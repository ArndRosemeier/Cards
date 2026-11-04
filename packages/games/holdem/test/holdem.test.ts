import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { score5, bestScore, categoryOf, HAND_NAMES } from "../src/eval.ts";
import { Holdem, defaultConfig } from "../src/rules.ts";
import { holdemBot, createHoldemBot, equityVsRanges, PERSONAS } from "../src/bot.ts";
import { BANTER, banterLine } from "../src/banter.ts";

const H = (s: string) => s.split(" ") as Card[];
const cat = (s: string) => HAND_NAMES[categoryOf(score5(H(s)))];

test("5-card categories", () => {
  assert.equal(cat("SA SK SQ SJ ST"), "straightFlush");
  assert.equal(cat("S9 H9 D9 C9 SA"), "quads");
  assert.equal(cat("S9 H9 D9 C5 S5"), "fullHouse");
  assert.equal(cat("S2 S7 S9 SJ SK"), "flush");
  assert.equal(cat("SA H2 D3 C4 S5"), "straight");     // wheel
  assert.equal(cat("S9 H9 D9 C5 S4"), "trips");
  assert.equal(cat("S9 H9 D5 C5 S4"), "twoPair");
  assert.equal(cat("S9 H9 D6 C5 S4"), "pair");
  assert.equal(cat("S9 H8 D6 C5 S3"), "highCard");
});
test("ordering and kickers", () => {
  assert.ok(score5(H("SA HA D5 C4 S2")) > score5(H("SK HK D5 C4 S2")));
  assert.ok(score5(H("SA HA D5 C4 S3")) > score5(H("SA HA D5 C4 S2")));
  assert.ok(score5(H("S6 H5 D4 C3 S2")) > score5(H("SA H2 D3 C4 S5")));   // six-high straight beats wheel
  assert.ok(bestScore(H("SA SK SQ SJ ST H2 D3")) === score5(H("SA SK SQ SJ ST")));
});

