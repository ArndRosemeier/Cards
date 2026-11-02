import { makeDeck, rankOf, suitOf, type Card, type GameRules, type Rng, type Seat, type TrickEv } from "@cards/engine";

/** n = normal, hochzeit, soloD/H/S/C = suit solos, soloQ = Damensolo, soloJ = Bubensolo */
export type Mode = "normal" | "hochzeit" | "soloD" | "soloH" | "soloS" | "soloC" | "soloQ" | "soloJ";
export interface DokoConfig { rounds: number }
export const defaultConfig: DokoConfig = { rounds: 12 };

export interface DokoState {
  hands: Card[][]; phase: "reserve" | "play" | "over"; dealer: Seat; round: number; rounds: number; scores: number[];
  reservations: (Mode | "ok" | null)[]; mode: Mode; soloist: Seat | null; holder: Seat | null; partner: Seat | null; solo: boolean;
  re: Seat[];               // Re party (known to nobody but the cards; resolved at deal / first tricks)
  announced: { re: boolean; kontra: boolean };
  trick: { seat: Seat; card: Card }[]; turn: Seat; taken: Card[][]; trickNo: number;
  extras: { karlchen: number[]; doppel: number[] }; // credited per seat
  fuchsLog: [Seat, Seat][]; // [owner of a played club... diamond ace, trick winner]
  lastWinners: Seat[];
  seenQ: Seat[];            // seats that have shown a club queen
}
export type Move = { t: "reserve"; mode: Mode | "ok" } | { t: "announce" } | { t: "play"; card: Card };
export type Ev = TrickEv;
export interface View {
  you: Seat | "public"; hand: Card[]; handSizes: number[]; talon: number; trick: { seat: Seat; card: Card }[];
  turn: Seat | null; scores: number[]; over: boolean;
  phase: DokoState["phase"]; mode: Mode; soloist: Seat | null; team: "re" | "kontra" | null; seenQ: Seat[];
  announced: { re: boolean; kontra: boolean }; canAnnounce: boolean; round: number; rounds: number; dealer: Seat; reserved: (Mode | "ok" | null)[];
  /** card points of the viewer's side as far as they can know it; opp is null while the sides are not fully known */
  teamPts: { mine: number; opp: number | null; complete: boolean } | null;
}

const N = 4;
const POINTS: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, "9": 0 };
export const cardPoints = (c: Card) => POINTS[rankOf(c)]!;
const sum = (cs: Card[]) => cs.reduce((a, c) => a + cardPoints(c), 0);
const SUITS = ["D", "H", "S", "C"]; // ordering for Q/J: clubs highest
const QJ_ORDER = ["C", "S", "H", "D"];

const strip = (c: Card) => c.slice(0, 2);
export function isTrump(c: Card, mode: Mode): boolean {
  const r = rankOf(c), su = suitOf(c);
  if (mode === "soloQ") return r === "Q";
  if (mode === "soloJ") return r === "J";
  const trumpSuit = mode === "soloH" ? "H" : mode === "soloS" ? "S" : mode === "soloC" ? "C" : "D";
  if (r === "Q" || r === "J") return true;
  if (strip(c) === "HT") return true;                    // Dulle
  return su === trumpSuit;
}
const SIDE_ORDER = ["A", "T", "K", "9"];
const SIDE_ORDER_Q = ["A", "T", "K", "J", "9"], SIDE_ORDER_J = ["A", "T", "K", "Q", "9"];

/** Strength within trump (>=100) or within the suit. Equal cards tie; the caller resolves by play order. */
export function strength(c: Card, mode: Mode): number {
  const r = rankOf(c), su = suitOf(c), id = strip(c);
  if (isTrump(c, mode)) {
    if (mode === "soloQ" || mode === "soloJ") return 100 + (3 - QJ_ORDER.indexOf(su));
    if (id === "HT") return 200;
    if (r === "Q") return 150 + (3 - QJ_ORDER.indexOf(su));
    if (r === "J") return 130 + (3 - QJ_ORDER.indexOf(su));
    return 100 + (3 - SIDE_ORDER.indexOf(r));            // trump-suit A,T,K,9
  }
  const ord = mode === "soloQ" ? SIDE_ORDER_Q : mode === "soloJ" ? SIDE_ORDER_J : SIDE_ORDER;
  return 20 - ord.indexOf(r);
}
const group = (c: Card, mode: Mode) => (isTrump(c, mode) ? "T" : suitOf(c));
const effMode = (m: Mode): Mode => (m === "normal" || m === "hochzeit" ? "soloD" : m);

