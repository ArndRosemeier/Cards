import { rankOf, suitOf, type Bot, type Card } from "@cards/engine";
import { cardPoints, isTrump, strength, type Mode, type Move, type View } from "./rules.ts";

function trumpScore(hand: Card[], m: Mode): number {
  return hand.reduce((a, c) => a + (isTrump(c, m) ? (rankOf(c) === "Q" ? 2.2 : rankOf(c) === "J" ? 1.5 : 1) : 0), 0);
}
export const schafkopfBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    if (v.phase === "choose") {
      const games = legal.filter((m): m is Extract<Move, { t: "game" }> => m.t === "game").map((m) => m.mode);
      const hand = v.hand;
      const obers = hand.filter((c) => rankOf(c) === "Q").length;
      let best: { m: Mode; sc: number } | null = null;
      for (const m of games) {
        let sc = trumpScore(hand, m);
        if (m.startsWith("sau")) sc = trumpScore(hand, m) - 4.2 + (obers >= 2 ? 0.6 : 0);
        else if (m === "wenz") sc = hand.filter((c) => rankOf(c) === "J").length * 2.5 - 5.5 + (hand.includes("CJ" as Card) ? 1 : 0);
        else sc = trumpScore(hand, m) - 9.5;
        if (sc > 0 && (!best || sc > best.sc)) best = { m, sc };
      }
      if (best && best.sc > 0.4) return { t: "game", mode: best.m };
      return { t: "pass" };
    }
    const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
    if (plays.length === 1) return { t: "play", card: plays[0]! };
    const m = v.mode!;
    const st = (c: Card) => strength(c, m);
    const tr = (c: Card) => st(c);
    const trick = v.trick, me = v.you as number;
    const partner = v.role === "partner" ? v.declarer : v.role === "declarer" ? v.partnerKnown : null;
    const isPartner = (s: number) => (partner !== null && s === partner) || (v.role === "opponent" && v.mode!.startsWith("sau") && v.partnerKnown !== null && s !== v.declarer && s !== v.partnerKnown && s !== me);
    if (!trick.length) {
      const aces = plays.filter((c) => rankOf(c) === "A" && !isTrump(c, m) && !(m.startsWith("sau") && c[0] === m.slice(3) && v.role !== "declarer"));
      if (aces.length) return { t: "play", card: aces[0]! };
      if (v.role === "declarer" || v.role === "partner") {
        const t2 = plays.filter((c) => isTrump(c, m)).sort((a, b) => tr(b) - tr(a));
        if (t2.length >= 4) return { t: "play", card: t2[0]! };
      }
      return { t: "play", card: plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || tr(a) - tr(b))[0]! };
    }
    let win = trick[0]!;
    for (const p of trick.slice(1)) {
      const a = isTrump(p.card, m), b = isTrump(win.card, m);
      if (a === b ? st(p.card) > st(win.card) : a) win = p;
    }
    const last = trick.length === 3, pot = trick.reduce((a, p) => a + cardPoints(p.card), 0);
    const beat = plays.filter((c) => { const a = isTrump(c, m), b = isTrump(win.card, m); return a === b ? st(c) > st(win.card) : a; }).sort((a, b) => tr(a) - tr(b));
    const dump = () => plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || tr(a) - tr(b))[0]!;
    const smear = () => plays.slice().sort((a, b) => cardPoints(b) - cardPoints(a) || tr(a) - tr(b))[0]!;
    if (isPartner(win.seat)) return { t: "play", card: last || st(win.card) > 190 ? smear() : dump() };
    if (beat.length && (pot >= 10 || last || rng.next() < 0.3)) return { t: "play", card: beat[0]! };
    return { t: "play", card: dump() };
  },
};
export { suitOf };
