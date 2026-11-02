import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { score5, bestScore, categoryOf, HAND_NAMES } from "../src/eval.ts";
import { Holdem, defaultConfig } from "../src/rules.ts";
import { holdemBot } from "../src/bot.ts";

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
