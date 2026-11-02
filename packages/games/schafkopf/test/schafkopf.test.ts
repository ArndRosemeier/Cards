import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { Schafkopf, strength, isTrump } from "../src/rules.ts";
import { schafkopfBot } from "../src/bot.ts";

test("games finish with legal moves and zero-sum scores", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = Rng.fromSeed(seed);
    let { state } = Schafkopf.setup({ rounds: 3 }, 4, rng);
    for (let i = 0; i < 20000 && !Schafkopf.result(state); i++) {
      const seat = Schafkopf.activeSeats(state)[0]!;
      const legal = Schafkopf.legalMoves(state, seat);
      assert.ok(legal.length, "moves exist");
      const m = seed % 2 ? schafkopfBot.choose(Schafkopf.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
      assert.ok(legal.some((x) => JSON.stringify(x) === JSON.stringify(m)));
      state = Schafkopf.apply(state, seat, m, rng).state;
      assert.ok(Math.abs(state.scores.reduce((a, b) => a + b, 0)) < 1e-9, "zero-sum");
    }
    assert.ok(Schafkopf.result(state), `seed ${seed}`);
  }
});
test("trump order", () => {
  const s = (c: string) => strength(c as Card, "sauC");
  assert.ok(s("CQ") > s("DQ") && s("DQ") > s("CJ") && s("DJ") > s("HA") && s("HA") > s("H7"));
  assert.ok(isTrump("H9" as Card, "sauC") && !isTrump("CA" as Card, "sauC") && !isTrump("HQ" as Card, "wenz") && isTrump("DJ" as Card, "wenz"));
});