export function legalPlays(s: DokoState, seat: Seat): Card[] {
  const hand = s.hands[seat]!;
  if (!s.trick.length) return hand;
  const m = effMode(s.mode), led = group(s.trick[0]!.card, m);
  const f = hand.filter((c) => group(c, m) === led);
  return f.length ? f : hand;
}
function winnerOf(trick: { seat: Seat; card: Card }[], m: Mode): Seat {
  let best = trick[0]!;
  for (const p of trick.slice(1)) {
    const g = group(p.card, m), bg = group(best.card, m);
    if (g === bg) {
      const a = strength(p.card, m), b = strength(best.card, m);
      if (a > b || (a === b && strip(p.card) === "HT" && (m !== "soloQ" && m !== "soloJ"))) best = p;   // second Dulle wins; otherwise first of equals wins
    } else if (g === "T") best = p;
  }
  return best.seat;
}

function deal(s: DokoState, rng: Rng, events: Ev[]) {
  const deck = rng.shuffle(makeDeck(["9", "T", "J", "Q", "K", "A"], 2));
  s.hands = Array.from({ length: N }, (_, i) => deck.slice(i * 12, i * 12 + 12));
  s.taken = Array.from({ length: N }, () => []); s.trick = []; s.trickNo = 0;
  s.mode = "normal"; s.soloist = null; s.holder = null; s.partner = null; s.solo = false;
  s.re = s.hands.map((h, i) => (h.some((c) => strip(c) === "CQ") ? i : -1)).filter((i) => i >= 0);
  s.announced = { re: false, kontra: false };
  s.extras = { karlchen: [0, 0, 0, 0], doppel: [0, 0, 0, 0] }; s.fuchsLog = []; s.seenQ = []; s.lastWinners = [];
  s.reservations = Array(N).fill(null); s.phase = "reserve"; s.turn = (s.dealer + 1) % N;
  events.push({ t: "newRound" });
  for (let i = 0; i < N; i++) events.push({ t: "dealt", seat: i, count: 12 });
}

function resolveReservations(s: DokoState, events: Ev[]) {
  const order = [0, 1, 2, 3].map((i) => (s.dealer + 1 + i) % N);
  const solo = order.find((i) => (s.reservations[i] as string)?.startsWith("solo"));
  const hoch = order.find((i) => s.reservations[i] === "hochzeit");
  s.phase = "play"; s.turn = (s.dealer + 1) % N;
  if (solo !== undefined) {
    s.mode = s.reservations[solo] as Mode; s.soloist = solo; s.solo = true; s.re = [solo];
    events.push({ t: "say", seat: solo, key: "dk_" + s.mode });
  } else if (hoch !== undefined) {
    s.mode = "hochzeit"; s.holder = hoch; s.re = [hoch];
    events.push({ t: "say", seat: hoch, key: "dk_hochzeit" });
  }
}

