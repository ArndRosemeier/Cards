import { makeDeck, hide, type Card, type GameRules, type Rng, type Seat } from "@cards/engine";
import { bestScore, categoryOf, HAND_NAMES } from "./eval.ts";

export interface HoldemConfig { stack: number; sb: number; bb: number; handsPerLevel: number }
export const defaultConfig: HoldemConfig = { stack: 1000, sb: 10, bb: 20, handsPerLevel: 6 };

/** "between": the hand is decided and shown; seat 0 (the host) starts the next one */
type Phase = "preflop" | "flop" | "turn" | "river" | "between" | "over";
export interface HoldemState {
  stacks: number[]; hole: Card[][]; community: Card[]; deck: Card[]; dealer: Seat; phase: Phase;
  bets: number[]; total: number[]; folded: boolean[]; allIn: boolean[]; out: boolean[];
  cur: number; minRaise: number; pending: Seat[]; turn: Seat; handNo: number; sb: number; bb: number; handsPerLevel: number;
}
export type Move = { t: "fold" } | { t: "check" } | { t: "call" } | { t: "raise"; to: number } | { t: "next" };
export type Ev =
  | { t: "newHand"; hand: number; dealer: Seat; sb: number; bb: number }
  | { t: "blind"; seat: Seat; amount: number }
  | { t: "dealHole"; seat: Seat; cards: Card[] }
  | { t: "act"; seat: Seat; action: "fold" | "check" | "call" | "raise" | "allin"; amount: number; to: number }
  | { t: "community"; cards: Card[]; street: "flop" | "turn" | "river" }
  | { t: "sweep" }
  | { t: "show"; seat: Seat; cards: Card[]; hand: string }
  | { t: "award"; seat: Seat; amount: number; hand?: string }
  | { t: "out"; seat: Seat }
  | { t: "say"; seat: Seat | null; key: string; vars?: Record<string, string | number> };
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: never[]; turn: Seat | null; scores: number[]; over: boolean;
  stacks: number[]; bets: number[]; folded: boolean[]; allIn: boolean[]; out: boolean[]; community: Card[]; pot: number; dealer: Seat;
  toCall: number; minRaiseTo: number; maxRaiseTo: number; phase: Phase; handNo: number; sb: number; bb: number; inHand: boolean[];
}

const nextIn = (s: HoldemState, from: Seat, pred: (i: Seat) => boolean = (i) => !s.out[i]): Seat => {
  const n = s.stacks.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (pred(i)) return i; }
  return from;
};
const potOf = (s: HoldemState) => s.total.reduce((a, b) => a + b, 0);

function post(s: HoldemState, seat: Seat, amount: number, events: Ev[]) {
  const a = Math.min(amount, s.stacks[seat]!);
  s.stacks[seat]! -= a; s.bets[seat]! += a; s.total[seat]! += a;
  if (s.stacks[seat] === 0) s.allIn[seat] = true;
  events.push({ t: "blind", seat, amount: a });
}

function startHand(s: HoldemState, rng: Rng, events: Ev[]) {
  const n = s.stacks.length;
  s.handNo++;
  if (s.handNo > 1 && (s.handNo - 1) % s.handsPerLevel === 0) { s.sb *= 2; s.bb *= 2; events.push({ t: "say", seat: null, key: "blindsUp", vars: { sb: s.sb, bb: s.bb } }); }
  s.dealer = nextIn(s, s.dealer);
  const live = s.out.filter((o) => !o).length;
  const sbSeat = live === 2 ? s.dealer : nextIn(s, s.dealer);
  const bbSeat = nextIn(s, sbSeat);
  s.deck = rng.shuffle(makeDeck()); s.community = [];
  s.hole = Array.from({ length: n }, () => []);
  s.bets = Array(n).fill(0); s.total = Array(n).fill(0);
  s.folded = s.out.slice(); s.allIn = Array(n).fill(false); s.phase = "preflop";
  events.push({ t: "newHand", hand: s.handNo, dealer: s.dealer, sb: s.sb, bb: s.bb });
  for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) { const i = (s.dealer + k) % n; if (!s.out[i]) s.hole[i]!.push(s.deck.pop()!); }
  for (let i = 0; i < n; i++) if (!s.out[i]) events.push({ t: "dealHole", seat: i, cards: s.hole[i]!.slice() });
  post(s, sbSeat, s.sb, events); post(s, bbSeat, s.bb, events);
  s.cur = s.bb; s.minRaise = s.bb;
  const first = live === 2 ? sbSeat : nextIn(s, bbSeat);
  setPending(s, first);
}
/** Everyone still able to act, starting at `first`. */
function setPending(s: HoldemState, first: Seat) {
  const n = s.stacks.length; s.pending = [];
  for (let k = 0; k < n; k++) { const i = (first + k) % n; if (!s.folded[i] && !s.allIn[i]) s.pending.push(i); }
  s.turn = s.pending[0] ?? first;
}

function raiseRange(s: HoldemState, seat: Seat) {
  const maxTo = s.bets[seat]! + s.stacks[seat]!;
  const minTo = Math.min(maxTo, s.cur + s.minRaise);
  return { minTo, maxTo };
}

