import type { Bot, GameRules } from "@cards/engine";
import { connect, type GameHub, type RoomSummary } from "./gamehub.ts";
import { TableHost, type SeatSpec, type TableSnapshot, type Update } from "./host.ts";

export interface LobbySeat { kind: "host" | "human" | "bot" | "open"; name: string; away?: boolean }
export interface LobbyState { phase: "lobby" | "playing"; game: string; seats: LobbySeat[] }

/** Everything the session needs to know about one game. */
export interface GameDef<Config, State, Move, View, Ev> {
  id: string;
  rules: GameRules<Config, State, Move, View, Ev>;
  config: Config;
  makeBot: (spec: SeatSpec & { kind: "bot" }) => Bot<View, Move>;
  botDelay?: (rng: any) => number;
}

type Msg =
  | { t: "hello"; token: string; name: string }
  | { t: "move"; move: unknown }
  | { t: "seat"; seat: number }
  | { t: "update"; u: Update<any, any, any> }
  | { t: "rehello" }
  | { t: "full" }
  | { t: "emote"; seat: number; id: string }
  | { t: "chat"; seat: number; name: string; text: string }
  | { t: "shadow"; snap: TableSnapshot<any>; lobby: LobbyState; tokens: (string | null)[] };

export interface SessionOptions {
  url?: string; appKey?: string; access?: boolean;
  name: string;
  token: string;
  /** Delay before a migrated host gives up waiting for a shadow copy, etc. (tests may shorten) */
}

type Events<V, M, E> = {
  update: (u: Update<V, M, E>) => void;
  lobby: (l: LobbyState) => void;
  seat: (seat: number) => void;
  role: (isHost: boolean) => void;
  error: (code: string) => void;
  emote: (seat: number, id: string) => void;
  chat: (seat: number, name: string, text: string) => void;
};

/**
 * One player's connection to an online table. It is a client until/unless it becomes the host:
 * the creator starts as host, and any client can be promoted when the host leaves (using the shadow
 * copy it keeps if it is the designated successor).
 */
export class OnlineSession<Config, State, Move, View, Ev> {
  readonly hub: GameHub<LobbyState, never, Msg>;
  lobby: LobbyState;
  mySeat: number | null = null;
  isHost = false;
  table: TableHost<Config, State, Move, View, Ev> | null = null;
  private tokens: (string | null)[] = [];
  private seatByPlayer = new Map<number, number>();
  private shadow: { snap: TableSnapshot<State>; lobby: LobbyState; tokens: (string | null)[] } | null = null;
  private listeners: { [K in keyof Events<View, Move, Ev>]: Set<Events<View, Move, Ev>[K]> } = {
    update: new Set(), lobby: new Set(), seat: new Set(), role: new Set(), error: new Set(), emote: new Set(), chat: new Set(),
  };
  private readonly def: GameDef<Config, State, Move, View, Ev>;
  private readonly opts: SessionOptions;

  private constructor(def: GameDef<Config, State, Move, View, Ev>, opts: SessionOptions) {
    this.def = def; this.opts = opts;
    this.lobby = { phase: "lobby", game: def.id, seats: [] };
    this.hub = connect<LobbyState, never, Msg>({ url: opts.url, app: "cards", appKey: opts.appKey, access: opts.access, name: opts.name });
    this.hub.on("msg", (m, from) => this.onMsg(m, from));
    this.hub.on("state", (s) => { if (!this.isHost) { this.lobby = s; this.emit("lobby", s); } });
    this.hub.on("player-", (id) => this.onPlayerLeft(id));
    this.hub.on("player+", () => this.sendShadow());
    this.hub.on("host", (id) => { if (id === this.hub.you) this.promote(); });
    this.hub.on("close", () => { if (!this.left) this.emit("error", "connection_closed"); });
  }

  static async create<C, S, M, V, E>(def: GameDef<C, S, M, V, E>, opts: SessionOptions, room: { name: string; seats: number; public?: boolean }) {
    const s = new OnlineSession<C, S, M, V, E>(def, opts);
    try {
      await s.hub.ready;
      await s.hub.create({ name: room.name, public: room.public ?? true, maxPlayers: Math.max(room.seats, def.rules.maxSeats), meta: { game: def.id, v: 1, seats: room.seats } });
    } catch (e) { s.hub.close(); throw e; }
    s.isHost = true; s.mySeat = 0;
    s.tokens = Array(room.seats).fill(null); s.tokens[0] = opts.token;
    s.lobby = { phase: "lobby", game: def.id, seats: [{ kind: "host", name: opts.name }, ...Array.from({ length: room.seats - 1 }, (): LobbySeat => ({ kind: "open", name: "" }))] };
    s.publishLobby();
    s.emit("seat", 0); s.emit("role", true);
    return s;
  }