export const Doppelkopf: GameRules<DokoConfig, DokoState, Move, View, Ev> = {
  id: "doppelkopf", minSeats: 4, maxSeats: 4,

  setup(config, _s, rng) {
    const s = { hands: [], phase: "reserve", dealer: 0, round: 0, rounds: config.rounds, scores: [0, 0, 0, 0], reservations: [], mode: "normal", soloist: null,
      holder: null, partner: null, solo: false, re: [], announced: { re: false, kontra: false }, trick: [], turn: 0, taken: [], trickNo: 0,
      extras: { karlchen: [], doppel: [] }, fuchsLog: [], lastWinners: [], seenQ: [] } as DokoState;
    const events: Ev[] = []; deal(s, rng, events);
    return { state: s, events };
  },

  activeSeats(s) { return s.phase === "over" ? [] : [s.turn]; },

  legalMoves(s, seat) {
    if (s.phase === "over" || seat !== s.turn) return [];
    const out: Move[] = [];
    if (s.phase === "reserve") {
      out.push({ t: "reserve", mode: "ok" });
      if (s.hands[seat]!.filter((c) => strip(c) === "CQ").length === 2) out.push({ t: "reserve", mode: "hochzeit" });
      for (const m of ["soloC", "soloS", "soloH", "soloD", "soloQ", "soloJ"] as Mode[]) out.push({ t: "reserve", mode: m });
      return out;
    }
    if (canAnnounce(s, seat)) out.push({ t: "announce" });
    for (const card of legalPlays(s, seat)) out.push({ t: "play", card });
    return out;
  },

  apply(prev, seat, move, rng) {
    const s: DokoState = structuredClone(prev);
    const events: Ev[] = [];
    if (!Doppelkopf.legalMoves(prev, seat).some((m) => JSON.stringify(m) === JSON.stringify(move))) throw new Error("illegal move");

    if (move.t === "reserve") {
      s.reservations[seat] = move.mode;
      if (move.mode !== "ok") events.push({ t: "say", seat, key: "dk_reserve" });
      else events.push({ t: "say", seat, key: "dk_healthy" });
      if (s.reservations.every((r) => r !== null)) resolveReservations(s, events); else s.turn = (seat + 1) % N;
      return { state: s, events };
    }
    if (move.t === "announce") {
      const team = teamOf(s, seat);
      if (team === "re") s.announced.re = true; else s.announced.kontra = true;
      events.push({ t: "say", seat, key: team === "re" ? "dk_re" : "dk_kontra" });
      return { state: s, events };
    }
    const m = effMode(s.mode);
    const hand = s.hands[seat]!; hand.splice(hand.indexOf(move.card), 1);
    s.trick.push({ seat, card: move.card });
    events.push({ t: "played", seat, card: move.card });
    if (strip(move.card) === "CQ" && !s.seenQ.includes(seat)) s.seenQ.push(seat);
    if (s.trick.length < N) { s.turn = (seat + 1) % N; return { state: s, events }; }

    const w = winnerOf(s.trick, m);
    const pts = sum(s.trick.map((p) => p.card));
    const normal = s.mode === "normal" || s.mode === "hochzeit";
    const last = s.hands[0]!.length === 0;
    if (normal) {
      for (const p of s.trick) if (strip(p.card) === "DA") s.fuchsLog.push([p.seat, w]);
      if (last && s.trick.some((p) => p.seat === w && strip(p.card) === "CJ")) s.extras.karlchen[w]!++;
    }
    if (pts >= 40) s.extras.doppel[w]!++;
    s.taken[w]!.push(...s.trick.map((p) => p.card));
    events.push({ t: "trickDone", winner: w });
    // Hochzeit: the first foreign trick winner (within three tricks) becomes the partner
    if (s.mode === "hochzeit" && s.partner === null && !s.solo) {
      if (w !== s.holder) { s.partner = w; s.re = [s.holder!, w]; events.push({ t: "say", seat: w, key: "dk_partner" }); }
      else if (s.trickNo === 2) { s.solo = true; events.push({ t: "say", seat: w, key: "dk_forcedSolo" }); }
    }
    s.trick = []; s.turn = w; s.trickNo++;
    if (last) {
      scoreRound(s, w, events);
      s.round++;
      if (s.round >= s.rounds) s.phase = "over";
      else { s.dealer = (s.dealer + 1) % N; deal(s, rng, events); }
    }
    return { state: s, events };
  },

  view(s, seat) {
    return {
      you: seat, hand: seat === "public" ? [] : s.hands[seat]!.slice(), handSizes: s.hands.map((h) => h.length), talon: 0, trick: s.trick.slice(),
      turn: s.phase === "over" ? null : s.turn, scores: s.scores.slice(), over: s.phase === "over", phase: s.phase, mode: s.mode, soloist: s.soloist,
      team: seat === "public" || s.phase === "reserve" ? null : teamOf(s, seat), seenQ: s.seenQ.slice(), announced: { ...s.announced },
      teamPts: seat === "public" || s.phase !== "play" ? null : teamPoints(s, seat),
      canAnnounce: seat !== "public" && canAnnounce(s, seat), round: s.round, rounds: s.rounds, dealer: s.dealer, reserved: s.reservations.slice(),
    };
  },

  result(s) {
    if (s.phase !== "over") return null;
    const max = Math.max(...s.scores);
    return { winners: s.scores.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0), scores: s.scores };
  },
};

