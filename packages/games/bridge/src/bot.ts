import { rankOf, suitOf, RANKS, type Bot, type Card, type Rng } from "@cards/engine";
import { STRAINS, hcp, lastBid, type Call, type Move, type Strain, type View } from "./rules.ts";

const rv = (c: Card) => RANKS.indexOf(rankOf(c));
const counts = (hand: Card[]): Record<string, number> => { const r = { C: 0, D: 0, H: 0, S: 0 } as Record<string, number>; for (const c of hand) r[suitOf(c)]!++; return r; };
const balanced = (cn: Record<string, number>) => Object.values(cn).every((n) => n >= 2) && Object.values(cn).filter((n) => n === 2).length <= 1;
const points = (hand: Card[]) => { const cn = counts(hand); let d = 0; for (const n of Object.values(cn)) d += n === 0 ? 3 : n === 1 ? 2 : n === 2 ? 1 : 0; return hcp(hand) + d; };
const longest = (cn: Record<string, number>, order: string[] = ["S", "H", "D", "C"]) => order.slice().sort((a, b) => cn[b]! - cn[a]! || order.indexOf(a) - order.indexOf(b))[0] as Strain;
const isMajor = (s: string) => s === "H" || s === "S";
const bidOf = (calls: Call[], level: number, suit: Strain): Call | undefined => calls.find((c) => c.t === "bid" && c.level === level && c.suit === suit);
/** The cheapest legal bid in `suit`. */
const cheapest = (calls: Call[], suit: Strain): Call | undefined => calls.filter((c): c is Extract<Call, { t: "bid" }> => c.t === "bid" && c.suit === suit).sort((a, b) => a.level - b.level)[0];

function bidding(v: View, legal: Move[]): Move {
  const calls = legal as Call[];
  const me = v.you as number, hand = v.hand, cn = counts(hand), h = hcp(hand), pts = points(hand);
  const pass: Call = { t: "pass" };
  const lb = lastBid({ auction: v.auction });
  const partner = (me + 2) % 4;
  const own = v.auction.filter((a) => a.seat === me && a.call.t === "bid");
  const pBids = v.auction.filter((a) => a.seat === partner && a.call.t === "bid").map((a) => a.call as Extract<Call, { t: "bid" }>);
  const oppBids = v.auction.filter((a) => a.seat % 2 !== me % 2 && a.call.t === "bid").map((a) => a.call as Extract<Call, { t: "bid" }>);

  // Opening
  if (!lb) {
    if (pts < 12 && h < 11) return pass;
    if (balanced(cn) && h >= 15 && h <= 17) return bidOf(calls, 1, "N") ?? pass;
    const five = (["S", "H"] as Strain[]).filter((s) => cn[s]! >= 5).sort((a, b) => cn[b]! - cn[a]!)[0];
    if (five) return bidOf(calls, 1, five) ?? pass;
    const minor = (cn.D! > cn.C! || (cn.D === cn.C && cn.D! >= 4 ? false : false)) ? "D" : "C";
    const m: Strain = cn.D! >= 4 && cn.C! >= 4 ? (cn.D! > cn.C! ? "D" : "C") : cn.D! > cn.C! ? "D" : minor as Strain;
    return bidOf(calls, 1, m) ?? pass;
  }
  // Partner has bid and opponents have not interfered with a bigger bid
  if (pBids.length && lb.seat === partner) {
    const pb = pBids[pBids.length - 1]!;
    if (pb.suit === "N") {
      if (h >= 10) return bidOf(calls, 3, "N") ?? pass;
      if (h >= 8 && lb.level === 1) return bidOf(calls, 2, "N") ?? pass;
      return pass;
    }
    const fit = cn[pb.suit]! >= (isMajor(pb.suit) ? 3 : 4) || (cn[pb.suit]! >= 3 && pts >= 13);
    if (own.length === 0) {
      if (fit) {
        if (pts >= 13) return (isMajor(pb.suit) ? bidOf(calls, 4, pb.suit) : bidOf(calls, 3, "N")) ?? pass;
        if (pts >= 10) return bidOf(calls, pb.level + 2, pb.suit) ?? bidOf(calls, 3, pb.suit) ?? pass;
        if (pts >= 6) return bidOf(calls, pb.level + 1, pb.suit) ?? pass;
        return pass;
      }
      if (h >= 6) {
        const s = (["S", "H", "D", "C"] as Strain[]).filter((x) => x !== pb.suit && cn[x]! >= 4).sort((a, b) => cn[b]! - cn[a]!)[0];
        if (s) { const b = cheapest(calls, s); if (b && b.t === "bid" && b.level <= 2) return b; }
        if (balanced(cn) && h >= 10) return bidOf(calls, 3, "N") ?? bidOf(calls, 2, "N") ?? pass;
        if (balanced(cn)) return bidOf(calls, 1, "N") ?? bidOf(calls, 2, "N") ?? pass;
      }
      return pass;
    }
    // second round: with strong hands try to reach game, otherwise stay low
    const gameBid = isMajor(pb.suit) && cn[pb.suit]! >= 3 ? bidOf(calls, 4, pb.suit) : bidOf(calls, 3, "N");
    if (h + (pb.level >= 2 ? 8 : 6) >= 25 && pts >= 13 && lb.level < 4) return gameBid ?? pass;
    return pass;
  }
  // Opponents opened: overcall with a good suit, or double for penalties at high level
  if (lb.seat % 2 !== me % 2) {
    if (lb.level >= 4 && h >= 11 && cn[lb.suit === "N" ? "S" : lb.suit]! >= 4 && v.auction.every((a) => a.call.t !== "double")) return (calls.find((c) => c.t === "double")) ?? pass;
    if (own.length === 0 && !pBids.length && lb.level <= 1) {
      if (balanced(cn) && h >= 15 && h <= 18) return bidOf(calls, 1, "N") ?? pass;
      const s = longest(cn);
      if (cn[s]! >= 5 && h >= 10) { const b = cheapest(calls, s); if (b && b.t === "bid" && b.level <= 2) return b; }
    }
    void oppBids;
  }
  void STRAINS;
  return pass;
}

