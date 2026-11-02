import { Rng, type Bot, type GameRules, type GameResult, type Seat } from "@cards/engine";

export type SeatSpec =
  | { kind: "human"; name: string }
  | { kind: "bot"; name: string; level?: number };

/** What a seat's client receives after every state change. */
export interface Update<View, Move, Ev> {
  seq: number;
  events: Ev[];            // already redacted for this seat
  view: View;              // the seat's own view after the events
  legal: Move[];           // legal moves for this seat (empty when it is not its turn)
  result: GameResult | null;
  seats: SeatSpec[];
}
export type Link<View, Move, Ev> = (u: Update<View, Move, Ev>) => void;

export interface HostOptions {
  seed?: number | string;
  /** Delay before a bot acts, ms. Gives animations time to play. */
  botDelay?: (rng: Rng) => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  /** Called after every state change (used to keep a shadow copy on the host's successor). */
  onChange?: () => void;
}

export interface TableSnapshot<State> { state: State; seq: number; rng: number; seats: SeatSpec[] }

/**
 * The authoritative table. Runs the rules, owns the seat map, drives bots, and fans out per-seat updates.
 * It is transport-agnostic: local play attaches in-process links, online play attaches GameHub links.
 */
export class TableHost<Config, State, Move, View, Ev> {
  state!: State;
  seq = 0;
  readonly rng: Rng;
  private links = new Map<Seat, Link<View, Move, Ev>>();
  private bots = new Map<Seat, Bot<View, Move>>();
  private lastEvents: Ev[] = [];
  private timer: unknown = null;
  private paused = false;
  private readonly schedule: (fn: () => void, ms: number) => unknown;

  readonly rules: GameRules<Config, State, Move, View, Ev>;
  readonly config: Config;
  seats: SeatSpec[];
  private readonly makeBot: (spec: SeatSpec & { kind: "bot" }) => Bot<View, Move>;
  private readonly opts: HostOptions;

  constructor(
    rules: GameRules<Config, State, Move, View, Ev>,
    config: Config,
    seats: SeatSpec[],
    makeBot: (spec: SeatSpec & { kind: "bot" }) => Bot<View, Move>,
    opts: HostOptions = {},
  ) {
    this.rules = rules; this.config = config; this.seats = seats; this.makeBot = makeBot; this.opts = opts;
    this.rng = Rng.fromSeed(opts.seed ?? Date.now());
    this.schedule = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    seats.forEach((s, i) => { if (s.kind === "bot") this.bots.set(i, makeBot(s)); });
  }

  attach(seat: Seat, link: Link<View, Move, Ev>): void {
    this.links.set(seat, link);
    if (this.seq > 0) link(this.updateFor(seat, [])); // late join / reconnect: current state, no events
  }
  detach(seat: Seat): void { this.links.delete(seat); }

  /** Replace a seat's occupant, e.g. a bot takes over for a player who left. */
  setSeat(seat: Seat, spec: SeatSpec): void {
    this.seats[seat] = spec;
    if (spec.kind === "bot") this.bots.set(seat, this.makeBot(spec)); else this.bots.delete(seat);
    this.broadcast([]);
    this.pump();
  }

  start(): void {
    const { state, events } = this.rules.setup(this.config, this.seats.length, this.rng);
    this.state = state;
    this.broadcast(events);
    this.pump();
  }

  /** A human (or remote) seat plays a move. Throws on illegal moves. */
  submit(seat: Seat, move: Move): void {
    if (this.paused || this.rules.result(this.state)) return;
    const { state, events } = this.rules.apply(this.state, seat, move, this.rng);
    this.state = state;
    this.broadcast(events);
    this.pump();
  }

  snapshot(): TableSnapshot<State> {
    return { state: structuredClone(this.state), seq: this.seq, rng: this.rng.state, seats: structuredClone(this.seats) };
  }
  /** Resume from a snapshot (host migration). Call attach() for the seats afterwards, then resume(). */
  restore(snap: TableSnapshot<State>): void {
    this.state = structuredClone(snap.state); this.seq = snap.seq; this.rng.state = snap.rng;
    this.seats = structuredClone(snap.seats);
    this.bots.clear();
    this.seats.forEach((s, i) => { if (s.kind === "bot") this.bots.set(i, this.makeBot(s)); });
  }
  resume(): void { this.broadcast([]); this.pump(); }

  pause(on: boolean): void { this.paused = on; if (!on) this.pump(); }
  dispose(): void { this.paused = true; this.links.clear(); }

  private updateFor(seat: Seat, events: Ev[]): Update<View, Move, Ev> {
    const redact = this.rules.redactEvent;
    return {
      seq: this.seq,
      events: redact ? events.map((e) => redact.call(this.rules, e, seat)) : events,
      view: this.rules.view(this.state, seat),
      legal: this.rules.legalMoves(this.state, seat),
      result: this.rules.result(this.state),
      seats: this.seats,
    };
  }

  private broadcast(events: Ev[]): void {
    this.seq++;
    this.lastEvents = events;
    for (const [seat, link] of this.links) link(this.updateFor(seat, events));
    this.opts.onChange?.();
  }

  private pump(): void {
    if (this.paused || this.timer || this.rules.result(this.state)) return;
    const seat = this.rules.activeSeats(this.state).find((s) => this.bots.has(s));
    if (seat === undefined) return;
    const delay = this.opts.botDelay ? this.opts.botDelay(this.rng) : 900 + this.rng.int(700);
    this.timer = this.schedule(() => {
      this.timer = null;
      if (this.paused || this.rules.result(this.state)) return;
      const bot = this.bots.get(seat);
      if (!bot || !this.rules.activeSeats(this.state).includes(seat)) return this.pump();
      const move = bot.choose(this.rules.view(this.state, seat), this.rules.legalMoves(this.state, seat), this.rng);
      this.submit(seat, move);
    }, delay);
  }
}
