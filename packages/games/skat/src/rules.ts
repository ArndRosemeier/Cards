import { makeDeck, rankOf, suitOf, SKAT_RANKS, hide, type Card, type GameRules, type Rng, type Seat, type Suit, type TrickEv } from "@cards/engine";

export type Game = "C" | "S" | "H" | "D" | "G" | "N" | "R"; // suits, Grand, Null, Ramsch
export interface SkatConfig { rounds: number; ramsch: boolean }
export const defaultConfig: SkatConfig = { rounds: 12, ramsch: true };

export type Phase = "bid" | "skat" | "discard" | "declare" | "play" | "over";
interface Bid { stage: 1 | 2; caller: Seat; listener: Seat; level: number; waiting: "caller" | "listener" | "final"; }

export interface SkatState {
  hands: Card[][]; talon: Card[]; phase: Phase;
  dealer: Seat; round: number; rounds: number; ramschOk: boolean; scores: number[];
  bid: Bid; declarer: Seat | null; game: Game | null; handGame: boolean; contract: number; declarerCards: Card[];
  trick: { seat: Seat; card: Card }[]; turn: Seat; taken: Card[][]; tricksWon: number[];
}
export type Move =
  | { t: "bid"; value: number } | { t: "pass" } | { t: "hold" } | { t: "pickup" } | { t: "handgame" }
  | { t: "cards"; cards: Card[] } | { t: "game"; game: Game } | { t: "play"; card: Card };
export type Ev = TrickEv;
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: { seat: Seat; card: Card }[];
  turn: Seat | null; scores: number[]; over: boolean;
  phase: Phase; dealer: Seat; forehand: Seat; declarer: Seat | null; game: Game | null; handGame: boolean; contract: number;
  bidLevel: number; caller: Seat | null; listener: Seat | null; round: number; rounds: number;
}

const N = 3;
const POINTS: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 };
export const cardPoints = (c: Card) => POINTS[rankOf(c)]!;
const sumPoints = (cs: Card[]) => cs.reduce((a, c) => a + cardPoints(c), 0);
const JACKS: Card[] = ["CJ", "SJ", "HJ", "DJ"];
const BASE: Record<string, number> = { C: 12, S: 11, H: 10, D: 9, G: 24, N: 23, R: 0 };

export const BIDS: number[] = (() => {
  const set = new Set<number>();
  for (const b of [9, 10, 11, 12, 24, 23, 35, 46, 59]) for (let m = 1; m <= 24; m++) set.add(b * m);
  return [...set].filter((v) => v >= 18 && v <= 264).sort((a, b) => a - b);
})();

export const isTrump = (c: Card, g: Game): boolean => {
  if (g === "N") return false;
  if (rankOf(c) === "J") return true;
  return g !== "G" && g !== "R" && suitOf(c) === g;
};
const SIDE = ["A", "T", "K", "Q", "9", "8", "7"], NULLORD = ["A", "K", "Q", "J", "T", "9", "8", "7"];
/** Higher beats lower within the same effective suit. */
export function strength(c: Card, g: Game): number {
  if (g === "N") return 10 - NULLORD.indexOf(rankOf(c));
  if (rankOf(c) === "J") return 100 + (3 - JACKS.indexOf(c));
  return 10 - SIDE.indexOf(rankOf(c));
}
const effSuit = (c: Card, g: Game): string => (isTrump(c, g) ? "T" : suitOf(c));

export function jackMultiplier(cards: Card[]): number {
  const has = JACKS.map((j) => cards.includes(j));
  let n = 0;
  if (has[0]) { while (n < 4 && has[n]) n++; } else { while (n < 4 && !has[n]) n++; }
  return n + 1;
}

export function legalPlays(s: SkatState, seat: Seat): Card[] {
  const hand = s.hands[seat]!, g = s.game!;
  if (!s.trick.length) return hand;
  const led = effSuit(s.trick[0]!.card, g);
  const follow = hand.filter((c) => effSuit(c, g) === led);
  return follow.length ? follow : hand;
}

function trickWinner(trick: { seat: Seat; card: Card }[], g: Game): Seat {
  const led = effSuit(trick[0]!.card, g);
  let best = trick[0]!;
  for (const p of trick) {
    const a = effSuit(p.card, g), b = effSuit(best.card, g);
    if (a === b ? strength(p.card, g) > strength(best.card, g) : a === "T") best = p;
  }
  void led;
  return best.seat;
}

const forehand = (dealer: Seat) => (dealer + 1) % N;