/** Bots play with the cards of both their hand and the dummy; no peeking at other hands. */
function play(v: View, legal: Move[], rng: Rng): Move {
  const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
  if (plays.length === 1) return { t: "play", card: plays[0]! };
  const trump = v.contract!.suit === "N" ? null : v.contract!.suit;
  const trick = v.trick; const controller = v.you as number;
  const owner = trick.length ? (trick[trick.length - 1]!.seat + 1) % 4 : v.turn as number; // whose card we are playing
  void owner;
  const decl = v.contract!.declarer, dummy = (decl + 2) % 4;
  const myTeam = (s: number) => s % 2 === controller % 2;
  const hiFirst = (a: Card, b: Card) => rv(b) - rv(a), loFirst = (a: Card, b: Card) => rv(a) - rv(b);
  const bySuit = (s: string) => plays.filter((c) => suitOf(c) === s);
  if (!trick.length) {
    // lead
    const declSide = myTeam(decl);
    if (declSide && trump) {
      const tr = bySuit(trump).sort(hiFirst);
      const total = [...v.hand, ...(v.shown?.[dummy] ?? [])].filter((c) => suitOf(c) === trump).length;
      if (tr.length && total >= 7 && rng.next() < 0.8) return { t: "play", card: tr[0]! };
    }
    const aces = plays.filter((c) => rankOf(c) === "A" && suitOf(c) !== trump);
    if (aces.length && rng.next() < 0.7) return { t: "play", card: aces[0]! };
    const kings = plays.filter((c) => rankOf(c) === "K");
    if (declSide && kings.length && rng.next() < 0.4) return { t: "play", card: kings[0]! };
    const cn = counts(plays);
    const suits = (["S", "H", "D", "C"] as string[]).filter((s) => cn[s]! > 0 && s !== trump).sort((a, b) => cn[b]! - cn[a]!);
    const s = suits[0] ?? suitOf(plays[0]!);
    const cs = plays.filter((c) => suitOf(c) === s).sort(hiFirst);
    // fourth best from the longest suit for defenders, otherwise low
    return { t: "play", card: (!declSide && cs.length >= 4 ? cs[3] : cs[cs.length - 1])! };
  }
  const ledSuit = suitOf(trick[0]!.card);
  let win = trick[0]!;
  for (const p of trick.slice(1)) {
    const a = suitOf(p.card), b = suitOf(win.card);
    if (a === b ? rv(p.card) > rv(win.card) : trump !== null && a === trump && b !== trump) win = p;
  }
  const last = trick.length === 3;
  const beats = (c: Card) => (suitOf(c) === suitOf(win.card) ? rv(c) > rv(win.card) : trump !== null && suitOf(c) === trump && suitOf(win.card) !== trump);
  const winners = plays.filter(beats).sort(loFirst);
  const partnerWins = myTeam(win.seat);
  const follow = plays.filter((c) => suitOf(c) === ledSuit);
  const lowest = (cs: Card[]) => cs.slice().sort(loFirst)[0]!;
  if (partnerWins && (last || rv(win.card) >= 10)) return { t: "play", card: follow.length ? lowest(follow) : lowest(plays.filter((c) => suitOf(c) !== trump).length ? plays.filter((c) => suitOf(c) !== trump) : plays) };
  if (winners.length) {
    if (last || follow.length === 0 || rng.next() < 0.75) {
      // third hand high, otherwise cheapest winner; do not ruff if partner is winning
      if (!partnerWins) return { t: "play", card: trick.length === 2 && follow.length ? winners[winners.length - 1]! : winners[0]! };
    }
  }
  if (follow.length) return { t: "play", card: lowest(follow) };
  const side = plays.filter((c) => suitOf(c) !== trump);
  return { t: "play", card: lowest(side.length ? side : plays) };
}

export const bridgeBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    if (v.phase === "auction") return bidding(v, legal);
    return play(v, legal, rng);
  },
};
