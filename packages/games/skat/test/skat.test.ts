import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, type Card } from "@cards/engine";
import { Skat, defaultConfig, gameValue, jackMultiplier, strength, BIDS, cardPoints } from "../src/rules.ts";
import { skatBot } from "../src/bot.ts";

function run(seed: number, bots: boolean, cfg = defaultConfig) {
  const rng = Rng.fromSeed(seed);
  let { state } = Skat.setup(cfg, 3, rng);
  for (let i = 0; i < 20000 && !Skat.result(state); i++) {
    const seat = Skat.activeSeats(state)[0]!;
    const legal = Skat.legalMoves(state, seat);
    assert.ok(legal.length, `no moves in phase ${state.phase}`);
    const m = bots ? skatBot.choose(Skat.view(state, seat), legal, rng) : legal[rng.int(legal.length)]!;
    assert.ok(legal.some((x) => JSON.stringify(x) === JSON.stringify(m)), "illegal bot move");
    state = Skat.apply(state, seat, m, rng).state;
    if (state.phase === "play" || state.phase === "bid") {
      const total = state.hands.flat().length + state.talon.length + state.taken.flat().length + state.trick.length;
      assert.equal(total, 32);
    }
  }
  return state;
}

test("random and bot games finish", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const st = run(seed, seed % 2 === 0, { rounds: 3, ramsch: true });
    assert.ok(Skat.result(st), `seed ${seed}`);
  }
});

test("jack multiplier: mit/ohne", () => {
  assert.equal(jackMultiplier(["CJ", "SJ", "H9"] as Card[]), 3);          // mit 2 spielt 3
  assert.equal(jackMultiplier(["HJ", "DJ", "H9"] as Card[]), 3);          // ohne 2 spielt 3
  assert.equal(jackMultiplier(["CJ", "SJ", "HJ", "DJ"] as Card[]), 5);    // mit 4 spielt 5
  assert.equal(jackMultiplier(["SJ"] as Card[]), 2);                      // ohne 1 spielt 2
});

test("game values", () => {
  assert.equal(gameValue("H", ["CJ", "SJ"] as Card[], false, false, false), 30);   // hearts mit 2 spielt 3
  assert.equal(gameValue("G", ["CJ"] as Card[], true, true, false), 24 * 4);       // grand mit 1 hand schneider
  assert.equal(gameValue("N", [], true, false, false), 35);
  assert.ok(BIDS.includes(18) && BIDS.includes(24) && BIDS.includes(46) && !BIDS.includes(19));
});

test("trump order and card points", () => {
  assert.ok(strength("CJ", "H") > strength("SJ", "H") && strength("DJ", "H") > strength("HA", "H"));
  assert.ok(strength("HA", "H") > strength("HT", "H"));
  assert.equal(["CA", "ST", "HK", "DQ", "CJ", "C9"].reduce((a, c) => a + cardPoints(c as Card), 0), 11 + 10 + 4 + 3 + 2);
});

test("a whole 32-card deck carries 120 points", () => {
  const rng = Rng.fromSeed(1);
  const { state } = Skat.setup(defaultConfig, 3, rng);
  const all = [...state.hands.flat(), ...state.talon];
  assert.equal(all.reduce((a, c) => a + cardPoints(c), 0), 120);
});

test("announced Schneider and Schwarz raise the game value and must be made", () => {
  const cards = ["CJ", "SJ", "HA", "HT", "HK", "H7", "H8", "H9", "D7", "D8"] as Card[]; // two jacks with: multiplier 3 as hearts
  const plain = gameValue("H", cards, true, true, false, "none"), ann = gameValue("H", cards, true, true, false, "schneider"), sw = gameValue("H", cards, true, true, true, "schwarz");
  assert.equal(ann - plain, 10);                      // hearts are worth 10 per multiplier step
  assert.equal(sw, 10 * (jackMultiplier(cards) + 1 + 1 + 1 + 1 + 1));  // jacks and game + hand + schneider + schwarz + both announcements
});
test("hand game leads to an announce phase for suit and grand, not for null", () => {
  const rng = Rng.fromSeed(11);
  let { state } = Skat.setup({ rounds: 1, ramsch: false }, 3, rng);
  const st = structuredClone(state); st.phase = "declare"; st.declarer = 0; st.handGame = true; st.turn = 0;
  assert.equal(Skat.apply(st, 0, { t: "game", game: "G" }, rng).state.phase, "announce");
  assert.equal(Skat.apply(st, 0, { t: "game", game: "N" }, rng).state.phase, "play");
  const a = Skat.apply(Skat.apply(st, 0, { t: "game", game: "G" }, rng).state, 0, { t: "announce", level: "schneider" }, rng).state;
  assert.equal(a.phase, "play"); assert.equal(a.announce, "schneider");
});
