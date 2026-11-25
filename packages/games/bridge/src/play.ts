import { rankOf, suitOf, RANKS, type Card, type Rng } from "@cards/engine";
import { DD, NodeLimit, type DHands } from "./dd.ts";
import { hcp, type Call, type Move, type View } from "./rules.ts";

/** Card play for the Bridge bots: counting from the public play history, sensible leads/signals/second-third-fourth hand play,
 * and (once few enough cards are left) Monte-Carlo sampling of the hidden hands solved double-dummy, as GIB / WBridge5 do. */

const SUIT_IDX: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };
const SUIT_CH = ["C", "D", "H", "S"];
const rv = (c: Card) => RANKS.indexOf(rankOf(c));
const sidx = (c: Card) => SUIT_IDX[suitOf(c)]!;
type Play = { seat: number; card: Card };

interface Ctx {
  me: number; actor: number; decl: number; dummy: number; trump: string | null; legal: Card[];
  known: Card[][];              // cards we can see per seat (actor's side hands), empty for unknown seats
  played: Card[];               // all cards gone (history + current trick)
  trick: Play[]; history: Play[][]; sizes: number[];
  unseen: Card[];               // cards in unknown hands
  voids: boolean[][];           // [seat][suit]
  v: View;
}

function context(v: View, legal: Card[]): Ctx {
  const me = v.you as number, decl = v.contract!.declarer, dummy = (decl + 2) % 4;
  const actor = (v.playTurn ?? v.turn) as number;
  const trump = v.contract!.suit === "N" ? null : v.contract!.suit;
  const history = v.history ?? [];
  const played: Card[] = [];
  for (const t of history) for (const p of t) played.push(p.card);
  for (const p of v.trick) played.push(p.card);
  const known: Card[][] = [[], [], [], []];
  known[me] = v.hand.slice();
  if (v.shown?.[dummy]) known[dummy] = v.shown[dummy]!.slice();
  const seen = new Set<Card>([...played, ...known.flat()]);
  const unseen: Card[] = [];
  for (const s of SUIT_CH) for (const r of RANKS) { const c = `${s}${r}` as Card; if (!seen.has(c)) unseen.push(c); }
  const voids = [0, 1, 2, 3].map(() => [false, false, false, false]);
  for (const t of [...history, v.trick]) {
    if (!t.length) continue; const led = suitOf(t[0]!.card);
    for (const p of t.slice(1)) if (suitOf(p.card) !== led) voids[p.seat]![SUIT_IDX[led]!] = true;
  }
  return { me, actor, decl, dummy, trump, legal, known, played, trick: v.trick, history, sizes: v.handSizes, unseen, voids, v };
}

/** Is `c` the highest unplayed card of its suit (among everything not yet played)? */
const isMaster = (x: Ctx, c: Card) => { for (let i = RANKS.length - 1; i > rv(c); i--) if (!x.played.includes(`${suitOf(c)}${RANKS[i]}` as Card)) return false; return true; };
const cardsOf = (cs: Card[], s: string) => cs.filter((c) => suitOf(c) === s).sort((a, b) => rv(b) - rv(a));
/** Lowest card of a run of touching cards that includes c (equivalent cards: no unplayed card of another hand lies between). */
function lowestEquivalent(x: Ctx, hand: Card[], c: Card): Card {
  const s = suitOf(c); const own = new Set(hand);
  let cur = c;
  for (let i = rv(c) - 1; i >= 0; i--) {
    const d = `${s}${RANKS[i]}` as Card;
    if (own.has(d)) { cur = d; continue; }
    if (x.played.includes(d)) continue;
    break;
  }
  return cur;
}
const honor = (c: Card) => rv(c) >= 9;     // J or better

function winnerOf(trick: Play[], trump: string | null): Play {
  let w = trick[0]!;
  for (const p of trick.slice(1)) { const a = suitOf(p.card), b = suitOf(w.card); if (a === b ? rv(p.card) > rv(w.card) : trump !== null && a === trump && b !== trump) w = p; }
  return w;
}

