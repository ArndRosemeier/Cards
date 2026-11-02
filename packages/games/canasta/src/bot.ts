import { isJoker, rankOf, type Bot, type Card, type Rank } from "@cards/engine";
import { combine, isBlack3, isRed3, isWild, points, type Move, type View } from "./rules.ts";

type Group = { to: number | null; cards: Card[] };

/** Decide which cards to meld this turn (empty if nothing worthwhile). Every returned plan is legal. */
export function planMelds(v: View): Group[] {
  const hand = v.hand.filter((c) => !isRed3(c)), mine = v.melds[v.mySide]!, opened = mine.length > 0;
  const nat = new Map<Rank, Card[]>();
  for (const c of hand) if (!isWild(c) && !isBlack3(c)) (nat.get(rankOf(c)) ?? nat.set(rankOf(c), []).get(rankOf(c))!).push(c);
  const wilds = hand.filter(isWild).sort((a, b) => Number(isJoker(a)) - Number(isJoker(b))); // spend 2s before jokers
  const groups: Group[] = [], used = new Set<Card>();
  const take = (cs: Card[]) => cs.forEach((c) => used.add(c));
  const spare = () => wilds.filter((w) => !used.has(w));

  mine.forEach((m, mi) => {
    const add = (nat.get(m.rank) ?? []).filter((c) => !used.has(c));
    let cards = add.slice(); let cur = combine(m.cards, cards);
    if (cur || !cards.length) {
      const have = (cur ?? m.cards).length, w = spare();
      if (have < 7 && w.length && have + w.length >= 7 && have >= 4) { // wilds that finish a canasta
        const need = 7 - have, tryCards = [...cards, ...w.slice(0, need)];
        if (combine(m.cards, tryCards)) cards = tryCards;
      }
      if (cards.length && combine(m.cards, cards)) { groups.push({ to: mi, cards }); take(cards); }
    }
  });
  const fresh: Group[] = [];
  for (const [r, cs] of nat) if (cs.length >= 3 && !mine.some((m) => m.rank === r)) { fresh.push({ to: null, cards: cs.slice() }); take(cs); }
  const val = (gs: Group[]) => gs.reduce((a, g) => a + g.cards.reduce((x, c) => x + points(c), 0), 0);
  const all = () => [...groups, ...fresh];
  // pairs completed by a wild card
  const pairs = [...nat].filter(([r, cs]) => cs.length === 2 && !mine.some((m) => m.rank === r) && !cs.some((c) => used.has(c))).sort((a, b) => points(b[1][0]!) - points(a[1][0]!));
  for (const [, cs] of pairs) {
    const w = spare()[0]; if (!w) break;
    if (opened || val(all()) < v.minOpen) { fresh.push({ to: null, cards: [...cs, w] }); take([...cs, w]); }
  }
  let plan = all();
  if (!opened && val(plan) < v.minOpen) return [];
  const canastaAfter = () => mine.some((m) => m.cards.length >= 7) || plan.some((g) => (g.to === null ? g.cards.length : mine[g.to]!.cards.length + g.cards.length) >= 7);
  const left = () => hand.length + v.hand.filter(isRed3).length - plan.reduce((a, g) => a + g.cards.length, 0);
  while (plan.length && !(left() >= 2 || (canastaAfter() && left() >= 0) || (v.stock === 0))) {
    // keep a card back: drop the cheapest group (opening plans must still reach the minimum)
    plan = plan.slice().sort((a, b) => val([a]) - val([b])).slice(1);
    if (!opened && plan.length && val(plan) < v.minOpen) return [];
  }
  return plan;
}

function keepScore(c: Card, v: View): number {
  const hand = v.hand;
  if (isWild(c)) return 200;
  const r = rankOf(c); let s = points(c) * 0.3 + (hand.filter((x) => x !== c && !isWild(x) && rankOf(x) === r).length) * 14;
  if (v.melds[v.mySide]!.some((m) => m.rank === r)) s += 60;
  if (v.melds.some((ms, i) => i !== v.mySide && ms.some((m) => m.rank === r))) s += 35;
  if (isBlack3(c)) s -= 12;
  return s;
}

export const canastaBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    if (v.phase === "draw") {
      const piles = legal.filter((m): m is Extract<Move, { t: "pile" }> => m.t === "pile");
      const draws = legal.find((m) => m.t === "draw");
      if (piles.length && (v.discardSize >= 4 || !draws || (piles.some((m) => m.cards.length === 0) && v.discardSize >= 2))) {
        const pick = piles.slice().sort((a, b) => a.cards.filter(isWild).length - b.cards.filter(isWild).length)[0]!;
        return pick;
      }
      return draws ?? piles[0]!;
    }
    const plan = planMelds(v);
    if (plan.length) return { t: "meld", groups: plan };
    const ds = legal.filter((m): m is Extract<Move, { t: "discard" }> => m.t === "discard");
    return ds.slice().sort((a, b) => keepScore(a.card, v) - keepScore(b.card, v) + (rng.next() - 0.5) * 3)[0]!;
  },
};
