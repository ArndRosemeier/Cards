import { makeDeck, rankOf, suitOf, RANKS, type Card, type GameRules, type Rng, type Seat, type TrickEv } from "@cards/engine";

/** Seats: 0=N 1=E 2=S 3=W. Partnerships NS (0,2) and EW (1,3). */
export type Strain = "C" | "D" | "H" | "S" | "N";
export const STRAINS: Strain[] = ["C", "D", "H", "S", "N"];
export type Call = { t: "bid"; level: number; suit: Strain } | { t: "pass" } | { t: "double" } | { t: "redouble" };
export interface Contract { level: number; suit: Strain; declarer: Seat; doubled: 0 | 1 | 2 }
export interface BridgeConfig { boards: number }
export const defaultConfig: BridgeConfig = { boards: 8 };

export interface BridgeState {
  hands: Card[][]; phase: "auction" | "play" | "over"; dealer: Seat; board: number; boards: number; scores: number[];
  auction: { seat: Seat; call: Call }[]; turn: Seat; contract: Contract | null; revealed: boolean;
  trick: { seat: Seat; card: Card }[]; tricks: [number, number]; vul: [boolean, boolean];
}
export type Move = Call | { t: "play"; card: Card };
export type Ev = TrickEv;
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: { seat: Seat; card: Card }[]; turn: Seat | null; scores: number[]; over: boolean;
  shown?: Record<number, Card[]>;
  phase: BridgeState["phase"]; dealer: Seat; board: number; boards: number; auction: { seat: Seat; call: Call }[]; contract: Contract | null; dummy: Seat | null;
  tricks: [number, number]; vul: [boolean, boolean]; controller: Seat | null;
}

const N = 4;
const side = (s: Seat) => s % 2;
export const VUL: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true], [true, false], [false, true], [true, true], [false, false],
  [false, true], [true, true], [false, false], [true, false], [true, true], [false, false], [true, false], [false, true]];
export const hcp = (hand: Card[]) => hand.reduce((a, c) => a + (({ A: 4, K: 3, Q: 2, J: 1 } as Record<string, number>)[rankOf(c)] ?? 0), 0);
const strainIdx = (s: Strain) => STRAINS.indexOf(s);
const rankVal = (c: Card) => RANKS.indexOf(rankOf(c));

export function lastBid(s: { auction: { seat: Seat; call: Call }[] }): { seat: Seat; level: number; suit: Strain } | null {
  for (let i = s.auction.length - 1; i >= 0; i--) { const c = s.auction[i]!.call; if (c.t === "bid") return { seat: s.auction[i]!.seat, level: c.level, suit: c.suit }; }
  return null;
}
function doubledState(auction: { seat: Seat; call: Call }[]): 0 | 1 | 2 {
  let d: 0 | 1 | 2 = 0;
  for (const a of auction) { if (a.call.t === "bid") d = 0; else if (a.call.t === "double") d = 1; else if (a.call.t === "redouble") d = 2; }
  return d;
}

export function legalCalls(s: BridgeState, seat: Seat): Call[] {
  const out: Call[] = [{ t: "pass" }];
  const lb = lastBid(s);
  for (let level = 1; level <= 7; level++) for (const suit of STRAINS) {
    if (!lb || level > lb.level || (level === lb.level && strainIdx(suit) > strainIdx(lb.suit))) out.push({ t: "bid", level, suit });
  }
  if (lb) {
    const d = doubledState(s.auction);
    if (side(lb.seat) !== side(seat) && d === 0) out.push({ t: "double" });
    if (side(lb.seat) === side(seat) && d === 1) out.push({ t: "redouble" });
  }
  return out;
}