  static async join<C, S, M, V, E>(def: GameDef<C, S, M, V, E>, opts: SessionOptions, code: string) {
    const s = new OnlineSession<C, S, M, V, E>(def, opts);
    try { await s.hub.ready; await s.hub.join(code); } catch (e) { s.hub.close(); throw e; }
    s.emit("role", false);
    s.hub.send({ t: "hello", token: opts.token, name: opts.name }, s.hub.host!);
    return s;
  }

  get code(): string | null { return this.hub.room?.id ?? null; }

  on<K extends keyof Events<View, Move, Ev>>(ev: K, fn: Events<View, Move, Ev>[K]): () => void {
    (this.listeners[ev] as Set<unknown>).add(fn);
    return () => { (this.listeners[ev] as Set<unknown>).delete(fn); };
  }
  private emit<K extends keyof Events<View, Move, Ev>>(ev: K, ...args: Parameters<Events<View, Move, Ev>[K]>) {
    for (const fn of this.listeners[ev]) { try { (fn as (...a: unknown[]) => void)(...args); } catch (e) { console.error(e); } }
  }

  // ---- host side -------------------------------------------------------------------------------

  private publishLobby() {
    this.hub.setState(this.lobby);
    this.emit("lobby", this.lobby);
  }

  /** Host, lobby phase: make seat `i` open for a human or a bot. */
  setSeatKind(i: number, kind: "open" | "bot", botName = "") {
    if (!this.isHost || this.lobby.phase !== "lobby" || i === 0) return;
    const cur = this.lobby.seats[i]!;
    if (cur.kind === "human" || cur.kind === "host") return;
    this.lobby.seats[i] = { kind, name: kind === "bot" ? botName : "" };
    this.publishLobby();
  }

  startGame(botNames: string[] = ["Anna", "Ben", "Clara", "Dario", "Eva", "Finn", "Gina", "Hugo"]) {
    if (!this.isHost || this.lobby.phase !== "lobby") return;
    let b = 0;
    const seats: SeatSpec[] = this.lobby.seats.map((s, i) => {
      if (s.kind === "host" || s.kind === "human") return { kind: "human", name: s.name };
      const name = s.name || botNames[b++ % botNames.length]!;
      this.lobby.seats[i] = { kind: "bot", name };
      return { kind: "bot", name };
    });
    this.lobby.phase = "playing";
    this.buildTable(seats);
    seats.forEach((sp, i) => { if (sp.kind === "human") this.table!.attach(i, this.linkFor(i)); });
    this.table!.start();
    this.hub.setRoom({ public: false });
    this.publishLobby();
  }

  private buildTable(seats: SeatSpec[]) {
    this.table = new TableHost(this.def.rules, this.def.config, seats, this.def.makeBot, {
      onChange: () => this.sendShadow(),
      ...(this.def.botDelay ? { botDelay: this.def.botDelay } : {}),
    });
  }

  private linkFor(seat: number) {
    return (u: Update<View, Move, Ev>) => {
      if (seat === this.mySeat) { this.emit("update", u); return; }
      const pid = [...this.seatByPlayer].find(([, s]) => s === seat)?.[0];
      if (pid !== undefined) this.hub.send({ t: "update", u }, pid);
    };
  }

  private handleHello(from: number, token: string, name: string) {
    if (!this.isHost) return;
    let idx = this.tokens.findIndex((t) => t === token);
    if (idx < 0 && this.lobby.phase === "lobby") idx = this.lobby.seats.findIndex((s) => s.kind === "open");
    if (idx < 0) { this.hub.send({ t: "full" }, from); return; }
    // the same token may be re-used by a new connection: drop the stale player mapping
    for (const [pid, s] of this.seatByPlayer) if (s === idx) this.seatByPlayer.delete(pid);
    this.tokens[idx] = token;
    this.seatByPlayer.set(from, idx);
    this.lobby.seats[idx] = { kind: idx === this.mySeat ? "host" : "human", name };
    this.hub.send({ t: "seat", seat: idx }, from);
    if (this.table) {
      this.table.detach(idx);
      this.table.setSeat(idx, { kind: "human", name });
      this.table.attach(idx, this.linkFor(idx));
    }
    this.publishLobby();
  }

  private onPlayerLeft(id: number) {
    if (!this.isHost) return;
    const seat = this.seatByPlayer.get(id);
    this.seatByPlayer.delete(id);
    if (seat === undefined) { this.sendShadow(); return; }
    const name = this.lobby.seats[seat]!.name;
    if (this.table) {
      this.table.detach(seat);
      this.table.setSeat(seat, { kind: "bot", name });
      this.lobby.seats[seat] = { kind: "bot", name, away: true };
    } else {
      this.lobby.seats[seat] = { kind: "open", name: "" };
      this.tokens[seat] = null;
    }
    this.publishLobby();
    this.sendShadow();
  }

