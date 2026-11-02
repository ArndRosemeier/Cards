import { makeDeck, rankOf, suitOf, SKAT_RANKS, type Card, type GameRules, type Rng, type Seat, type TrickEv } from "@cards/engine";

/** Bavarian suits on the French deck: C=Eichel, S=Gras, H=Herz, D=Schellen. Ober = Q, Unter = J. */
export type Mode = "sauC" | "sauS" | "sauD" | "wenz" | "soloC" | "soloS" | "soloH" | "soloD" | "ramsch";
export interface SchafConfig { rounds: number }
export const defaultConfig: SchafConfig = { rounds: 12 };

export interface SchafState {
  hands: Card[][]; start: Card[][]; phase: "choose" | "play" | "over"; dealer: Seat; round: number; rounds: number; scores: number[];
  offers: (Mode | "pass" | null)[]; best: { seat: Seat; mode: Mode } | null;
  mode: Mode | null; declarer: Seat | null; partner: Seat | null; aceSeen: boolean;
  trick: { seat: Seat; card: Card }[]; turn: Seat; taken: Card[][]; tricksWon: number[];
}
export type Move = { t: "pass" } | { t: "game"; mode: Mode } | { t: "play"; card: Card };
export type Ev = TrickEv;
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: { seat: Seat; card: Card }[];
  turn: Seat | null; scores: number[]; over: boolean;
  phase: SchafState["phase"]; mode: Mode | null; declarer: Seat | null; role: "declarer" | "partner" | "opponent" | null; partnerKnown: Seat | null;
  round: number; rounds: number; dealer: Seat; offers: (Mode | "pass" | null)[];
}

const N = 4;
const POINTS: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 };
export const cardPoints = (c: Card) => POINTS[rankOf(c)]!;
const sum = (cs: Card[]) => cs.reduce((a, c) => a + cardPoints(c), 0);
const SUIT_RANK = ["C", "S", "H", "D"];

const trumpSuit = (m: Mode): string | null => (m === "wenz" ? null : m === "ramsch" || m.startsWith("sau") ? "H" : m.slice(4));
export function isTrump(c: Card, m: Mode): boolean {
  const r = rankOf(c);
  if (m === "wenz") return r === "J";
  return r === "Q" || r === "J" || suitOf(c) === trumpSuit(m);
}
const TSIDE = ["A", "T", "K", "9", "8", "7"], WSIDE = ["A", "T", "K", "Q", "9", "8", "7"];
export function strength(c: Card, m: Mode): number {
  const r = rankOf(c), su = suitOf(c);
  if (isTrump(c, m)) {
    if (m !== "wenz" && r === "Q") return 200 + (3 - SUIT_RANK.indexOf(su));
    if (r === "J") return 150 + (3 - SUIT_RANK.indexOf(su));
    return 100 + (10 - TSIDE.indexOf(r));
  }
  return 20 - (m === "wenz" ? WSIDE : TSIDE).indexOf(r);
}
const group = (c: Card, m: Mode) => (isTrump(c, m) ? "T" : suitOf(c));
const priority = (m: Mode) => (m.startsWith("solo") ? 3 : m === "wenz" ? 2 : 1);

export function legalPlays(s: SchafState, seat: Seat): Card[] {
  const hand = s.hands[seat]!, m = s.mode!;
  if (!s.trick.length) return hand;
  const led = group(s.trick[0]!.card, m);
  const follow = hand.filter((c) => group(c, m) === led);
  if (!follow.length) return hand;
  if (m.startsWith("sau") && led === m.slice(3)) {                  // the called suit is led: the ace-holder must play it
    const ace = (m.slice(3) + "A") as Card;
    if (follow.includes(ace)) return [ace];
  }
  return follow;
}
function winnerOf(trick: { seat: Seat; card: Card }[], m: Mode): Seat {
  let best = trick[0]!;
  for (const p of trick.slice(1)) {
    const a = group(p.card, m), b = group(best.card, m);
    if (a === b ? strength(p.card, m) > strength(best.card, m) : a === "T") best = p;
  }
  return best.seat;
}

