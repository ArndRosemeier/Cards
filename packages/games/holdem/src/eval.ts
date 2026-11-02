import { RANKS, rankOf, suitOf, type Card } from "@cards/engine";

export const HAND_NAMES = ["highCard", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"] as const;
const rv = (c: Card) => RANKS.indexOf(rankOf(c)) + 2; // 2..14

/** Score of exactly 5 cards: higher is better. category * 15^5 + tie-break ranks. */
export function score5(cards: Card[]): number {
  const vals = cards.map(rv).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const uniq = [...new Set(vals)];
  let high = 0;
  if (uniq.length === 5) { if (vals[0]! - vals[4]! === 4) high = vals[0]!; else if (vals[0] === 14 && vals[1] === 5) high = 5; }
  const straight = high > 0;
  const counts = new Map<number, number>(); for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kick = (arr: number[]) => arr.reduce((a, v) => a * 15 + v, 0);
  const pack = (cat: number, ranks: number[]) => cat * 15 ** 5 + kick(ranks.concat([0, 0, 0, 0, 0]).slice(0, 5));
  if (straight && flush) return pack(8, [high]);
  if (groups[0]![1] === 4) return pack(7, [groups[0]![0], groups[1]![0]]);
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return pack(6, [groups[0]![0], groups[1]![0]]);
  if (flush) return pack(5, vals);
  if (straight) return pack(4, [high]);
  if (groups[0]![1] === 3) return pack(3, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return pack(2, [groups[0]![0], groups[1]![0], groups[2]![0]]);
  if (groups[0]![1] === 2) return pack(1, [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]]);
  return pack(0, vals);
}
/** Best 5-card score from 5..7 cards. */
export function bestScore(cards: Card[]): number {
  if (cards.length === 5) return score5(cards);
  let best = -1; const n = cards.length;
  const pick: Card[] = [];
  const rec = (start: number) => {
    if (pick.length === 5) { const s = score5(pick); if (s > best) best = s; return; }
    for (let i = start; i < n; i++) { pick.push(cards[i]!); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return best;
}
export const categoryOf = (score: number) => Math.floor(score / 15 ** 5);
