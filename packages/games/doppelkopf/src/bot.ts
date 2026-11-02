import { rankOf, type Bot, type Card } from "@cards/engine";
import { cardPoints, isTrump, strength, type Mode, type Move, type View } from "./rules.ts";

const strip = (c: Card) => c.slice(0, 2);
const eff = (m: Mode): Mode => (m === "normal" || m === "hochzeit" ? "soloD" : m);

function handValue(hand: Card[]): number {
  let v = 0;
  for (const c of hand) {
    if (strip(c) === "HT") v += 2.5; else if (rankOf(c) === "Q") v += strip(c) === "CQ" ? 2.2 : 1.6; else if (rankOf(c) === "J") v += 0.8; else if (isTrump(c, "soloD")) v += 0.8;
    else if (rankOf(c) === "A") v += 0.6;
  }
  return v;
}

export const dokoBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    const has = (f: (m: Move) => boolean) => legal.find(f);
    if (v.phase === "reserve") {
      const hv = handValue(v.hand);
      const hoch = has((m) => m.t === "reserve" && m.mode === "hochzeit");
      if (hoch) return hoch;
      if (hv >= 17.5) return has((m) => m.t === "reserve" && m.mode === "soloD")!;   // very strong: Karo solo
      return has((m) => m.t === "reserve" && m.mode === "ok")!;
    }
    const ann = has((m) => m.t === "announce");
    if (ann && v.hand.length === 12 && handValue(v.hand) >= 12 && rng.next() < 0.8) return ann;
    const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
    if (plays.length === 1) return { t: "play", card: plays[0]! };
    const mode = eff(v.mode);
    const st = (c: Card) => strength(c, mode);
    const lowTrump = (c: Card) => (isTrump(c, mode) ? 50 : 0) + st(c) * 0.01;
    const trick = v.trick;
    const reKnown = new Set(v.seenQ);
    const me = v.you as number;
    const isPartner = (s: number) => {
      if (v.team === "re") return reKnown.has(s) && s !== me;
      return !reKnown.has(s) && v.seenQ.length >= 2;   // all queens seen: everyone else is Kontra
    };
    const isFoe = (s: number) => {
      if (v.team === "re") return !reKnown.has(s) && v.seenQ.length >= 2 ? true : false;
      return reKnown.has(s);
    };
    if (!trick.length) {
      const aces = plays.filter((c) => rankOf(c) === "A" && !isTrump(c, mode));
      if (aces.length && rng.next() < 0.85) return { t: "play", card: aces[0]! };
      const trumps = plays.filter((c) => isTrump(c, mode));
      if (v.team === "re" && trumps.length >= 5) return { t: "play", card: trumps.sort((a, b) => st(b) - st(a))[0]! };
      const side = plays.filter((c) => !isTrump(c, mode)).sort((a, b) => cardPoints(a) - cardPoints(b));
      return { t: "play", card: (side[0] ?? plays.slice().sort((a, b) => st(a) - st(b))[0])! };
    }
    let win = trick[0]!;
    for (const p of trick.slice(1)) {
      const gp = isTrump(p.card, mode), gw = isTrump(win.card, mode);
      if (gp === gw ? (st(p.card) > st(win.card) || (strip(p.card) === "HT" && strip(win.card) === "HT")) : gp) win = p;
    }
    const last = trick.length === 3;
    const pot = trick.reduce((a, p) => a + cardPoints(p.card), 0);
    const beaters = plays.filter((c) => {
      const gp = isTrump(c, mode), gw = isTrump(win.card, mode);
      return gp === gw ? st(c) > st(win.card) || (strip(c) === "HT" && strip(win.card) === "HT") : gp;
    }).sort((a, b) => lowTrump(a) - lowTrump(b));
    const smear = () => plays.slice().sort((a, b) => cardPoints(b) - cardPoints(a) || lowTrump(a) - lowTrump(b))[0]!;
    const dump = () => plays.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || lowTrump(a) - lowTrump(b))[0]!;
    if (isPartner(win.seat)) return { t: "play", card: last || st(win.card) > 140 ? smear() : dump() };
    if (beaters.length && (isFoe(win.seat) || pot >= 10 || last)) return { t: "play", card: beaters[0]! };
    return { t: "play", card: dump() };
  },
};