// ---------------------------------------------------------------- sampling the hidden hands
function bidInfo(v: View) {
  // rough HCP bounds of each seat's original hand from the auction (opening = 11+, an unbid pass = at most 12, 1NT = 15-17)
  const lo = [0, 0, 0, 0], hi = [40, 40, 40, 40];
  const first: Record<number, Call> = {};
  let opened = false;
  for (const a of v.auction) {
    if (!(a.seat in first)) first[a.seat] = a.call;
    if (a.call.t === "bid" && !opened) {
      opened = true; lo[a.seat] = 11;
      if (a.call.suit === "N" && a.call.level === 1) { lo[a.seat] = 15; hi[a.seat] = 17; }
      if (a.call.suit === "N" && a.call.level === 2) { lo[a.seat] = 20; hi[a.seat] = 21; }
      if (a.call.level >= 2 && a.call.suit !== "N" && a.call.suit !== "C") hi[a.seat] = Math.min(hi[a.seat]!, 11);
    }
  }
  const firstBidAt = v.auction.findIndex((a) => a.call.t === "bid");
  for (const [seat, c] of Object.entries(first)) {
    if (c.t !== "pass") continue;
    const idx = v.auction.findIndex((a) => a.seat === Number(seat));
    hi[Number(seat)] = Math.min(hi[Number(seat)]!, firstBidAt >= 0 && firstBidAt < idx ? 15 : 12);   // an unbid pass: at most a minimum opening
  }
  return { lo, hi };
}

function sample(x: Ctx, rng: Rng, bounds: { lo: number[]; hi: number[] }): Card[][] | null {
  const unknown = [0, 1, 2, 3].filter((s) => x.known[s]!.length === 0 && x.sizes[s]! > 0);
  const need = unknown.map((s) => x.sizes[s]!);
  const origHcp = (s: number, cs: Card[]) => hcp(cs) + hcp(x.history.concat([x.trick]).flat().filter((p) => p.seat === s).map((p) => p.card));
  for (let attempt = 0; attempt < 60; attempt++) {
    const pool = rng.shuffle(x.unseen);
    const hands = unknown.map(() => [] as Card[]);
    const cap = need.slice();
    let ok = true;
    // forced cards first (a void seat cannot hold the suit)
    const free: Card[] = [];
    for (const c of pool) {
      const allowed = unknown.map((s, i) => (!x.voids[s]![sidx(c)] && hands[i]!.length < need[i]! ? i : -1)).filter((i) => i >= 0);
      if (allowed.length === 1) hands[allowed[0]!]!.push(c); else if (allowed.length === 0) { ok = false; break; } else free.push(c);
    }
    if (!ok) continue;
    for (const c of free) {
      const allowed = unknown.map((s, i) => (!x.voids[s]![sidx(c)] && hands[i]!.length < cap[i]! ? i : -1)).filter((i) => i >= 0);
      if (!allowed.length) { ok = false; break; }
      hands[allowed[rng.int(allowed.length)]!]!.push(c);
    }
    if (!ok || hands.some((h, i) => h.length !== need[i])) continue;
    if (attempt < 50) for (let i = 0; i < unknown.length; i++) { const p = origHcp(unknown[i]!, hands[i]!); if (p < bounds.lo[unknown[i]!]! || p > bounds.hi[unknown[i]!]!) ok = false; }
    if (!ok) continue;
    const out: Card[][] = [[], [], [], []];
    for (let s = 0; s < 4; s++) out[s] = x.known[s]!.slice();
    unknown.forEach((s, i) => { out[s] = hands[i]!; });
    return out;
  }
  return null;
}

const toMasks = (hands: Card[][]): DHands => hands.map((h) => { const m = [0, 0, 0, 0]; for (const c of h) m[sidx(c)]! |= 1 << rv(c); return m; });

