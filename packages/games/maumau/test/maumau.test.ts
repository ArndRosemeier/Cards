import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "@cards/engine";
import { MauMau, defaultConfig } from "../src/rules.ts";

function playRandom(seed: number, seats: number) {
  const rng = Rng.fromSeed(seed);
  let { state } = MauMau.setup(defaultConfig, seats, rng);
  for (let i = 0; i < 5000 && MauMau.result(state) === null; i++) {
    const seat = MauMau.activeSeats(state)[0]!;
    const moves = MauMau.legalMoves(state, seat);
    assert.ok(moves.length > 0, "active seat always has a legal move");
    state = MauMau.apply(state, seat, moves[rng.int(moves.length)]!, rng).state;
    // conservation: 32 cards always
    const total = state.hands.flat().length + state.draw.length + state.discard.length;
    assert.equal(total, 32);
  }
  return MauMau.result(state);
}

test("random games always finish with a winner and conserve cards", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = playRandom(seed, 2 + (seed % 4));
    assert.ok(r, `seed ${seed} did not finish`);
    assert.equal(r.winners.length, 1);
  }
});

test("games are reproducible from the seed", () => {
  const a = MauMau.setup(defaultConfig, 3, Rng.fromSeed(42)).state;
  const b = MauMau.setup(defaultConfig, 3, Rng.fromSeed(42)).state;
  assert.deepEqual(a, b);
});

test("views hide other hands", () => {
  const { state } = MauMau.setup(defaultConfig, 3, Rng.fromSeed(7));
  const v = MauMau.view(state, 1);
  assert.equal(v.hand.length, 5);
  assert.deepEqual(MauMau.view(state, "public").hand, []);
});
