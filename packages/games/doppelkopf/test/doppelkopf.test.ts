import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { Doppelkopf, defaultConfig, isTrump, strength, cardPoints } from "../src/rules.ts";
import { dokoBot } from "../src/bot.ts";

function run(seed: number, bots: boolean) {
  const rng = Rng.fromSeed(seed);
  let { state } = Doppelkopf.setup({ rounds: 3 }, 4, rng);
  let zeroSumOk = true;
  for (let i = 0; i < 30000 && !Doppelkopf.result(state); i++) {
    const seat = Doppelkopf.activeSeats(state)[0]!;
    const legal = Doppelkopf.legalMoves(state, seat);
    assert.ok(legal.length, "moves exist");
    const m = bots ? dokoBot.choose(Doppelkopf.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
    assert.ok(legal.some((x) => JSON.stringify(x) === JSON.stringify(m)), "legal bot move");
    state = Doppelkopf.apply(state, seat, m, rng).state;
    if (state.scores.reduce((a, b) => a + b, 0) !== 0) zeroSumOk = false;
  }
  assert.ok(zeroSumOk, "scores are zero-sum");
  return state;
}

test("games finish (random and bot) and scoring is zero-sum", () => {
  for (let seed = 1; seed <= 40; seed++) assert.ok(Doppelkopf.result(run(seed, seed % 2 === 0)), `seed ${seed}`);
});

test("trump order", () => {
  const t = (c: string) => strength(c as Card, "soloD");
  assert.ok(t("HT") > t("CQ") && t("CQ") > t("SQ") && t("SQ") > t("HQ") && t("HQ") > t("DQ") && t("DQ") > t("CJ") && t("CJ") > t("DJ") && t("DJ") > t("DA") && t("DA") > t("DT") && t("DT") > t("DK") && t("DK") > t("D9"));
  assert.ok(isTrump("HT" as Card, "soloD") && !isTrump("HA" as Card, "soloD") && !isTrump("CA" as Card, "soloD"));
  assert.ok(!isTrump("HT" as Card, "soloQ") && isTrump("CQ" as Card, "soloQ") && !isTrump("CJ" as Card, "soloQ"));
});

test("deck carries 240 points with duplicates having unique ids", () => {
  const { state } = Doppelkopf.setup(defaultConfig, 4, Rng.fromSeed(2));
  const all = state.hands.flat();
  assert.equal(all.length, 48); assert.equal(new Set(all).size, 48);
  assert.equal(all.reduce((a, c) => a + cardPoints(c), 0), 240);
});
