import { makeDeck, hide, isJoker, type Card, type GameRules, type Rng, type Seat } from "@cards/engine";
import { parseMeld, meldValue, handPenalty, type Meld } from "./melds.ts";

export interface RommeConfig { rounds: number; minOpen: number; handSize: number }
export const defaultConfig: RommeConfig = { rounds: 3, minOpen: 40, handSize: 13 };

export interface TableMeld { owner: Seat; kind: "set" | "run"; cards: Card[] }
export interface RommeState {
  hands: Card[][]; stock: Card[]; discard: Card[]; melds: TableMeld[]; opened: boolean[];
  turn: Seat; phase: "draw" | "play" | "over"; scores: number[]; round: number; rounds: number; dealer: Seat; minOpen: number; handSize: number;
  taken: Card | null; // card picked from the discard pile this turn
  wentOut: Seat | null;
}
export type Move =
  | { t: "draw"; from: "stock" | "discard" }
  | { t: "meld"; groups: Card[][] }
  | { t: "layoff"; cards: Card[]; meld: number }
  | { t: "swap"; meld: number; card: Card }          // take the joker out of a table meld by putting the natural card in its place
  | { t: "discard"; card: Card };
export type Ev =
  | { t: "newRound" }
  | { t: "dealt"; seat: Seat | "discard"; count: number }
  | { t: "draw"; seat: Seat; from: "stock" | "discard"; card: Card }
  | { t: "meld"; seat: Seat; first: number; groups: Card[][] }
  | { t: "layoff"; seat: Seat; meld: number; cards: Card[]; result: Card[] }
  | { t: "swap"; seat: Seat; meld: number; card: Card; joker: Card; result: Card[] }
  | { t: "discard"; seat: Seat; card: Card }
  | { t: "reshuffle" }
  | { t: "say"; seat: Seat | null; key: string; vars?: Record<string, string | number> };
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: never[]; turn: Seat | null; scores: number[]; over: boolean;
  stock: number; discardTop: Card | null; discardSize: number; melds: TableMeld[]; opened: boolean[]; phase: RommeState["phase"]; minOpen: number; round: number; rounds: number; taken: Card | null;
}

const N_JOKERS = 6;
export const deckOf = (): Card[] => [...makeDeck(undefined, 2), ...Array.from({ length: N_JOKERS }, (_, i) => `X${i + 1}` as Card)];

function deal(s: RommeState, rng: Rng, events: Ev[]) {
  const n = s.hands.length || (s as unknown as { n: number }).n;
  const deck = rng.shuffle(deckOf());
  s.hands = Array.from({ length: n }, (_, i) => deck.slice(i * s.handSize, (i + 1) * s.handSize));
  const rest = deck.slice(n * s.handSize);
  s.discard = [rest.pop()!]; s.stock = rest; s.melds = []; s.opened = Array(n).fill(false); s.taken = null; s.wentOut = null;
  s.phase = "draw"; s.turn = (s.dealer + 1) % n;
  events.push({ t: "newRound" });
  for (let i = 0; i < n; i++) events.push({ t: "dealt", seat: i, count: s.handSize });
  events.push({ t: "dealt", seat: "discard", count: 1 });
}
function drawStock(s: RommeState, rng: Rng, events: Ev[]): Card {
  if (s.stock.length === 0) {
    const top = s.discard.pop()!; s.stock = rng.shuffle(s.discard); s.discard = [top]; events.push({ t: "reshuffle" });
  }
  return s.stock.pop()!;
}
const remove = (hand: Card[], cards: Card[]) => { for (const c of cards) { const i = hand.indexOf(c); if (i < 0) throw new Error("card not in hand"); hand.splice(i, 1); } };

