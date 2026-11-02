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

function atAuction(hands: string[][], auction: [number, string][], seat: number) {
  const rng = Rng.fromSeed(1);
  let { state } = Bridge.setup({ boards: 1 }, 4, rng);
  state.hands = hands as any;
  state.dealer = 0;
  state.auction = auction.map(([s, c]) => ({ seat: s, call: c === "P" ? { t: "pass" } : { t: "bid", level: Number(c[0]), suit: c[1] } as any }));
  state.turn = seat;
  const legal = Bridge.legalMoves(state, seat);
  return bridgeBot.choose(Bridge.view(state, seat), legal, rng);
}
const filler = (n: number) => ["CA", "CK", "CQ", "CJ", "CT", "C9", "C8", "C7", "D2"].slice(0, n);
test("conventions: 1NT opening, Stayman, Jacoby transfer", () => {
  const empty = [[], [], [], []] as string[][];
  // 16 balanced points opens 1NT
  const open = ["SA", "SK", "S5", "HK", "HQ", "H4", "H2", "DK", "D7", "D3", "C9", "C5", "C2"];
  const o = atAuction([open, [], [], []].map((h, i) => (i ? [] : h)) as any, [], 0) as any;
  assert.deepEqual([o.t, o.level, o.suit], ["bid", 1, "N"]);
  // responder: 9 hcp with four hearts bids Stayman 2C
  const stay = ["SK", "S5", "S2", "HA", "HJ", "H8", "H4", "DQ", "D5", "D3", "C8", "C3", "C2"];
  const r = atAuction([empty[0]!, empty[1]!, stay, empty[3]!] as any, [[0, "1N"], [1, "P"]], 2) as any;
  assert.deepEqual([r.t, r.level, r.suit], ["bid", 2, "C"]);
  // five spades and a weak hand: Jacoby transfer 2H
  const tr = ["SQ", "SJ", "S9", "S5", "S2", "H8", "H4", "H3", "D5", "D2", "C8", "C3", "C2"];
  const t = atAuction([empty[0]!, empty[1]!, tr, empty[3]!] as any, [[0, "1N"], [1, "P"]], 2) as any;
  assert.deepEqual([t.t, t.level, t.suit], ["bid", 2, "H"]);
  // opener completes the transfer
  const done = atAuction([open, empty[1]!, empty[2]!, empty[3]!] as any, [[0, "1N"], [1, "P"], [2, "2H"], [3, "P"]], 0) as any;
  assert.deepEqual([done.t, done.level, done.suit], ["bid", 2, "S"]);
  void filler;
});
test("weak two opening", () => {
  const hand = ["SA", "SQ", "S9", "S7", "S6", "S3", "H5", "H2", "D8", "D4", "C7", "C3", "C2"];
  const m = atAuction([hand, [], [], []] as any, [], 0) as any;
  assert.deepEqual([m.t, m.level, m.suit], ["bid", 2, "S"]);
});

test("Blackwood: opener answers with the number of aces", () => {
  const opener = ["SA", "SK", "S9", "S7", "S3", "HK", "H5", "D8", "D4", "D2", "C7", "C3", "C2"]; // one ace
  const none = [[], [], [], []] as string[][];
  const r = atAuction([opener, none[1]!, none[2]!, none[3]!] as any, [[0, "1S"], [1, "P"], [2, "4N"], [3, "P"]], 0) as any;
  assert.deepEqual([r.t, r.level, r.suit], ["bid", 5, "D"]);
});