function deal(s: SchafState, rng: Rng, events: Ev[]) {
  const deck = rng.shuffle(makeDeck(SKAT_RANKS));
  s.hands = Array.from({ length: N }, (_, i) => deck.slice(i * 8, i * 8 + 8));
  s.start = s.hands.map((h) => h.slice());
  s.taken = [[], [], [], []]; s.tricksWon = [0, 0, 0, 0]; s.trick = [];
  s.phase = "choose"; s.offers = Array(N).fill(null); s.best = null; s.mode = null; s.declarer = null; s.partner = null; s.aceSeen = false;
  s.turn = (s.dealer + 1) % N;
  events.push({ t: "newRound" });
  for (let i = 0; i < N; i++) events.push({ t: "dealt", seat: i, count: 8 });
}

export function availableGames(hand: Card[]): Mode[] {
  const out: Mode[] = [];
  for (const su of ["C", "S", "D"]) {
    const has = hand.some((c) => suitOf(c) === su && !isTrump(c, "sauC") && rankOf(c) !== "A");
    if (has && !hand.includes((su + "A") as Card)) out.push(("sau" + su) as Mode);
  }
  out.push("wenz", "soloC", "soloS", "soloH", "soloD");
  return out;
}

export const Schafkopf: GameRules<SchafConfig, SchafState, Move, View, Ev> = {
  id: "schafkopf", minSeats: 4, maxSeats: 4,

  setup(config, _s, rng) {
    const s = { hands: [], start: [], phase: "choose", dealer: 0, round: 0, rounds: config.rounds, scores: [0, 0, 0, 0], offers: [], best: null, mode: null,
      declarer: null, partner: null, aceSeen: false, trick: [], turn: 0, taken: [], tricksWon: [] } as SchafState;
    const events: Ev[] = []; deal(s, rng, events);
    return { state: s, events };
  },
  activeSeats: (s) => (s.phase === "over" ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.phase === "over" || seat !== s.turn) return [];
    if (s.phase === "choose") {
      const out: Move[] = [{ t: "pass" }];
      for (const m of availableGames(s.hands[seat]!)) if (!s.best || priority(m) > priority(s.best.mode)) out.push({ t: "game", mode: m });
      return out;
    }
    return legalPlays(s, seat).map((card): Move => ({ t: "play", card }));
  },

  apply(prev, seat, move, rng) {
    const s: SchafState = structuredClone(prev);
    const events: Ev[] = [];
    if (!Schafkopf.legalMoves(prev, seat).some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    if (move.t === "pass" || move.t === "game") {
      if (move.t === "game") { s.best = { seat, mode: move.mode }; s.offers[seat] = move.mode; events.push({ t: "say", seat, key: "sk_" + move.mode }); }
      else { s.offers[seat] = "pass"; events.push({ t: "say", seat, key: "sk_pass" }); }
      if (s.offers.every((o) => o !== null)) {
        s.phase = "play"; s.turn = (s.dealer + 1) % N;
        if (s.best) {
          s.mode = s.best.mode; s.declarer = s.best.seat;
          if (s.mode.startsWith("sau")) s.partner = s.start.findIndex((h) => h.includes((s.mode!.slice(3) + "A") as Card));
        } else { s.mode = "ramsch"; events.push({ t: "say", seat: null, key: "sk_ramsch" }); }
      } else s.turn = (seat + 1) % N;
      return { state: s, events };
    }

    const m = s.mode!;
    const hand = s.hands[seat]!; hand.splice(hand.indexOf(move.card), 1);
    s.trick.push({ seat, card: move.card });
    events.push({ t: "played", seat, card: move.card });
    if (m.startsWith("sau") && move.card === ((m.slice(3) + "A") as Card) && !s.aceSeen) { s.aceSeen = true; events.push({ t: "say", seat, key: "sk_partner" }); }
    if (s.trick.length < N) { s.turn = (seat + 1) % N; return { state: s, events }; }
    const w = winnerOf(s.trick, m);
    s.taken[w]!.push(...s.trick.map((p) => p.card)); s.tricksWon[w]!++;
    events.push({ t: "trickDone", winner: w });
    s.trick = []; s.turn = w;
    if (s.hands[0]!.length === 0) {
      score(s, events);
      s.round++;
      if (s.round >= s.rounds) s.phase = "over"; else { s.dealer = (s.dealer + 1) % N; deal(s, rng, events); }
    }
    return { state: s, events };
  },

  view(s, seat) {
    const me = seat === "public" ? null : seat;
    let role: View["role"] = null;
    if (s.phase === "play" && me !== null && s.declarer !== null) role = me === s.declarer ? "declarer" : me === s.partner ? "partner" : s.mode!.startsWith("sau") && !(s.aceSeen && false) ? "opponent" : "opponent";
    return {
      you: seat, hand: me === null ? [] : s.hands[me]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0, trick: s.trick.slice(),
      turn: s.phase === "over" ? null : s.turn, scores: s.scores.slice(), over: s.phase === "over", phase: s.phase, mode: s.mode, declarer: s.declarer, role,
      partnerKnown: s.aceSeen ? s.partner : null, round: s.round, rounds: s.rounds, dealer: s.dealer, offers: s.offers.slice(),
    };
  },
  result(s) {
    if (s.phase !== "over") return null;
    const max = Math.max(...s.scores);
    return { winners: s.scores.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0), scores: s.scores };
  },
};

