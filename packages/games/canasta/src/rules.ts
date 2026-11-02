import { makeDeck, hide, isJoker, rankOf, suitOf, RANKS, type Card, type GameRules, type Rank, type Rng, type Seat } from "@cards/engine";

/** Canasta (classic rules, simplified): 2 or 3 players alone, 4 players as partners (seats 0+2 vs 1+3). */
export interface CanastaConfig { target: number }
export const defaultConfig: CanastaConfig = { target: 3000 };

export interface Meld { rank: Rank; cards: Card[] }
export interface CanastaState {
  n: number; hands: Card[][]; stock: Card[]; discard: Card[]; melds: Meld[][]; reds: Card[][]; frozen: boolean;
  scores: number[]; lastRound: number[]; turn: Seat; phase: "draw" | "play" | "over"; dealer: Seat; round: number; target: number; closedAtStart: boolean;
}
export type Move =
  | { t: "draw" }
  | { t: "pile"; cards: Card[]; extra: Card[][] }
  | { t: "meld"; groups: { to: number | null; cards: Card[] }[] }
  | { t: "discard"; card: Card };
export interface MeldItem { meld: number; cards: Card[]; result: Card[]; created: boolean }
export type Ev =
  | { t: "newRound" }
  | { t: "dealt"; seat: Seat | "discard"; count: number }
  | { t: "draw"; seat: Seat; card: Card }
  | { t: "reds"; seat: Seat; cards: Card[] }
  | { t: "pile"; seat: Seat; top: Card; used: Card[]; meld: number; result: Card[]; created: boolean; taken: Card[] }
  | { t: "meld"; seat: Seat; items: MeldItem[] }
  | { t: "discard"; seat: Seat; card: Card }
  | { t: "say"; seat: Seat | null; key: string; vars?: Record<string, string | number> };
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: never[]; turn: Seat | null; scores: number[]; over: boolean;
  stock: number; discardTop: Card | null; discardSize: number; frozen: boolean; phase: CanastaState["phase"]; round: number; target: number;
  sides: number; mySide: number; sideScores: number[]; melds: Meld[][]; reds: Card[][]; minOpen: number; lastRound: number[]; teams: boolean;
}

export const isWild = (c: Card) => isJoker(c) || rankOf(c) === "2";
export const isRed3 = (c: Card) => !isJoker(c) && rankOf(c) === "3" && (suitOf(c) === "H" || suitOf(c) === "D");
export const isBlack3 = (c: Card) => !isJoker(c) && rankOf(c) === "3" && !isRed3(c);
export function points(c: Card): number {
  if (isJoker(c)) return 50;
  const r = rankOf(c);
  if (r === "2" || r === "A") return 20;
  if (r === "8" || r === "9" || r === "T" || r === "J" || r === "Q" || r === "K") return 10;
  return 5;
}
export const minOpenFor = (score: number) => (score < 0 ? 15 : score < 1500 ? 50 : score < 3000 ? 90 : 120);
export const sideOf = (n: number, seat: Seat) => (n === 4 ? seat % 2 : seat);
export const seatsOf = (n: number, sd: number): Seat[] => (n === 4 ? [sd, sd + 2] : [sd]);
const nSides = (n: number) => (n === 4 ? 2 : n);
export const isCanasta = (m: Meld) => m.cards.length >= 7;
export const deckOf = (): Card[] => [...makeDeck(RANKS, 2), "X1", "X2", "X3", "X4"] as Card[];

/** Validate `existing + add` as one meld. More naturals than wild cards, at most three wilds, no wilds into a finished canasta. */
export function combine(existing: Card[], add: Card[]): Card[] | null {
  const all = [...existing, ...add];
  const nat = all.filter((c) => !isWild(c));
  const wild = all.length - nat.length;
  if (all.length < 3 || !nat.length) return null;
  const r = rankOf(nat[0]!);
  if (r === "3" || nat.some((c) => rankOf(c) !== r)) return null;
  if (wild > 3 || wild >= nat.length) return null;
  if (existing.length >= 7 && add.some(isWild)) return null;
  return all;
}
const meldPoints = (cards: Card[]) => cards.reduce((a, c) => a + points(c), 0);

