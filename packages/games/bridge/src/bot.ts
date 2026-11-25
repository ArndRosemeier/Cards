import { rankOf, suitOf, RANKS, type Bot, type Card, type Rng } from "@cards/engine";
import { chooseCard } from "./play.ts";
import { competitive } from "./compete.ts";
import { STRAINS, hcp, lastBid, type Call, type Move, type Strain, type View } from "./rules.ts";

const rv = (c: Card) => RANKS.indexOf(rankOf(c));
const counts = (hand: Card[]): Record<string, number> => { const r = { C: 0, D: 0, H: 0, S: 0 } as Record<string, number>; for (const c of hand) r[suitOf(c)]!++; return r; };
const balanced = (cn: Record<string, number>) => Object.values(cn).every((n) => n >= 2) && Object.values(cn).filter((n) => n === 2).length <= 1;
const points = (hand: Card[]) => { const cn = counts(hand); let d = 0; for (const n of Object.values(cn)) d += n === 0 ? 3 : n === 1 ? 2 : n === 2 ? 1 : 0; return hcp(hand) + d; };
const longest = (cn: Record<string, number>, order: string[] = ["S", "H", "D", "C"]) => order.slice().sort((a, b) => cn[b]! - cn[a]! || order.indexOf(a) - order.indexOf(b))[0] as Strain;
const isMajor = (s: string) => s === "H" || s === "S";
const SUIT_ORDER: Strain[] = ["S", "H", "D", "C"];
const bidOf = (calls: Call[], level: number, suit: Strain): Call | undefined => calls.find((c) => c.t === "bid" && c.level === level && c.suit === suit);
/** The cheapest legal bid in `suit`. */
const cheapest = (calls: Call[], suit: Strain): Call | undefined => calls.filter((c): c is Extract<Call, { t: "bid" }> => c.t === "bid" && c.suit === suit).sort((a, b) => a.level - b.level)[0];

/** Partnership conventions for uncontested auctions: 1NT 15-17 with Stayman and Jacoby transfers, strong 2NT,
 * weak twos and preempts, limit raises, natural rebids. Returns null when the situation is not covered (the older natural logic takes over). */