function score(s: SchafState, events: Ev[]) {
  const m = s.mode!;
  if (m === "ramsch") {
    const pts = s.taken.map(sum); const worst = Math.max(...pts);
    const losers = pts.map((p, i) => (p === worst ? i : -1)).filter((i) => i >= 0);
    const through = s.tricksWon.findIndex((n) => n === 8);
    if (through >= 0) { for (let i = 0; i < N; i++) s.scores[i]! += i === through ? 9 : -3; events.push({ t: "say", seat: through, key: "sk_durchmarsch" }); return; }
    const L = losers.length;
    for (let i = 0; i < N; i++) s.scores[i]! += L === N ? 0 : losers.includes(i) ? -3 : (3 * L) / (N - L);
    events.push({ t: "say", seat: pts.indexOf(worst), key: "sk_ramschLoser", vars: { pts: worst } });
    return;
  }
  const d = s.declarer!;
  const team = new Set<Seat>([d]); if (m.startsWith("sau") && s.partner !== null) team.add(s.partner);
  const tp = sum([...team].flatMap((i) => s.taken[i]!)), op = 120 - tp;
  const won = tp >= 61;
  const loserPts = won ? op : tp;
  const loserTricks = won ? [0, 1, 2, 3].filter((i) => !team.has(i)).reduce((a, i) => a + s.tricksWon[i]!, 0) : [...team].reduce((a, i) => a + s.tricksWon[i]!, 0);
  let v = m.startsWith("sau") ? 2 : 5;
  if (loserPts <= 30) v++; if (loserTricks === 0) v++;
  // laufende: consecutive top trumps held by one team from the start
  const order: Card[] = m === "wenz" ? ["CJ", "SJ", "HJ", "DJ"] : ["CQ", "SQ", "HQ", "DQ", "CJ", "SJ", "HJ", "DJ"];
  const heldBy = (c: Card) => s.start.findIndex((h) => h.includes(c));
  const first = heldBy(order[0]!); const firstTeam = team.has(first);
  let run = 0; for (const c of order) { if (team.has(heldBy(c)) === firstTeam) run++; else break; }
  if (run >= (m === "wenz" ? 2 : 3)) v += run;
  for (let i = 0; i < N; i++) {
    const inTeam = team.has(i); let dlt = (inTeam === won) ? v : -v;
    if (!m.startsWith("sau") && i === d) dlt *= 3;
    s.scores[i]! += dlt;
  }
  events.push({ t: "say", seat: d, key: won ? "sk_won" : "sk_lost", vars: { n: v, pts: tp } });
}