function deal(s: CanastaState, rng: Rng, events: Ev[]) {
  const n = s.n, per = n === 2 ? 15 : n === 3 ? 13 : 11, sides = nSides(n);
  const deck = rng.shuffle(deckOf());
  s.hands = Array.from({ length: n }, (_, i) => deck.slice(i * per, (i + 1) * per));
  s.stock = deck.slice(n * per); s.discard = []; s.melds = Array.from({ length: sides }, () => []); s.reds = Array.from({ length: sides }, () => []); s.frozen = false;
  events.push({ t: "newRound" });
  for (let i = 0; i < n; i++) events.push({ t: "dealt", seat: i, count: per });
  for (let i = 0; i < n; i++) { // red threes go straight to the table, replaced from the stock (silently at the deal)
    const h = s.hands[i]!, sd = sideOf(n, i);
    for (;;) { const r = h.filter(isRed3); if (!r.length) break; for (const c of r) { h.splice(h.indexOf(c), 1); s.reds[sd]!.push(c); h.push(s.stock.pop()!); } }
  }
  for (;;) { // turn up the first discard; wild cards and red threes freeze the pile
    const c = s.stock.pop()!; s.discard.push(c);
    if (isWild(c) || isRed3(c)) s.frozen = true; else break;
  }
  events.push({ t: "dealt", seat: "discard", count: s.discard.length });
  s.phase = "draw"; s.turn = (s.dealer + 1) % n; s.closedAtStart = true;
}

function placeReds(s: CanastaState, seat: Seat, events: Ev[]) {
  const hand = s.hands[seat]!, sd = sideOf(s.n, seat);
  for (;;) {
    const r = hand.filter(isRed3); if (!r.length) return;
    for (const c of r) hand.splice(hand.indexOf(c), 1);
    s.reds[sd]!.push(...r); events.push({ t: "reds", seat, cards: r.slice() });
    for (let i = 0; i < r.length && s.stock.length; i++) { const c = s.stock.pop()!; hand.push(c); events.push({ t: "draw", seat, card: c }); }
  }
}

const hasCanasta = (s: CanastaState, sd: number) => s.melds[sd]!.some(isCanasta);
/** Whether a seat may end up with `rem` cards and the given canasta situation without getting stuck or going out illegally. */
const remainingOk = (s: CanastaState, rem: number, canasta: boolean) => rem >= 2 || ((canasta || s.stock.length === 0) && rem >= 0);

function takeFromHand(hand: Card[], cards: Card[]): Card[] {
  const h = hand.slice();
  for (const c of cards) { const i = h.indexOf(c); if (i < 0) throw new Error("card not in hand"); h.splice(i, 1); }
  return h;
}

function pileTopOk(s: CanastaState): Card | null {
  const top = s.discard[s.discard.length - 1];
  return top && !isWild(top) && !isBlack3(top) && !isRed3(top) ? top : null;
}

interface PilePlan { top: Card; mi: number; created: boolean; result: Card[]; extras: Card[][]; rest: Card[]; newHand: Card[] }
function planPile(s: CanastaState, seat: Seat, cards: Card[], extra: Card[][]): PilePlan {
  if (s.phase !== "draw") throw new Error("already drew");
  const top = pileTopOk(s); if (!top) throw new Error("pile cannot be taken");
  const sd = sideOf(s.n, seat), melds = s.melds[sd]!, hand = s.hands[seat]!;
  const afterUse = takeFromHand(hand, [...cards, ...extra.flat()]);
  const rank = rankOf(top), mi = melds.findIndex((m) => m.rank === rank), frozen = s.frozen || melds.length === 0;
  let result: Card[] | null;
  if (mi >= 0) {
    if (s.frozen) throw new Error("pile frozen");
    result = combine(melds[mi]!.cards, [top, ...cards]);
  } else {
    const nat = cards.filter((c) => !isWild(c) && rankOf(c) === rank).length;
    if (frozen ? nat < 2 : nat < 1) throw new Error("need matching cards");
    result = combine([], [top, ...cards]);
  }
  if (!result) throw new Error("invalid meld");
  const ranks = new Set<Rank>([rank, ...melds.map((m) => m.rank)]), extras: Card[][] = [];
  for (const g of extra) { const m = combine([], g); if (!m) throw new Error("invalid meld"); const r = rankOf(m.find((c) => !isWild(c))!); if (ranks.has(r)) throw new Error("rank already melded"); ranks.add(r); extras.push(m); }
  if (melds.length === 0 && meldPoints(result) + extras.reduce((a, g) => a + meldPoints(g), 0) < minOpenFor(s.scores[sd]!)) throw new Error("opening value too low");
  const rest = s.discard.slice(0, -1), newHand = [...afterUse, ...rest];
  const canasta = hasCanasta(s, sd) || result.length >= 7 || extras.some((g) => g.length >= 7);
  if (!remainingOk(s, newHand.length, canasta)) throw new Error("keep a card to discard");
  return { top, mi, created: mi < 0, result, extras, rest, newHand };
}

