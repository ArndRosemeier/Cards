import { makeDeck, RANKS, rankOf, suitOf, Rng, type Bot, type Card } from "@cards/engine";
import { bestScore } from "./eval.ts";
import type { Move, View } from "./rules.ts";

const rv = (c: Card) => RANKS.indexOf(rankOf(c)) + 2;

/** Monte-Carlo equity of `hole` on `board` against `opps` random hands. */
export function equity(hole: Card[], board: Card[], opps: number, rng: Rng, samples = 160): number {
  return equityVsRanges(hole, board, Array(opps).fill(1), rng, samples);
}

/**
 * Monte-Carlo equity against opponents whose hands are drawn from a range. `ks[i]` is how selective opponent i is:
 * 1 = any two cards, k > 1 = the best of k random hands (by current strength), so 2 is roughly the top half,
 * 4 the top fifth, 8 the top tenth. Cheap, and it shifts the distribution the way a betting action does.
 */
export function equityVsRanges(hole: Card[], board: Card[], ks: number[], rng: Rng, samples = 160): number {
  const used = new Set<Card>([...hole, ...board]);
  const rest = makeDeck().filter((c) => !used.has(c));
  let win = 0;
  for (let n = 0; n < samples; n++) {
    const deck = rng.shuffle(rest);
    let p = 0;
    const b = board.concat(deck.slice(p, p + 5 - board.length)); p += 5 - board.length;
    const mine = bestScore([...hole, ...b]);
    let best = true, tie = 0;
    for (const k of ks) {
      let pick: Card[] = [deck[p]!, deck[p + 1]!]; p += 2;
      if (k > 1) {
        let top = handStrength(pick, board);
        for (let j = 1; j < k; j++) {
          const cand = [deck[p]!, deck[p + 1]!]; p += 2;
          const st = handStrength(cand, board);
          if (st > top) { top = st; pick = cand; }
        }
      }
      const sc = bestScore([...pick, ...b]);
      if (sc > mine) { best = false; break; }
      if (sc === mine) tie++;
    }
    if (best) win += tie ? 1 / (tie + 1) : 1;
  }
  return win / samples;
}
/** Strength used to pick the best of k hands: preflop heuristic before the flop, made hand on the current board after. */
function handStrength(hole: Card[], board: Card[]): number {
  return board.length === 0 ? preflop(hole) : bestScore([...hole, ...board]);
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

interface Seen { acts: number; aggr: number }

/**
 * A playing quirk. Every bot plays the same sound base game; a persona bends it so that a table of bots is not
 * predictable, and so that opponents cannot read a bot just from its habits. `de`/`en` are the names a player may see.
 */
export interface Persona {
  id: string; de: string; en: string;
  /** hands this bot always plays preflop (never folds them, limps or raises, calls raises) */
  pet?: (hole: Card[]) => boolean;
  /** 0 = baseline; above 0 it calls with less equity than the pot odds ask for, below 0 it folds more */
  loose?: number;
  /** 1 = baseline; scales how often it raises and bluffs */
  aggr?: number;
  /** chance of a random preflop all-in when nobody has raised yet */
  shove?: number;
  /** slow-plays strong hands (checks or calls instead of betting) most of the time */
  trap?: boolean;
}
const hasRank = (r: string) => (h: Card[]) => h.some((c) => rankOf(c) === r);
export const PERSONAS: Persona[] = [
  { id: "sevens", de: "Siebener-Fan", en: "Sevens fan", pet: hasRank("7") },
  { id: "aces", de: "Ass-Jäger", en: "Ace hunter", pet: hasRank("A") },
  { id: "suited", de: "Farb-Fan", en: "Suit lover", pet: (h) => suitOf(h[0]!) === suitOf(h[1]!) },
  { id: "connector", de: "Straßen-Träumer", en: "Straight dreamer", pet: (h) => Math.abs(rv(h[0]!) - rv(h[1]!)) === 1 },
  { id: "maniac", de: "Draufgänger", en: "Maniac", aggr: 1.8, loose: 0.04 },
  { id: "rock", de: "Fels", en: "Rock", loose: -0.06, aggr: 0.8 },
  { id: "station", de: "Calling Station", en: "Calling station", loose: 0.1, aggr: 0.5 },
  { id: "gambler", de: "Zocker", en: "Gambler", shove: 0.06, aggr: 1.2 },
  { id: "trapper", de: "Fallensteller", en: "Trapper", trap: true },
];

/**
 * A fresh bot with its own memory of how the opponents behave. Use one instance per seat.
 *
 * What it does beyond hand strength: it estimates each opponent's range from the size of their bet and from how
 * aggressive they have been (watched between its own turns), runs its equity simulation against those ranges,
 * plays tighter in early position and wider on the button, shoves or folds with short stacks, sizes value bets
 * by strength, and mixes in bluffs at a rate that keeps its bets from being pure value.
 */
export function createHoldemBot(persona?: Persona): Bot<View, Move> {
  const loose = persona?.loose ?? 0, aggr = persona?.aggr ?? 1;
  const seen = new Map<number, Seen>();
  let last: View | null = null;

  const observe = (v: View) => {
    if (last && v.handNo < last.handNo) seen.clear();               // a new game
    if (last && last.handNo === v.handNo) {
      const topBet = Math.max(0, ...last.bets);
      v.bets.forEach((bet, o) => {
        if (o === v.you) return;
        const s = seen.get(o) ?? { acts: 0, aggr: 0 };
        if (v.folded[o] && !last!.folded[o]) s.acts++;
        else if (v.phase !== last!.phase) { if (bet > 0) { s.acts++; s.aggr++; } }
        else if (bet > last!.bets[o]!) { s.acts++; if (bet > topBet) s.aggr++; }
        seen.set(o, s);
      });
    }
    last = v;
  };

  return {
    choose(v, legal, rng) {
      const nextHand = legal.find((m) => m.t === "next");
      if (nextHand) return nextHand;
      observe(v);
      const me = v.you as number;
      const has = (t: Move["t"]) => legal.find((m) => m.t === t);
      const raises = legal.filter((m): m is Extract<Move, { t: "raise" }> => m.t === "raise");
      const callMove = has("call"), checkMove = has("check"), foldMove = has("fold");
      const safe = (): Move => checkMove ?? foldMove ?? callMove!;

      const opponents = v.inHand.map((x, i) => (x && i !== me ? i : -1)).filter((i) => i >= 0);
      const n = Math.max(1, opponents.length);
      const preflopRound = v.community.length === 0;
      const bb = v.bb, pot = v.pot, toCall = v.toCall, myStack = v.stacks[me]!;
      const sumBets = v.bets.reduce((a, b) => a + b, 0);
      const prevPot = Math.max(0, pot - sumBets);

      // position: 0 = first to act postflop (small blind side), 1 = button
      const live: number[] = [];
      for (let k = 1; k <= v.stacks.length; k++) { const i = (v.dealer + k) % v.stacks.length; if (!v.out[i]) live.push(i); }
      const pos = live.length > 1 ? live.indexOf(me) / (live.length - 1) : 1;

      // how selective each opponent is right now
      const ks = opponents.map((o) => {
        const bet = v.bets[o]!;
        let k = 1;
        if (preflopRound) { const r = bet / bb; k = r <= 1 ? 1 : r <= 2.5 ? 2 : r <= 6 ? 3 : r <= 15 ? 5 : 8; }
        else {
          const frac = bet / Math.max(1, prevPot);
          k = bet === 0 ? 1 : frac < 0.4 ? 2 : frac < 0.8 ? 3 : frac < 1.5 ? 4 : 6;
          const potBB = prevPot / bb; k = Math.max(k, potBB > 14 ? 3 : potBB > 6 ? 2 : 1);   // a pot that grew before the flop was not built from junk
        }
        const s = seen.get(o);
        if (s && s.acts >= 5) { const ar = s.aggr / s.acts; if (s.acts >= 8 && ar > 0.75) k = Math.max(1, Math.ceil(k / 3)); else if (ar > 0.7) k = Math.max(1, Math.ceil(k / 2)); else if (ar > 0.5) k = Math.max(1, k - 1); else if (ar < 0.2 && bet > 0) k += 1; }
        return Math.min(8, k);
      });
      const eqSamples = n > 3 ? 110 : 150;
      const eqVs = (o?: number[]) => equityVsRanges(v.hand, v.community, o ?? ks, rng, eqSamples);
      const hs = preflop(v.hand);
      const odds = toCall / Math.max(1, pot + toCall);
      const effBB = Math.min(myStack + v.bets[me]!, Math.max(...opponents.map((o) => v.stacks[o]! + v.bets[o]!), 0)) / bb;

      // choose the legal raise nearest to a pot fraction; very large ones become all-in
      const sized = (frac: number): Move | null => {
        if (!raises.length) return null;
        const want = v.bets[me]! + toCall + frac * (pot + toCall);
        const top = raises[raises.length - 1]!;
        if (want >= top.to * 0.6) return top;
        return raises.reduce((b, r) => (Math.abs(r.to - want) < Math.abs(b.to - want) ? r : b));
      };
      const shove = (): Move | null => raises[raises.length - 1] ?? callMove ?? null;

      // ---- preflop ----------------------------------------------------------------------------------
      if (preflopRound) {
        const unraised = toCall <= bb;
        if (persona?.shove && unraised && raises.length && rng.next() < persona.shove) return shove() ?? safe();
        if (persona?.pet?.(v.hand)) {                                          // a pet hand is always played
          if (unraised && raises.length && rng.next() < 0.45 * aggr) return sized(1.2 + rng.next() * 0.8) ?? safe();
          if (toCall <= bb || toCall <= myStack * 0.35) { if (callMove) return callMove; if (checkMove) return checkMove; }   // it plays on, unless the raise is a huge part of its stack
        }
        if (effBB <= 12) {                                                    // short stacks: shove or fold
          const thr = (effBB <= 6 ? 0.3 : effBB <= 9 ? 0.38 : 0.45) - 0.12 * pos + 0.03 * (n - 1);
          if (unraised) {
            if (hs >= thr) return shove() ?? safe();
            return checkMove ?? foldMove ?? callMove!;
          }
          const eq = eqVs();
          return eq > odds + 0.03 && (callMove || raises.length) ? (callMove ?? shove()!) : (foldMove ?? safe());
        }
        if (unraised) {
          const open = 0.5 - 0.17 * pos - 0.02 * Math.max(0, 5 - live.length) - 0.5 * loose;
          if (hs >= open + 0.02 * (n - 1) && raises.length && (aggr >= 1 || rng.next() < aggr)) return sized(1.4 + rng.next() * 0.6) ?? safe();
          if (hs >= open - 0.1 && callMove && toCall <= bb && toCall > 0 && pos > 0.4 && rng.next() < 0.6) return callMove;
          if (checkMove) return checkMove;
          // a cheap price is always worth it: compare a rough equity against the pot odds, and never throw a pair away for under a big blind
          const eqPre = Math.pow(hs, 1 + 0.15 * (n - 1)) * 0.9 + 0.08;
          const pair = rv(v.hand[0]!) === rv(v.hand[1]!);
          if (callMove && ((eqPre > odds * 1.3 && toCall <= bb * 0.6) || (pair && toCall <= bb))) return callMove;
          return foldMove ?? callMove!;
        }
        // facing a raise: equity against the raiser's range
        const eq = eqVs();
        const need = odds * 1.08 + 0.03 - 0.04 * pos - loose;
        if (eq > 0.62 + 0.03 * (n - 1) - 0.05 * (aggr - 1) && raises.length && rng.next() < 0.7 * Math.min(1.3, aggr)) return sized(0.9 + rng.next() * 0.5) ?? callMove ?? safe();
        if (eq > need && callMove) return callMove;
        // set mining: a pair is worth a small raise when the stacks are deep
        if (callMove && rv(v.hand[0]!) === rv(v.hand[1]!) && toCall * 12 <= myStack && toCall <= 6 * bb) return callMove;
        return foldMove ?? safe();
      }

      // ---- postflop ---------------------------------------------------------------------------------
      const eq = eqVs();
      const street = v.community.length;                                     // 3 flop, 4 turn, 5 river
      const marginal = 0.05 - 0.02 * pos;
      if (toCall === 0) {
        if (eq > 0.86 && n === 1 && rng.next() < (persona?.trap ? 0.75 : 0.22)) return checkMove ?? safe();
        if (persona?.trap && eq > 0.66 && rng.next() < 0.6) return checkMove ?? safe();           // slow-play the monster now and then
        if (eq > 0.66 + 0.04 * (n - 1) - 0.06 * (aggr - 1) && raises.length && (aggr >= 1 || rng.next() < aggr)) return sized(eq > 0.82 ? 0.7 + rng.next() * 0.4 : 0.45 + rng.next() * 0.25) ?? safe();
        if (eq > 0.55 && n <= 2 && raises.length && rng.next() < 0.5) return sized(0.33) ?? safe();    // thin value / protection
        // bluffs: semi-bluffs with equity, a few river bluffs, more when in position and few opponents are left
        const bluffy = street < 5 ? eq > 0.22 && eq < 0.52 : eq < 0.22;
        const rate = (street < 5 ? 0.3 : 0.1) * (0.6 + 0.8 * pos) * aggr / n;
        if (bluffy && n <= 2 && raises.length && rng.next() < rate) return sized(street < 5 ? 0.5 : 0.65) ?? safe();
        return checkMove ?? safe();
      }
      const allIn = toCall >= myStack;
      if (eq > 0.78 && raises.length && !allIn && rng.next() < (persona?.trap ? 0.25 : 0.65 * Math.min(1.3, aggr))) return sized(0.75 + rng.next() * 0.5) ?? callMove ?? safe();
      // semi-bluff raise with a drawing hand, rarely
      if (street < 5 && eq > 0.3 && eq < 0.48 && n === 1 && raises.length && !allIn && toCall <= pot * 0.5 && rng.next() < 0.07) return sized(0.8) ?? callMove ?? safe();
      const need = (odds < 0.25 ? odds * 0.92 + marginal * 0.5 : odds + marginal) - loose;
      if (eq > need && callMove) return callMove;
      return foldMove ?? safe();
    },
  };
}

/** Shared default instance (no cross-game memory is kept between different tables only if you use createHoldemBot). */
export const holdemBot: Bot<View, Move> = createHoldemBot();