function conventional(v: View, calls: Call[]): Call | null {
  const me = v.you as number, partner = (me + 2) % 4, hand = v.hand, cn = counts(hand), h = hcp(hand);
  const A = v.auction;
  if (A.some((a) => a.seat % 2 !== me % 2 && a.call.t !== "pass")) return null;           // opponents have acted: natural logic
  const mine = A.filter((a) => a.seat % 2 === me % 2 && a.call.t === "bid");        // our side's bids, both partners
  const ownBids = mine.filter((a) => a.seat === me), partnerBids = mine.filter((a) => a.seat === partner);
  const bid = (level: number, suit: Strain): Call | null => bidOf(calls, level, suit) ?? null;
  const pass: Call = { t: "pass" };
  const longestSuit = (suits: Strain[]) => suits.slice().sort((a, b) => cn[b]! - cn[a]!)[0]!;
  const second = (excl: string) => (["S", "H", "D", "C"] as Strain[]).filter((x) => x !== excl).sort((a, b) => cn[b]! - cn[a]!)[0]!;
  const bal = balanced(cn);
  const aces = (cs: Card[]) => cs.filter((c) => rankOf(c) === "A").length;

  // ---------------- opening
  if (mine.length === 0 && A.every((a) => a.call.t === "pass")) {
    const len1 = Math.max(...Object.values(cn)), srt = Object.values(cn).sort((a, b) => b - a), rule20 = h + srt[0]! + srt[1]!;
    if (h >= 22 || (h >= 20 && len1 >= 7) || (h + srt[0]! + srt[1]! >= 31 && h >= 19)) return bid(2, "C") ?? pass;             // strong, artificial and forcing to game
    if (bal && h >= 20) return bid(2, "N") ?? pass;
    if (bal && h >= 15 && h <= 17) return bid(1, "N") ?? pass;
    const goodSuit = (s: Strain) => hand.filter((c) => suitOf(c) === s && "AKQ".includes(rankOf(c))).length >= 2;
    if (h < 11) {
      for (const s of ["S", "H", "D", "C"] as Strain[]) {
        if (cn[s] === 6 && s !== "C" && h >= 5 && goodSuit(s)) return bid(2, s) ?? pass;                     // weak two
        if (cn[s] === 7 && h <= 10) return bid(3, s) ?? pass;                                                  // preempt
        if (cn[s]! >= 8 && h <= 10) return bid(4, s) ?? pass;
      }
      return pass;
    }
    if (h >= 13 || (h >= 11 && rule20 >= 20)) {
      void len1;
      const majors = (["S", "H"] as Strain[]).filter((s) => cn[s]! >= 5).sort((a, b) => cn[b]! - cn[a]! || (a === "S" ? -1 : 1));
      if (majors.length) return bid(1, majors[0]!) ?? pass;
      const minor: Strain = cn.D! > cn.C! ? "D" : cn.D === cn.C ? (cn.D! >= 4 ? "D" : "C") : "C";
      return bid(1, minor) ?? pass;
    }
    return pass;
  }
  const lbid = lastBid({ auction: A });
  if (!lbid) return null;
  if (lbid.seat === partner && lbid.suit === "N" && lbid.level === 4 && ownBids.length >= 1 && ownBids.every((a) => (a.call as Extract<Call, { t: "bid" }>).suit !== "N") && partnerBids.length >= 2) {
    const n = aces(hand); return (n === 1 ? bid(5, "D") : n === 2 ? bid(5, "H") : n === 3 ? bid(5, "S") : bid(5, "C")) ?? pass;     // answer Blackwood
  }

  // ---------------- strong 2C: waiting 2D, then game-forcing natural bidding
  const open2c = A.find((a) => a.call.t === "bid");
  if (open2c && (open2c.call as Extract<Call, { t: "bid" }>).suit === "C" && (open2c.call as Extract<Call, { t: "bid" }>).level === 2) {
    const strong = open2c.seat === me, mineBids = ownBids.length;
    const maxSuit = SUIT_ORDER.slice().sort((a, b) => cn[b]! - cn[a]!)[0]!;
    if (!strong && mineBids === 0) {                                                       // response
      const own = SUIT_ORDER.filter((s) => cn[s]! >= 5 && "AKQ".split("").filter((r) => hand.some((c) => suitOf(c) === s && rankOf(c) === r)).length >= 2);
      if (h >= 8 && own.length) { const b = cheapest(calls, own[0]!); if (b && b.t === "bid" && b.level <= 3) return b; }
      return bid(2, "D") ?? pass;
    }
    if (strong && mineBids === 1) {                                                        // opener's rebid
      const r = [...A].reverse().find((a) => a.seat === partner && a.call.t === "bid");
      const rc = r?.call as Extract<Call, { t: "bid" }> | undefined;
      if (rc && rc.suit === "D" && rc.level === 2) { if (bal) return (h >= 25 ? bid(3, "N") : bid(2, "N")) ?? pass; const b = cheapest(calls, maxSuit); if (b && b.t === "bid") return b; }
      if (rc && rc.suit !== "D") { if (cn[rc.suit]! >= 3 && isMajor(rc.suit)) return bid(4, rc.suit) ?? pass; if (bal) return bid(3, "N") ?? pass; const b = cheapest(calls, maxSuit); if (b && b.t === "bid") return b; }
    }
    if (!strong && mineBids === 1) {                                                       // responder after opener's rebid (game forced)
      const pl = [...A].reverse().find((a) => a.seat === partner && a.call.t === "bid")!.call as Extract<Call, { t: "bid" }>;
      if (pl.suit === "N") return (pl.level === 2 && h >= 10 ? bid(6, "N") : bid(3, "N")) ?? pass;
      if (cn[pl.suit]! >= 3) { if (isMajor(pl.suit)) return (h >= 9 ? bid(4, pl.suit) ?? bid(6, pl.suit) : bid(4, pl.suit)) ?? pass; return bid(3, "N") ?? bid(pl.level + 1, pl.suit) ?? pass; }
      return bid(3, "N") ?? pass;
    }
    if (strong && mineBids >= 2) return bid(3, "N") ?? pass;
    return null;
  }

  // ---------------- partner opened (I have not bid yet)
  const po = A.find((a) => a.call.t === "bid");
  if (po && po.seat === partner && ownBids.length === 0) {
    const o = po.call as Extract<Call, { t: "bid" }>;
    if (A.some((a) => a.seat === (me + 1) % 4 && a.call.t !== "pass")) return null;
    if (o.suit === "N") {
      if (o.level === 1) {                                                         // 1NT, 15-17
        if (h >= 18) return bid(6, "N") ?? bid(3, "N") ?? pass;
        if (h >= 16 && bal) return bid(4, "N") ?? bid(3, "N") ?? pass;                              // quantitative: 6NT only with a maximum
        const m5 = (["S", "H"] as Strain[]).find((s) => cn[s]! >= 5);
        if (m5 && h >= 0 && !(h >= 10 && cn[m5]! === 5 && false)) return m5 === "H" ? bid(2, "D") ?? pass : bid(2, "H") ?? pass; // Jacoby transfer
        if (h >= 8 && (cn.H! >= 4 || cn.S! >= 4)) return bid(2, "C") ?? pass;     // Stayman
        if (h >= 10) return bid(3, "N") ?? pass;
        if (h >= 8) return bid(2, "N") ?? pass;
        return pass;
      }
      if (o.level === 2) { if (h >= 12) return bid(6, "N") ?? bid(3, "N") ?? pass; return h >= 4 ? bid(3, "N") ?? pass : pass; }
      return pass;
    }
    if (o.level === 2 && o.suit !== "C") {                                       // weak two
      const fit = cn[o.suit]! >= 3;
      if (h >= 15 && fit && isMajor(o.suit)) return bid(4, o.suit) ?? pass;
      if (h >= 16) return bid(3, "N") ?? pass;
      return pass;
    }
    if (o.level >= 3) { if (isMajor(o.suit) && h >= 15 && cn[o.suit]! >= 2 && o.level === 3) return bid(4, o.suit) ?? pass; return pass; }
    // 1-level suit opening
    const sup = (cn[o.suit]!) , shortPts = (() => { let d = 0; for (const [s, n] of Object.entries(cn)) if (s !== o.suit) d += n === 0 ? 3 : n === 1 ? 2 : n === 2 ? 1 : 0; return d; })();
    if (isMajor(o.suit) && sup >= 3) {
      const sp = h + (sup >= 4 ? shortPts : Math.min(shortPts, 1));
      if (sp >= 13 && sup >= 4) return bid(2, "N") ?? bid(4, o.suit) ?? pass;                 // Jacoby 2NT: forcing raise, 4+ trumps
      if (sp >= 13) return bid(3, o.suit) ?? pass;                                           // three trumps: limit-plus, opener decides
      if (sp >= 10) return bid(3, o.suit) ?? pass;
      if (sp >= 6) return bid(2, o.suit) ?? pass;
      return pass;
    }
    if (h < 6) return pass;
    const lower = (["C", "D", "H", "S"] as Strain[]).filter((s) => s !== o.suit && cn[s]! >= 4);
    const cheapestNewOK = () => lower.some((s2) => { const c2 = cheapest(calls, s2); return !!c2 && c2.t === "bid" && c2.level <= 2; });
    if (h < 10) {                                                                  // 6-9: a one-level new suit or 1NT
      const one = lower.find((s) => bid(1, s)); if (one) return bid(1, one)!;
      if (!isMajor(o.suit) && cn[o.suit]! >= 5) return bid(2, o.suit) ?? bid(1, "N") ?? pass;
      return bid(1, "N") ?? pass;
    }
    // 10+: forcing new suit, otherwise notrump
    if (!isMajor(o.suit) && cn[o.suit]! >= 5 && h >= 10 && h < 13) return (bal ? bid(2, "N") : bid(3, o.suit)) ?? pass;
    if (isMajor(o.suit) && bal && h >= 10 && h < 13 && !cheapestNewOK()) return bid(1, "N") ?? pass;
    const cheapestNew = lower.map((s) => cheapest(calls, s)).filter((c): c is Extract<Call, { t: "bid" }> => !!c && c.t === "bid").sort((a, b) => a.level - b.level || STRAINS.indexOf(a.suit) - STRAINS.indexOf(b.suit))[0];
    if (bal && h >= 13 && !(isMajor(o.suit) && sup >= 4)) return bid(3, "N") ?? pass;
    if (cheapestNew && cheapestNew.level <= 2) { const five = lower.filter((s) => cn[s]! >= 5).sort((a, b) => cn[b]! - cn[a]!)[0]; return (five && cheapest(calls, five)) || cheapestNew; }
    if (bal) return bid(2, "N") ?? pass;
    return bid(3, "N") ?? pass;
  }

  // ---------------- I opened and partner answered
  const nt1 = mine[0]!.seat === me && (mine[0]!.call as Extract<Call, { t: "bid" }>).suit === "N" && (mine[0]!.call as Extract<Call, { t: "bid" }>).level === 1;
  if (mine[0]!.seat === me && (ownBids.length === 1 || (nt1 && lbid.seat === partner))) {
    const o = mine[0]!.call as Extract<Call, { t: "bid" }>;
    const r = A.slice().reverse().find((a) => a.seat === partner && a.call.t === "bid");
    if (!r) return null;                                                           // partner passed: nothing more to say
    const rc = r.call as Extract<Call, { t: "bid" }>;
    if (o.suit === "N" && o.level === 1) {
      if (rc.suit === "C" && rc.level === 2) return (cn.H! >= 4 ? bid(2, "H") : cn.S! >= 4 ? bid(2, "S") : bid(2, "D")) ?? pass;   // Stayman answer
      if (rc.suit === "D" && rc.level === 2) return bid(2, "H") ?? pass;                                                              // transfer to hearts
      if (rc.suit === "H" && rc.level === 2) return bid(2, "S") ?? pass;                                                              // transfer to spades
      if (rc.suit === "N" && rc.level === 2) return h >= 16 ? bid(3, "N") ?? pass : pass;                                           // 2NT invite
      if (rc.suit === "N" && rc.level === 4) return h >= 17 ? bid(6, "N") ?? pass : pass;                                            // quantitative raise
      if (isMajor(rc.suit) && rc.level === 3) return (h >= 16 && cn[rc.suit]! >= 3) || (h >= 15 && cn[rc.suit]! >= 4) ? bid(4, rc.suit) ?? pass : pass;   // accept the invitation
      return pass;
    }
    if (o.suit === "N") return pass;
    if (o.level >= 2) return pass;                                                 // weak openings: partner decides
    const mf = (s: Strain) => cn[s]!;
    // partner raised my suit
    if (rc.suit === o.suit) {
      if (rc.level === 2) { const t = h + (mf(o.suit) >= 6 ? 1 : 0); if (isMajor(o.suit)) { if (t >= 17) return bid(4, o.suit) ?? pass; if (t >= 15) return bid(3, o.suit) ?? pass; } return pass; }
      if (rc.level === 3) return isMajor(o.suit) && h >= 14 ? bid(4, o.suit) ?? pass : pass;
      return pass;
    }
    if (rc.suit === "N" && rc.level === 4 && isMajor(o.suit)) {                    // Blackwood: answer with the number of aces
      const n = aces(hand);
      return (n === 1 ? bid(5, "D") : n === 2 ? bid(5, "H") : n === 3 ? bid(5, "S") : bid(5, "C")) ?? pass;
    }
    if (rc.suit === "N" && rc.level === 2 && isMajor(o.suit)) {                    // Jacoby 2NT: 18+ asks for aces, otherwise game
      if (h >= 18) return bid(4, "N") ?? bid(4, o.suit) ?? pass;
      return bid(4, o.suit) ?? pass;
    }
    if (rc.suit === "N") {                                                         // 1NT 6-9 / 2NT 10-12 / 3NT
      if (rc.level >= 3) return pass;
      if (rc.level === 2) return h >= 14 ? bid(3, "N") ?? pass : pass;
      if (h >= 19) return bid(3, "N") ?? pass;
      if (h >= 16 && bal) return bid(2, "N") ?? pass;
      if (mf(o.suit) >= 6) return bid(2, o.suit) ?? pass;
      return pass;
    }
    // partner bid a new suit
    if (isMajor(rc.suit) && mf(rc.suit) >= 4) {
      if (h >= 18) return bid(4, rc.suit) ?? pass;
      if (h >= 15) return bid(3, rc.suit) ?? pass;
      return bid(2, rc.suit) ?? pass;
    }
    if (mf(o.suit) >= 6) return (h >= 17 ? bid(3, o.suit) : bid(2, o.suit)) ?? bid(1, "N") ?? pass;
    if (bal) return (h >= 18 ? bid(2, "N") : bid(1, "N")) ?? (h >= 18 ? bid(3, "N") : bid(2, "N")) ?? pass;
    const other = second(o.suit);
    if (cn[other]! >= 4 && other !== rc.suit) { const b = cheapest(calls, other); if (b && b.t === "bid" && b.level <= 2) return b; }
    return bid(1, "N") ?? bid(2, "N") ?? (cheapest(calls, o.suit) ?? pass);
  }

  // ---------------- I asked with Blackwood and partner answered
  const asked = ownBids.find((a) => (a.call as Extract<Call, { t: "bid" }>).suit === "N" && (a.call as Extract<Call, { t: "bid" }>).level === 4);
  if (asked) {
    const trump = (mine.find((a) => (a.call as Extract<Call, { t: "bid" }>).suit !== "N")?.call as Extract<Call, { t: "bid" }> | undefined)?.suit ?? "S";
    const ans = [...partnerBids].reverse()[0]!.call as Extract<Call, { t: "bid" }>;
    if (ans.level === 5 && ans.suit !== "N" && isMajor(trump)) {
      const theirs = ans.suit === "C" ? 0 : ans.suit === "D" ? 1 : ans.suit === "H" ? 2 : 3;
      const total = aces(hand) + theirs;
      if (total >= 4) return bid(6, trump) ?? pass;
      return bid(5, trump) ?? pass;
    }
    return pass;
  }

  // ---------------- responder's second turn (partner has rebid)
  void longestSuit; void lbid;
  const first = mine[0]!.seat === partner ? mine[0] : undefined, mineOwn = ownBids;
  if (first && mineOwn.length === 1 && partnerBids.length >= 2) {
    const o = first.call as Extract<Call, { t: "bid" }>, mc = mineOwn[0]!.call as Extract<Call, { t: "bid" }>;
    const pLast = [...mine].reverse().find((a) => a.seat === partner)!.call as Extract<Call, { t: "bid" }>;
    // after a Jacoby transfer was completed
    if (o.suit === "N" && o.level === 1 && mc.level === 2 && (mc.suit === "D" || mc.suit === "H")) {
      const maj: Strain = mc.suit === "D" ? "H" : "S";
      if (pLast.suit === maj && pLast.level === 2) {
        if (h >= 10 || (h >= 8 && cn[maj]! >= 6)) return (cn[maj]! >= 6 || h >= 13 ? bid(4, maj) : bid(3, "N")) ?? pass;
        if (h >= 8) return bid(3, maj) ?? pass;                                  // invitational
        return pass;
      }
    }
    // after Stayman
    if (o.suit === "N" && o.level === 1 && mc.suit === "C" && mc.level === 2) {
      if (pLast.suit === "H" || pLast.suit === "S") {
        if (cn[pLast.suit]! >= 4) return (h >= 10 ? bid(4, pLast.suit) : bid(3, pLast.suit)) ?? pass;
        return (h >= 10 ? bid(3, "N") : bid(2, "N")) ?? pass;
      }
      if (pLast.suit === "D") {
        const other = cn.H! >= 4 ? null : null; void other;
        return (h >= 10 ? bid(3, "N") : bid(2, "N")) ?? pass;
      }
    }
  }
  return null;
}

function bidding(v: View, legal: Move[]): Move {
  const conv = conventional(v, legal as Call[]);
  if (conv) return conv;
  const me = v.you as number;
  if (v.auction.some((a) => a.call.t !== "pass")) { const c = competitive(v, legal as Call[]); if (c) return c; }
  return naturalBidding(v, legal);
}

function naturalBidding(v: View, legal: Move[]): Move {
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

function play(v: View, legal: Move[], rng: Rng): Move {
  const plays = legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card);
  return { t: "play", card: chooseCard(v, plays, rng) };
}

export const bridgeBot: Bot<View, Move> = {
  choose(v, legal, rng) {
    if (v.phase === "auction") return bidding(v, legal);
    return play(v, legal, rng);
  },
};
