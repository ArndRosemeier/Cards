import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { parseMeld } from "../src/melds.ts";
import { Romme, defaultConfig, deckOf } from "../src/rules.ts";
import { rommeBot, bestPlan } from "../src/bot.ts";

const C = (s: string) => s.split(" ") as Card[];

test("sets and runs", () => {
  assert.ok(parseMeld(C("H7 S7 D7")));
  assert.ok(parseMeld(C("H7 S7 D7 C7")));
  assert.equal(parseMeld(C("H7 H7' D7")), null);              // two hearts in a set
  assert.ok(parseMeld(C("H5 H6 H7")));
  assert.ok(parseMeld(C("HA H2 H3")));                        // ace low
  assert.ok(parseMeld(C("HQ HK HA")));                        // ace high
  assert.equal(parseMeld(C("HK HA H2")), null);               // no wrap
  assert.ok(parseMeld(C("H5 X1 H7")));                        // joker fills a gap
  assert.equal(parseMeld(C("H5 H6 X1 X2")), null);            // one joker max
  assert.equal(parseMeld(C("H5 H6")), null);
  assert.equal(parseMeld(C("H5 S6 H7")), null);
});
test("meld values", () => {
  assert.equal(parseMeld(C("HQ HK HA"))!.value, 31);
  assert.equal(parseMeld(C("H7 S7 D7"))!.value, 21);
  assert.equal(parseMeld(C("HK SK DK"))!.value, 30);
  assert.equal(parseMeld(C("H5 X1 H7"))!.value, 18);
});
test("deck has 110 unique cards", () => { const d = deckOf(); assert.equal(d.length, 110); assert.equal(new Set(d).size, 110); });
test("planner finds disjoint melds", () => {
  const p = bestPlan(C("H5 H6 H7 S9 D9 C9 HK C2 D4"));
  assert.ok(p.value >= 18 + 27); assert.equal(p.groups.length, 2);
});
test("bot games finish and keep 110 cards", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = Rng.fromSeed(seed);
    let { state } = Romme.setup({ ...defaultConfig, rounds: 2 }, 2 + (seed % 3), rng);
    for (let i = 0; i < 6000 && !Romme.result(state); i++) {
      const seat = Romme.activeSeats(state)[0]!;
      const legal = Romme.legalMoves(state, seat);
      const m = rommeBot.choose(Romme.view(state, seat), legal, rng);
      state = Romme.apply(state, seat, m, rng).state;
      const total = state.hands.flat().length + state.stock.length + state.discard.length + state.melds.reduce((a, x) => a + x.cards.length, 0);
      assert.equal(total, 110);
    }
    assert.ok(Romme.result(state), `seed ${seed} did not finish`);
  }
});

test("joker swap takes the joker out of a table meld", () => {
  const rng = Rng.fromSeed(5);
  const { state } = Romme.setup({ ...defaultConfig, rounds: 1 }, 2, rng);
  const st = structuredClone(state);
  st.phase = "play"; st.turn = 0; st.opened = [true, false]; st.taken = null;
  st.melds = [{ owner: 0, kind: "run", cards: C("H5 X1 H7") }];
  st.hands[0] = C("H6 SK DK");
  assert.throws(() => Romme.apply(st, 0, { t: "swap", meld: 0, card: "SK" as Card }, rng));       // does not fit
  const r = Romme.apply(st, 0, { t: "swap", meld: 0, card: "H6" as Card }, rng).state;
  assert.deepEqual(r.melds[0]!.cards, C("H5 H6 H7"));
  assert.ok(r.hands[0]!.includes("X1" as Card));
  st.opened = [false, false];
  assert.throws(() => Romme.apply(st, 0, { t: "swap", meld: 0, card: "H6" as Card }, rng));       // must have opened
});