  private sendShadow() {
    if (!this.isHost || !this.table) return;
    const ids = this.hub.players.map((p) => p.id).filter((id) => id !== this.hub.you).sort((a, b) => a - b);
    if (!ids.length) return;
    this.hub.send({ t: "shadow", snap: this.table.snapshot(), lobby: this.lobby, tokens: this.tokens }, ids[0]);
  }

  // ---- client side + migration --------------------------------------------------------------------

  private onMsg(m: Msg, from: number) {
    switch (m.t) {
      case "hello": this.handleHello(from, m.token, m.name); break;
      case "move": {
        if (!this.isHost || !this.table) return;
        const seat = this.seatByPlayer.get(from);
        if (seat === undefined) return;
        try { this.table.submit(seat, m.move as Move); }
        catch { this.table.detach(seat); this.table.attach(seat, this.linkFor(seat)); } // illegal move: resync that seat
        break;
      }
      case "seat": this.mySeat = m.seat; this.emit("seat", m.seat); break;
      case "update": this.emit("update", m.u as Update<View, Move, Ev>); break;
      case "rehello": if (!this.isHost) this.hub.send({ t: "hello", token: this.opts.token, name: this.opts.name }, from); break;
      case "full": this.emit("error", "room_full"); break;
      case "emote": if (m.seat !== this.mySeat && typeof m.id === "string") this.emit("emote", m.seat, m.id.slice(0, 16)); break;
      case "chat": if (m.seat !== this.mySeat && typeof m.text === "string") this.emit("chat", m.seat, String(m.name ?? "").slice(0, 24), m.text.slice(0, 240)); break;
      case "shadow": this.shadow = { snap: m.snap, lobby: m.lobby, tokens: m.tokens }; break;
    }
  }

  /** Called when GameHub made this client the host after the previous host left. */
  private promote() {
    if (this.isHost) return;
    const prev = this.lobby;
    this.isHost = true;
    const me = this.mySeat;
    if (me === null) { this.emit("error", "host_lost"); return; }
    if (this.shadow && this.shadow.lobby.phase === "playing") {
      const { snap, lobby, tokens } = this.shadow;
      this.tokens = tokens.slice();
      this.lobby = lobby;
      // everyone except me is unreachable until they answer rehello: bots hold their seats meanwhile
      const seats: SeatSpec[] = snap.seats.map((s, i) => (i !== me && s.kind === "human" ? { kind: "bot", name: `${s.name} (Bot)` } : s));
      this.lobby.seats = this.lobby.seats.map((s, i) => (i === me ? { ...s, kind: "host" } : s.kind === "human" || s.kind === "host" ? { kind: "bot", name: s.name, away: true } : s));
      this.buildTable(seats);
      this.table!.restore({ ...snap, seats });
      this.table!.attach(me, this.linkFor(me));
      this.table!.resume();
    } else if (prev.phase === "lobby") {
      this.tokens = prev.seats.map(() => null); this.tokens[me] = this.opts.token;
      this.lobby = { ...prev, seats: prev.seats.map((s, i): LobbySeat => (i === me ? { kind: "host", name: this.opts.name } : { kind: s.kind === "bot" ? "bot" : "open", name: s.kind === "bot" ? s.name : "" })) };
    } else { this.isHost = false; this.emit("error", "host_lost"); return; }
    this.emit("role", true);
    this.publishLobby();
    this.hub.send({ t: "rehello" });
  }

  submit(move: Move) {
    if (this.isHost) {
      if (this.table && this.mySeat !== null) {
        try { this.table.submit(this.mySeat, move); } catch (e) { console.error("illegal move", e); }
      }
    } else if (this.hub.host !== null) this.hub.send({ t: "move", move }, this.hub.host);
  }

  /** Show a quick reaction at the own seat for everyone at the table. */
  /** Table chat: goes to everyone else in the room; the sender also gets it back through the "chat" event. */
  sendChat(text: string) {
    const msg = text.trim().slice(0, 240);
    if (!msg || this.mySeat === null) return;
    this.hub.send({ t: "chat", seat: this.mySeat, name: this.opts.name, text: msg });
    this.emit("chat", this.mySeat, this.opts.name, msg);
  }
  sendEmote(id: string) { if (this.mySeat !== null) this.hub.send({ t: "emote", seat: this.mySeat, id }); }

  private left = false;
  leave() { this.left = true; this.hub.close(); this.table?.dispose(); }
}

export type { RoomSummary };
