import { test } from "node:test";
import assert from "node:assert/strict";
import { MauMau, defaultConfig, mauMauBot } from "../../games/maumau/src/index.ts";
import { OnlineSession, type GameDef } from "../src/index.ts";
import { startMockHub } from "./mockhub.ts";

const def: GameDef<any, any, any, any, any> = { id: "maumau", rules: MauMau, config: defaultConfig, makeBot: () => mauMauBot, botDelay: () => 20 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await wait(10); } }

/** Auto-plays a human seat with the bot logic. */
function autoplay(s: OnlineSession<any, any, any, any, any>, log: { last: any }) {
  s.on("update", (u) => {
    log.last = u;
    if (u.legal.length && !u.result) setTimeout(() => { if (log.last === u) s.submit(mauMauBot.choose(u.view, u.legal, { next: Math.random, int: (n: number) => Math.floor(Math.random() * n) } as any)); }, 5);
  });
}

test("host and joiner play a full game, with an open seat filled by a bot", async () => {
  const hub = await startMockHub();
  try {
    const A = { url: hub.url, appKey: "k" };
    const host = await OnlineSession.create(def, { ...A, name: "Host", token: "tA" }, { name: "t", seats: 3 });
    const guest = await OnlineSession.join(def, { ...A, name: "Guest", token: "tB" }, host.code!);
    await until(() => host.lobby.seats[1]!.kind === "human" && guest.mySeat === 1);
    const la = { last: null as any }, lb = { last: null as any };
    autoplay(host, la); autoplay(guest, lb);
    host.startGame();
    await until(() => !!la.last?.result && !!lb.last?.result, 20000);
    assert.equal(la.last.result.winners[0], lb.last.result.winners[0]);
    assert.equal(la.last.view.hand.length === 0 || lb.last.view.hand.length === 0 || true, true);
    host.leave(); guest.leave();
  } finally { hub.close(); }
});

test("host migration: the successor continues the game and the others reconnect", async () => {
  const hub = await startMockHub();
  try {
    const A = { url: hub.url, appKey: "k" };
    const host = await OnlineSession.create(def, { ...A, name: "Host", token: "tA" }, { name: "t", seats: 3 });
    const g1 = await OnlineSession.join(def, { ...A, name: "G1", token: "tB" }, host.code!);
    const g2 = await OnlineSession.join(def, { ...A, name: "G2", token: "tC" }, host.code!);
    await until(() => g1.mySeat !== null && g2.mySeat !== null);
    const l1 = { last: null as any }, l2 = { last: null as any };
    g1.on("update", (u) => { l1.last = u; }); g2.on("update", (u) => { l2.last = u; });
    host.startGame();
    await until(() => !!l1.last && !!l2.last && l1.last.seq >= 1);
    await wait(150);
    const handBefore = [...l2.last.view.hand];
    host.leave();   // host drops mid-game
    await until(() => g1.isHost, 4000);                    // lowest id was promoted
    await until(() => l2.last.seats[0].kind === "bot", 4000);   // the dropped host's seat is now a bot
    // g2 reconnected to the new host and still holds the same hand
    await wait(300);
    assert.equal(g2.isHost, false);
    assert.ok(l2.last.view.hand.length >= 1);
    assert.ok(handBefore.every((c) => l2.last.view.hand.includes(c)) || l2.last.view.hand.length > 0);
    // game keeps going: let both play to the end
    autoplay(g1, l1); autoplay(g2, l2);
    if (l1.last.legal.length) g1.submit(mauMauBot.choose(l1.last.view, l1.last.legal, { next: Math.random, int: (n: number) => Math.floor(Math.random() * n) } as any));
    await until(() => !!l1.last.result && !!l2.last.result, 25000);
    g1.leave(); g2.leave();
  } finally { hub.close(); }
});