function deal(s: BridgeState, rng: Rng, events: Ev[]) {
  const deck = rng.shuffle(makeDeck());
  s.hands = Array.from({ length: N }, (_, i) => deck.slice(i * 13, i * 13 + 13));
  s.phase = "auction"; s.auction = []; s.contract = null; s.revealed = false; s.trick = []; s.tricks = [0, 0];
  s.vul = VUL[(s.board - 1) % 16]!; s.turn = s.dealer;
  events.push({ t: "newRound" });
  for (let i = 0; i < N; i++) events.push({ t: "dealt", seat: i, count: 13 });
}
const dummyOf = (c: Contract) => (c.declarer + 2) % N;

export function playable(s: BridgeState, seat: Seat): Card[] {
  const hand = s.hands[s.turn]!; void seat;
  if (!s.trick.length) return hand;
  const led = suitOf(s.trick[0]!.card);
  const f = hand.filter((c) => suitOf(c) === led);
  return f.length ? f : hand;
}
function trickWinner(trick: { seat: Seat; card: Card }[], trump: Strain): Seat {
  const led = suitOf(trick[0]!.card); let best = trick[0]!;
  for (const p of trick.slice(1)) {
    const a = suitOf(p.card), b = suitOf(best.card);
    if (a === b ? rankVal(p.card) > rankVal(best.card) : trump !== "N" && a === trump && b !== trump) best = p;
  }
  void led; return best.seat;
}

