import { rankOf, suitOf, type Bot, type Card, type Rng } from "@cards/engine";
import { BIDS, cardPoints, gameValue, isTrump, jackMultiplier, strength, type Game, type Move, type View } from "./rules.ts";
import { ALL_CARDS, cloneWorld, dealPool, eff, legalIn, playout, pointsOf, step, voidsFrom, winnerOf, type World } from "./sim.ts";

const BASE: Record<string, number> = { C: 12, S: 11, H: 10, D: 9, G: 24, N: 23 };
const SUIT_GAMES: Game[] = ["C", "S", "H", "D", "G"];
/** How sure the simulation must be before the bot bids up to a game's value. */
const WIN_THRESHOLD = 0.58;

/** Deterministic cheap strength of a hand for a game, used to pick which discards are worth simulating. */
function dumpScore(c: Card, hand: Card[], g: Game): number {
  const suit = suitOf(c), same = hand.filter((x) => !isTrump(x, g) && suitOf(x) === suit);
  const hasAce = same.some((x) => rankOf(x) === "A");
  let s = cardPoints(c);
  if (same.length === 1) s += 6; else if (same.length === 2) s += 3;
  if (rankOf(c) === "A") s -= 14;
  if (rankOf(c) === "T" && hasAce) s -= 9;
  if (rankOf(c) === "K" && same.some((x) => rankOf(x) === "T" || rankOf(x) === "A")) s -= 3;
  return s;
}
/** A few sensible ways to put two cards away. */
function discardOptions(hand: Card[], g: Game): Card[][] {
  const pairs: Card[][] = [];
  const add = (a?: Card, b?: Card) => { if (a && b && a !== b && !pairs.some((p) => p.includes(a) && p.includes(b))) pairs.push([a, b]); };
  if (g === "N") {
    const rank = (c: Card) => strength(c, "N");
    const hi = hand.slice().sort((a, b) => rank(b) - rank(a));
    add(hi[0], hi[1]);
    const lone = hand.filter((c) => hand.filter((x) => suitOf(x) === suitOf(c)).length <= 2 && rank(c) >= 6).sort((a, b) => rank(b) - rank(a));
    add(lone[0], lone[1]);
    return pairs;
  }
  const side = hand.filter((c) => !isTrump(c, g));
  const pool = side.length >= 2 ? side : hand.slice().sort((a, b) => strength(a, g) - strength(b, g));
  const byDump = pool.slice().sort((a, b) => dumpScore(b, hand, g) - dumpScore(a, hand, g));
  add(byDump[0], byDump[1]);
  const bySuit = (suit: string) => side.filter((c) => suitOf(c) === suit);
  const suits = ["C", "S", "H", "D"].map(bySuit).filter((cs) => cs.length > 0 && cs.length <= 2 && !cs.some((c) => rankOf(c) === "A")).sort((a, b) => a.length - b.length);
  if (suits[0]) { if (suits[0].length === 2) add(suits[0][0], suits[0][1]); else add(suits[0][0], byDump.find((c) => c !== suits[0]![0])); }
  const cheap = side.slice().sort((a, b) => cardPoints(a) - cardPoints(b) || strength(a, g) - strength(b, g));
  add(cheap[0], cheap[1]);
  if (!pairs.length) add(pool[0], pool[1]);
  return pairs;
}

interface Plan { game: Game; discard: Card[]; hand: boolean; p61: number; p90: number; pBlack: number }

