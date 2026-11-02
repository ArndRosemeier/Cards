import { isJoker, rankOf, suitOf, RANKS, type Card } from "@cards/engine";

export interface Meld { kind: "set" | "run"; cards: Card[]; value: number }

const rankNum = (c: Card): number => { const i = RANKS.indexOf(rankOf(c)) + 2; return i; }; // 2..14 (A=14)
export const cardValue = (c: Card): number => (isJoker(c) ? 20 : rankOf(c) === "A" ? 11 : ["T", "J", "Q", "K"].includes(rankOf(c)) ? 10 : rankNum(c));
const posValue = (pos: number): number => (pos === 14 || pos === 1 ? 11 : pos >= 10 ? 10 : pos); // pos 1..14, A low/high = 11

/** Order and validate a meld. At most one joker per meld. Returns null if invalid. */
export function parseMeld(cards: Card[]): Meld | null {
  if (cards.length < 3) return null;
  const jokers = cards.filter(isJoker), real = cards.filter((c) => !isJoker(c));
  if (jokers.length > 1 || real.length < 2) return null;
  // set: same rank, different suits, 3 or 4 cards
  if (real.every((c) => rankOf(c) === rankOf(real[0]!)) && cards.length <= 4) {
    const suits = new Set(real.map(suitOf));
    if (suits.size === real.length) {
      const v = rankNum(real[0]!) === 14 ? 11 : cardValue(real[0]!);
      return { kind: "set", cards: [...real, ...jokers], value: v * cards.length };
    }
  }
  // run: same suit, distinct ranks, consecutive (ace low or high)
  if (!real.every((c) => suitOf(c) === suitOf(real[0]!))) return null;
  let best: Meld | null = null;
  for (const aceHigh of [false, true]) {
    const nums = real.map((c) => { const n = rankNum(c); return n === 14 && !aceHigh ? 1 : n; }).sort((a, b) => a - b);
    if (new Set(nums).size !== nums.length) continue;
    const lo = nums[0]!, hi = nums[nums.length - 1]!;
    const gaps = hi - lo + 1 - nums.length;
    const spare = jokers.length - gaps;
    if (gaps < 0 || spare < 0) continue;
    if (gaps === 0 && !jokers.length && cards.length !== nums.length) continue;
    if (hi - lo + 1 + spare > 14 || lo < 1) continue;
    let start = lo, end = hi;
    if (spare === 1) { if (end < 14) end++; else if (start > 1) start--; else continue; }
    // positions → ordered cards
    const byNum = new Map<number, Card>(real.map((c) => { const n = rankNum(c); return [n === 14 && !aceHigh ? 1 : n, c]; }));
    const ordered: Card[] = []; let jk = 0, value = 0;
    for (let p = start; p <= end; p++) { const c = byNum.get(p) ?? jokers[jk++]!; ordered.push(c); value += posValue(p); }
    if (ordered.length !== cards.length) continue;
    const m: Meld = { kind: "run", cards: ordered, value };
    if (!best || m.value > best.value) best = m;
  }
  return best;
}

export const meldValue = (groups: Card[][]): number => groups.reduce((a, g) => a + (parseMeld(g)?.value ?? 0), 0);
export const handPenalty = (hand: Card[]) => hand.reduce((a, c) => a + cardValue(c), 0);