/** What a player can know about the card points of the two sides: only revealed Re members count. */
function teamPoints(s: DokoState, seat: Seat): { mine: number; opp: number | null; complete: boolean } {
  const knownRe = s.mode === "normal" ? [...new Set([...s.seenQ, ...(s.re.includes(seat) ? [seat] : [])])] : s.re.slice();
  const complete = knownRe.length === s.re.length && (s.mode !== "hochzeit" || s.partner !== null || s.solo);
  const all = [0, 1, 2, 3], reSet = new Set(knownRe);
  const reP = sum(knownRe.flatMap((i) => s.taken[i]!)), restP = sum(all.filter((i) => !reSet.has(i)).flatMap((i) => s.taken[i]!));
  if (teamOf(s, seat) === "re") return { mine: reP, opp: complete ? restP : null, complete };
  return complete ? { mine: restP, opp: reP, complete } : { mine: sum(s.taken[seat]!), opp: null, complete };
}
function teamOf(s: DokoState, seat: Seat): "re" | "kontra" {
  if (s.phase === "play" && (s.mode === "hochzeit" || s.solo || s.mode.startsWith("solo"))) return s.re.includes(seat) ? "re" : "kontra";
  return s.hands[seat]!.some((c) => strip(c) === "CQ") || s.re.includes(seat) ? "re" : "kontra";
}
/** Re/Kontra may be announced until the player plays their second card (>= 11 cards left) and only once per team. */
function canAnnounce(s: DokoState, seat: Seat): boolean {
  if (s.phase !== "play" || s.hands[seat]!.length < 11) return false;
  const team = teamOf(s, seat);
  return team === "re" ? !s.announced.re : !s.announced.kontra;
}

function scoreRound(s: DokoState, lastWinner: Seat, events: Ev[]) {
  void lastWinner;
  const re = new Set(s.re);
  const rePts = sum([...re].flatMap((i) => s.taken[i]!)), kPts = 240 - rePts;
  const reWins = rePts >= 121;
  const normal = s.mode === "normal" || s.mode === "hochzeit";
  const kontraTricks = [0, 1, 2, 3].filter((i) => !re.has(i)).reduce((a, i) => a + s.taken[i]!.length, 0);
  const reTricks = [...re].reduce((a, i) => a + s.taken[i]!.length, 0);
  let v = 1; // won
  const loserPts = reWins ? kPts : rePts;
  if (!reWins && !s.solo && normal && re.size === 2) v += 1; // against the old
  if (loserPts < 90) v++; if (loserPts < 60) v++; if (loserPts < 30) v++; if (loserPts === 0 || (reWins ? kontraTricks === 0 : reTricks === 0)) v++;
  if (s.announced.re) v += 2; if (s.announced.kontra) v += 2;
  // extras per team
  const teamOfSeat = (i: number) => (re.has(i) ? 1 : 0);
  let extra = 0; // from Re's point of view
  for (let i = 0; i < N; i++) {
    const sign = teamOfSeat(i) ? 1 : -1;
    extra += sign * (s.extras.doppel[i]! + s.extras.karlchen[i]!);
  }
  for (const [owner, catcher] of s.fuchsLog) if (teamOfSeat(owner) !== teamOfSeat(catcher)) extra += teamOfSeat(catcher) ? 1 : -1;
  s.fuchsLog = [];
  const reValue = (reWins ? v : -v) + extra;   // game value from Re's side
  for (let i = 0; i < N; i++) {
    let d = teamOfSeat(i) ? reValue : -reValue;
    if (s.solo && re.size === 1 && i === [...re][0]) d *= 3;
    s.scores[i]! += d;
  }
  events.push({ t: "say", seat: null, key: reWins ? "dk_reWon" : "dk_kontraWon", vars: { n: Math.abs(reValue), re: rePts } });
}
