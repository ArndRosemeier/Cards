import { makeDeck, rankOf, suitOf, SKAT_RANKS, type Card, type Rng } from "@cards/engine";
import { cardPoints, isTrump, jackMultiplier, strength, type Game } from "./rules.ts";

/**
 * A light perfect-information Skat simulator for the bot: a world is a full deal (every hand known), and a fixed
 * greedy policy plays it out. The bot samples worlds that are consistent with what it has seen (Monte-Carlo over the
 * hidden cards) and compares moves by the average outcome of the playouts.
 */
export interface World {
  g: Game;
  hands: Card[][];          // all three hands, index = seat
  decl: number;             // declarer seat (-1 in Ramsch)
  trick: { seat: number; card: Card }[];
  turn: number;
  pts: number[];            // card points taken in tricks, per seat
  tricks: number[];         // tricks won, per seat
}
export interface Outcome { pts: number[]; tricks: number[] }

export const ALL_CARDS: Card[] = makeDeck(SKAT_RANKS);
export const eff = (c: Card, g: Game): string => (isTrump(c, g) ? "T" : suitOf(c));
export const beats = (c: Card, cur: Card, g: Game): boolean => {
  const a = eff(c, g), b = eff(cur, g);
  return a === b ? strength(c, g) > strength(cur, g) : a === "T";
};
export function legalIn(hand: Card[], trick: { card: Card }[], g: Game): Card[] {
  if (!trick.length) return hand;
  const led = eff(trick[0]!.card, g);
  const follow = hand.filter((c) => eff(c, g) === led);
  return follow.length ? follow : hand;
}
export function winnerOf(trick: { seat: number; card: Card }[], g: Game): { seat: number; card: Card } {
  let best = trick[0]!;
  for (const p of trick) if (beats(p.card, best.card, g)) best = p;
  return best;
}
const trumpsOf = (hand: Card[], g: Game) => hand.filter((c) => isTrump(c, g));
const lowest = (cs: Card[], g: Game) => cs.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || strength(a, g) - strength(b, g))[0]!;
const highestPts = (cs: Card[], g: Game) => cs.slice().sort((a, b) => cardPoints(b) - cardPoints(a) || strength(a, g) - strength(b, g))[0]!;
const cheapest = (cs: Card[], g: Game) => cs.slice().sort((a, b) => strength(a, g) - strength(b, g) || cardPoints(a) - cardPoints(b))[0]!;
const tr = (c: Card, g: Game) => (isTrump(c, g) ? 1000 : 0) + strength(c, g);

/** The playout policy. It sees every hand, as the worlds are perfect-information. */
export function pick(w: World, seat: number): Card {
  const g = w.g, hand = w.hands[seat]!, legal = legalIn(hand, w.trick, g);
  if (legal.length === 1) return legal[0]!;
  if (g === "N") return pickNull(w, seat, legal);
  if (g === "R") return pickRamsch(w, seat, legal);
  const isDecl = seat === w.decl;
  const others = [0, 1, 2].filter((s) => s !== seat);
  if (!w.trick.length) return lead(w, seat, legal, isDecl);
  const cur = winnerOf(w.trick, g);
  const after = [0, 1, 2].filter((s) => s !== seat && !w.trick.some((p) => p.seat === s));   // players still to play
  const mateWins = !isDecl && cur.seat !== w.decl;
  const beatenLater = (card: Card) => after.some((s) => legalIn(w.hands[s]!, [...w.trick, { seat, card }], g).some((c) => beats(c, card, g)));
  const trickPts = w.trick.reduce((a, p) => a + cardPoints(p.card), 0);
  const winners = legal.filter((c) => beats(c, cur.card, g));
  if (mateWins) {
    if (!beatenLater(cur.card)) return highestPts(legal, g);                       // safe: put points on a won trick
    const over = winners.filter((c) => !beatenLater(c));
    if (over.length && trickPts + 0 >= 4) return cheapest(over, g);                // take it over from the partner when it saves the trick
    return lowest(legal, g);
  }
  if (winners.length) {
    const safe = winners.filter((c) => !beatenLater(c));
    const worth = isDecl || trickPts >= 4 || after.length === 0 || winners.some((c) => cardPoints(c) >= 10);
    if (safe.length && (worth || trickPts + cardPoints(safe[0]!) >= 5)) return cheapest(safe, g);
    if (worth && after.length === 0) return cheapest(winners, g);
    if (isDecl && after.length) return cheapest(winners, g);
  }
  void others;
  // cannot or will not win: shed the cheapest card, keep trumps
  const nonTrump = legal.filter((c) => !isTrump(c, g));
  return lowest(nonTrump.length ? nonTrump : legal, g);
}

