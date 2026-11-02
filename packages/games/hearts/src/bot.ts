import { rankOf, suitOf, RANKS, type Bot, type Card } from "@cards/engine";
import type { Move, View } from "./rules.ts";
import { points } from "./rules.ts";

const val = (c: Card) => RANKS.indexOf(rankOf(c));
const danger = (c: Card) => (c === "SQ" ? 100 : suitOf(c) === "H" ? 20 + val(c) : (c === "SA" || c === "SK") ? 60 : val(c));

/** Heuristic Hearts bot: passes its most dangerous cards, ducks tricks, dumps points when void. */
export const heartsBot: Bot<View, Move> = {
  choose(view, legal, rng) {
    if (legal[0]?.t === "cards") {
      const pick = view.hand.slice().sort((a, b) => danger(b) - danger(a)).slice(0, 3);
      return legal.find((m) => m.t === "cards" && pick.every((c) => m.cards.includes(c))) ?? legal[0]!;
    }
    const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
    if (plays.length === 1) return { t: "play", card: plays[0]! };
    const trick = view.trick;
    let best = plays[0]!, bestScore = -Infinity;
    for (const c of plays) {
      let sc = rng.next() * 0.3;
      if (trick.length === 0) {
        sc -= val(c) * 0.5;                                    // lead low
        if (suitOf(c) === "H") sc -= 3;
      } else {
        const lead = suitOf(trick[0]!.card);
        if (suitOf(c) === lead) {
          const top = Math.max(...trick.filter((p) => suitOf(p.card) === lead).map((p) => val(p.card)));
          const wins = val(c) > top;
          const lastToPlay = trick.length === 3;
          const potPoints = trick.reduce((a, p) => a + points(p.card), 0);
          if (!wins) sc += 10 + val(c) * 0.5;                     // duck, preferably with the highest safe card
          else sc += lastToPlay && potPoints === 0 ? 3 - val(c) * 0.2 : -8 - potPoints * 3 - val(c) * 0.3;
          if (c === "SQ") sc -= 40;
        } else {
          sc += danger(c) * 0.5 + 5;                               // void: dump the worst card
        }
      }
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return { t: "play", card: best };
  },
};