function deal(s: SkatState, rng: Rng, events: Ev[]) {
  const deck = rng.shuffle(makeDeck(SKAT_RANKS));
  s.hands = [deck.slice(0, 10), deck.slice(10, 20), deck.slice(20, 30)];
  s.talon = deck.slice(30, 32);
  s.taken = [[], [], []]; s.tricksWon = [0, 0, 0]; s.trick = [];
  s.declarer = null; s.game = null; s.handGame = false; s.contract = 0; s.declarerCards = [];
  s.phase = "bid";
  const F = forehand(s.dealer), M = (s.dealer + 2) % N;
  s.bid = { stage: 1, caller: M, listener: F, level: -1, waiting: "caller" };
  s.turn = M;
  events.push({ t: "newRound" });
  for (let i = 0; i < N; i++) events.push({ t: "dealt", seat: i, count: 10 });
  events.push({ t: "dealt", seat: "talon", count: 2 });
}

function bidTurn(b: Bid): Seat { return b.waiting === "caller" ? b.caller : b.listener; }

export const Skat: GameRules<SkatConfig, SkatState, Move, View, Ev> = {
  id: "skat", minSeats: 3, maxSeats: 3,

  setup(config, _seats, rng) {
    const s = { hands: [], talon: [], phase: "bid", dealer: 0, round: 0, rounds: config.rounds, ramschOk: config.ramsch, scores: [0, 0, 0],
      bid: { stage: 1, caller: 0, listener: 0, level: -1, waiting: "caller" }, declarer: null, game: null, handGame: false, contract: 0, declarerCards: [],
      trick: [], turn: 0, taken: [], tricksWon: [] } as SkatState;
    const events: Ev[] = [];
    deal(s, rng, events);
    return { state: s, events };
  },

  activeSeats(s) {
    if (s.phase === "over") return [];
    if (s.phase === "bid") return [s.bid.waiting === "final" ? s.bid.listener : bidTurn(s.bid)];
    if (s.phase === "play") return [s.turn];
    return [s.declarer!];
  },

  legalMoves(s, seat) {
    if (s.phase === "over" || !Skat.activeSeats(s).includes(seat)) return [];
    const out: Move[] = [];
    if (s.phase === "bid") {
      const b = s.bid;
      if (b.waiting === "caller") {
        for (let k = 1; k <= 4; k++) { const v = BIDS[b.level + k]; if (v) out.push({ t: "bid", value: v }); }
        out.push({ t: "pass" });
      } else if (b.waiting === "listener") out.push({ t: "hold" }, { t: "pass" });
      else out.push({ t: "bid", value: 18 }, { t: "pass" }); // forehand: play at 18 or give up (Ramsch)
    } else if (s.phase === "skat") out.push({ t: "pickup" }, { t: "handgame" });
    else if (s.phase === "discard") {
      const h = s.hands[seat]!;
      for (let a = 0; a < h.length; a++) for (let b = a + 1; b < h.length; b++) out.push({ t: "cards", cards: [h[a]!, h[b]!] });
    } else if (s.phase === "declare") {
      for (const g of ["C", "S", "H", "D", "G", "N"] as Game[]) out.push({ t: "game", game: g });
    } else for (const card of legalPlays(s, seat)) out.push({ t: "play", card });
    return out;
  },

  apply(prev, seat, move, rng) {
    const s: SkatState = structuredClone(prev);
    const events: Ev[] = [];
    const legal = Skat.legalMoves(prev, seat);
    if (!legal.some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    const endStage = (winner: Seat) => {
      const b = s.bid;
      if (b.stage === 1) { s.bid = { stage: 2, caller: s.dealer, listener: winner, level: b.level, waiting: "caller" }; return; }
      if (b.level >= 0) { s.declarer = winner; s.contract = BIDS[b.level]!; s.phase = "skat"; s.turn = winner; return; }
      s.bid = { ...b, waiting: "final", listener: winner };
    };
    const startPlay = () => { s.phase = "play"; s.turn = forehand(s.dealer); };

    switch (move.t) {
      case "bid": {
        const b = s.bid;
        if (b.waiting === "final") { b.level = 0; s.declarer = b.listener; s.contract = 18; s.phase = "skat"; s.turn = s.declarer; events.push({ t: "say", seat: s.declarer, key: "sayBid", vars: { v: 18 } }); break; }
        b.level = BIDS.indexOf(move.value); b.waiting = "listener";
        events.push({ t: "say", seat, key: "sayBid", vars: { v: move.value } });
        break;
      }
      case "hold": s.bid.waiting = "caller"; events.push({ t: "say", seat, key: "sayHold" }); break;
      case "pass": {
        const b = s.bid;
        events.push({ t: "say", seat, key: "sayPass" });
        if (b.waiting === "final") {
          if (s.ramschOk) { s.game = "R"; startPlay(); events.push({ t: "say", seat: null, key: "ramsch" }); }
          else { s.dealer = (s.dealer + 1) % N; deal(s, rng, events); }
        } else if (b.waiting === "caller") endStage(b.listener);
        else endStage(b.caller);
        break;
      }
      case "pickup": {
        const d = s.declarer!;
        events.push({ t: "transfer", from: "talon", to: d, cards: s.talon.slice() });
        s.hands[d]!.push(...s.talon); s.talon = []; s.declarerCards = s.hands[d]!.slice(); s.phase = "discard";
        break;
      }
      case "handgame": s.handGame = true; s.declarerCards = s.hands[s.declarer!]!.slice(); s.phase = "declare"; events.push({ t: "say", seat, key: "handgame" }); break;
      case "cards": {
        const d = s.declarer!;
        s.hands[d] = s.hands[d]!.filter((c) => !move.cards.includes(c)); s.talon = move.cards.slice();
        events.push({ t: "transfer", from: d, to: "talon", cards: move.cards.slice() });
        s.phase = "declare";
        break;
      }
      case "game": s.game = move.game; events.push({ t: "say", seat, key: "game" + move.game }); startPlay(); break;
      case "play": {
        const hand = s.hands[seat]!; hand.splice(hand.indexOf(move.card), 1);
        s.trick.push({ seat, card: move.card });
        events.push({ t: "played", seat, card: move.card });
        if (s.trick.length < N) { s.turn = (seat + 1) % N; break; }
        const w = trickWinner(s.trick, s.game!);
        s.taken[w]!.push(...s.trick.map((p) => p.card)); s.tricksWon[w]!++;
        events.push({ t: "trickDone", winner: w });
        s.trick = []; s.turn = w;
        if (s.hands[0]!.length === 0) {
          scoreRound(s, w, events);
          s.round++;
          if (s.round >= s.rounds) s.phase = "over";
          else { s.dealer = (s.dealer + 1) % N; deal(s, rng, events); }
        }
        break;
      }
    }
    return { state: s, events };
  },

  view(s, seat) {
    return {
      you: seat, hand: seat === "public" ? [] : s.hands[seat]!.slice(), handSizes: s.hands.map((h) => h.length), talon: s.talon.length,
      trick: s.trick.slice(), turn: s.phase === "over" ? null : Skat.activeSeats(s)[0] ?? null, scores: s.scores.slice(), over: s.phase === "over",
      phase: s.phase, dealer: s.dealer, forehand: forehand(s.dealer), declarer: s.declarer, game: s.game, handGame: s.handGame, contract: s.contract,
      bidLevel: s.bid.level, caller: s.phase === "bid" ? s.bid.caller : null, listener: s.phase === "bid" ? s.bid.listener : null, round: s.round, rounds: s.rounds,
    };
  },

  redactEvent(ev, seat) {
    if (ev.t === "transfer" && ev.to !== seat && ev.from !== seat) return { ...ev, cards: hide(ev.cards) };
    return ev;
  },

  result(s) {
    if (s.phase !== "over") return null;
    const max = Math.max(...s.scores);
    return { winners: s.scores.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0), scores: s.scores };
  },
};

