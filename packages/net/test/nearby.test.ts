import { test } from "node:test";
import assert from "node:assert/strict";
import { MauMau, defaultConfig, mauMauBot } from "../../games/maumau/src/index.ts";
import { OnlineSession, LocalRoomServer, createLoopback, connectSocket, type GameDef } from "../src/index.ts";

// Nearby (Wi-Fi) play without a browser: the room server of the host's page, with in-page sockets instead of WebRTC.
const def: GameDef<any, any, any, any, any> = { id: "maumau", rules: MauMau, config: defaultConfig, makeBot: () => mauMauBot, botDelay: () => 20 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await wait(10); } }

test("a nearby table: host and a joiner over the host's own room server play a game", async () => {
  const server = new LocalRoomServer("cards");
  const link = (owner: boolean, name: string) => { const [mine, theirs] = createLoopback(); server.accept(theirs, { owner }); return connectSocket<any, any, any>(mine, { name, fixedRoom: owner ? undefined : server.room?.id }); };
  const host = await OnlineSession.create(def, { hub: link(true, "Host"), name: "Host", token: "tA" }, { name: "t", seats: 3 });
  assert.ok(host.nearby);
  const guestHub = link(false, "Guest");
  await guestHub.ready; await guestHub.join("");
  assert.equal((guestHub.room?.meta as any).game, "maumau");   // the joiner learns the game from the room
  const guest = await OnlineSession.join(def, { hub: guestHub, name: "Guest", token: "tB" }, "");
  await until(() => host.lobby.seats[1]!.kind === "human" && guest.mySeat === 1);
  await until(() => guest.lobby.seats[1]?.kind === "human");   // the joiner got the lobby although it joined before the session existed
  const la = { last: null as any }, lb = { last: null as any };
  for (const [s, log] of [[host, la], [guest, lb]] as const) {
    s.on("update", (u) => { log.last = u; if (u.legal.length && !u.result) setTimeout(() => { if (log.last === u) s.submit(mauMauBot.choose(u.view, u.legal, { next: Math.random, int: (n: number) => Math.floor(Math.random() * n) } as any)); }, 5); });
  }
  host.startGame();
  await until(() => !!la.last?.result && !!lb.last?.result, 20000);
  assert.equal(la.last.result.winners[0], lb.last.result.winners[0]);
  // the host leaves: the nearby game is over for the guest (no migration)
  const err: string[] = []; guest.on("error", (c) => err.push(c));
  host.leave(); server.close();
  await until(() => err.length > 0, 4000);
  assert.equal(err[0], "connection_closed");
  guest.leave();
});
