import { rankOf, suitOf, RANKS, type Card } from "@cards/engine";
import { hcp, lastBid, type Call, type Strain, type View } from "./rules.ts";

/** Bidding when the opponents take part: overcalls, takeout and negative doubles, advancing partner, competing by the law of total
 * tricks, and sensible game bids in later rounds. Used whenever an opponent has made a call; returns null only for "not my business". */

type Bid = Extract<Call, { t: "bid" }>;
const SUITS: Strain[] = ["C", "D", "H", "S"];
const rank = (c: Card) => RANKS.indexOf(rankOf(c));
const isMaj = (s: string) => s === "H" || s === "S";
const lenOf = (hand: Card[]) => { const r: Record<string, number> = { C: 0, D: 0, H: 0, S: 0 }; for (const c of hand) r[suitOf(c)]!++; return r; };
const shortPts = (cn: Record<string, number>, excl?: string) => { let d = 0; for (const [s, n] of Object.entries(cn)) if (s !== excl) d += n === 0 ? 3 : n === 1 ? 2 : n === 2 ? 1 : 0; return d; };
const balancedHand = (cn: Record<string, number>) => Object.values(cn).every((n) => n >= 2) && Object.values(cn).filter((n) => n === 2).length <= 1;
const honorsIn = (hand: Card[], s: string, top: number) => hand.filter((c) => suitOf(c) === s && rank(c) >= 13 - top).length;   // honours among the top `top` ranks (A=1..)
const stopper = (hand: Card[], s: string) => { const cs = hand.filter((c) => suitOf(c) === s).map(rank).sort((a, b) => b - a); return cs.length > 0 && (cs[0] === 12 || (cs[0] === 11 && cs.length >= 2) || (cs[0] === 10 && cs.length >= 3) || (cs[0] === 9 && cs.length >= 4)); };