function pileMoves(s: CanastaState, seat: Seat): Move[] {
  const top = pileTopOk(s); if (!top) return [];
  const hand = s.hands[seat]!, rank = rankOf(top), sd = sideOf(s.n, seat);
  const out: Move[] = [], tryPush = (cards: Card[]) => { try { planPile(s, seat, cards, []); out.push({ t: "pile", cards, extra: [] }); } catch { /* not allowed */ } };
  const nat = [...new Set(hand.filter((c) => !isWild(c) && rankOf(c) === rank))], wild = [...new Set(hand.filter(isWild))];
  if (s.melds[sd]!.some((m) => m.rank === rank)) { tryPush([]); for (const c of nat) tryPush([c]); return out; }
  for (let i = 0; i < nat.length; i++) for (let j = i + 1; j < nat.length; j++) tryPush([nat[i]!, nat[j]!]);
  if (!s.frozen) for (const c of nat) for (const w of wild) tryPush([c, w]);
  return out;
}

export const Canasta: GameRules<CanastaConfig, CanastaState, Move, View, Ev> = {
  id: "canasta", minSeats: 2, maxSeats: 4,

  setup(config, seats, rng) {
    const sides = nSides(seats);
    const s: CanastaState = { n: seats, hands: [], stock: [], discard: [], melds: [], reds: [], frozen: false, scores: Array(sides).fill(0), lastRound: Array(sides).fill(0),
      turn: 0, phase: "draw", dealer: seats - 1, round: 0, target: config.target, closedAtStart: true };
    const events: Ev[] = []; deal(s, rng, events);
    return { state: s, events };
  },
  activeSeats: (s) => (s.phase === "over" ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.phase === "over" || seat !== s.turn) return [];
    if (s.phase === "draw") return [...(s.stock.length ? [{ t: "draw" } as Move] : []), ...pileMoves(s, seat)];
    const hand = s.hands[seat]!, canOut = hasCanasta(s, sideOf(s.n, seat)) || s.stock.length === 0;
    if (hand.length === 1 && !canOut) return [];
    return [...new Set(hand)].map((card): Move => ({ t: "discard", card }));
  },

  apply(prev, seat, move, rng) {
    const s: CanastaState = structuredClone(prev), events: Ev[] = [];
    if (s.phase === "over" || seat !== s.turn) throw new Error("not your turn");
    const n = s.n, sd = sideOf(n, seat), hand = s.hands[seat]!;

    if (move.t === "draw") {
      if (s.phase !== "draw") throw new Error("already drew");
      if (!s.stock.length) throw new Error("stock is empty");
      const c = s.stock.pop()!; hand.push(c); events.push({ t: "draw", seat, card: c });
      s.closedAtStart = s.melds[sd]!.length === 0; s.phase = "play"; placeReds(s, seat, events);
      return { state: s, events };
    }
    if (move.t === "pile") {
      const p = planPile(s, seat, move.cards, move.extra);
      s.closedAtStart = s.melds[sd]!.length === 0;
      const melds = s.melds[sd]!, items: MeldItem[] = [];
      if (p.created) melds.push({ rank: rankOf(p.top), cards: p.result }); else melds[p.mi]!.cards = p.result;
      const mi = p.created ? melds.length - 1 : p.mi;
      for (const g of p.extras) { melds.push({ rank: rankOf(g.find((c) => !isWild(c))!), cards: g }); items.push({ meld: melds.length - 1, cards: g.slice(), result: g.slice(), created: true }); }
      s.hands[seat] = p.newHand; s.discard = []; s.frozen = false; s.phase = "play";
      events.push({ t: "pile", seat, top: p.top, used: move.cards.slice(), meld: mi, result: p.result.slice(), created: p.created, taken: p.rest.slice() });
      if (items.length) events.push({ t: "meld", seat, items });
      placeReds(s, seat, events);
      if (s.hands[seat]!.length === 0) return { state: finishRound(s, seat, rng, events), events };
      return { state: s, events };
    }
    if (s.phase !== "play") throw new Error("draw first");

    if (move.t === "meld") {
      if (!move.groups.length) throw new Error("nothing to meld");
      const melds = s.melds[sd]!, base = melds.length, items: MeldItem[] = [];
      const afterUse = takeFromHand(hand, move.groups.flatMap((g) => g.cards));
      const ranksUsed = new Set<Rank>(melds.map((m) => m.rank));
      let value = 0;
      for (const g of move.groups) {
        value += meldPoints(g.cards);
        if (g.to === null) {
          const m = combine([], g.cards); if (!m) throw new Error("invalid meld");
          const r = rankOf(m.find((c) => !isWild(c))!); if (ranksUsed.has(r)) throw new Error("rank already melded"); ranksUsed.add(r);
          melds.push({ rank: r, cards: m }); items.push({ meld: melds.length - 1, cards: g.cards.slice(), result: m.slice(), created: true });
        } else {
          if (g.to < 0 || g.to >= base) throw new Error("no such meld");
          const m = combine(melds[g.to]!.cards, g.cards); if (!m) throw new Error("cannot add");
          melds[g.to]!.cards = m; items.push({ meld: g.to, cards: g.cards.slice(), result: m.slice(), created: false });
        }
      }
      if (base === 0 && value < minOpenFor(s.scores[sd]!)) throw new Error("opening value too low");
      if (!remainingOk(s, afterUse.length, hasCanasta(s, sd))) throw new Error("keep a card to discard");
      s.hands[seat] = afterUse;
      events.push({ t: "meld", seat, items });
      if (melds.filter(isCanasta).length > prev.melds[sd]!.filter(isCanasta).length) events.push({ t: "say", seat, key: "ca_canasta" });
      if (afterUse.length === 0) return { state: finishRound(s, seat, rng, events), events };
      return { state: s, events };
    }
    // discard
    if (!hand.includes(move.card)) throw new Error("card not in hand");
    if (hand.length === 1 && !(hasCanasta(s, sd) || s.stock.length === 0)) throw new Error("need a canasta to go out");
    hand.splice(hand.indexOf(move.card), 1); s.discard.push(move.card);
    if (isWild(move.card)) s.frozen = true;
    events.push({ t: "discard", seat, card: move.card });
    if (hand.length === 0) return { state: finishRound(s, seat, rng, events), events };
    s.turn = (seat + 1) % n; s.phase = "draw";
    if (!s.stock.length && !pileMoves(s, s.turn).length) { events.push({ t: "say", seat: null, key: "ca_stockEmpty" }); return { state: finishRound(s, null, rng, events), events }; }
    return { state: s, events };
  },

  view(s, seat) {
    const me = seat === "public" ? null : seat;
    return {
      you: seat, hand: me === null ? [] : s.hands[me]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0, trick: [], turn: s.phase === "over" ? null : s.turn,
      scores: s.hands.map((_, i) => s.scores[sideOf(s.n, i)]!), over: s.phase === "over", stock: s.stock.length, discardTop: s.discard[s.discard.length - 1] ?? null, discardSize: s.discard.length,
      frozen: s.frozen, phase: s.phase, round: s.round, target: s.target, sides: s.scores.length, mySide: me === null ? 0 : sideOf(s.n, me), sideScores: s.scores.slice(),
      melds: s.melds.map((ms) => ms.map((m) => ({ rank: m.rank, cards: m.cards.slice() }))), reds: s.reds.map((r) => r.slice()), minOpen: minOpenFor(s.scores[me === null ? 0 : sideOf(s.n, me)]!),
      lastRound: s.lastRound.slice(), teams: s.n === 4,
    };
  },
  redactEvent(ev, seat) { return ev.t === "draw" && ev.seat !== seat ? { ...ev, card: hide([ev.card])[0]! } : ev; },
  result(s) {
    if (s.phase !== "over") return null;
    const best = Math.max(...s.scores), win = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
    return { winners: s.hands.map((_, i) => i).filter((i) => win.includes(sideOf(s.n, i))), scores: s.hands.map((_, i) => s.scores[sideOf(s.n, i)]!) };
  },
};