/** Pick the card with the best average double-dummy result over sampled deals. Returns null when too expensive or inconsistent. */
function pimc(x: Ctx, rng: Rng, budgetMs: number): Card | null {
  const bounds = bidInfo(x.v);
  const trumpIdx = x.trump === null ? -1 : SUIT_IDX[x.trump]!;
  const actorHand = x.actor === x.me ? x.v.hand : x.known[x.actor]!;
  // legal cards, minus cards equivalent to a higher legal card
  const legal = x.legal.slice().sort((a, b) => sidx(a) - sidx(b) || rv(b) - rv(a));
  const cands: Card[] = [];
  for (const c of legal) { const prev = cands[cands.length - 1]; if (prev && suitOf(prev) === suitOf(c) && lowestEquivalent(x, actorHand, prev) === lowestEquivalent(x, actorHand, c)) continue; cands.push(c); }
  if (cands.length === 1) return cands[0]!;
  const sums = cands.map(() => 0); let n = 0;
  const t0 = Date.now(); const left = x.sizes[x.actor]! + 0;     // tricks remaining, including the current one
  const cur: [number, number, number][] = x.trick.map((p) => [p.seat, sidx(p.card), rv(p.card)]);
  for (let i = 0; i < 40 && ((i < playConfig.minSamples && Date.now() - t0 < 1200) || Date.now() - t0 < budgetMs); i++) {
    const hands = sample(x, rng, bounds); if (!hands) break;
    const dd = new DD(trumpIdx, 600_000);
    try {
      const vals: number[] = [];
      for (const c of cands) {
        const h = toMasks(hands); const hh = h[x.actor]!;
        // the actor's hand must include the candidate
        hh[sidx(c)]! &= ~(1 << rv(c));
        const nv = dd.value(h, (x.actor + 1) % 4, [...cur, [x.actor, sidx(c), rv(c)]], left);
        vals.push(x.actor % 2 === 0 ? nv : left - nv);
      }
      vals.forEach((vv, k) => { sums[k]! += vv; }); n++;
    } catch (e) { if (e instanceof NodeLimit) break; throw e; }
  }
  if (n < 2) return null;
  let best = 0;
  for (let k = 1; k < cands.length; k++) if (sums[k]! > sums[best]! + 1e-9) best = k;
  // among equal results prefer the lowest card of the suit (keeps honours, no needless overtakes)
  const bestSum = sums[best]!;
  const ties = cands.filter((_, k) => Math.abs(sums[k]! - bestSum) < 1e-9);
  const pick = ties.slice().sort((a, b) => rv(a) - rv(b))[0]!;
  return pick;
}

// ---------------------------------------------------------------- heuristic play
function suitsBid(v: View, seats: number[]): Set<string> {
  const out = new Set<string>();
  for (const a of v.auction) if (seats.includes(a.seat) && a.call.t === "bid" && a.call.suit !== "N") out.add(a.call.suit);
  return out;
}