export function competitive(v: View, calls: Call[]): Call | null {
  const me = v.you as number, partner = (me + 2) % 4, A = v.auction, hand = v.hand;
  const lb = lastBid({ auction: A }); if (!lb) return null;
  const cn = lenOf(hand), h = hcp(hand);
  const pass: Call = { t: "pass" };
  const bidAt = (level: number, suit: Strain): Call | null => calls.find((c): c is Bid => c.t === "bid" && c.level === level && c.suit === suit) ?? null;
  const cheap = (suit: Strain): Bid | null => (calls.filter((c): c is Bid => c.t === "bid" && c.suit === suit).sort((a, b) => a.level - b.level)[0]) ?? null;
  const dbl = calls.find((c) => c.t === "double") ?? null;
  const rdbl = calls.find((c) => c.t === "redouble") ?? null;
  const bidsBy = (pred: (seat: number) => boolean) => A.filter((a) => pred(a.seat) && a.call.t === "bid").map((a) => a.call as Bid);
  const mine = bidsBy((s) => s === me), pb = bidsBy((s) => s === partner), opp = bidsBy((s) => s % 2 !== me % 2);
  const lastOpp = [...A].reverse().find((a) => a.seat % 2 !== me % 2 && a.call.t === "bid");
  const oppSuit = lastOpp && (lastOpp.call as Bid).suit !== "N" ? (lastOpp.call as Bid).suit : null;
  const lastCall = A[A.length - 1];
  const balancing = A.length >= 3 && A.slice(-2).every((a) => a.call.t === "pass") && lb.seat % 2 !== me % 2;   // the auction would end if I pass
  const sc = balancing ? 3 : 0;                                                                                 // balancing: bid on 3 points less
  const myDouble = A.some((a) => a.seat === me && a.call.t === "double");
  const pDouble = [...A].reverse().find((a) => a.seat === partner && a.call.t === "double");
  const sup = (s: string) => cn[s]!;

  // ---------------------------------------------------------------- 1. my side has made no bid: the opponents opened (and perhaps raised)
  if (pb.length === 0 && mine.length === 0 && !pDouble) {
    const first = A.find((a) => a.call.t === "bid")!; const o = first.call as Bid;
    if (lb.seat % 2 === me % 2) return null;
    const L = lb.level;
    // a double of an artificial or very high contract
    if (L >= 4) {
      if (dbl && h >= 14 && oppSuit && sup(oppSuit) >= 3) return dbl;
      // preempt over preempt: only with a real long suit
      const long = SUITS.find((s) => sup(s) >= 7 && s !== oppSuit);
      if (long && h >= 10) { const b = cheap(long); if (b && b.level <= 5) return b; }
      return pass;
    }
    if (lb.suit === "N") {
      if (L === 1 && dbl && h >= 16 - sc && balancedHand(cn) && (lb.seat + 1) % 4 === me) return dbl;                 // penalty double of a weak notrump? only with real strength
      const best = SUITS.slice().sort((a, b) => sup(b) - sup(a))[0]!;
      if (L <= 2 && sup(best) >= 5 && h >= 11 - sc && honorsIn(hand, best, 5) >= 2) { const b = cheap(best); if (b && b.level <= 3) return b; }
      return pass;
    }
    const S = lb.suit; const unbid = SUITS.filter((s) => s !== S);
    const shortInOpp = sup(S) <= 2;
    const otherMajors = (["H", "S"] as Strain[]).filter((s) => s !== S);
    // takeout double: opening values, short in their suit, support for the others
    const supportAll = unbid.every((s) => sup(s) >= 3 || (!isMaj(s) && sup(s) >= 2) || sup(s) >= 4) && otherMajors.every((s) => sup(s) >= 3);
    const longest = unbid.slice().sort((a, b) => sup(b) - sup(a))[0]!;
    const preferOvercall = sup(longest) >= 6 || (sup(longest) === 5 && !supportAll && h < 17);
    if (dbl && !preferOvercall && L <= 3 && lb.seat !== partner && (h >= 12 - sc && shortInOpp && (supportAll || sup(S) <= 1)) && (L === 1 || h >= 13 - sc || supportAll)) return dbl;
    // strong hands: overcall or double-and-bid
    const bestSuit = unbid.slice().sort((a, b) => sup(b) - sup(a) || (isMaj(b) ? 1 : 0) - (isMaj(a) ? 1 : 0))[0]!;
    if (dbl && L <= 2 && h >= 17 && sup(S) <= 2) return dbl;
    // 1NT overcall
    if (L === 1 && h >= 15 - sc && h <= 18 && balancedHand(cn) && stopper(hand, S)) { const b = bidAt(1, "N"); if (b) return b; }
    // suit overcall
    const good = (s: string) => honorsIn(hand, s, 5) >= 2 || (h >= 13 && honorsIn(hand, s, 5) >= 1);
    if (sup(bestSuit) >= 5 || (sup(bestSuit) >= 6)) {
      const b = cheap(bestSuit);
      if (b && (b.level === L ? true : true)) {
        const lvl = b.level;
        if (lvl === 1 && h >= 8 - sc && h <= 17 && good(bestSuit)) return b;
        if (lvl === 2 && h >= 11 - sc && h <= 17 && (sup(bestSuit) >= 6 || good(bestSuit))) return b;
        if (lvl === 3 && h >= 14 && sup(bestSuit) >= 6 && good(bestSuit)) return b;
      }
    }
    // weak jump / preempt over a one-level opening
    if (L <= 2 && h <= 10 && h >= 4) {
      const long = unbid.find((s) => sup(s) >= 7); if (long) { const b = bidAt(3, long as Strain); if (b) return b; }
      const six = unbid.find((s) => sup(s) === 6 && s !== "C" && honorsIn(hand, s, 5) >= 2 && cheap(s)!.level <= 2); void six;
    }
    // second suit: both of two long suits (Michaels-like) are not played; pass
    void o;
    return pass;
  }

  // ---------------------------------------------------------------- 2. partner doubled for takeout (I have not bid): advance
  if (pDouble && mine.length === 0 && lastCall && lastCall.seat !== partner) {
    const S = oppSuit; const Lc = lb.level;
    const opts = SUITS.filter((s) => s !== S && sup(s) >= 3 && !(pb.some((p) => p.suit === s)));
    const lbs = lb.seat % 2 !== me % 2;
    // penalty pass with a long, strong holding in their suit
    if (S && lbs && sup(S) >= 5 && honorsIn(hand, S, 5) >= 3 && h >= 7 && Lc <= 2 && !dbl) return pass;
    const pick = opts.slice().sort((a, b) => sup(b) - sup(a) || (isMaj(b) ? 1 : 0) - (isMaj(a) ? 1 : 0))[0];
    const stp = S ? stopper(hand, S) : true;
    if (h >= 12 && S) {
      if (pick && isMaj(pick) && sup(pick) >= 4) { const g = bidAt(4, pick as Strain); if (g) return g; }
      if (stp && balancedHand(cn)) { const g = bidAt(3, "N"); if (g) return g; }
      const cue = cheap(S as Strain); if (cue && cue.level <= 3) return cue;                                    // forcing cue-bid
    }
    if (pick) {
      const b = cheap(pick as Strain);
      if (b) {
        const jump = h >= 9 && h <= 11 ? bidAt(b.level + 1, pick as Strain) : null;
        if (jump && jump.t === "bid" && jump.level <= 3) return jump;
        return b;
      }
    }
    if (stp && balancedHand(cn) && S) { const t = h >= 11 ? bidAt(2, "N") : bidAt(1, "N"); if (t) return t; }
    const any = SUITS.filter((s) => s !== S).sort((a, b) => sup(b) - sup(a))[0]!;
    const b = cheap(any); if (b && b.level <= 3) return b;
    return pass;
  }

  // ---------------------------------------------------------------- 3. partner overcalled (I have not bid): advance
  if (pb.length >= 1 && mine.length === 0 && A.find((a) => a.call.t === "bid")!.seat % 2 !== me % 2 && !pDouble) {
    const p = pb[pb.length - 1]!;
    const pl = lb.seat === partner;
    if (p.suit === "N") {                                                                               // partner overcalled 1NT: Stayman-lite
      if (h >= 10 && oppSuit && stopper(hand, oppSuit)) return bidAt(3, "N") ?? pass;
      return pass;
    }
    const fit = sup(p.suit) >= 3;
    const spt = h + (sup(p.suit) >= 4 ? shortPts(cn, p.suit) : Math.min(shortPts(cn, p.suit), 1));
    const stp = oppSuit ? stopper(hand, oppSuit) : true;
    if (fit) {
      if (spt >= 14) { if (isMaj(p.suit)) return bidAt(4, p.suit) ?? pass; if (stp) return bidAt(3, "N") ?? pass; return bidAt(5, p.suit) ?? pass; }
      if (spt >= 11 && lb.level < 3) { const j = bidAt(p.level + 2, p.suit) ?? bidAt(3, p.suit); if (j) return j; }
      if (spt >= 6 + sc && lb.level < 3) { const r = cheap(p.suit); if (r && r.level <= 3) return r; }
      return pass;
    }
    // no fit
    const own = SUITS.filter((s) => s !== p.suit && s !== oppSuit && sup(s) >= 5).sort((a, b) => sup(b) - sup(a))[0];
    if (own && h >= 8) { const b = cheap(own as Strain); if (b && b.level <= 2 + (h >= 12 ? 1 : 0)) return b; }
    if (stp && balancedHand(cn)) { if (h >= 13) return bidAt(3, "N") ?? pass; if (h >= 10) return bidAt(2, "N") ?? pass; if (h >= 8 && lb.level === 1) return bidAt(1, "N") ?? pass; }
    if (h >= 13 && oppSuit) { const cue = cheap(oppSuit as Strain); if (cue && cue.level <= 3) return cue; }
    void pl;
    return pass;
  }

  // ---------------------------------------------------------------- 4. partner opened, the opponents interfered (I have not bid)
  if (pb.length >= 1 && mine.length === 0 && A.find((a) => a.call.t === "bid")!.seat === partner) {
    const o = A.find((a) => a.seat === partner && a.call.t === "bid")!.call as Bid;
    const rho = A[A.length - 1]!;                                                                       // the interference is always the last call here (RHO)
    const over = rho.call.t === "bid" ? (rho.call as Bid) : null;
    const isTakeout = rho.call.t === "double";
    if (o.suit === "N") {                                                                               // 1NT/2NT opened, interference: bid game with values, else pass (double = penalties with a good hand)
      if (over && h >= 10 && oppSuit && stopper(hand, oppSuit)) return bidAt(3, "N") ?? pass;
      if (over && over.level <= 2 && h >= 9) { const best = SUITS.slice().sort((a, b) => sup(b) - sup(a))[0]!; if (sup(best) >= 5 && isMaj(best)) { const b = bidAt(over.level === 2 ? 3 : 2, best); if (b) return b; } }
      return pass;
    }
    if (o.level >= 2) {                                                                                 // preempt / weak two / strong two opened: simple raise to game with a fit and values
      if (isMaj(o.suit) && sup(o.suit) >= 3 && h >= 14) return bidAt(4, o.suit) ?? pass;
      return pass;
    }
    const spt = h + (sup(o.suit) >= 4 ? shortPts(cn, o.suit) : sup(o.suit) === 3 ? Math.min(shortPts(cn, o.suit), 1) : 0);
    const needSupport = isMaj(o.suit) ? 3 : 4;
    const fit = sup(o.suit) >= needSupport;
    const free = (s: Strain) => cheap(s);
    if (isTakeout) {
      if (fit && spt >= 13) return bidAt(4, o.suit) && isMaj(o.suit) ? bidAt(4, o.suit)! : bidAt(3, o.suit) ?? pass;
      if (fit && spt >= 10) return bidAt(3, o.suit) ?? pass;                                              // limit (or preemptive 4-card) raise
      if (fit && spt >= 6) return bidAt(2, o.suit) ?? pass;
      if (fit && sup(o.suit) >= 5 && h < 6) return bidAt(3, o.suit) ?? pass;                              // preemptive jump raise
      if (h >= 10 && rdbl) return rdbl;
      const nu = SUITS.filter((s) => s !== o.suit && sup(s) >= 4).sort((a, b) => sup(b) - sup(a))[0];
      if (nu && h >= 6) { const b = free(nu as Strain); if (b && (b.level === 1 || h >= 10)) return b; }
      if (h >= 6 && h <= 9 && balancedHand(cn)) return bidAt(1, "N") ?? pass;
      return pass;
    }
    if (over) {
      const S2 = over.suit; const L2 = over.level;
      const stp = S2 === "N" ? true : stopper(hand, S2);
      const unbidMajors = (["H", "S"] as Strain[]).filter((s) => s !== o.suit && s !== S2);
      // strong raises first
      if (fit) {
        if (spt >= 13) { if (isMaj(o.suit)) return bidAt(4, o.suit) ?? pass; return stp ? bidAt(3, "N") ?? pass : bidAt(4, o.suit) ?? bidAt(5, o.suit) ?? pass; }
        if (spt >= 10 && L2 <= 2) { const b = bidAt(3, o.suit); if (b) return b; }
        if (spt >= 6 && over.level <= 2) { const r = cheap(o.suit); if (r && r.level <= 3 && (r.level <= 2 || spt >= 8)) return r; }
      }
      // negative double
      if (dbl && L2 <= 2 && h >= (L2 === 1 ? 6 : 8)) {
        const maj = unbidMajors.filter((s) => sup(s) >= 4);
        if (maj.length) return dbl;
        const minors = (["C", "D"] as Strain[]).filter((s) => s !== o.suit && s !== S2);
        if (minors.length === 2 && minors.every((s) => sup(s) >= 4) && !fit) return dbl;
        if (!isMaj(o.suit) && maj.length === 0 && sup(o.suit) <= 2 && h >= 8 && minors.length === 1 && sup(minors[0]!) >= 4 && unbidMajors.length === 2) return dbl;   // 4-4 unknown: show it
      }
      // natural new suit
      const nu = SUITS.filter((s) => s !== o.suit && s !== S2 && sup(s) >= 5).sort((a, b) => sup(b) - sup(a))[0];
      if (nu) { const b = free(nu as Strain); if (b && ((b.level === 1 && h >= 6) || (b.level === 2 && h >= 10) || (b.level === 3 && h >= 13))) return b; }
      // notrump
      if (stp && balancedHand(cn) && !fit) { if (h >= 13) return bidAt(3, "N") ?? pass; if (h >= 11) return bidAt(2, "N") ?? pass; if (h >= 7 && L2 === 1) return bidAt(1, "N") ?? pass; }
      if (h >= 12 && !fit) { const nu2 = SUITS.filter((s) => s !== o.suit && s !== S2 && sup(s) >= 4).sort((a, b) => sup(b) - sup(a))[0]; if (nu2) { const b = free(nu2 as Strain); if (b && b.level <= 3) return b; } }
      return pass;
    }
    return null;
  }

  // ---------------------------------------------------------------- 5. I have bid already: compete, judge and bid game (law of total tricks)
  // what partner has shown: first bid defines the main suit
  const myFirst = mine[0], pFirst = pb[0];
  const tried: { s: Strain; len: number }[] = [];
  for (const m of mine) if (m.suit !== "N") tried.push({ s: m.suit, len: m === myFirst ? 5 : 4 });
  void tried;
  let fitSuit: Strain | null = null, fitTotal = 0;
  for (const s of SUITS) {
    let pl = 0;
    for (const p of pb) { if (p.suit === s) pl = Math.max(pl, p === pFirst ? (pb.length >= 1 && A.find((a) => a.call.t === "bid")!.seat === partner ? 5 : 4) : 4); }
    for (const m of mine) if (m.suit === s) { for (const p of pb) if (p.suit === s && p !== pFirst) pl = Math.max(pl, 3); }
    // partner raised my suit: assume 3-4 cards
    if (mine.some((m) => m.suit === s) && pb.some((p) => p.suit === s)) pl = Math.max(pl, 3);
    if (pl >= 3 && sup(s) + pl >= 8) { if (sup(s) + pl > fitTotal || (sup(s) + pl === fitTotal && isMaj(s))) { fitSuit = s; fitTotal = sup(s) + pl; } }
  }
  const pRange = partnerPoints(v, A);
  const pm = (pRange[0] + pRange[1]) / 2;
  const T = h + (fitSuit ? shortPts(cn, fitSuit) * 0.7 : 0) + pm;
  const isFinalLevelOK = (lvl: number) => lvl <= 5;
  const gameBid = (): Call | null => {
    if (fitSuit && isMaj(fitSuit)) return bidAt(4, fitSuit);
    if (fitSuit && fitTotal >= 10 && T >= 29) return bidAt(5, fitSuit);
    return null;
  };
  // responding to partner's forcing calls
  if (lb.seat === partner && lastCall && lastCall.call.t === "double" && !myDouble) {                  // partner's (negative/support) double after my opening and their overcall
    const S = oppSuit; const maj = (["S", "H"] as Strain[]).filter((s) => s !== S && sup(s) >= 4 && !mine.some((m) => m.suit === s) );
    if (maj.length) { const m = maj.sort((a, b) => sup(b) - sup(a))[0]!; const b = cheap(m); if (b) { if (h >= 17 && b.level <= 3) return bidAt(b.level + 1, m) ?? b; if (h >= 15) return b; return b; } }
    if (myFirst && sup(myFirst.suit) >= 6) { const b = cheap(myFirst.suit); if (b && b.level <= 3) return b; }
    if (balancedHand(cn) && S && stopper(hand, S)) return (h >= 18 ? bidAt(2, "N") : bidAt(1, "N")) ?? pass;
    const own = SUITS.filter((s) => mine.some((m) => m.suit === s)).sort((a, b) => sup(b) - sup(a))[0];
    if (own) { const b = cheap(own as Strain); if (b && b.level <= 2) return b; }
    return pass;
  }
  if (lb.seat === partner && lastCall && lastCall.seat === partner) {                                   // partner made the last bid: respond naturally, never push beyond our values
    if (fitSuit && T >= (isMaj(fitSuit) ? 25 : 28)) { const g = gameBid(); if (g && lb.level < 4) return g; }
    if (!fitSuit && balancedHand(cn) && T >= 26 && oppSuit && stopper(hand, oppSuit) && lb.level < 3) return bidAt(3, "N") ?? pass;
    // partner's forcing cue-bid (a bid in the opponents' suit): show a stopper or the trump suit
    if (oppSuit && lb.suit === oppSuit && mine.length) { if (stopper(hand, oppSuit) && balancedHand(cn)) return bidAt(3, "N") ?? pass; const f = SUITS.slice().sort((a, b) => sup(b) - sup(a))[0]!; const b = cheap(f); if (b && b.level <= 4) return b; }
    return pass;
  }
  // the opponents have just acted over our side
  if (lb.seat % 2 !== me % 2) {
    if (fitSuit) {
      const target = Math.min(5, fitTotal - 6 + (T >= 24 ? 0 : 0));
      const raise = cheap(fitSuit);
      if (T >= 26 && isMaj(fitSuit) && lb.level <= 3) { const g = bidAt(4, fitSuit); if (g) return g; }
      if (raise && raise.level <= target && isFinalLevelOK(raise.level) && (T >= 17 + raise.level * 1.5 || raise.level <= 2)) {
        if (!balancing || raise.level <= 3) return raise;
      }
      // they are too high: double when we hold defence
      if (dbl && lb.level >= target + 1 && lb.level >= 3 && h >= 11 && oppSuit && sup(oppSuit) >= 3 && T <= 22) return dbl;
      return pass;
    }
    // no fit: balanced hands can bid NT with a stopper
    if (balancedHand(cn) && T >= 25 && oppSuit && stopper(hand, oppSuit) && lb.level <= 2) return bidAt(3, "N") ?? pass;
    const own = myFirst && sup(myFirst.suit) >= 6 ? myFirst.suit : null;
    if (own && lb.level <= 2 && h >= 11) { const b = cheap(own); if (b && b.level <= 3) return b; }
    if (dbl && lb.level >= 3 && h >= 12 && oppSuit && sup(oppSuit) >= 4) return dbl;
    return pass;
  }
  return null;
}

