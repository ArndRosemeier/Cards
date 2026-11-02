import { makeDeck, RANKS, rankOf, suitOf, Rng, type Bot, type Card } from "@cards/engine";
import { bestScore } from "./eval.ts";
import type { Move, View } from "./rules.ts";

const rv = (c: Card) => RANKS.indexOf(rankOf(c)) + 2;

/** Monte-Carlo equity of `hole` on `board` against `opps` random hands. */
export function equity(hole: Card[], board: Card[], opps: number, rng: Rng, samples = 160): number {
  const used = new Set<Card>([...hole, ...board]);
  const rest = makeDeck().filter((c) => !used.has(c));
  let win = 0;
  for (let k = 0; k < samples; k++) {
    const deck = rng.shuffle(rest);
    let p = 0;
    const b = board.concat(deck.slice(p, p + 5 - board.length)); p += 5 - board.length;
    const mine = bestScore([...hole, ...b]);
    let best = true, tie = 0;
    for (let o = 0; o < opps; o++) {
      const sc = bestScore([deck[p]!, deck[p + 1]!, ...b]); p += 2;
      if (sc > mine) { best = false; break; }
      if (sc === mine) tie++;
    }
    if (best) win += tie ? 1 / (tie + 1) : 1;
  }
  return win / samples;
}

/** Preflop heuristic strength 0..1 (Chen-style). */
export function preflop(hole: Card[]): number {
  const [a, b] = hole.map(rv).sort((x, y) => y - x) as [number, number];
  const pts = (v: number) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  let s = pts(a);
  if (a === b) s = Math.max(5, s * 2);
  if (suitOf(hole[0]!) === suitOf(hole[1]!)) s += 2;
  const gap = a - b - 1;
  if (a !== b) s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 12 && a !== b) s += 1;
  return Math.max(0, Math.min(1, (s + 1) / 21));
}

export const holdemBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    const me = v.you as number;
    const opps = Math.max(1, v.inHand.filter((x, i) => x && i !== me).length);
    const has = (t: Move["t"]) => legal.find((m) => m.t === t);
    const raises = legal.filter((m): m is Extract<Move, { t: "raise" }> => m.t === "raise");
    const eq = v.community.length === 0 ? preflop(v.hand) ** (1 + 0.15 * (opps - 1)) * 0.9 + 0.08 : equity(v.hand, v.community, opps, rng);
    const pot = v.pot, toCall = v.toCall;
    const odds = toCall / Math.max(1, pot + toCall);
    const bluff = rng.next() < 0.06;
    const aggressive = eq > 0.62 + 0.04 * (opps - 1) || (bluff && eq > 0.3);
    if (toCall === 0) {
      if (aggressive && raises.length && rng.next() < 0.8) {
        const idx = Math.min(raises.length - 1, Math.floor(rng.next() * (eq > 0.8 ? raises.length : Math.max(1, raises.length / 2))));
        return raises[Math.max(0, Math.min(idx, raises.length - 2 < 0 ? 0 : raises.length - 2))]!;
      }
      return has("check")!;
    }
    if (eq > 0.8 && raises.length && rng.next() < 0.7) return raises[Math.min(raises.length - 1, 1 + Math.floor(rng.next() * 2))] ?? raises[raises.length - 1]!;
    if (aggressive && raises.length && rng.next() < 0.35) return raises[0]!;
    if (eq > odds + 0.05 || (toCall <= v.bb && eq > 0.25)) return has("call")!;
    return has("fold") ?? has("call")!;
  },
};
