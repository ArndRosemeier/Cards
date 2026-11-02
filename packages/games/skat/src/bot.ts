import { rankOf, suitOf, type Bot, type Card, type Rng } from "@cards/engine";
import { BIDS, cardPoints, gameValue, isTrump, jackMultiplier, strength, type Game, type Move, type View } from "./rules.ts";

const BASE: Record<string, number> = { C: 12, S: 11, H: 10, D: 9, G: 24 };

/** Rough strength of playing `g` with these cards: trump count weighted, plus top side cards. */
function assess(cards: Card[], g: Game): number {
  const trumps = cards.filter((c) => isTrump(c, g));
  const jacks = cards.filter((c) => rankOf(c) === "J").length;
  const aces = cards.filter((c) => rankOf(c) === "A" && !isTrump(c, g)).length;
  const need = g === "G" ? jacks >= 2 ? 0 : 99 : 0;
  if (need) return 0;
  const length = trumps.length;
  if (g === "G") return jacks * 3 + aces * 2.2 + cards.filter((c) => rankOf(c) === "T").length;
  return length * 2.2 + jacks * 0.8 + aces * 1.6 + (cards.some((c) => c === "CJ") ? 1 : 0);
}
function bestGame(cards: Card[]): { game: Game; score: number } {
  let best: { game: Game; score: number } = { game: "C", score: -1 };
  for (const g of ["C", "S", "H", "D", "G"] as Game[]) { const sc = assess(cards, g); if (sc > best.score) best = { game: g, score: sc }; }
  return best;
}
/** The highest bid we are willing to make (0 = pass). */
function maxBid(cards: Card[]): number {
  const { game, score } = bestGame(cards);
  if (score < 11) return 0;
  const mult = jackMultiplier(cards);
  const v = gameValue(game, cards, false, false, false) * (score > 15 ? 1 : 1);
  return Math.max(0, v - (score < 13 ? BASE[game]! : 0)) + (mult > 2 ? 0 : 0);
}

const cardsOf = (legal: Move[]) => legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);

export const skatBot: Bot<View, Move> = {
  choose(v, legal, rng: Rng) {
    const has = (t: Move["t"]) => legal.find((m) => m.t === t);
    const hand = v.hand;
    if (v.phase === "bid") {
      const limit = maxBid(hand);
      const bids = legal.filter((m): m is Extract<Move, { t: "bid" }> => m.t === "bid");
      if (has("hold")) return limit >= (BIDS[v.bidLevel] ?? 18) ? has("hold")! : has("pass")!;
      const next = bids.find((b) => b.value <= limit);
      if (next) return next;
      return has("pass") ?? legal[0]!;
    }
    if (v.phase === "skat") return has("pickup")!;
    if (v.phase === "discard") {
      const { game } = bestGame(hand);
      const nonTrump = hand.filter((c) => !isTrump(c, game));
      const suitLen = (c: Card) => hand.filter((x) => suitOf(x) === suitOf(c) && !isTrump(x, game)).length;
      const ranked = (nonTrump.length >= 2 ? nonTrump : hand).slice().sort((a, b) => {
        const ka = (suitLen(a) <= 2 ? -1 : 0) * 10 + (rankOf(a) === "A" ? 50 : 0) - cardPoints(a) * 0.2;
        const kb = (suitLen(b) <= 2 ? -1 : 0) * 10 + (rankOf(b) === "A" ? 50 : 0) - cardPoints(b) * 0.2;
        return ka - kb;
      });
      const pick = ranked.slice(0, 2);
      return legal.find((m) => m.t === "cards" && pick.every((c) => m.cards.includes(c))) ?? legal[0]!;
    }
    if (v.phase === "announce") return legal.find((m) => m.t === "announce" && m.level === "none")!;
    if (v.phase === "declare") {
      const { game } = bestGame(hand);
      return legal.find((m) => m.t === "game" && m.game === game) ?? legal[0]!;
    }
    // ---- card play
    const plays = cardsOf(legal);
    const g = v.game!;
    if (plays.length === 1) return { t: "play", card: plays[0]! };
    const isDecl = v.declarer === v.you;
    const trick = v.trick;
    const sorted = plays.slice().sort((a, b) => strength(a, g) - strength(b, g) || cardPoints(a) - cardPoints(b));
    const tr = (c: Card) => (isTrump(c, g) ? 1000 : 0) + strength(c, g);
    if (g === "N") {
      if (isDecl) return { t: "play", card: trick.length ? lowestBelow(plays, trick, g) : sorted[0]! };
      return { t: "play", card: trick.length ? highestBelowWinner(plays, trick, g) : sorted[Math.floor(rng.next() * Math.min(2, sorted.length))]! };
    }
    if (!trick.length) {
      // lead
      const trumps = plays.filter((c) => isTrump(c, g));
      if (isDecl && trumps.length * 2 >= plays.length) return { t: "play", card: trumps.sort((a, b) => tr(b) - tr(a))[0]! };
      const aces = plays.filter((c) => rankOf(c) === "A" && !isTrump(c, g));
      if (aces.length) return { t: "play", card: aces[0]! };
      return { t: "play", card: plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || tr(a) - tr(b))[0]! };
    }
    const winning = trick.reduce((a, b) => (beats(b.card, a.card, trick[0]!.card, g) ? b : a));
    const partnerWinning = !isDecl && winning.seat !== v.declarer;
    const last = trick.length === 2;
    const winners = plays.filter((c) => beats(c, winning.card, trick[0]!.card, g)).sort((a, b) => tr(a) - tr(b));
    if (partnerWinning) {
      if (last || strength(winning.card, g) > 8) return { t: "play", card: plays.slice().sort((a, b) => cardPoints(b) - cardPoints(a))[0]! }; // smear
      return { t: "play", card: plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || tr(a) - tr(b))[0]! };
    }
    if (winners.length) {
      const pot = trick.reduce((a, p) => a + cardPoints(p.card), 0);
      if (pot >= 4 || last || isDecl) return { t: "play", card: winners[0]! };
    }
    return { t: "play", card: plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || tr(a) - tr(b))[0]! };
  },
};

function beats(c: Card, cur: Card, led: Card, g: Game): boolean {
  const ec = isTrump(c, g) ? "T" : suitOf(c), eb = isTrump(cur, g) ? "T" : suitOf(cur);
  if (ec === eb) return strength(c, g) > strength(cur, g);
  return ec === "T";
}
function lowestBelow(plays: Card[], trick: { seat: number; card: Card }[], g: Game): Card {
  const top = trick.reduce((a, p) => (beats(p.card, a, trick[0]!.card, g) ? p.card : a), trick[0]!.card);
  const under = plays.filter((c) => !beats(c, top, trick[0]!.card, g));
  return (under.length ? under : plays).slice().sort((a, b) => strength(b, g) - strength(a, g))[0]!;
}
function highestBelowWinner(plays: Card[], trick: { seat: number; card: Card }[], g: Game): Card {
  return lowestBelow(plays, trick, g);
}
