import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "@cards/engine";
import { TableHost } from "../../../net/src/host.ts";
import { MauMau, defaultConfig } from "../src/rules.ts";
import { mauMauBot } from "../src/bot.ts";

test("bots finish games through the table host", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const queue: (() => void)[] = [];
    const host = new TableHost(MauMau, defaultConfig,
      [{ kind: "bot", name: "A" }, { kind: "bot", name: "B" }, { kind: "bot", name: "C" }], () => mauMauBot,
      { seed, setTimeout: (fn) => { queue.push(fn); return 1; }, botDelay: () => 0 });
    let last: unknown = null;
    host.attach(0, (u) => { last = u; });
    host.start();
    let n = 0;
    while (queue.length && n++ < 5000) { (host as any).timer = null; queue.shift()!(); }
    assert.ok(MauMau.result(host.state), `seed ${seed} finished`);
    assert.ok(last);
  }
});
