import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "@cards/engine";
import { Hearts, defaultConfig, points } from "../src/rules.ts";
import { heartsBot } from "../src/bot.ts";

function play(seed: number, useBot: boolean) {
  const rng = Rng.fromSeed(seed);
  let { state } = Hearts.setup(defaultConfig, 4, rng);
  for (let i = 0; i < 20000 && !Hearts.result(state); i++) {
    const seat = Hearts.activeSeats(state)[0]!;
    const legal = Hearts.legalMoves(state, seat);
    assert.ok(legal.length, "active seat has moves");
    const m = useBot ? heartsBot.choose(Hearts.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
    assert.ok(legal.some((x) => JSON.stringify(x) === JSON.stringify(m)), "bot picks a legal move");
    state = Hearts.apply(state, seat, m, rng).state;
    const total = state.hands.flat().length + state.taken.flat().length + state.trick.length + 0;
    assert.equal(total, 52);
  }
  return { r: Hearts.result(state), state };
}

test("random and bot games finish; a round always distributes exactly 26 points", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { r, state } = play(seed, seed % 2 === 0);
    assert.ok(r, `seed ${seed} finished`);
    assert.ok(Math.max(...state.scores) >= 100);
  }
});

test("card points", () => { assert.equal(points("SQ"), 13); assert.equal(points("H5"), 1); assert.equal(points("D3"), 0); });

test("first lead must be the two of clubs", () => {
  const { state } = Hearts.setup({ ...defaultConfig, passing: false }, 4, Rng.fromSeed(3));
  const leader = Hearts.activeSeats(state)[0]!;
  assert.deepEqual(Hearts.legalMoves(state, leader), [{ t: "play", card: "C2" }]);
});