function play(seed: number, seats: number, useBot: boolean) {
  const rng = Rng.fromSeed(seed);
  let { state } = Holdem.setup({ ...defaultConfig, handsPerLevel: 3 }, seats, rng);
  const total = seats * defaultConfig.stack;
  for (let i = 0; i < 20000 && !Holdem.result(state); i++) {
    const seat = Holdem.activeSeats(state)[0]!;
    const legal = Holdem.legalMoves(state, seat);
    assert.ok(legal.length, "moves exist");
    const m = useBot ? holdemBot.choose(Holdem.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
    state = Holdem.apply(state, seat, m, rng).state;
    assert.equal(state.stacks.reduce((a, b) => a + b, 0) + state.total.reduce((a, b) => a + b, 0), total, "chips conserved");
  }
  return Holdem.result(state);
}
test("random games finish and conserve chips", () => {
  for (let seed = 1; seed <= 30; seed++) assert.ok(play(seed, 2 + (seed % 5), false), `seed ${seed}`);
});
test("bot games finish", () => {
  for (let seed = 1; seed <= 6; seed++) assert.ok(play(seed, 4, true), `seed ${seed}`);
});

test("a decided hand waits for seat 0 to press next", () => {
  const rng = new Rng(11);
  let { state } = Holdem.setup(defaultConfig, 3, rng);
  // everybody folds to the big blind
  let guard = 0;
  while (state.phase !== "between" && guard++ < 20) {
    const seat = Holdem.activeSeats(state)[0]!;
    const legal = Holdem.legalMoves(state, seat);
    state = Holdem.apply(state, seat, legal.find((m) => m.t === "fold") ?? legal[0]!, rng).state;
  }
  assert.equal(state.phase, "between");
  assert.deepEqual(Holdem.activeSeats(state), [0]);
  assert.deepEqual(Holdem.legalMoves(state, 0), [{ t: "next" }]);
  assert.deepEqual(Holdem.legalMoves(state, 1), []);
  assert.throws(() => Holdem.apply(state, 0, { t: "check" }, rng));
  const before = state.handNo;
  const r = Holdem.apply(state, 0, { t: "next" }, rng);
  assert.equal(r.state.handNo, before + 1);
  assert.ok(r.events.some((e) => e.t === "newHand"));
  assert.notEqual(r.state.phase, "between");
});

test("equity against a tight range is lower than against random hands", () => {
  const rng = Rng.fromSeed(5);
  const hole = H("SJ HJ");
  const vsRandom = equityVsRanges(hole, [], [1], rng, 600), vsTight = equityVsRanges(hole, [], [8], rng, 600);
  assert.ok(vsRandom > vsTight + 0.08, `${vsRandom} vs ${vsTight}`);
});

test("the bot shoves aces with a short stack and folds trash to a big raise", () => {
  const rng = Rng.fromSeed(9);
  const base = Holdem.setup(defaultConfig, 3, rng).state;
  const mk = (hole: Card[], stack: number) => {
    const s = structuredClone(base); const seat = s.turn;
    s.hole[seat] = hole; s.stacks[seat] = stack; return { s, seat };
  };
  const a = mk(H("SA HA"), 150);
  const mv = createHoldemBot().choose(Holdem.view(a.s, a.seat), Holdem.legalMoves(a.s, a.seat), rng);
  assert.equal(mv.t, "raise");
  assert.equal((mv as { to: number }).to, Holdem.view(a.s, a.seat).maxRaiseTo, "all-in");
});

test("every quirk persona plays a full game with legal moves and keeps chips", () => {
  for (const [k, persona] of PERSONAS.entries()) {
    const rng = Rng.fromSeed(300 + k);
    let { state } = Holdem.setup({ ...defaultConfig, handsPerLevel: 3 }, 4, rng);
    const bots = [createHoldemBot(persona), createHoldemBot(), createHoldemBot(persona), createHoldemBot()];
    const total = 4 * defaultConfig.stack;
    for (let i = 0; i < 20000 && !Holdem.result(state); i++) {
      const seat = Holdem.activeSeats(state)[0]!;
      const legal = Holdem.legalMoves(state, seat);
      const m = bots[seat]!.choose(Holdem.view(state, seat), legal, rng);
      assert.ok(legal.some((l) => JSON.stringify(l) === JSON.stringify(m)), `${persona.id}: illegal move ${JSON.stringify(m)}`);
      state = Holdem.apply(state, seat, m, rng).state;
      assert.equal(state.stacks.reduce((a, b) => a + b, 0) + state.total.reduce((a, b) => a + b, 0), total, "chips conserved");
    }
    assert.ok(Holdem.result(state), `${persona.id} game finishes`);
  }
});

test("table talk: pools match in both languages, bots speak now and then with known lines, never twice in a row", () => {
  for (const [k, p] of Object.entries(BANTER)) assert.equal(p.de.length, p.en.length, `${k} de/en lengths`);
  let decisions = 0; const said: string[] = [];
  for (const [k, persona] of [...PERSONAS, undefined].entries()) {
    const rng = Rng.fromSeed(900 + k);
    let { state } = Holdem.setup({ ...defaultConfig, handsPerLevel: 3 }, 4, rng);
    const bots = [0, 1, 2, 3].map(() => createHoldemBot(persona));
    for (let i = 0; i < 20000 && !Holdem.result(state); i++) {
      const seat = Holdem.activeSeats(state)[0]!, legal = Holdem.legalMoves(state, seat);
      const m = bots[seat]!.choose(Holdem.view(state, seat), legal, rng); decisions++;
      const q = bots[seat]!.say(); if (q) { said.push(q); assert.ok(banterLine(q, "de") && banterLine(q, "en"), `unknown line ${q}`); assert.equal(bots[seat]!.say(), null, "say() is consumed"); }
      state = Holdem.apply(state, seat, m, rng).state;
    }
  }
  const rate = said.length / decisions;
  assert.ok(rate > 0.01 && rate < 0.2, `talk rate ${rate.toFixed(3)} (${said.length}/${decisions})`);
  assert.ok(new Set(said).size > 25, `variety: ${new Set(said).size} different lines`);
});
