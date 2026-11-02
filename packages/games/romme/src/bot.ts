import { isJoker, rankOf, suitOf, RANKS, type Bot, type Card } from "@cards/engine";
import { cardValue, parseMeld, type Meld } from "./melds.ts";
import type { Move, TableMeld, View } from "./rules.ts";

interface Cand { mask: number; cards: Card[]; value: number }

/** All sets and runs that can be formed from `hand` (one joker at most per meld). */
export function candidates(hand: Card[]): Cand[] {
  const out: Cand[] = [];
  const idx = (c: Card, used: Set<number>) => { for (let i = 0; i < hand.length; i++) if (hand[i] === c && !used.has(i)) return i; return -1; };
  const push = (cards: Card[]) => {
    const used = new Set<number>(); let mask = 0;
    for (const c of cards) { const i = idx(c, used); if (i < 0) return; used.add(i); mask |= 1 << i; }
    const m = parseMeld(cards); if (m) out.push({ mask, cards: m.cards, value: m.value });
  };
  const jokers = hand.filter(isJoker);
  const real = hand.filter((c) => !isJoker(c));
  // sets
  for (const r of RANKS) {
    const ofRank = real.filter((c) => rankOf(c) === r);
    const bySuit = new Map<string, Card>(); for (const c of ofRank) if (!bySuit.has(suitOf(c))) bySuit.set(suitOf(c), c);
    const cs = [...bySuit.values()];
    const subsets = (k: number) => { const res: Card[][] = []; const rec = (st: number, cur: Card[]) => { if (cur.length === k) { res.push(cur.slice()); return; } for (let i = st; i < cs.length; i++) { cur.push(cs[i]!); rec(i + 1, cur); cur.pop(); } }; rec(0, []); return res; };
    for (const k of [3, 4]) for (const sub of subsets(k)) push(sub);
    if (jokers.length) for (const k of [2, 3]) for (const sub of subsets(k)) push([...sub, jokers[0]!]);
  }
  // runs
  for (const su of ["C", "S", "H", "D"]) {
    const bySuitRank = new Map<number, Card>();
    for (const c of real) if (suitOf(c) === su) { const n = RANKS.indexOf(rankOf(c)) + 2; if (!bySuitRank.has(n)) bySuitRank.set(n, c); }
    for (const aceHigh of [false, true]) {
      const at = (p: number): Card | undefined => bySuitRank.get(p === 1 ? 14 : p);
      for (let a = 1; a <= 14; a++) for (let b = a + 2; b <= 14; b++) {
        if ((a === 1) === aceHigh && a === 1 && aceHigh) continue;
        if (!aceHigh && b === 14) continue;           // ace high handled when aceHigh
        if (aceHigh && a === 1) continue;
        const cards: Card[] = []; let miss = 0;
        for (let p = a; p <= b; p++) { const c = at(p); if (c) cards.push(c); else miss++; }
        if (miss > 1 || (miss === 1 && !jokers.length)) continue;
        if (miss === 1) cards.push(jokers[0]!);
        if (cards.length >= 3) push(cards);
      }
    }
    // jokers extending a pair at an end are covered by miss===1 windows only when the joker fills a gap; add end extensions:
    for (const aceHigh of [false, true]) {
      if (!jokers.length) break;
      for (let a = 1; a <= 13; a++) {
        const c1 = bySuitRank.get(a === 1 ? 14 : a), c2 = bySuitRank.get(a + 1);
        if (c1 && c2 && !(a === 1 && aceHigh)) push([c1, c2, jokers[0]!]);
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => { const k = c.mask + ":" + c.cards.join(","); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Best set of disjoint melds from the hand by total value. */
export function bestPlan(hand: Card[]): { groups: Card[][]; value: number } {
  const cands = candidates(hand);
  const byLow = new Map<number, Cand[]>();
  for (const c of cands) { const low = Math.log2(c.mask & -c.mask) | 0; (byLow.get(low) ?? byLow.set(low, []).get(low)!).push(c); }
  const memo = new Map<number, { v: number; pick: Cand[] }>();
  const full = (1 << hand.length) - 1;
  const f = (mask: number): { v: number; pick: Cand[] } => {
    if (mask === full) return { v: 0, pick: [] };
    const hit = memo.get(mask); if (hit) return hit;
    let i = 0; while (mask & (1 << i)) i++;
    let best = f(mask | (1 << i));                                // leave card i unmelded
    for (const c of byLow.get(i) ?? []) if (!(c.mask & mask)) { const r = f(mask | c.mask); if (r.v + c.value > best.v) best = { v: r.v + c.value, pick: [c, ...r.pick] }; }
    memo.set(mask, best); return best;
  };
  const r = f(0);
  return { groups: r.pick.map((c) => c.cards), value: r.v };
}

function layoffs(hand: Card[], melds: TableMeld[]): { meld: number; card: Card }[] {
  const out: { meld: number; card: Card }[] = [];
  melds.forEach((m, mi) => { for (const c of new Set(hand)) if (parseMeld([...m.cards, c])) out.push({ meld: mi, card: c }); });
  return out;
}
const usefulness = (c: Card, hand: Card[]): number => {
  if (isJoker(c)) return 100;
  let u = 0; const n = RANKS.indexOf(rankOf(c));
  for (const o of hand) {
    if (o === c || isJoker(o)) continue;
    if (rankOf(o) === rankOf(c) && suitOf(o) !== suitOf(c)) u += 3;
    if (suitOf(o) === suitOf(c)) { const d = Math.abs(RANKS.indexOf(rankOf(o)) - n); if (d === 1) u += 3; else if (d === 2) u += 1.5; }
  }
  return u - cardValue(c) * 0.12;
};

export const rommeBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    const hand = v.hand;
    if (v.phase === "draw") {
      const top = v.discardTop;
      if (top) {
        const before = bestPlan(hand).value, after = bestPlan([...hand, top]);
        const used = after.groups.some((g) => g.includes(top));
        const canOpenNow = v.opened[v.you as number] || after.value >= v.minOpen;
        if (used && after.value > before && canOpenNow && (v.opened[v.you as number] || before < v.minOpen)) return { t: "draw", from: "discard" };
        if (used && v.opened[v.you as number] && after.value > before) return { t: "draw", from: "discard" };
      }
      return legal.find((m) => m.t === "draw" && m.from === "stock") ?? { t: "draw", from: "discard" };
    }
    const me = v.you as number;
    if (v.opened[me]) {                                   // trade a natural card for a joker lying in a table meld
      for (let mi = 0; mi < v.melds.length; mi++) {
        const m = v.melds[mi]!, jk = m.cards.find(isJoker); if (!jk) continue;
        for (const c of new Set(hand)) if (!isJoker(c) && parseMeld(m.cards.map((x) => (x === jk ? c : x)))) return { t: "swap", meld: mi, card: c };
      }
    }
    const plan = bestPlan(hand);
    const keepForOut = v.melds.length === 0 && !v.opened[me];
    if (plan.groups.length && (v.opened[me] || plan.value >= v.minOpen)) {
      // don't meld everything if that leaves no card to discard unless it ends the round (allowed)
      return { t: "meld", groups: plan.groups };
    }
    void keepForOut;
    if (v.opened[me]) {
      const lo = layoffs(hand, v.melds);
      if (lo.length) return { t: "layoff", cards: [lo[0]!.card], meld: lo[0]!.meld };
    }
    const discards = legal.filter((m): m is Extract<Move, { t: "discard" }> => m.t === "discard").map((m) => m.card);
    const pool = discards.length ? discards : hand;
    const pick = pool.slice().sort((a, b) => usefulness(a, hand) - usefulness(b, hand) + (rng.next() - 0.5) * 0.2)[0]!;
    return { t: "discard", card: pick };
  },
};
export type { Meld };
