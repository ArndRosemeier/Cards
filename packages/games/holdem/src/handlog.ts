import { rankOf, suitOf, type Card } from "@cards/engine";
import type { Ev, View } from "./rules.ts";

/**
 * Hand histories. A HandRecorder watches the updates a client receives (events + view) and turns every finished hand into a
 * HandRecord: a plain JSON object with everything needed to replay or analyse the hand (positions, stacks, pot and price at
 * every decision, board, showdowns, awards). `handToText` renders the PokerStars-style text that tracking tools and poker
 * friends read. A trainer can be built on the JSON alone; `note` on an action carries optional engine analysis (equity, pot odds)
 * for decisions of computer players when the table runs on this device.
 */
export type Street = "preflop" | "flop" | "turn" | "river";
export interface HandAction {
  street: Street; seat: number; action: "fold" | "check" | "call" | "bet" | "raise";
  /** chips put in with this action */ amount: number;
  /** the seat's total bet this street after the action */ to: number;
  allIn?: boolean;
  /** the chips in the pot, and what it cost to stay in, just before the action */ potBefore: number; toCall: number;
  /** the seat's chips behind, just before the action */ stackBefore: number;
  note?: Record<string, unknown>;
}
export interface HandRecord {
  v: 1; game: "holdem"; session: string; id: string; ts: string; hand: number;
  /** where it was played, e.g. "solo" or "online ABC123" (set by the app that stores it) */ table?: string;
  dealer: number; sb: number; bb: number; hero: number;
  seats: { seat: number; name: string; start: number }[];
  /** hole cards that were visible to the recording player: their own, and shown ones at showdown */
  hole: Record<number, Card[]>;
  board: Card[]; actions: HandAction[];
  shows: { seat: number; cards: Card[]; hand: string }[];
  awards: { seat: number; amount: number; hand?: string }[];
  /** total pot as paid in, including any uncalled bet that went back to its owner */ pot: number;
  /** the part of the biggest bet nobody called; it is returned to that seat and is part of that seat's award */
  uncalled?: { seat: number; amount: number };
}
export interface FedUpdate { events: Ev[]; view: View; seats: { name: string }[]; notes?: { seat: number; info: Record<string, unknown> }[] }

export class HandRecorder {
  private cur: (HandRecord & { _bets: number[]; _contrib: number[]; _street: Street; _pot: number }) | null = null;
  private session: string;
  constructor(session: string) { this.session = session; }

  /** Feed one update; returns the hands that finished with it. */
  feed(u: FedUpdate, now: number = Date.now()): HandRecord[] {
    const done: HandRecord[] = [];
    const me = u.view.you as number;
    for (const ev of u.events) {
      if (ev.t === "newHand") {
        const start = u.view.stacks.map((s, i) => s + (u.view.bets[i] ?? 0));          // the update holds the blinds already
        this.cur = {
          v: 1, game: "holdem", session: this.session, id: `${this.session}-${ev.hand}`, ts: new Date(now).toISOString(), hand: ev.hand,
          dealer: ev.dealer, sb: ev.sb, bb: ev.bb, hero: me,
          seats: u.seats.map((s, i) => ({ seat: i, name: s.name, start: start[i]! })).filter((s) => s.start > 0 || !u.view.out[s.seat]),
          hole: {}, board: [], actions: [], shows: [], awards: [], pot: 0,
          _bets: Array(start.length).fill(0), _contrib: Array(start.length).fill(0), _street: "preflop", _pot: 0,
        };
        continue;
      }
      const c = this.cur; if (!c) continue;                                            // joined mid-hand: wait for the next one
      switch (ev.t) {
        case "blind": c._bets[ev.seat]! += ev.amount; c._contrib[ev.seat]! += ev.amount; c._pot += ev.amount; break;
        case "dealHole": if (ev.cards.length && !ev.cards.some((x) => (x as string) === "??")) c.hole[ev.seat] = ev.cards.slice(); break;
        case "act": {
          const top = Math.max(...c._bets), seat = ev.seat, start = c.seats.find((s) => s.seat === seat)?.start ?? 0;
          const toCall = Math.max(0, top - c._bets[seat]!);
          let action: HandAction["action"] = ev.action === "fold" ? "fold" : ev.action === "check" ? "check" : ev.action === "call" ? "call" : top === 0 ? "bet" : "raise";
          if (ev.action === "allin" && ev.amount <= toCall) action = "call";
          const a: HandAction = { street: c._street, seat, action, amount: ev.amount, to: ev.to, potBefore: c._pot, toCall, stackBefore: start - c._contrib[seat]! };
          if (ev.action === "allin") a.allIn = true;
          const note = u.notes?.find((x) => x.seat === seat); if (note) a.note = note.info;
          c.actions.push(a); c._bets[seat] = ev.to; c._contrib[seat]! += ev.amount; c._pot += ev.amount; break;
        }
        case "community": c._street = ev.street; c.board.push(...ev.cards); c._bets = c._bets.map(() => 0); break;
        case "show": c.hole[ev.seat] = ev.cards.slice(); c.shows.push({ seat: ev.seat, cards: ev.cards.slice(), hand: ev.hand }); break;
        case "award": c.awards.push({ seat: ev.seat, amount: ev.amount, ...(ev.hand ? { hand: ev.hand } : {}) }); break;
      }
    }
    if (this.cur && this.cur.awards.length) {
      const { _bets, _contrib, _street, _pot, ...rec } = this.cur; void _bets; void _street;
      const sorted = _contrib.map((x, seat) => ({ seat, x })).sort((a, b) => b.x - a.x), unc = sorted[0] && sorted[1] && sorted[0].x > sorted[1].x ? { seat: sorted[0].seat, amount: sorted[0].x - sorted[1].x } : null;
      done.push({ ...rec, pot: _pot, ...(unc ? { uncalled: unc } : {}) }); this.cur = null;
    }
    return done;
  }
}

