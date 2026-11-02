import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { Canasta, checkMelds, checkPile, combine, deckOf, defaultConfig, type CanastaState } from "../src/rules.ts";
import { canastaBot } from "../src/bot.ts";

const C = (s: string) => (s ? s.split(" ") : []) as Card[];

test("deck has 108 unique cards", () => { const d = deckOf(); assert.equal(d.length, 108); assert.equal(new Set(d).size, 108); });
test("meld validation", () => {
  assert.ok(combine([], C("H7 S7 D7")));
  assert.ok(combine([], C("H7 S7 X1")));              // 2 naturals + wild
  assert.equal(combine([], C("H7 X1 S2")), null);     // wilds >= naturals
  assert.equal(combine([], C("H7 S8 D7")), null);
  assert.equal(combine([], C("H3 S3 D3")), null);     // threes never meld
  assert.equal(combine(C("H7 S7 D7 C7 H7' S7' D7'"), C("X1")), null); // no wild into a finished canasta
  assert.ok(combine(C("H7 S7 D7 C7 H7' S7' D7'"), C("C7'")));
});
function mk(over: Partial<CanastaState>): CanastaState {
  const { state } = Canasta.setup(defaultConfig, 2, Rng.fromSeed(1));
  return { ...state, ...over };
}
test("pile: frozen pile needs a natural pair, unfrozen allows a wild", () => {
  const base = mk({ hands: [C("HA SA X1 HK"), C("C4 D5 D6 D7")], discard: [C("CA")[0]!], stock: C("D2 D2' D4"), turn: 0, phase: "draw", melds: [[], []], reds: [[], []], frozen: false });
  const ok = Canasta.apply(base, 0, { t: "pile", cards: C("HA SA"), extra: [] }, Rng.fromSeed(2)).state;
  assert.equal(ok.melds[0]![0]!.cards.length, 3);
  assert.throws(() => Canasta.apply(base, 0, { t: "pile", cards: C("HA X1"), extra: [] }, Rng.fromSeed(2))); // side has not opened: frozen for it
  const opened = { ...base, melds: [[{ rank: "K" as const, cards: C("SK DK CK") }], []] };
  const w = Canasta.apply(opened, 0, { t: "pile", cards: C("HA X1"), extra: [] }, Rng.fromSeed(2)).state;
  assert.equal(w.melds[0]!.length, 2);
  assert.throws(() => Canasta.apply({ ...opened, frozen: true }, 0, { t: "pile", cards: C("HA X1"), extra: [] }, Rng.fromSeed(2)));
});
test("opening minimum and going out need a canasta", () => {
  const st = mk({ hands: [C("H5 S5 D5 HK C4"), C("C4 D5 D6 D7 D8")], discard: C("C8"), turn: 0, phase: "play", melds: [[], []], reds: [[], []], scores: [0, 0] });
  assert.throws(() => Canasta.apply(st, 0, { t: "meld", groups: [{ to: null, cards: C("H5 S5 D5") }] }, Rng.fromSeed(2)), /opening/);
  const out = mk({ hands: [C("H5"), C("C4 D5")], discard: C("C8"), turn: 0, phase: "play", melds: [[{ rank: "K", cards: C("SK DK CK") }], []], reds: [[], []] });
  assert.throws(() => Canasta.apply(out, 0, { t: "discard", card: "H5" as Card }, Rng.fromSeed(2)), /canasta/);
});
test("scoring a round", () => {
  const meld = (rank: "K", n: number) => ({ rank, cards: Array.from({ length: n }, (_, i) => `S${rank}${"'".repeat(i)}` as Card) });
  const st = mk({ hands: [C("H5"), C("C4 D5")], discard: C("C8"), turn: 0, phase: "play", stock: C("D4 D6"), melds: [[meld("K", 7)], [{ rank: "K", cards: C("SK DK CK") }]], reds: [[ "H3" as Card, "D3" as Card ], []], target: 99999 });
  const r = Canasta.apply(st, 0, { t: "discard", card: "H5" as Card }, Rng.fromSeed(3)).state;
  assert.equal(r.lastRound[0], 70 + 500 + 200 + 200);      // 7 kings, natural canasta, 2 red threes, going out (closed at start of turn: 200)
});
test("bot games finish and keep 108 cards", () => {
  for (let seed = 1; seed <= 9; seed++) {
    const rng = Rng.fromSeed(seed), n = 2 + (seed % 3);
    let { state } = Canasta.setup({ target: 1500 }, n, rng);
    for (let i = 0; i < 9000 && !Canasta.result(state); i++) {
      const seat = Canasta.activeSeats(state)[0]!;
      const legal = Canasta.legalMoves(state, seat);
      assert.ok(legal.length, `seed ${seed}: no legal moves (${state.phase})`);
      const m = canastaBot.choose(Canasta.view(state, seat), legal, rng);
      const view = Canasta.view(state, seat);
      if (m.t === "meld") assert.equal(checkMelds(view, m.groups), null);
      if (m.t === "pile") assert.equal(checkPile(view, m.cards, m.extra), null);
      state = Canasta.apply(state, seat, m, rng).state;
      const total = state.hands.flat().length + state.stock.length + state.discard.length + state.melds.flat().reduce((a, x) => a + x.cards.length, 0) + state.reds.flat().length;
      assert.equal(total, 108);
    }
    assert.ok(Canasta.result(state), `seed ${seed} did not finish`);
  }
});