function finishRound(s: CanastaState, out: Seat | null, rng: Rng, events: Ev[]): CanastaState {
  const sides = s.scores.length, outSide = out === null ? null : sideOf(s.n, out);
  const delta = Array(sides).fill(0) as number[];
  for (let sd = 0; sd < sides; sd++) {
    let p = 0; const opened = s.melds[sd]!.length > 0, reds = s.reds[sd]!.length, rp = reds * 100 + (reds === 4 ? 400 : 0);
    p += opened ? rp : -rp;
    for (const m of s.melds[sd]!) p += meldPoints(m.cards) + (m.cards.length >= 7 ? (m.cards.some(isWild) ? 300 : 500) : 0);
    if (outSide === sd) p += s.closedAtStart ? 200 : 100;
    for (const seat of seatsOf(s.n, sd)) p -= meldPoints(s.hands[seat]!);
    delta[sd] = p;
  }
  s.scores = s.scores.map((x, i) => x + delta[i]!); s.lastRound = delta;
  if (out !== null) events.push({ t: "say", seat: out, key: "ca_out" });
  s.round++;
  if (Math.max(...s.scores) >= s.target) s.phase = "over";
  else { s.dealer = (s.dealer + 1) % s.n; deal(s, rng, events); }
  return s;
}

// ---- client-side validation against a View (same rules as apply, so the UI can explain mistakes instead of sending illegal moves)
const viewRemainingOk = (v: View, rem: number, canasta: boolean) => rem >= 2 || ((canasta || v.stock === 0) && rem >= 0);
const sameCards = (hand: Card[], cards: Card[]): Card[] | null => { const h = hand.slice(); for (const c of cards) { const i = h.indexOf(c); if (i < 0) return null; h.splice(i, 1); } return h; };
const natRank = (g: Card[]): Rank => rankOf(g.find((c) => !isWild(c))!);
/** Returns an i18n key naming the problem, or null when the meld move is fine. */
export function checkMelds(v: View, groups: { to: number | null; cards: Card[] }[]): string | null {
  if (!groups.length) return "ca_err_invalid";
  const base = v.melds[v.mySide]!, sim = base.map((m) => ({ rank: m.rank, cards: m.cards.slice() }));
  const left = sameCards(v.hand, groups.flatMap((g) => g.cards)); if (!left) return "ca_err_invalid";
  const ranks = new Set<Rank>(base.map((m) => m.rank)); let value = 0;
  for (const g of groups) {
    value += meldPoints(g.cards);
    if (g.to === null) { const m = combine([], g.cards); if (!m) return "ca_err_invalid"; const r = natRank(m); if (ranks.has(r)) return "ca_err_rank"; ranks.add(r); sim.push({ rank: r, cards: m }); }
    else { const t = base[g.to]; const m = t && combine(t.cards, g.cards); if (!m) return "ca_err_invalid"; sim[g.to]!.cards = m; }
  }
  if (base.length === 0 && value < v.minOpen) return "ca_err_open";
  if (!viewRemainingOk(v, left.length, sim.some(isCanasta))) return "ca_err_keep";
  return null;
}
/** Same for taking the discard pile with `cards` from the hand (plus `extra` groups when opening). */
export function checkPile(v: View, cards: Card[], extra: Card[][]): string | null {
  const top = v.discardTop; if (!top || isWild(top) || isBlack3(top) || isRed3(top)) return "ca_err_blocked";
  const base = v.melds[v.mySide]!, rank = rankOf(top), mi = base.findIndex((m) => m.rank === rank), frozen = v.frozen || base.length === 0;
  const left = sameCards(v.hand, [...cards, ...extra.flat()]); if (!left) return "ca_err_invalid";
  let result: Card[] | null;
  if (mi >= 0) { if (v.frozen) return "ca_err_frozen"; result = combine(base[mi]!.cards, [top, ...cards]); }
  else { const nat = cards.filter((c) => !isWild(c) && rankOf(c) === rank).length; if (frozen ? nat < 2 : nat < 1) return v.frozen || base.length === 0 ? "ca_err_pair" : "ca_err_match"; result = combine([], [top, ...cards]); }
  if (!result) return "ca_err_invalid";
  const ranks = new Set<Rank>([rank, ...base.map((m) => m.rank)]); let canasta = base.some(isCanasta) || result.length >= 7, value = meldPoints(result);
  for (const g of extra) { const m = combine([], g); if (!m) return "ca_err_invalid"; const r = natRank(m); if (ranks.has(r)) return "ca_err_rank"; ranks.add(r); value += meldPoints(m); canasta = canasta || m.length >= 7; }
  if (base.length === 0 && value < v.minOpen) return "ca_err_open";
  if (!viewRemainingOk(v, left.length + v.discardSize - 1, canasta)) return "ca_err_keep";
  return null;
}
