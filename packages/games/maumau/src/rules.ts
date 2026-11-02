import { makeDeck, SKAT_RANKS, suitOf, rankOf, type Card, type Suit, type GameRules, type Rng, type Seat } from "@cards/engine";

export interface MauMauConfig { handSize: number }
export const defaultConfig: MauMauConfig = { handSize: 5 };

export interface MauMauState {
  hands: Card[][];
  draw: Card[];
  discard: Card[];        // last element is the top
  turn: Seat;
  direction: 1 | -1;
  pendingDraw: number;    // accumulated 7-penalty the current player faces
  pendingSkip: boolean;   // an 8 was played: current player skips unless they answer with an 8
  wish: Suit | null;      // active suit after a jack
  drewThisTurn: boolean;  // already drew a card normally; may play it or pass
  winner: Seat | null;
}

export type Move =
  | { t: "play"; card: Card; wish?: Suit }
  | { t: "draw" }
  | { t: "pass" };

export type Ev =
  | { t: "dealt"; seat: Seat; count: number }
  | { t: "started"; top: Card }
  | { t: "played"; seat: Seat; card: Card; wish?: Suit }
  | { t: "drew"; seat: Seat; cards: Card[] }   // cards are redacted to "??" for other seats by the host
  | { t: "skipped"; seat: Seat }
  | { t: "reshuffled" }
  | { t: "won"; seat: Seat };

export interface View {
  you: Seat | "public";
  hand: Card[];
  handSizes: number[];
  drawCount: number;
  top: Card;
  wish: Suit | null;
  turn: Seat;
  pendingDraw: number;
  pendingSkip: boolean;
  winner: Seat | null;
}

const next = (s: MauMauState, from: Seat) => (from + s.direction + s.hands.length) % s.hands.length;
const topCard = (s: MauMauState) => s.discard[s.discard.length - 1]!;

function canPlay(s: MauMauState, card: Card): boolean {
  const top = topCard(s);
  if (s.pendingDraw > 0) return rankOf(card) === "7";
  if (s.pendingSkip) return rankOf(card) === "8";
  if (rankOf(card) === "J") return true;
  const suit = s.wish ?? suitOf(top);
  return suitOf(card) === suit || rankOf(card) === rankOf(top);
}

function drawCards(s: MauMauState, seat: Seat, n: number, rng: Rng, events: Ev[]): Card[] {
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (s.draw.length === 0) {
      if (s.discard.length <= 1) break;
      const top = s.discard.pop()!;
      s.draw = rng.shuffle(s.discard);
      s.discard = [top];
      events.push({ t: "reshuffled" });
    }
    const c = s.draw.pop();
    if (c) { s.hands[seat]!.push(c); got.push(c); }
  }
  if (got.length) events.push({ t: "drew", seat, cards: got });
  return got;
}

export const MauMau: GameRules<MauMauConfig, MauMauState, Move, View, Ev> = {
  id: "maumau", minSeats: 2, maxSeats: 5,

  setup(config, seats, rng) {
    const deck = rng.shuffle(makeDeck(SKAT_RANKS));
    const hands: Card[][] = Array.from({ length: seats }, () => []);
    const events: Ev[] = [];
    for (let i = 0; i < config.handSize; i++) for (let p = 0; p < seats; p++) hands[p]!.push(deck.pop()!);
    for (let p = 0; p < seats; p++) events.push({ t: "dealt", seat: p, count: config.handSize });
    // first upcard must be a plain card so the game does not start with an effect
    let start = deck.pop()!;
    const parked: Card[] = [];
    while (["7", "8", "J"].includes(rankOf(start))) { parked.push(start); start = deck.pop()!; }
    deck.unshift(...parked);
    events.push({ t: "started", top: start });
    return {
      state: { hands, draw: deck, discard: [start], turn: 0, direction: 1, pendingDraw: 0, pendingSkip: false,
        wish: null, drewThisTurn: false, winner: null },
      events,
    };
  },

  activeSeats: (s) => (s.winner === null ? [s.turn] : []),

  legalMoves(s, seat) {
    if (s.winner !== null || seat !== s.turn) return [];
    const moves: Move[] = [];
    for (const card of new Set(s.hands[seat]!)) {
      if (!canPlay(s, card)) continue;
      if (rankOf(card) === "J" && s.pendingDraw === 0 && !s.pendingSkip) {
        for (const wish of ["C", "S", "H", "D"] as Suit[]) moves.push({ t: "play", card, wish });
      } else moves.push({ t: "play", card });
    }
    if (s.pendingSkip) moves.push({ t: "pass" });                 // take the skip
    else if (s.pendingDraw > 0) moves.push({ t: "draw" });        // take the penalty
    else if (s.drewThisTurn) moves.push({ t: "pass" });
    else moves.push({ t: "draw" });
    return moves;
  },

  apply(prev, seat, move, rng) {
    const s: MauMauState = structuredClone(prev);
    const events: Ev[] = [];
    const legal = MauMau.legalMoves(prev, seat);
    if (!legal.some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    const advance = () => { s.turn = next(s, s.turn); s.drewThisTurn = false; };

    if (move.t === "draw") {
      if (s.pendingDraw > 0) {
        drawCards(s, seat, s.pendingDraw, rng, events);
        s.pendingDraw = 0;
        advance();
      } else {
        const got = drawCards(s, seat, 1, rng, events);
        if (got.length === 1 && canPlay(s, got[0]!)) s.drewThisTurn = true; else advance();
      }
    } else if (move.t === "pass") {
      if (s.pendingSkip) { events.push({ t: "skipped", seat }); s.pendingSkip = false; }
      advance();
    } else {
      const hand = s.hands[seat]!;
      hand.splice(hand.indexOf(move.card), 1);
      s.discard.push(move.card);
      s.wish = rankOf(move.card) === "J" ? (move.wish ?? null) : null;
      events.push({ t: "played", seat, card: move.card, ...(move.wish ? { wish: move.wish } : {}) });
      if (rankOf(move.card) === "7") s.pendingDraw += 2;
      if (rankOf(move.card) === "8") s.pendingSkip = true;
      if (hand.length === 0) { s.winner = seat; events.push({ t: "won", seat }); }
      else advance();
    }
    return { state: s, events };
  },

  view(s, seat) {
    return {
      you: seat, hand: seat === "public" ? [] : s.hands[seat]!.slice(),
      handSizes: s.hands.map((h) => h.length), drawCount: s.draw.length, top: topCard(s), wish: s.wish,
      turn: s.turn, pendingDraw: s.pendingDraw, pendingSkip: s.pendingSkip, winner: s.winner,
    };
  },

  redactEvent(ev, seat) {
    if (ev.t === "drew" && ev.seat !== seat) return { ...ev, cards: ev.cards.map(() => "??" as Card) };
    return ev;
  },

  result(s) {
    if (s.winner === null) return null;
    return { winners: [s.winner], scores: s.hands.map((h, i) => (i === s.winner ? 0 : h.length)) };
  },
};