export function createSkatBot(): Bot<View, Move> {
  let bidKey = "", bidLimit = 0;
  let plan: Plan | null = null, planKey = "";

  /** Win statistics of playing `g` from `hand10` (plus the skat, random) against random opponent hands. */
  function simulateOwn(hand10: Card[], g: Game, v: View, rng: Rng, samples: number, withSkat: boolean, fixedDiscard?: Card[]): { p61: number; p90: number; pBlack: number } {
    const me = v.you as number, leader = (v.dealer + 1) % 3;
    const others = [0, 1, 2].filter((s) => s !== me);
    const known = new Set<Card>(hand10);
    const pool = ALL_CARDS.filter((c) => !known.has(c));
    let win = 0, w90 = 0, black = 0;
    for (let k = 0; k < samples; k++) {
      const deck = rng.shuffle(pool);
      const talon = deck.slice(0, 2), h1 = deck.slice(2, 12), h2 = deck.slice(12, 22);
      let mine = hand10.slice(), skatPts = 0;
      if (withSkat) {
        const twelve = hand10.concat(talon);
        const put = fixedDiscard ?? discardOptions(twelve, g)[0]!;
        mine = twelve.filter((c) => !put.includes(c)); skatPts = pointsOf(put);
      } else skatPts = pointsOf(talon);
      const hands: Card[][] = [[], [], []]; hands[me] = mine; hands[others[0]!] = h1; hands[others[1]!] = h2;
      const w: World = { g, hands, decl: me, trick: [], turn: leader, pts: [0, 0, 0], tricks: [0, 0, 0] };
      const out = playout(w);
      if (g === "N") { if (out.tricks[me] === 0) win++; continue; }
      const total = out.pts[me]! + skatPts;
      if (total >= 61) win++; if (total >= 90) w90++;
      if (out.tricks[me] === 10) black++;
    }
    return { p61: win / samples, p90: w90 / samples, pBlack: black / samples };
  }

  function bidding(v: View, rng: Rng): number {
    const key = v.hand.join(",");
    if (key === bidKey) return bidLimit;
    let limit = 0;
    for (const g of SUIT_GAMES) {
      const p = simulateOwn(v.hand, g, v, rng, 36, true).p61;
      if (p >= WIN_THRESHOLD) limit = Math.max(limit, gameValue(g, v.hand, false, false, false));
    }
    const pn = simulateOwn(v.hand, "N", v, rng, 36, true).p61;
    if (pn >= 0.8) limit = Math.max(limit, 23);
    bidKey = key; bidLimit = limit;
    return limit;
  }

  /** The best game and discard once the skat is in the hand. */
  function chooseGameAndDiscard(v: View, rng: Rng): Plan {
    const hand12 = v.hand;
    let best: (Plan & { ev: number }) | null = null;
    for (const g of [...SUIT_GAMES, "N" as Game]) {
      const gv = gameValue(g, hand12, false, false, false);
      const loss = Math.max(gv, Math.ceil(v.contract / BASE[g]!) * BASE[g]!);
      for (const put of discardOptions(hand12, g)) {
        const hand10 = hand12.filter((c) => !put.includes(c));
        const st2 = simulateWithPut(hand10, put, g, v, rng, 24);
        const covers = gv >= v.contract;
        const p = covers ? st2.p61 : 0;
        const ev = p * gv - (1 - p) * 2 * loss;
        if (!best || ev > best.ev) best = { game: g, discard: put, hand: false, ...st2, ev };
      }
    }
    return best!;
  }
  function simulateWithPut(hand10: Card[], put: Card[], g: Game, v: View, rng: Rng, samples: number) {
    const me = v.you as number, leader = (v.dealer + 1) % 3, others = [0, 1, 2].filter((s) => s !== me);
    const known = new Set<Card>([...hand10, ...put]);
    const pool = ALL_CARDS.filter((c) => !known.has(c));
    const skatPts = pointsOf(put);
    let win = 0, w90 = 0, black = 0;
    for (let k = 0; k < samples; k++) {
      const deck = rng.shuffle(pool);
      const hands: Card[][] = [[], [], []]; hands[me] = hand10.slice(); hands[others[0]!] = deck.slice(0, 10); hands[others[1]!] = deck.slice(10, 20);
      const out = playout({ g, hands, decl: me, trick: [], turn: leader, pts: [0, 0, 0], tricks: [0, 0, 0] });
      if (g === "N") { if (out.tricks[me] === 0) win++; continue; }
      const total = out.pts[me]! + skatPts;
      if (total >= 61) win++; if (total >= 90) w90++;
      if (out.tricks[me] === 10) black++;
    }
    return { p61: win / samples, p90: w90 / samples, pBlack: black / samples };
  }

  /** Card play: Monte-Carlo over the hidden cards, greedy perfect-information playouts. */
  function playCard(v: View, legal: Move[], rng: Rng): Move {
    const cards = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
    if (cards.length === 1) return { t: "play", card: cards[0]! };
    const g = v.game!, me = v.you as number, decl = v.declarer ?? -1;
    const history = v.history, trick = v.trick;
    const played = new Set<Card>([...history.flat().map((p) => p.card), ...trick.map((p) => p.card)]);
    const mineSet = new Set<Card>(v.hand);
    const skatKnown = new Set<Card>(v.skatCards);
    const unseen = ALL_CARDS.filter((c) => !played.has(c) && !mineSet.has(c) && !skatKnown.has(c));
    const others = [0, 1, 2].filter((s) => s !== me);
    const sizes = others.map((s) => v.handSizes[s]!);
    const extra = unseen.length - sizes[0]! - sizes[1]!;
    const seats = extra > 0 ? [...others, 3] : others;
    const sz = extra > 0 ? [...sizes, extra] : sizes;
    const voids = voidsFrom(history, trick, g);
    const need = decl >= 0 && g !== "N" ? Math.ceil(v.contract / BASE[g]!) - (v.handGame ? 1 : 0) : 0;
    const accept = (hands: Card[][]) => {
      if (decl < 0 || decl === me || need <= 1) return true;
      const i = seats.indexOf(decl); if (i < 0) return true;
      const full = hands[i]!.concat(extra > 0 ? hands[seats.indexOf(3)]! : []);
      return jackMultiplier(full) >= need;
    };
    const initialTricks = [0, 0, 0];
    for (const t of history) initialTricks[winnerOf(t, g).seat]!++;
    const ourSkatPts = pointsOf(v.skatCards);
    const deadline = Date.now() + 180;
    const nSamples = cards.length <= 4 ? 70 : 40;
    const totals = new Map<Card, number>(); cards.forEach((c) => totals.set(c, 0));
    let done = 0;
    for (let k = 0; k < nSamples && (done < 8 || Date.now() < deadline); k++) {
      const hs = dealPool(unseen, sz, seats, voids, g, rng, accept) ?? dealPool(unseen, sz, seats, {}, g, rng) ;
      if (!hs) continue;
      const hands: Card[][] = [[], [], []]; hands[me] = v.hand.slice();
      others.forEach((s, i) => { hands[s] = hs[i]!.slice(); });
      const talon = extra > 0 ? hs[seats.indexOf(3)]! : [];
      const base: World = { g, hands, decl, trick: trick.map((p) => ({ ...p })), turn: me, pts: v.cardPts.slice(), tricks: initialTricks.slice() };
      const skatPts = decl >= 0 && g !== "N" ? (decl === me ? ourSkatPts : 0) + pointsOf(talon) : 0;
      for (const card of cards) {
        const w = cloneWorld(base);
        step(w, me, card);
        const out = playout(w);
        totals.set(card, totals.get(card)! + utility(g, me, decl, out.pts, out.tricks, skatPts));
      }
      done++;
    }
    let best = cards[0]!, bestV = -Infinity;
    for (const c of cards) { const val = totals.get(c)!; if (val > bestV + 1e-9) { bestV = val; best = c; } }
    return { t: "play", card: best };
  }

  return {
    choose(v, legal, rng) {
      const has = (t: Move["t"]) => legal.find((m) => m.t === t);
      const hand = v.hand;
      if (v.phase === "bid") {
        const limit = bidding(v, rng);
        const bids = legal.filter((m): m is Extract<Move, { t: "bid" }> => m.t === "bid");
        if (has("hold")) return limit >= (BIDS[v.bidLevel] ?? 18) ? has("hold")! : has("pass")!;
        const next = bids.find((b) => b.value <= limit);
        if (next) return next;
        return has("pass") ?? legal[0]!;
      }
      if (v.phase === "skat") {
        planKey = hand.join(",");
        const bestHand = (): { g: Game; st: { p61: number; p90: number; pBlack: number } } => {
          let best: { g: Game; st: { p61: number; p90: number; pBlack: number } } | null = null;
          for (const g of SUIT_GAMES) { const st = simulateOwn(hand, g, v, rng, 40, false); if (!best || st.p61 > best.st.p61) best = { g, st }; }
          return best!;
        };
        if (has("ouvert") && jackMultiplier(hand) >= 5 && hand.filter((c) => rankOf(c) === "A").length >= 3) {
          const b = bestHand(); plan = { game: b.g, discard: [], hand: true, ...b.st };
          return has("ouvert")!;
        }
        // a hand game pays one more multiplier but gives up the skat: only when the cards alone almost surely win
        if (has("handgame")) {
          const b = bestHand();
          if (b.st.p61 >= 0.85 && gameValue(b.g, hand, true, false, false) >= v.contract) {
            plan = { game: b.g, discard: [], hand: true, ...b.st };
            return has("handgame")!;
          }
        }
        plan = null;
        return has("pickup")!;
      }
      if (v.phase === "discard") {
        plan = chooseGameAndDiscard(v, rng);
        const put = plan.discard;
        return legal.find((m) => m.t === "cards" && put.every((c) => m.cards.includes(c))) ?? legal[0]!;
      }
      if (v.phase === "declare") {
        if (!plan) {
          if (v.handGame) { let best: Plan | null = null; for (const g of SUIT_GAMES) { const st = simulateOwn(hand, g, v, rng, 30, false); if (!best || st.p61 > best.p61) best = { game: g, discard: [], hand: true, ...st }; } plan = best!; }
          else plan = chooseGameAndDiscard({ ...v, hand: [...hand, ...v.skatCards] }, rng);
        }
        return legal.find((m) => m.t === "game" && m.game === plan!.game) ?? legal[0]!;
      }
      if (v.phase === "announce") {
        const want = plan && plan.pBlack >= 0.7 ? "schwarz" : plan && plan.p90 >= 0.75 ? "schneider" : "none";
        return legal.find((m) => m.t === "announce" && m.level === want) ?? legal.find((m) => m.t === "announce" && m.level === "none")!;
      }
      void planKey;
      return playCard(v, legal, rng);
    },
  };
}

/** How good a finished playout is for `me` (0..1.3, higher is better). */
function utility(g: Game, me: number, decl: number, pts: number[], tricks: number[], skatPts: number): number {
  if (g === "R") return 1 - Math.min(120, pts[me]!) / 120;
  if (g === "N") return (tricks[decl] === 0 ? 1 : 0) * (me === decl ? 1 : -1) + (me === decl ? 0 : 1);
  const total = pts[decl]! + skatPts;
  const u = total >= 61 ? 1 + Math.min(0.3, (total - 61) / 300) : total / 122;
  return me === decl ? u : 1.3 - u;
}

export const skatBot: Bot<View, Move> = createSkatBot();
void eff; void legalIn;