function chooseLead(x: Ctx, rng: Rng): Card {
  const hand = x.legal, me = x.actor;
  const declSide = me % 2 === x.decl % 2;
  const trump = x.trump;
  const bySuit = (s: string) => cardsOf(hand, s);
  const suits = SUIT_CH.filter((s) => bySuit(s).length > 0);
  const otherHand = declSide ? (me === x.decl ? x.known[x.dummy]! : x.known[x.decl]!.length ? x.known[x.decl]! : x.v.hand) : [];
  const outstanding = (s: string) => 13 - cardsOf(x.played, s).length - cardsOf(hand, s).length - (declSide ? cardsOf(otherHand, s).length : x.known[x.dummy]!.filter((c) => suitOf(c) === s).length);

  if (declSide) {
    const mine = hand, other = otherHand;
    if (trump) {
      const ours = cardsOf([...mine, ...other], trump);
      const out = 13 - cardsOf(x.played, trump).length - ours.length;
      const myTr = cardsOf(mine, trump);
      if (out > 0 && myTr.length && ours.length >= 6) {
        // draw trump: cash a master, otherwise lead the highest from the longer holding when it holds honours, low towards honours of the other hand
        const m = myTr.find((c) => isMaster(x, c)); if (m) return lowestEquivalent(x, mine, m);
        const oth = cardsOf(other, trump);
        if (oth.some((c) => honor(c)) && myTr.length) return myTr[myTr.length - 1]!;
        return myTr[0]!;
      }
    }
    // cash masters (from the hand that holds fewer cards of the suit first, to avoid blocking), else lead low towards honours / long suit
    let best: { c: Card; s: number } | null = null;
    for (const s of suits) {
      if (trump && s === trump && 13 - cardsOf(x.played, trump).length - cardsOf([...mine, ...other], trump).length > 0) continue;
      const cs = bySuit(s); const oth = cardsOf(other, s);
      let score = 0, card = cs[cs.length - 1]!;
      const m = cs.find((c) => isMaster(x, c));
      if (m && (oth.length >= cs.length || oth.length === 0 || cs.length <= 2)) { score = 6 + cs.length; card = lowestEquivalent(x, mine, m); }
      else if (oth.some((c) => honor(c) || isMaster(x, c))) { score = 4 + oth.length; card = cs[cs.length - 1]!; }          // lead low towards the honours
      else { score = 1 + cs.length + oth.length * 0.5; card = cs[cs.length - 1]!; }
      if (cs.length === 0) continue;
      if (!best || score > best.s) best = { c: card, s: score };
    }
    if (best) return best.c;
    return hand[0]!;
  }

  // defence
  const partner = (me + 2) % 4;
  const pSuits = suitsBid(x.v, [partner]), oSuits = suitsBid(x.v, [x.decl, x.dummy]);
  let best: { c: Card; s: number } | null = null;
  for (const s of suits) {
    const cs = bySuit(s); const n = cs.length;
    let score = n * 0.7; let card: Card;
    const top = cs[0]!; const touching = (a: Card, b: Card) => rv(a) - rv(b) === 1;
    const seq = n >= 2 && touching(cs[0]!, cs[1]!) && rv(cs[0]!) >= 9 || (n >= 3 && touching(cs[1]!, cs[2]!) && rv(cs[1]!) >= 8 && rv(cs[0]!) >= 10 && rv(cs[0]!) - rv(cs[1]!) === 2 && false);
    const interior = n >= 3 && rv(cs[0]!) >= 9 && rv(cs[1]!) === rv(cs[0]!) - 2 && rv(cs[2]!) === rv(cs[1]!) - 1 && rv(cs[1]!) >= 8;   // KJT, AQJ, QT9: interior sequence
    if (n >= 2 && rv(cs[0]!) === 12 && rv(cs[1]!) === 11) { card = cs[0]!; score += 6; }                       // AK: lead the ace
    else if (seq) { card = cs[0]!; score += 5 + (n >= 3 ? 1 : 0); }
    else if (interior) { card = cs[1]!; score += 3.5; }
    else if (n >= 4) { card = cs[3]!; score += (rv(top) >= 10 ? 2.5 : 1); if (rv(top) === 12 && trump) score -= 3; if (rv(top) >= 10 && rv(cs[1]!) < 8) score -= 0.5; }       // 4th best
    else if (n === 3) { card = rv(top) >= 9 ? cs[2]! : cs[0]!; score += rv(top) >= 9 ? 0 : 0.5; }
    else if (n === 2) { card = top; score += rv(top) >= 10 ? -1 : 0.3; }
    else { card = top; score += trump && s !== trump && cardsOf(hand, trump).length >= 2 ? 2.5 : -2; }       // singleton: ruffing chance
    if (!seq && rv(top) >= 10 && n <= 3 && !(n >= 2 && rv(top) === 12 && rv(cs[1]!) === 11)) score -= 1.5;   // unsupported honour
    if (!trump && n >= 5) score += 1.5;
    if (pSuits.has(s)) { score += 3.5; card = n === 2 ? top : n >= 3 && rv(top) >= 10 && !seq ? cs[n >= 4 ? 3 : 2]! : card; if (n === 1) card = top; }
    if (oSuits.has(s)) score -= 3;
    if (trump && s === trump) score -= (outstanding(s) > 0 ? 3 : 1);
    if (x.played.length && cardsOf(x.played, s).length >= 2 && isMaster(x, top)) score += 1 + (rv(top) === 12 ? 1 : 0);   // cash a master later in the play
    if (!best || score > best.s) best = { c: card, s: score };
  }
  void rng;
  return best ? best.c : hand[0]!;
}

function discard(x: Ctx): Card {
  const hand = x.legal; const trump = x.trump;
  const suits = SUIT_CH.filter((s) => s !== trump && hand.some((c) => suitOf(c) === s));
  if (!suits.length) return hand.slice().sort((a, b) => rv(a) - rv(b))[0]!;
  let best: { c: Card; s: number } | null = null;
  const dummyHand = x.known[x.dummy]!;
  const defender = x.actor % 2 !== x.decl % 2;
  for (const s of suits) {
    const cs = cardsOf(hand, s); const low = cs[cs.length - 1]!;
    let score = cs.length - cs.filter((c) => rv(c) >= 10).length * 2.2 - (rv(cs[0]!) === 12 ? 1 : 0);
    if (cs.length === 1 && rv(low) >= 9) score -= 4;
    if (defender) {                                  // keep guards against dummy's long suit
      const dl = cardsOf(dummyHand, s).length; if (dl >= 4) score -= 2.5 + (cs.length <= dl ? 0.5 : 0);
    } else { score += 0; }
    if (isMaster(x, cs[0]!)) score -= 1.5;
    if (!best || score > best.s) best = { c: low, s: score };
  }
  return best!.c;
}