// ------------------------------------------------------------------------------------------------ text format

const cardText = (c: Card) => `${rankOf(c)}${suitOf(c).toLowerCase()}`;
const cards = (cs: Card[]) => cs.map(cardText).join(" ");
const HAND_TEXT: Record<string, string> = { highCard: "high card", pair: "a pair", twoPair: "two pair", trips: "three of a kind", straight: "a straight", flush: "a flush", fullHouse: "a full house", quads: "four of a kind", straightFlush: "a straight flush" };
const STREET_TEXT: Record<Street, string> = { preflop: "before Flop", flop: "on the Flop", turn: "on the Turn", river: "on the River" };
const stamp = (iso: string) => iso.slice(0, 19).replace(/-/g, "/").replace("T", " ") + " UTC";

/** One hand in PokerStars play-money style. Opponents' hole cards appear only where they were shown. */
export function handToText(h: HandRecord, table = "Cards"): string {
  const name = (s: number) => h.seats.find((x) => x.seat === s)?.name ?? `Seat ${s + 1}`;
  const L: string[] = [];
  L.push(`PokerStars Hand #${Math.floor(Date.parse(h.ts) / 1000)}${String(h.hand).padStart(3, "0")}:  Hold'em No Limit (${h.sb}/${h.bb}) - ${stamp(h.ts)}`);
  L.push(`Table '${table}' ${h.seats.length}-max Seat #${h.seats.findIndex((s) => s.seat === h.dealer) + 1} is the button`);
  h.seats.forEach((s, i) => L.push(`Seat ${i + 1}: ${s.name} (${s.start} in chips)`));
  const order = h.seats.map((s) => s.seat), live = order.length, di = order.indexOf(h.dealer);
  const sbSeat = live === 2 ? h.dealer : order[(di + 1) % live]!, bbSeat = order[(order.indexOf(sbSeat) + 1) % live]!;
  L.push(`${name(sbSeat)}: posts small blind ${h.sb}`, `${name(bbSeat)}: posts big blind ${h.bb}`);
  L.push("*** HOLE CARDS ***");
  if (h.hole[h.hero]) L.push(`Dealt to ${name(h.hero)} [${cards(h.hole[h.hero]!)}]`);
  const order5: Street[] = ["preflop", "flop", "turn", "river"], folded: Record<number, Street> = {};
  let street: Street = "preflop";
  const advance = (to: Street) => {                                              // print the street headers up to `to`
    while (order5.indexOf(street) < order5.indexOf(to)) {
      street = order5[order5.indexOf(street) + 1]!; const b = h.board;
      L.push(street === "flop" ? `*** FLOP *** [${cards(b.slice(0, 3))}]` : street === "turn" ? `*** TURN *** [${cards(b.slice(0, 3))}] [${cards(b.slice(3, 4))}]` : `*** RIVER *** [${cards(b.slice(0, 4))}] [${cards(b.slice(4, 5))}]`);
    }
  };
  for (const a of h.actions) {
    advance(a.street);
    const who = name(a.seat), tail = a.allIn ? " and is all-in" : "";
    if (a.action === "fold") { L.push(`${who}: folds`); folded[a.seat] = a.street; }
    else if (a.action === "check") L.push(`${who}: checks`);
    else if (a.action === "call") L.push(`${who}: calls ${a.amount}${tail}`);
    else if (a.action === "bet") L.push(`${who}: bets ${a.amount}${tail}`);
    else L.push(`${who}: raises ${a.amount - a.toCall} to ${a.to}${tail}`);
  }
  advance(h.board.length >= 5 ? "river" : h.board.length === 4 ? "turn" : h.board.length >= 3 ? "flop" : "preflop");   // the board runs out after an all-in
  if (h.shows.length) { L.push("*** SHOW DOWN ***"); for (const s of h.shows) L.push(`${name(s.seat)}: shows [${cards(s.cards)}] (${HAND_TEXT[s.hand] ?? s.hand})`); }
  const unc = h.uncalled, back = (seat: number) => (unc && unc.seat === seat ? unc.amount : 0);
  if (unc) L.push(`Uncalled bet (${unc.amount}) returned to ${name(unc.seat)}`);
  for (const a of h.awards) L.push(`${name(a.seat)} collected ${a.amount - back(a.seat)} from pot`);
  L.push("*** SUMMARY ***", `Total pot ${h.pot - (unc?.amount ?? 0)} | Rake 0`);
  if (h.board.length) L.push(`Board [${cards(h.board)}]`);
  h.seats.forEach((s, i) => {
    const won = h.awards.find((a) => a.seat === s.seat), shown = h.shows.find((x) => x.seat === s.seat);
    const pos = s.seat === h.dealer ? " (button)" : s.seat === sbSeat ? " (small blind)" : s.seat === bbSeat ? " (big blind)" : "";
    const what = folded[s.seat] ? `folded ${STREET_TEXT[folded[s.seat]!]}` : shown ? `showed [${cards(shown.cards)}] and ${won ? `won (${won.amount - back(s.seat)})` : "lost"} with ${HAND_TEXT[shown.hand] ?? shown.hand}` : won ? `collected (${won.amount - back(s.seat)})` : "mucked";
    L.push(`Seat ${i + 1}: ${s.name}${pos} ${what}`);
  });
  return L.join("\n");
}

/** Many hands as one text file (blank lines between hands, as tracking tools expect). */
export const handsToText = (hands: HandRecord[], table = "Cards") => hands.map((h) => handToText(h, table)).join("\n\n\n") + "\n";