export const Bridge: GameRules<BridgeConfig, BridgeState, Move, View, Ev> = {
  id: "bridge", minSeats: 4, maxSeats: 4,

  setup(config, _s, rng) {
    const s = { hands: [], phase: "auction", dealer: 0, board: 1, boards: config.boards, scores: [0, 0, 0, 0], auction: [], turn: 0, contract: null, revealed: false, trick: [], tricks: [0, 0], vul: [false, false] } as BridgeState;
    const events: Ev[] = []; deal(s, rng, events); return { state: s, events };
  },
  activeSeats(s) {
    if (s.phase === "over") return [];
    if (s.phase === "play" && s.contract && s.turn === dummyOf(s.contract)) return [s.contract.declarer];
    return [s.turn];
  },
  legalMoves(s, seat) {
    if (s.phase === "over" || !Bridge.activeSeats(s).includes(seat)) return [];
    if (s.phase === "auction") return legalCalls(s, seat);
    return playable(s, seat).map((card): Move => ({ t: "play", card }));
  },

  apply(prev, seat, move, rng) {
    const s: BridgeState = structuredClone(prev);
    const events: Ev[] = [];
    if (!Bridge.activeSeats(prev).includes(seat)) throw new Error("not your turn");
    if (!Bridge.legalMoves(prev, seat).some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    if (move.t !== "play") {
      s.auction.push({ seat, call: move });
      const a = s.auction;
      events.push({ t: "say", seat, key: "br_call", vars: { call: callText(move) } });
      const bids = a.some((x) => x.call.t === "bid");
      const tail = a.slice(-3).every((x) => x.call.t === "pass");
      if (!bids && a.length === 4 && a.every((x) => x.call.t === "pass")) {
        events.push({ t: "say", seat: null, key: "br_passedOut" });
        s.board++; s.dealer = (s.dealer + 1) % N;
        if (s.board > s.boards) s.phase = "over"; else deal(s, rng, events);
      } else if (bids && tail && a.length >= 4) {
        const lb = lastBid(s)!;
        const first = a.find((x) => x.call.t === "bid" && x.call.suit === lb.suit && side(x.seat) === side(lb.seat))!;
        s.contract = { level: lb.level, suit: lb.suit, declarer: first.seat, doubled: doubledState(a) };
        s.phase = "play"; s.turn = (s.contract.declarer + 1) % N;
        events.push({ t: "say", seat: s.contract.declarer, key: "br_contract" });
      } else s.turn = (seat + 1) % N;
      return { state: s, events };
    }

    const c = s.contract!, owner = s.turn;
    const hand = s.hands[owner]!; hand.splice(hand.indexOf(move.card), 1);
    s.trick.push({ seat: owner, card: move.card });
    events.push({ t: "played", seat: owner, card: move.card });
    if (!s.revealed) { s.revealed = true; const d = dummyOf(c); events.push({ t: "reveal", seat: d, cards: s.hands[d]!.slice() }); }
    if (s.trick.length < N) { s.turn = (owner + 1) % N; return { state: s, events }; }
    const w = trickWinner(s.trick, c.suit);
    s.tricks[side(w)]++;
    events.push({ t: "trickDone", winner: w });
    s.trick = []; s.turn = w;
    if (s.hands[0]!.length === 0) {
      const pts = scoreContract(c, s.tricks[side(c.declarer)]!, s.vul[side(c.declarer)]!);
      const sign = (team: number) => (team === side(c.declarer) ? pts : -pts);
      s.scores = s.scores.map((x, i) => x + (side(i) === 0 ? sign(0) : sign(1)));
      events.push({ t: "say", seat: c.declarer, key: pts >= 0 ? "br_made" : "br_down", vars: { n: Math.abs(pts), tricks: s.tricks[side(c.declarer)]! } });
      s.board++; s.dealer = (s.dealer + 1) % N;
      if (s.board > s.boards) s.phase = "over"; else deal(s, rng, events);
    }
    return { state: s, events };
  },

  view(s, seat) {
    const me = seat === "public" ? null : seat;
    const dummy = s.contract ? dummyOf(s.contract) : null;
    return {
      you: seat, hand: me === null ? [] : s.hands[me]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0, trick: s.trick.slice(),
      turn: s.phase === "over" ? null : Bridge.activeSeats(s)[0] ?? null, scores: s.scores.slice(), over: s.phase === "over",
      ...(s.revealed && dummy !== null ? { shown: { [dummy]: s.hands[dummy]!.slice() } } : {}),
      phase: s.phase, dealer: s.dealer, board: s.board, boards: s.boards, auction: s.auction.slice(), contract: s.contract ? { ...s.contract } : null, dummy,
      tricks: [...s.tricks] as [number, number], vul: [...s.vul] as [boolean, boolean], controller: s.phase === "play" ? Bridge.activeSeats(s)[0] ?? null : null,
    };
  },
  result(s) {
    if (s.phase !== "over") return null;
    const ns = s.scores[0]!, ew = s.scores[1]!;
    return { winners: ns === ew ? [0, 1, 2, 3] : ns > ew ? [0, 2] : [1, 3], scores: s.scores };
  },
};

export const callText = (c: Call) => (c.t === "bid" ? `${c.level}${c.suit === "N" ? "NT" : c.suit}` : c.t === "pass" ? "Pass" : c.t === "double" ? "X" : "XX");

/** Duplicate bridge scoring for the declaring side (negative if the contract fails). */
export function scoreContract(c: Contract, tricksTaken: number, vul: boolean): number {
  const need = 6 + c.level, d = c.doubled;
  const per = c.suit === "C" || c.suit === "D" ? 20 : 30;
  if (tricksTaken < need) {
    const down = need - tricksTaken;
    if (d === 0) return -(vul ? 100 : 50) * down;
    let total = 0;
    for (let i = 1; i <= down; i++) total += vul ? (i === 1 ? 200 : 300) : (i === 1 ? 100 : i <= 3 ? 200 : 300);
    return -total * (d === 2 ? 2 : 1);
  }
  const over = tricksTaken - need;
  let trick = c.suit === "N" ? 40 + 30 * (c.level - 1) : per * c.level;
  trick *= d === 0 ? 1 : d === 1 ? 2 : 4;
  let total = trick;
  total += trick >= 100 ? (vul ? 500 : 300) : 50;
  if (c.level === 6) total += vul ? 750 : 500; if (c.level === 7) total += vul ? 1500 : 1000;
  if (d === 0) total += over * per_over(c);
  else total += over * (vul ? 200 : 100) * (d === 2 ? 2 : 1);
  if (d === 1) total += 50; if (d === 2) total += 100;
  return total;
}
const per_over = (c: Contract) => (c.suit === "C" || c.suit === "D" ? 20 : c.suit === "N" ? 30 : 30);