export const Holdem: GameRules<HoldemConfig, HoldemState, Move, View, Ev> = {
  id: "holdem", minSeats: 2, maxSeats: 9,

  setup(config, seats, rng) {
    const s: HoldemState = { stacks: Array(seats).fill(config.stack), hole: [], community: [], deck: [], dealer: seats - 1, phase: "preflop", bets: [], total: [], folded: [], allIn: [], out: Array(seats).fill(false),
      cur: 0, minRaise: config.bb, pending: [], turn: 0, handNo: 0, sb: config.sb, bb: config.bb, handsPerLevel: config.handsPerLevel };
    const events: Ev[] = []; startHand(s, rng, events);
    return { state: s, events };
  },

  activeSeats: (s) => (s.phase === "over" ? [] : s.phase === "between" ? [0] : [s.turn]),

  legalMoves(s, seat) {
    if (s.phase === "over" || seat !== s.turn) return [];
    if (s.phase === "between") return [{ t: "next" }];
    const toCall = s.cur - s.bets[seat]!;
    const out: Move[] = [];
    if (toCall > 0) out.push({ t: "fold" }, { t: "call" }); else out.push({ t: "check" });
    const { minTo, maxTo } = raiseRange(s, seat);
    if (maxTo > s.cur && s.stacks[seat]! > toCall) {
      const pot = potOf(s);
      const set = new Set<number>([minTo, maxTo]);
      for (const f of [0.5, 0.75, 1, 2]) { const to = Math.round(s.cur + (pot + toCall) * f); if (to > minTo && to < maxTo) set.add(to); }
      for (const to of [...set].sort((a, b) => a - b)) out.push({ t: "raise", to });
    }
    return out;
  },

  apply(prev, seat, move, rng) {
    const s: HoldemState = structuredClone(prev);
    const events: Ev[] = [];
    if (s.phase === "over" || seat !== s.turn) throw new Error("not your turn");
    if (s.phase === "between") {
      if (move.t !== "next") throw new Error("the hand is over");
      startHand(s, rng, events);
      return { state: s, events };
    }
    if (move.t === "next") throw new Error("no hand to finish");
    const toCall = s.cur - s.bets[seat]!;
    const put = (amt: number) => { s.stacks[seat]! -= amt; s.bets[seat]! += amt; s.total[seat]! += amt; if (s.stacks[seat] === 0) s.allIn[seat] = true; };
    s.pending.shift();
    if (move.t === "fold") {
      if (toCall <= 0) throw new Error("cannot fold for free");
      s.folded[seat] = true; events.push({ t: "act", seat, action: "fold", amount: 0, to: s.bets[seat]! });
    } else if (move.t === "check") {
      if (toCall > 0) throw new Error("cannot check");
      events.push({ t: "act", seat, action: "check", amount: 0, to: s.bets[seat]! });
    } else if (move.t === "call") {
      if (toCall <= 0) throw new Error("nothing to call");
      const a = Math.min(toCall, s.stacks[seat]!); put(a);
      events.push({ t: "act", seat, action: s.allIn[seat] ? "allin" : "call", amount: a, to: s.bets[seat]! });
    } else {
      const { minTo, maxTo } = raiseRange(s, seat);
      const to = Math.floor(move.to);
      if (!(to === maxTo || (to >= minTo && to <= maxTo)) || to <= s.cur) throw new Error("bad raise");
      const a = to - s.bets[seat]!; const size = to - s.cur;
      put(a);
      if (size >= s.minRaise) s.minRaise = size;
      s.cur = to;
      s.pending = []; const n = s.stacks.length;
      for (let k = 1; k < n; k++) { const i = (seat + k) % n; if (!s.folded[i] && !s.allIn[i]) s.pending.push(i); }
      events.push({ t: "act", seat, action: s.allIn[seat] ? "allin" : "raise", amount: a, to });
    }
    advance(s, rng, events);
    return { state: s, events };
  },

  view(s, seat) {
    const me = seat === "public" ? null : seat;
    const { minTo, maxTo } = me !== null && s.turn === me && s.phase !== "over" && s.phase !== "between" ? raiseRange(s, me) : { minTo: 0, maxTo: 0 };
    return {
      you: seat, hand: me === null ? [] : s.hole[me]!.slice(), handSizes: s.hole.map((h) => h.length), talon: 0, trick: [], turn: s.phase === "over" ? null : s.turn,
      scores: s.stacks.slice(), over: s.phase === "over", stacks: s.stacks.slice(), bets: s.bets.slice(), folded: s.folded.slice(), allIn: s.allIn.slice(), out: s.out.slice(),
      community: s.community.slice(), pot: potOf(s), dealer: s.dealer, toCall: me !== null && s.phase !== "between" ? Math.max(0, s.cur - s.bets[me]!) : 0, minRaiseTo: minTo, maxRaiseTo: maxTo,
      phase: s.phase, handNo: s.handNo, sb: s.sb, bb: s.bb, inHand: s.folded.map((f) => !f),
    };
  },
  redactEvent(ev, seat) { return ev.t === "dealHole" && ev.seat !== seat ? { ...ev, cards: hide(ev.cards) } : ev; },
  result(s) {
    if (s.phase !== "over") return null;
    const w = s.stacks.findIndex((x) => x > 0);
    return { winners: [w], scores: s.stacks };
  },
};

