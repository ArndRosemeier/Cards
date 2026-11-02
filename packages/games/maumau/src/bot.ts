import type { Bot, Card, Suit } from "@cards/engine";
import { suitOf, rankOf } from "@cards/engine";
import type { Move, View } from "./rules.ts";

/** Simple heuristic bot: counters penalties, keeps jacks for late, wishes its strongest suit. */
export const mauMauBot: Bot<View, Move> = {
  choose(view, legal, rng) {
    const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play");
    const other = legal.find((m) => m.t !== "play");
    if (plays.length === 0) return other ?? legal[0]!;

    const count: Record<string, number> = { C: 0, S: 0, H: 0, D: 0 };
    for (const c of view.hand) count[suitOf(c)]!++;
    const best = (Object.keys(count) as Suit[]).sort((a, b) => count[b]! - count[a]!)[0]!;

    const score = (m: Extract<Move, { t: "play" }>): number => {
      const r = rankOf(m.card);
      let s = rng.next() * 0.5;
      if (r === "7" || r === "8") s += 5;                       // attacking / defending cards
      if (r === "J") s -= view.hand.length > 2 ? 4 : -2;        // save wild cards unless nearly done
      s += count[suitOf(m.card)]! * 0.3;                         // shed from long suits
      if (m.wish) s += m.wish === best ? 1 : -3;                 // wish the strongest suit
      return s;
    };
    return plays.reduce((a, b) => (score(b) > score(a) ? b : a));
  },
};
export type { Card };