/** Game value (before bid check) for a won/lost declarer result. Exposed for tests and bots. */
export function gameValue(game: Game, declarerCards: Card[], hand: boolean, schneider: boolean, schwarz: boolean): number {
  if (game === "N") return hand ? 35 : 23;
  const mult = jackMultiplier(declarerCards) + (hand ? 1 : 0) + (schneider ? 1 : 0) + (schwarz ? 1 : 0);
  return BASE[game]! * mult;
}

function scoreRound(s: SkatState, lastWinner: Seat, events: Ev[]) {
  const g = s.game!;
  if (g === "R") {
    const pts = s.taken.map(sumPoints);
    pts[lastWinner]! += sumPoints(s.talon);
    const through = s.tricksWon.findIndex((n) => n === 10);
    if (through >= 0) { s.scores[through]! += 120; events.push({ t: "say", seat: through, key: "durchmarsch" }); return; }
    const worst = Math.max(...pts);
    pts.forEach((p, i) => { if (p === worst) s.scores[i]! -= p; });
    events.push({ t: "say", seat: pts.indexOf(worst), key: "ramschLoser", vars: { pts: worst } });
    return;
  }
  const d = s.declarer!;
  const own = s.taken[d]!;
  const decl = sumPoints(own) + (g === "N" ? 0 : sumPoints(s.talon));
  const oppTricks = s.tricksWon.reduce((a, n, i) => (i === d ? a : a + n), 0);
  let won: boolean, value: number;
  if (g === "N") { won = s.tricksWon[d] === 0; value = gameValue("N", s.declarerCards, s.handGame, false, false); }
  else {
    won = decl >= 61;
    const schneider = won ? decl >= 90 : decl <= 30;
    const schwarz = won ? oppTricks === 0 : s.tricksWon[d] === 0;
    value = gameValue(g, s.declarerCards, s.handGame, schneider, schwarz);
    if (s.contract > value) {  // overbid: loses, and is charged the next multiple of the base value that covers the bid
      won = false;
      value = Math.ceil(s.contract / BASE[g]!) * BASE[g]!;
    }
  }
  const delta = won ? value : -2 * value;
  s.scores[d]! += delta;
  events.push({ t: "say", seat: d, key: won ? "skatWon" : "skatLost", vars: { n: Math.abs(delta), pts: decl } });
}
