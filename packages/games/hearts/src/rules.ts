import { makeDeck, rankOf, suitOf, RANKS, hide, HIDDEN, type Card, type GameRules, type Rng, type Seat, type Suit, type TrickEv } from "@cards/engine";

export interface HeartsConfig { target: number; passing: boolean }
export const defaultConfig: HeartsConfig = { target: 100, passing: true };

export interface HeartsState {
  hands: Card[][];
  phase: "pass" | "play" | "over";
  passDir: 0 | 1 | 2 | 3;            // left, right, across, none
  pending: (Card[] | null)[];         // chosen pass cards
  trick: { seat: Seat; card: Card }[];
  turn: Seat;
  broken: boolean;
  taken: Card[][];
  scores: number[];
  round: number;
  firstTrick: boolean;
  target: number;
  passing: boolean;
}
export type Move = { t: "cards"; cards: Card[] } | { t: "play"; card: Card };
export type Ev = TrickEv;
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: { seat: Seat; card: Card }[];
  turn: Seat | null; scores: number[]; over: boolean;
  phase: HeartsState["phase"]; passDir: number; roundPoints: number[]; broken: boolean; waiting: boolean;
}

const N = 4;
const rankVal = (c: Card) => RANKS.indexOf(rankOf(c));
export const points = (c: Card) => (suitOf(c) === "H" ? 1 : c === "SQ" ? 13 : 0);
const sum = (cs: Card[]) => cs.reduce((a, c) => a + points(c), 0);

function deal(s: HeartsState, rng: Rng, events: Ev[]) {
  const deck = rng.shuffle(makeDeck());
  s.hands = Array.from({ length: N }, (_, i) => deck.slice(i * 13, i * 13 + 13));
  s.taken = Array.from({ length: N }, () => []);
  s.trick = []; s.broken = false; s.firstTrick = true;
  s.passDir = (s.round % 4) as 0 | 1 | 2 | 3;
  events.push({ t: "newRound" });
  for (let i = 0; i < N; i++) events.push({ t: "dealt", seat: i, count: 13 });
}
function startPlay(s: HeartsState) {
  s.phase = "play";
  s.turn = s.hands.findIndex((h) => h.includes("C2"));
}

export function legalPlays(s: HeartsState, seat: Seat): Card[] {
  const hand = s.hands[seat]!;
  if (s.trick.length === 0) {
    if (s.firstTrick) return hand.includes("C2") ? ["C2"] : hand;
    if (!s.broken && hand.some((c) => suitOf(c) !== "H")) return hand.filter((c) => suitOf(c) !== "H");
    return hand;
  }
  const lead = suitOf(s.trick[0]!.card);
  const follow = hand.filter((c) => suitOf(c) === lead);
  if (follow.length) return follow;
  if (s.firstTrick) { const clean = hand.filter((c) => points(c) === 0); if (clean.length) return clean; }
  return hand;
}

export const Hearts: GameRules<HeartsConfig, HeartsState, Move, View, Ev> = {
  id: "hearts", minSeats: 4, maxSeats: 4,

  setup(config, _seats, rng) {
    const s: HeartsState = { hands: [], phase: config.passing ? "pass" : "play", passDir: 0, pending: Array(N).fill(null), trick: [], turn: 0,
      broken: false, taken: [], scores: Array(N).fill(0), round: 0, firstTrick: true, target: config.target, passing: config.passing };
    const events: Ev[] = [];
    deal(s, rng, events);
    if (!config.passing || s.passDir === 3) startPlay(s);
    return { state: s, events };
  },

  activeSeats(s) {
    if (s.phase === "over") return [];
    if (s.phase === "pass") return s.pending.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    return [s.turn];
  },

  legalMoves(s, seat) {
    if (s.phase === "over") return [];
    if (s.phase === "pass") {
      if (s.pending[seat]) return [];
      const h = s.hands[seat]!, out: Move[] = [];
      for (let a = 0; a < h.length; a++) for (let b = a + 1; b < h.length; b++) for (let c = b + 1; c < h.length; c++)
        out.push({ t: "cards", cards: [h[a]!, h[b]!, h[c]!] });
      return out;
    }
    if (seat !== s.turn) return [];
    return legalPlays(s, seat).map((card): Move => ({ t: "play", card }));
  },

  apply(prev, seat, move, rng) {
    const s: HeartsState = structuredClone(prev);
    const events: Ev[] = [];
    const legal = Hearts.legalMoves(prev, seat);
    if (!legal.some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    if (move.t === "cards") {
      s.pending[seat] = move.cards.slice();
      if (s.pending.every((p) => p)) {
        const target = (i: number) => (s.passDir === 0 ? (i + 1) % N : s.passDir === 1 ? (i + N - 1) % N : (i + 2) % N);
        const got: Card[][] = Array.from({ length: N }, () => []);
        for (let i = 0; i < N; i++) {
          const cards = s.pending[i]!;
          s.hands[i] = s.hands[i]!.filter((c) => !cards.includes(c));
          got[target(i)] = cards;
          events.push({ t: "transfer", from: i, to: target(i), cards });
        }
        for (let i = 0; i < N; i++) s.hands[i]!.push(...got[i]!);
        s.pending = Array(N).fill(null);
        startPlay(s);
      }
      return { state: s, events };
    }

    const hand = s.hands[seat]!;
    hand.splice(hand.indexOf(move.card), 1);
    s.trick.push({ seat, card: move.card });
    events.push({ t: "played", seat, card: move.card });
    if (suitOf(move.card) === "H") s.broken = true;
    if (s.trick.length < N) { s.turn = (seat + 1) % N; return { state: s, events }; }

    const lead = suitOf(s.trick[0]!.card);
    const win = s.trick.filter((p) => suitOf(p.card) === lead).reduce((a, b) => (rankVal(b.card) > rankVal(a.card) ? b : a));
    s.taken[win.seat]!.push(...s.trick.map((p) => p.card));
    events.push({ t: "trickDone", winner: win.seat });
    s.trick = []; s.firstTrick = false; s.turn = win.seat;
    if (s.hands[0]!.length === 0) {
      const pts = s.taken.map(sum);
      const moon = pts.findIndex((p) => p === 26);
      const add = moon >= 0 ? pts.map((_, i) => (i === moon ? 0 : 26)) : pts;
      s.scores = s.scores.map((x, i) => x + add[i]!);
      if (moon >= 0) events.push({ t: "say", seat: moon, key: "moon" });
      s.round++;
      if (Math.max(...s.scores) >= s.target) { s.phase = "over"; }
      else {
        deal(s, rng, events);
        if (s.passing && s.passDir !== 3) s.phase = "pass"; else startPlay(s);
      }
    }
    return { state: s, events };
  },

  view(s, seat) {
    const waiting = s.phase === "pass" && seat !== "public" && !!s.pending[seat];
    return {
      you: seat, hand: seat === "public" ? [] : s.hands[seat]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0,
      trick: s.trick.slice(), turn: s.phase === "play" ? s.turn : null, scores: s.scores.slice(), over: s.phase === "over",
      phase: s.phase, passDir: s.passDir, roundPoints: s.taken.map(sum), broken: s.broken, waiting,
    };
  },

  redactEvent(ev, seat) {
    if (ev.t === "transfer" && ev.to !== seat && ev.from !== seat) return { ...ev, cards: hide(ev.cards) };
    return ev;
  },

  result(s) {
    if (s.phase !== "over") return null;
    const min = Math.min(...s.scores);
    return { winners: s.scores.map((x, i) => (x === min ? i : -1)).filter((i) => i >= 0), scores: s.scores };
  },
};
export { HIDDEN };