/** Rough HCP range partner has shown with their calls so far. */
function partnerPoints(v: View, A: View["auction"]): [number, number] {
  const partner = ((v.you as number) + 2) % 4;
  const firstBidIdx = A.findIndex((a) => a.call.t === "bid");
  let lo = 0, hi = 9;
  const mine = A.filter((a) => a.seat === partner);
  const bids = mine.filter((a) => a.call.t === "bid");
  if (!bids.length) return [0, A.some((a) => a.seat === partner && a.call.t === "double") ? 20 : 9];
  const f = bids[0]!.call as Bid; const opened = A.indexOf(bids[0]!) === firstBidIdx;
  if (opened) {
    if (f.suit === "N" && f.level === 1) { lo = 15; hi = 17; }
    else if (f.suit === "N" && f.level === 2) { lo = 20; hi = 21; }
    else if (f.level >= 2) { lo = 5; hi = 10; }
    else { lo = 12; hi = 16; }
  } else if (A.slice(0, A.indexOf(bids[0]!)).some((a) => a.call.t === "bid" && a.seat % 2 === partner % 2)) { lo = 6; hi = 10; } // a response
  else { lo = 8; hi = 15; }                                                                                   // an overcall
  if (bids.length >= 2) { lo += 2; hi += 2; }
  return [lo, hi];
}
