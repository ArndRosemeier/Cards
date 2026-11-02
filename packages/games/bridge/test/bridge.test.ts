import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "@cards/engine";
import { Bridge, defaultConfig, scoreContract, type Contract } from "../src/rules.ts";
import { bridgeBot } from "../src/bot.ts";

const K = (level: number, suit: Contract["suit"], doubled: 0 | 1 | 2 = 0): Contract => ({ level, suit, declarer: 0, doubled });
test("scoring", () => {
  assert.equal(scoreContract(K(4, "S"), 10, false), 420);
  assert.equal(scoreContract(K(4, "S"), 10, true), 620);
  assert.equal(scoreContract(K(3, "N"), 9, false), 400);
  assert.equal(scoreContract(K(1, "C"), 7, false), 70);        // 20 + part-score 50
  assert.equal(scoreContract(K(1, "N"), 8, false), 120);       // 40 + 50 + 1 overtrick 30
  assert.equal(scoreContract(K(6, "S"), 12, false), 980);      // 180 + 300 + 500
  assert.equal(scoreContract(K(7, "N"), 13, true), 2220);      // 220 + 500 + 1500
  assert.equal(scoreContract(K(4, "H"), 8, false), -100);
  assert.equal(scoreContract(K(4, "H"), 8, true), -200);
  assert.equal(scoreContract(K(4, "H", 1), 7, false), -100 - 200 - 200);
  assert.equal(scoreContract(K(2, "H", 1), 8, false), 120 + 300 + 50);
});
test("full games with bots finish", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = Rng.fromSeed(seed);
    let { state } = Bridge.setup({ boards: 3 }, 4, rng);
    for (let i = 0; i < 5000 && !Bridge.result(state); i++) {
      const seat = Bridge.activeSeats(state)[0]!;
      const legal = Bridge.legalMoves(state, seat);
      assert.ok(legal.length);
      const m = seed % 2 ? bridgeBot.choose(Bridge.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
      assert.ok(legal.some((x) => JSON.stringify(x) === JSON.stringify(m)), "legal");
      state = Bridge.apply(state, seat, m, rng).state;
    }
    assert.ok(Bridge.result(state), `seed ${seed}`);
    assert.equal(state.scores[0]! + state.scores[1]!, 0);
  }
});