function follow(x: Ctx): Card {
  const trick = x.trick, trump = x.trump, hand = x.legal, pos = trick.length;
  const led = suitOf(trick[0]!.card);
  const win = winnerOf(trick, trump);
  const partnerWins = win.seat % 2 === x.actor % 2;
  const beats = (c: Card) => suitOf(c) === suitOf(win.card) ? rv(c) > rv(win.card) : trump !== null && suitOf(c) === trump && suitOf(win.card) !== trump;
  const follows = hand.filter((c) => suitOf(c) === led);
  const lowest = (cs: Card[]) => cs.slice().sort((a, b) => rv(a) - rv(b))[0]!;
  const last = pos === 3;
  if (follows.length) {
    if (partnerWins) {
      // partner is winning: stay low, but overtake when the partner's card is not safe and we are fourth... (never) ; attitude signal: spot encourages when partner leads and we hold an honour
      if (!last && pos === 2 && trick[0]!.seat === (x.actor + 2) % 4 && x.actor % 2 !== x.decl % 2) {
        const hasHon = follows.some((c) => rv(c) >= 10); const spots = follows.filter((c) => rv(c) <= 7).sort((a, b) => rv(b) - rv(a));
        if (hasHon && spots.length >= 2) return spots[0]!;
      }
      if (!last && !isMaster(x, win.card) && pos === 2 && win.seat === (x.actor + 2) % 4) {
        // third hand: partner's card may be beaten by the fourth hand; take over only with a clearly better card
        const better = follows.filter((c) => rv(c) > rv(win.card) && isMaster(x, c)); if (better.length && rv(win.card) < 9) return lowestEquivalent(x, hand, better[0]!);
      }
      return lowest(follows);
    }
    const winners = follows.filter(beats);
    if (last) return winners.length ? lowest(winners) : lowest(follows);                         // fourth hand: cheapest winner
    if (pos === 1) {                                                                              // second hand: low, cover an honour with an honour
      const ledCard = trick[0]!.card;
      if (winners.length && rv(ledCard) >= 9 && rv(ledCard) < 12) { const w = winners.filter((c) => rv(c) <= rv(ledCard) + 3).sort((a, b) => rv(a) - rv(b))[0]; if (w && w.length) return w; }
      const m = winners.find((c) => isMaster(x, c));
      if (m && x.actor % 2 === x.decl % 2 && cardsOf(x.known[x.dummy]!, led).length === 0 && x.actor !== x.dummy) return lowestEquivalent(x, hand, m);
      return lowest(follows);
    }
    // third hand (pos 2): play high, the lowest of equal cards, unless the trick is already safe
    if (winners.length) { const top = winners.sort((a, b) => rv(b) - rv(a))[0]!; return lowestEquivalent(x, hand, top); }
    return lowest(follows);
  }
  // void in the led suit: ruff or discard
  if (trump && !partnerWins) {
    const trumps = hand.filter((c) => suitOf(c) === trump);
    const winnersT = trumps.filter(beats);
    if (winnersT.length && (last || !partnerWins)) return lowest(winnersT);
  }
  return discard(x);
}

/** Tunables (the tests and benchmarks change them). */
export const playConfig = { maxCards: 10, minSamples: 3 };

export function chooseCard(v: View, legalCards: Card[], rng: Rng): Card {
  if (legalCards.length === 1) return legalCards[0]!;
  const x = context(v, legalCards);
  const cards = x.sizes[x.actor]!;
  // sampling plus double-dummy search once few cards remain; with more cards it is too slow in the browser
  if (cards <= playConfig.maxCards) {
    try { const c = pimc(x, rng, cards <= 6 ? 250 : 450); if (c) return c; } catch { /* fall through to the heuristics */ }
  }
  if (!x.trick.length) return chooseLead(x, rng);
  return follow(x);
}