function advance(s: HoldemState, rng: Rng, events: Ev[]) {
  const alive = s.folded.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (alive.length === 1) { sweep(s, events); award(s, rng, events, false); return; }
  if (s.pending.length > 0 && !(s.pending.length === 1 && s.bets[s.pending[0]!] === s.cur && alive.filter((i) => !s.allIn[i]).length === 1)) {
    s.turn = s.pending[0]!; return;
  }
  // betting round complete
  sweep(s, events);
  const canAct = alive.filter((i) => !s.allIn[i]);
  const street = (): void => {
    if (s.phase === "preflop") { s.phase = "flop"; deck3(s, events, "flop"); }
    else if (s.phase === "flop") { s.phase = "turn"; deck1(s, events, "turn"); }
    else if (s.phase === "turn") { s.phase = "river"; deck1(s, events, "river"); }
  };
  if (s.phase === "river") { award(s, rng, events, true); return; }
  street();
  if (canAct.length <= 1) { // run out the board
    while ((s.phase as string) !== "river") street();
    award(s, rng, events, true); return;
  }
  s.cur = 0; s.minRaise = s.bb; s.bets = s.bets.map(() => 0);
  const live = s.out.filter((o) => !o).length;
  setPending(s, live === 2 ? nextIn(s, s.dealer, (i) => !s.out[i]) : nextIn(s, s.dealer, (i) => !s.folded[i] && !s.allIn[i] && !s.out[i]) );
  // first to act postflop: first live player left of the dealer
  const n = s.stacks.length; s.pending = [];
  for (let k = 1; k <= n; k++) { const i = (s.dealer + k) % n; if (!s.folded[i] && !s.allIn[i]) s.pending.push(i); }
  s.turn = s.pending[0]!;
}
function deck3(s: HoldemState, events: Ev[], street: "flop") { s.deck.pop(); const c = [s.deck.pop()!, s.deck.pop()!, s.deck.pop()!]; s.community.push(...c); events.push({ t: "community", cards: c, street }); }
function deck1(s: HoldemState, events: Ev[], street: "turn" | "river") { s.deck.pop(); const c = s.deck.pop()!; s.community.push(c); events.push({ t: "community", cards: [c], street }); }
function sweep(s: HoldemState, events: Ev[]) { if (s.bets.some((b) => b > 0)) events.push({ t: "sweep" }); s.bets = s.bets.map(() => 0); }

function award(s: HoldemState, rng: Rng, events: Ev[], showdown: boolean) {
  const n = s.stacks.length;
  const alive = s.folded.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  const scores = new Map<Seat, number>();
  if (showdown && alive.length > 1) for (const i of alive) {
    const sc = bestScore([...s.hole[i]!, ...s.community]); scores.set(i, sc);
    events.push({ t: "show", seat: i, cards: s.hole[i]!.slice(), hand: HAND_NAMES[categoryOf(sc)]! });
  }
  // side pots by contribution levels
  const levels = [...new Set(s.total.filter((x) => x > 0))].sort((a, b) => a - b);
  let prev = 0; const won = Array(n).fill(0);
  for (const lvl of levels) {
    const contributors = [...Array(n).keys()].filter((i) => s.total[i]! >= lvl);
    const pot = (lvl - prev) * contributors.length; prev = lvl;
    const eligible = contributors.filter((i) => !s.folded[i]);
    if (!eligible.length) { // everyone who paid this level folded: give to the next best
      const e2 = alive; won[e2[0]!] += pot; continue;
    }
    let winners = eligible;
    if (scores.size) { const best = Math.max(...eligible.map((i) => scores.get(i) ?? -1)); winners = eligible.filter((i) => (scores.get(i) ?? -1) === best); }
    const share = Math.floor(pot / winners.length); let rem = pot - share * winners.length;
    // odd chips go to the first winner left of the dealer
    const order = [...winners].sort((a, b) => ((a - s.dealer + n) % n) - ((b - s.dealer + n) % n));
    for (const w of order) { won[w] += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  }
  for (let i = 0; i < n; i++) if (won[i] > 0) {
    s.stacks[i]! += won[i];
    events.push({ t: "award", seat: i, amount: won[i], ...(scores.has(i) ? { hand: HAND_NAMES[categoryOf(scores.get(i)!)]! } : {}) });
  }
  s.total = Array(n).fill(0);
  for (let i = 0; i < n; i++) if (!s.out[i] && s.stacks[i] === 0) { s.out[i] = true; events.push({ t: "out", seat: i }); }
  if (s.out.filter((o) => !o).length <= 1) { s.phase = "over"; return; }
  s.phase = "between"; s.turn = 0; s.pending = [];
}