function lead(w: World, seat: number, legal: Card[], isDecl: boolean): Card {
  const g = w.g;
  const defenders = [0, 1, 2].filter((s) => s !== w.decl);
  const oppTrumps = (isDecl ? defenders : [w.decl]).reduce((a, s) => a + trumpsOf(w.hands[s]!, g).length, 0);
  const myTrumps = trumpsOf(legal, g);
  const opponents = isDecl ? defenders : [w.decl];
  const sideSafe = (c: Card) => {                                                 // nobody can take it: top of its suit, or no trump left to ruff
    const suit = eff(c, g);
    return opponents.every((s) => {
      const h = w.hands[s]!;
      const higher = h.some((x) => eff(x, g) === suit && strength(x, g) > strength(c, g));
      const ruff = h.every((x) => eff(x, g) !== suit) && h.some((x) => isTrump(x, g));
      return !higher && !ruff;
    });
  };
  if (isDecl) {
    if (oppTrumps > 0 && myTrumps.length >= 2) {
      const top = myTrumps.slice().sort((a, b) => tr(b, g) - tr(a, g))[0]!;
      return strength(top, g) >= 100 || myTrumps.length >= 4 ? top : cheapest(myTrumps, g);
    }
    const sure = legal.filter((c) => !isTrump(c, g) && sideSafe(c)).sort((a, b) => cardPoints(b) - cardPoints(a));
    if (sure.length) return sure[0]!;
    if (myTrumps.length && oppTrumps > 0) return myTrumps.slice().sort((a, b) => tr(b, g) - tr(a, g))[0]!;
    const side = legal.filter((c) => !isTrump(c, g));
    return lowest(side.length ? side : legal, g);
  }
  // defender
  const sure = legal.filter((c) => !isTrump(c, g) && sideSafe(c)).sort((a, b) => cardPoints(b) - cardPoints(a));
  if (sure.length) return sure[0]!;
  const declVoid = (suit: string) => w.hands[w.decl]!.every((x) => eff(x, g) !== suit);
  const safeLow = legal.filter((c) => !isTrump(c, g) && !declVoid(eff(c, g)));
  if (safeLow.length) return lowest(safeLow, g);
  return lowest(legal, g);
}

function pickNull(w: World, seat: number, legal: Card[]): Card {
  const g = w.g;
  const rank = (c: Card) => strength(c, "N");
  if (seat === w.decl) {
    if (!w.trick.length) return legal.slice().sort((a, b) => rank(a) - rank(b))[0]!;
    const cur = winnerOf(w.trick, g);
    const under = legal.filter((c) => !beats(c, cur.card, g));
    return under.length ? under.sort((a, b) => rank(b) - rank(a))[0]! : legal.slice().sort((a, b) => rank(a) - rank(b))[0]!;
  }
  // defenders try to make the declarer win a trick
  if (!w.trick.length) return legal.slice().sort((a, b) => rank(a) - rank(b))[0]!;
  const declPlayed = w.trick.find((p) => p.seat === w.decl);
  const cur = winnerOf(w.trick, g);
  if (declPlayed && cur.seat === w.decl) return legal.filter((c) => !beats(c, cur.card, g)).sort((a, b) => rank(b) - rank(a))[0] ?? legal.slice().sort((a, b) => rank(a) - rank(b))[0]!;
  const under = legal.filter((c) => !beats(c, cur.card, g));
  return under.length ? under.sort((a, b) => rank(b) - rank(a))[0]! : legal.slice().sort((a, b) => rank(a) - rank(b))[0]!;
}

