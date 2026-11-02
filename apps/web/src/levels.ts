import type { Bot } from "@cards/engine";

/** Bot strength: 0 easy, 1 normal (the default heuristics). Easy bots now and then play a random legal move. */
export const LEVELS = [0, 1] as const;
export const EASY_MISTAKE = 0.3;

export function withLevel<V, M>(bot: Bot<V, M>, level: number | undefined): Bot<V, M> {
  if (level === undefined || level >= 1) return bot;
  return {
    choose(view, legal, rng) {
      const move = bot.choose(view, legal, rng);
      // only swap moves the rules enumerate (card plays, bids, draws); composite moves such as melds are left alone
      const listed = legal.some((m) => JSON.stringify(m) === JSON.stringify(move));
      if (listed && legal.length > 1 && rng.next() < EASY_MISTAKE) return legal[Math.floor(rng.next() * legal.length)]!;
      return move;
    },
  };
}