export const Romme: GameRules<RommeConfig, RommeState, Move, View, Ev> = {
  id: "romme", minSeats: 2, maxSeats: 4,

  setup(config, seats, rng) {
    const s = { hands: Array.from({ length: seats }, () => []), stock: [], discard: [], melds: [], opened: [], turn: 0, phase: "draw", scores: Array(seats).fill(0), round: 0, rounds: config.rounds,
      dealer: seats - 1, minOpen: config.minOpen, handSize: config.handSize, taken: null, wentOut: null } as unknown as RommeState;
    const events: Ev[] = []; deal(s, rng, events);
    return { state: s, events };
  },
  activeSeats: (s) => (s.phase === "over" ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.phase === "over" || seat !== s.turn) return [];
    if (s.phase === "draw") {
      const out: Move[] = [];
      if (s.stock.length > 0 || s.discard.length > 1) out.push({ t: "draw", from: "stock" }); // nothing left to reshuffle otherwise
      if (s.discard.length > 0) out.push({ t: "draw", from: "discard" });
      return out;
    }
    return [...new Set(s.hands[seat]!)].filter((c) => c !== s.taken || s.hands[seat]!.length === 1).map((card): Move => ({ t: "discard", card }));
  },

  apply(prev, seat, move, rng) {
    const s: RommeState = structuredClone(prev);
    const events: Ev[] = [];
    if (s.phase === "over" || seat !== s.turn) throw new Error("not your turn");
    const hand = s.hands[seat]!;
    const n = s.hands.length;

    if (move.t === "draw") {
      if (s.phase !== "draw") throw new Error("already drew");
      let card: Card;
      if (move.from === "discard") { card = s.discard.pop()!; s.taken = card; } else card = drawStock(s, rng, events);
      hand.push(card); s.phase = "play";
      events.push({ t: "draw", seat, from: move.from, card });
      return { state: s, events };
    }
    if (s.phase !== "play") throw new Error("draw first");

    if (move.t === "meld") {
      const all = move.groups.flat();
      const parsed = move.groups.map(parseMeld);
      if (!parsed.length || parsed.some((m) => !m)) throw new Error("invalid meld");
      if (!s.opened[seat] && meldValue(move.groups) < s.minOpen) throw new Error("opening value too low");
      remove(hand, all);
      const first = s.melds.length;
      (parsed as Meld[]).forEach((m, i) => s.melds.push({ owner: seat, kind: m.kind, cards: m.cards }));
      s.opened[seat] = true; if (s.taken && all.includes(s.taken)) s.taken = null;
      events.push({ t: "meld", seat, first, groups: (parsed as Meld[]).map((m) => m.cards) });
      if (hand.length === 0) return { state: finishRound(s, seat, rng, events), events };
      return { state: s, events };
    }
    if (move.t === "layoff") {
      if (!s.opened[seat]) throw new Error("open first");
      const m = s.melds[move.meld]; if (!m) throw new Error("no such meld");
      const merged = parseMeld([...m.cards, ...move.cards]); if (!merged) throw new Error("cannot lay off");
      remove(hand, move.cards);
      m.cards = merged.cards; m.kind = merged.kind;
      if (s.taken && move.cards.includes(s.taken)) s.taken = null;
      events.push({ t: "layoff", seat, meld: move.meld, cards: move.cards.slice(), result: merged.cards.slice() });
      if (hand.length === 0) return { state: finishRound(s, seat, rng, events), events };
      return { state: s, events };
    }
    if (move.t === "swap") {
      if (!s.opened[seat]) throw new Error("open first");
      const m = s.melds[move.meld]; if (!m) throw new Error("no such meld");
      const joker = m.cards.find(isJoker); if (!joker) throw new Error("no joker in that meld");
      if (!hand.includes(move.card) || isJoker(move.card)) throw new Error("card not in hand");
      const merged = parseMeld(m.cards.map((c) => (c === joker ? move.card : c))); if (!merged || merged.cards.some(isJoker)) throw new Error("card does not fit");
      remove(hand, [move.card]); hand.push(joker); m.cards = merged.cards; m.kind = merged.kind;
      if (s.taken && move.card === s.taken) s.taken = null;
      events.push({ t: "swap", seat, meld: move.meld, card: move.card, joker, result: merged.cards.slice() });
      if (hand.length === 0) return { state: finishRound(s, seat, rng, events), events };
      return { state: s, events };
    }
    // discard
    if (!hand.includes(move.card)) throw new Error("card not in hand");
    if (s.taken && move.card === s.taken && hand.length > 1) throw new Error("cannot discard the card you took");
    remove(hand, [move.card]); s.discard.push(move.card); s.taken = null;
    events.push({ t: "discard", seat, card: move.card });
    if (hand.length === 0) return { state: finishRound(s, seat, rng, events), events };
    s.turn = (seat + 1) % n; s.phase = "draw";
    return { state: s, events };
  },

  view(s, seat) {
    const me = seat === "public" ? null : seat;
    return {
      you: seat, hand: me === null ? [] : s.hands[me]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0, trick: [], turn: s.phase === "over" ? null : s.turn, scores: s.scores.slice(),
      over: s.phase === "over", stock: s.stock.length, discardTop: s.discard[s.discard.length - 1] ?? null, discardSize: s.discard.length, melds: s.melds.map((m) => ({ ...m, cards: m.cards.slice() })),
      opened: s.opened.slice(), phase: s.phase, minOpen: s.minOpen, round: s.round, rounds: s.rounds, taken: me !== null && me === s.turn ? s.taken : null,
    };
  },
  redactEvent(ev, seat) { return ev.t === "draw" && ev.from === "stock" && ev.seat !== seat ? { ...ev, card: hide([ev.card])[0]! } : ev; },
  result(s) {
    if (s.phase !== "over") return null;
    const min = Math.min(...s.scores);
    return { winners: s.scores.map((x, i) => (x === min ? i : -1)).filter((i) => i >= 0), scores: s.scores };
  },
};

function finishRound(s: RommeState, winner: Seat, rng: Rng, events: Ev[]): RommeState {
  s.wentOut = winner;
  const n = s.hands.length;
  const handOut = s.melds.every((m) => m.owner !== winner) ? false : false; void handOut;
  for (let i = 0; i < n; i++) if (i !== winner) s.scores[i]! += handPenalty(s.hands[i]!);
  events.push({ t: "say", seat: winner, key: "rm_out" });
  s.round++;
  if (s.round >= s.rounds) s.phase = "over";
  else { s.dealer = (s.dealer + 1) % n; deal(s, rng, events); }
  return s;
}
export { parseMeld, meldValue, handPenalty, isJoker };
export type { Meld };