function pickRamsch(w: World, seat: number, legal: Card[]): Card {
  const g = w.g;
  if (!w.trick.length) return lowest(legal, g);
  const cur = winnerOf(w.trick, g);
  const losing = legal.filter((c) => !beats(c, cur.card, g));
  if (losing.length) return highestPts(losing, g);          // someone else takes it: give them the points
  void seat;
  return lowest(legal, g);
}

/** Play one card; completes the trick when it is the third. */
export function step(w: World, seat: number, card: Card) {
  const h = w.hands[seat]!; h.splice(h.indexOf(card), 1);
  w.trick.push({ seat, card });
  if (w.trick.length === 3) {
    const win = winnerOf(w.trick, w.g);
    w.pts[win.seat]! += w.trick.reduce((a, p) => a + cardPoints(p.card), 0); w.tricks[win.seat]!++;
    w.trick = []; w.turn = win.seat;
  } else w.turn = (seat + 1) % 3;
}
/** Play the world to the end with the greedy policy. */
export function playout(w: World): Outcome {
  while (w.hands[0]!.length + w.hands[1]!.length + w.hands[2]!.length > 0) step(w, w.turn, pick(w, w.turn));
  return { pts: w.pts, tricks: w.tricks };
}
export function cloneWorld(w: World): World {
  return { g: w.g, hands: w.hands.map((h) => h.slice()), decl: w.decl, trick: w.trick.map((p) => ({ ...p })), turn: w.turn, pts: w.pts.slice(), tricks: w.tricks.slice() };
}
export const pointsOf = (cs: Card[]) => cs.reduce((a, c) => a + cardPoints(c), 0);

/** Deal `pool` into hands of the given sizes, respecting known voids (suit classes a seat could not follow). */
export function dealPool(pool: Card[], sizes: number[], seats: number[], voids: Record<number, Set<string>>, g: Game, rng: Rng, accept?: (hands: Card[][]) => boolean): Card[][] | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const deck = rng.shuffle(pool);
    const hands: Card[][] = seats.map(() => []);
    const cap = sizes.slice();
    let ok = true;
    // place the most constrained cards first
    const order = deck.slice().sort((a, b) => allowedCount(a) - allowedCount(b));
    function allowedCount(c: Card) { return seats.filter((s, i) => cap[i]! > 0 && !voids[s]?.has(eff(c, g))).length; }
    for (const c of order) {
      const options = seats.map((s, i) => i).filter((i) => cap[i]! > 0 && !voids[seats[i]!]?.has(eff(c, g)));
      if (!options.length) { ok = false; break; }
      // weight by remaining capacity so the hands fill evenly
      let total = 0; for (const i of options) total += cap[i]!;
      let r = rng.next() * total, pickI = options[0]!;
      for (const i of options) { r -= cap[i]!; if (r <= 0) { pickI = i; break; } }
      hands[pickI]!.push(c); cap[pickI]!--;
    }
    if (ok && (!accept || accept(hands))) return hands;
  }
  return null;
}

/** Suits (and "T" for trump) each seat has shown not to hold, read from the completed tricks and the current one. */
export function voidsFrom(history: { seat: number; card: Card }[][], current: { seat: number; card: Card }[], g: Game): Record<number, Set<string>> {
  const voids: Record<number, Set<string>> = { 0: new Set(), 1: new Set(), 2: new Set() };
  for (const t of [...history, current]) {
    if (!t.length) continue;
    const led = eff(t[0]!.card, g);
    for (const p of t.slice(1)) if (eff(p.card, g) !== led) voids[p.seat]!.add(led);
  }
  return voids;
}
export { jackMultiplier, rankOf };
