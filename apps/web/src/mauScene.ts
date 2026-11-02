import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import gsap from "gsap";
import type { Card, Suit } from "@cards/engine";
import { rankOf, suitOf } from "@cards/engine";
import type { Ev, Move, View } from "@cards/maumau";
import type { Update } from "@cards/net";
import { sfx } from "./sfx.ts";
import { CardView, sleep, tween } from "./cardview.ts";
import { CARD_H, CARD_W, tableTexture, suitTexture } from "./cardart.ts";
import { t } from "./i18n.ts";
import { attachAmbience } from "./ambience.ts";
import { cover } from "./geo.ts";

import { LAND, PORT, pickGeo, type Geo } from "./geo.ts";
const DECK = { x: 690, y: 450 }, DISCARD = { x: 910, y: 450 };
const setPiles = (g: Geo) => { const c = g.center; DECK.x = c.x - (g.portrait ? 80 : 110); DISCARD.x = c.x + (g.portrait ? 80 : 110); DECK.y = DISCARD.y = c.y + (g.portrait ? 0 : 10); };
const SUIT_ORDER: Suit[] = ["C", "H", "S", "D"];
const RANK_ORDER = ["7", "8", "9", "T", "J", "Q", "K", "A"];
const sortKey = (c: Card) => SUIT_ORDER.indexOf(suitOf(c)) * 10 + RANK_ORDER.indexOf(rankOf(c));

export interface SceneHooks { submit(move: Move): void; onFinished(winner: number, names: string[], me: number, scores?: number[]): void; }

export class MauScene {
  private world = new Container();
  private bg = new Sprite();
  private tableLayer = new Container();
  private handLayer = new Container();
  private flyLayer = new Container();
  private fxLayer = new Container();
  private geo: Geo = LAND;
  private plates: { holder: Container; box: Graphics; label: Text; count: Text; ring: Graphics }[] = [];
  private deckStack = new Container();
  private deckCount = new Text({ text: "", style: { fill: "#f4efe4", fontSize: 26, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } });
  private wishSprite = new Sprite();
  private discardViews: CardView[] = [];
  private mine = new Map<Card, CardView>();
  private opp: CardView[][] = [];
  private queue: Update<View, Move, Ev>[] = [];
  private running = false;
  private dealt = false;
  private ready = false;
  private legal: Move[] = [];
  private lastView: View | null = null;
  private me = 0;
  private n = 0;
  private names: string[] = [];
  private busy = true;
  private hooks: SceneHooks;
  private ui: HTMLElement;
  private banner = document.createElement("div");
  private passBtn = document.createElement("button");
  private destroyed = false;

  constructor(private app: Application, ui: HTMLElement, hooks: SceneHooks) {
    this.hooks = hooks; this.ui = ui; this.geo = pickGeo(app.screen.width, app.screen.height); setPiles(this.geo);
    app.stage.addChild(this.bg, this.world); attachAmbience(app, this.bg);
    this.world.addChild(this.tableLayer, this.handLayer, this.flyLayer, this.fxLayer);
    this.bg.texture = tableTexture(this.geo.W, this.geo.H);
    this.deckStack.position.set(DECK.x, DECK.y);
    this.deckCount.anchor.set(0.5); this.deckCount.position.set(DECK.x, DECK.y + CARD_H / 2 + 28);
    this.wishSprite.anchor.set(0.5); this.wishSprite.position.set(DISCARD.x + 150, DISCARD.y); this.wishSprite.visible = false; this.wishSprite.scale.set(0.45);
    this.tableLayer.addChild(this.deckStack, this.deckCount, this.wishSprite);
    this.deckStack.eventMode = "static"; this.deckStack.cursor = "pointer";
    this.deckStack.on("pointertap", () => this.tryDraw());
    this.banner.className = "banner"; this.banner.style.display = "none";
    this.passBtn.className = "btn primary"; this.passBtn.style.cssText = "position:absolute;right:24px;bottom:24px;display:none";
    this.passBtn.onclick = () => this.send({ t: "pass" });
    ui.append(this.banner, this.passBtn);
    this.resize();
    window.addEventListener("resize", this.onResize);
  }
  private onResize = () => this.resize();
  resize() {
    const w = this.app.screen.width, h = this.app.screen.height, g = pickGeo(w, h), changed = g !== this.geo;
    this.geo = g; setPiles(g);
    const s = Math.min(w / g.W, h / g.H);
    this.world.scale.set(s); this.world.position.set((w - g.W * s) / 2, (h - g.H * s) / 2);
    cover(this.bg, w, h);
    document.body.classList.toggle("portrait", g.portrait);
    if (g.portrait) document.documentElement.style.setProperty("--actions-bottom", `${Math.round(h - ((h - g.H * s) / 2 + (g.layouts[this.n || 4]![0]!.cy - 150 * g.ownScale) * s) + 8)}px`); else document.documentElement.style.removeProperty("--actions-bottom");
    if (changed && this.ready) this.applyGeo();
  }
  private applyGeo() {
    this.deckStack.position.set(DECK.x, DECK.y); this.deckCount.position.set(DECK.x, DECK.y + CARD_H / 2 + 28); this.wishSprite.position.set(DISCARD.x + 150, DISCARD.y);
    this.discardViews.forEach((cv) => { gsap.killTweensOf(cv); cv.position.set(DISCARD.x, DISCARD.y); });
    this.placePlates(); this.layoutAll(false);
  }
  private placePlates() {
    for (let s = 0; s < this.n; s++) { const rel = (s - this.me + this.n) % this.n, p = this.geo.plate(this.geo.layouts[this.n]![rel]!, rel); this.plates[s]!.holder.position.set(p.x, p.y); }
  }
  hint(cards: Card[]) { for (const c of cards) this.mine.get(c)?.glowFor(7); }
  destroy() {
    document.body.classList.remove("portrait"); document.documentElement.style.removeProperty("--actions-bottom");
    this.destroyed = true;
    window.removeEventListener("resize", this.onResize);
    gsap.killTweensOf("*");
    this.banner.remove(); this.passBtn.remove();
    this.ui.querySelectorAll(".suits,.result").forEach((e) => e.remove());
    this.app.stage.removeChildren();
  }

  receive(u: Update<View, Move, Ev>) { this.queue.push(u); void this.drain(); }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.destroyed) {
      const u = this.queue.shift()!;
      this.busy = true; this.legal = []; this.refreshInteractive();
      try {
        if (!this.ready) { this.ready = true; this.setup(u); this.dealt = !u.events.some((e) => e.t === "dealt"); }
        for (const ev of u.events) await this.animate(ev, u);
      } catch (e) { console.error("animation error", e); }
      this.sync(u);
      if (!this.queue.length) { this.busy = false; this.legal = u.legal; this.refreshInteractive(); }
    }
    this.running = false;
    if (this.lastView && this.lastView.winner !== null && !this.destroyed) this.hooks.onFinished(this.lastView.winner, this.names, this.me, (this.lastView as { scores?: number[] }).scores?.slice());
  }

  private setup(u: Update<View, Move, Ev>) {
    this.me = u.view.you as number; this.n = u.view.handSizes.length;
    this.names = u.seats.map((s) => s.name);
    this.opp = Array.from({ length: this.n }, () => []);
    const stack = Math.max(1, Math.min(4, 4));
    for (let i = 0; i < stack; i++) {
      const c = new CardView(null, false); c.position.set(-i * 1.5, -i * 1.5); this.deckStack.addChild(c);
    }
    for (let s = 0; s < this.n; s++) {
      const box = new Graphics(); const ring = new Graphics();
      const label = new Text({ text: s === this.me ? t("you") : this.names[s]!, style: { fill: "#f4efe4", fontSize: 24, fontWeight: "600", fontFamily: "Segoe UI, sans-serif" } });
      const count = new Text({ text: "", style: { fill: "#e8c66a", fontSize: 22, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } });
      label.anchor.set(0.5); count.anchor.set(0.5);
      const plate = new Container();
      const w = 200, h = 54;
      box.roundRect(-w / 2, -h / 2, w, h, 27).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 1.5, color: 0xe8c66a, alpha: 0.5 });
      ring.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 31).stroke({ width: 3, color: 0xffe08a, alpha: 1 }); ring.alpha = 0;
      label.position.set(-20, 0); count.position.set(w / 2 - 30, 0);
      plate.addChild(ring, box, label, count);
      this.tableLayer.addChild(plate);
      this.plates[s] = { holder: plate, box, label, count, ring };
    }
    this.placePlates();
  }

  private seatAnchor(seat: number) { return this.geo.layouts[this.n]![(seat - this.me + this.n) % this.n]!; }
  private handOf(seat: number): CardView[] {
    if (seat !== this.me) return this.opp[seat]!;
    return [...this.mine.values()].sort((a, b) => sortKey(a.id!) - sortKey(b.id!));
  }

  /** Target slot for card i of n in a fan, in world coordinates. */
  private fanSlot(seat: number, i: number, n: number) {
    const a = this.seatAnchor(seat); const own = seat === this.me;
    const g = this.geo, step = own ? Math.min(g.ownStep + 4, g.ownWidth / Math.max(n, 1)) : Math.min(30, 420 / Math.max(n, 1));
    const tt = i - (n - 1) / 2;
    const lx = tt * step, ly = tt * tt * (own ? 1.1 : 0.5);
    const cos = Math.cos(a.rot), sin = Math.sin(a.rot);
    return { x: a.cx + lx * cos - ly * sin, y: a.cy + lx * sin + ly * cos, rot: a.rot + tt * (own ? 0.035 : 0.03), scale: own ? g.ownScale : 0.56 };
  }

  private layout(seat: number, animate = true, stagger = 0) {
    const hand = this.handOf(seat);
    hand.forEach((cv, i) => {
      cv.slot = this.fanSlot(seat, i, hand.length);
      if (cv.parent !== this.handLayer) this.handLayer.addChild(cv);
      cv.zIndex = i;
      if (animate) gsap.to(cv, { x: cv.slot.x, y: cv.slot.y, rotation: cv.slot.rot, duration: 0.45, delay: i * stagger, ease: "power3.out" });
      else cv.position.set(cv.slot.x, cv.slot.y), cv.rotation = cv.slot.rot;
      gsap.to(cv.scale, { x: cv.slot.scale, y: cv.slot.scale, duration: animate ? 0.45 : 0, ease: "power3.out" });
    });
    this.handLayer.sortableChildren = true;
    const p = this.plates[seat]; if (p) p.count.text = String(hand.length);
  }
  private layoutAll(animate = true) { for (let s = 0; s < this.n; s++) this.layout(s, animate); }

  private makeAtDeck(id: Card | null, faceUp: boolean) {
    const cv = new CardView(id, faceUp); cv.position.set(DECK.x, DECK.y); cv.scale.set(1); this.flyLayer.addChild(cv); return cv;
  }

  private async fly(cv: CardView, to: { x: number; y: number; rot: number; scale: number }, duration = 0.55) {
    this.flyLayer.addChild(cv);
    const mid = { x: (cv.x + to.x) / 2, y: (cv.y + to.y) / 2 - 70 };
    gsap.to(cv, { lift: 1, duration: duration * 0.45, ease: "power2.out" });
    gsap.to(cv, { lift: 0, duration: duration * 0.45, delay: duration * 0.55, ease: "power2.in" });
    gsap.to(cv.scale, { x: to.scale * 1.18, y: to.scale * 1.18, duration: duration * 0.5, ease: "power2.out" });
    gsap.to(cv.scale, { x: to.scale, y: to.scale, duration: duration * 0.5, delay: duration * 0.5, ease: "bounce.out" });
    gsap.to(cv, { rotation: to.rot, duration, ease: "power2.inOut" });
    gsap.to(cv, { x: mid.x, duration: duration / 2, ease: "sine.in" }); // slight S-curve
    await tween(cv, { x: to.x, y: to.y, duration, ease: "power3.inOut" });
    sfx.place();
  }

  private async animate(ev: Ev, u: Update<View, Move, Ev>) {
    switch (ev.t) {
      case "dealt": if (!this.dealt) await this.dealAll(u); break;
      case "started": {
        const cv = this.makeAtDeck(ev.top, false);
        await this.fly(cv, { x: DISCARD.x, y: DISCARD.y, rot: 0.05, scale: 1 }, 0.5);
        await cv.flip(true); this.discardViews.push(cv); break;
      }
      case "played": {
        let cv: CardView;
        if (ev.seat === this.me) cv = this.mine.get(ev.card)!;
        else { const h = this.opp[ev.seat]!; cv = h.splice(Math.floor(h.length / 2), 1)[0]!; cv.reveal(ev.card); }
        if (ev.seat === this.me) this.mine.delete(ev.card);
        this.layout(ev.seat);
        this.flyLayer.addChild(cv);
        const rot = (Math.random() - 0.5) * 0.5;
        const reveal = ev.seat === this.me ? Promise.resolve() : cv.flip(true, 0.35);
        await Promise.all([this.fly(cv, { x: DISCARD.x + (Math.random() - 0.5) * 14, y: DISCARD.y + (Math.random() - 0.5) * 14, rot, scale: 1 }, 0.5), reveal]);
        this.discardViews.push(cv);
        this.impact(DISCARD.x, DISCARD.y);
        if (ev.wish) this.setWish(ev.wish); else if (rankOf(ev.card) !== "J") this.setWish(null);
        if (this.discardViews.length > 6) { const old = this.discardViews.shift()!; gsap.to(old, { alpha: 0, duration: 0.4, onComplete: () => old.destroy() }); }
        break;
      }
      case "drew": {
        for (const c of ev.cards) {
          const own = ev.seat === this.me;
          const cv = this.makeAtDeck(own ? c : null, false);
          if (own) this.mine.set(c, cv); else this.opp[ev.seat]!.push(cv);
          this.layout(ev.seat);
          await Promise.all([this.landed(cv), own ? sleep(180).then(() => cv.flip(true)) : Promise.resolve()]);
          await sleep(90);
        }
        break;
      }
      case "skipped": this.toast(this.names[ev.seat] + " ⏭"); await sleep(500); break;
      case "reshuffled": {
        const olds = this.discardViews.splice(0, this.discardViews.length - 1);
        await Promise.all(olds.map((o, i) => tween(o, { x: DECK.x, y: DECK.y, rotation: 0, duration: 0.5, delay: i * 0.05, alpha: 0, ease: "power2.inOut" })));
        olds.forEach((o) => o.destroy());
        break;
      }
      case "won": await this.celebrate(ev.seat); break;
    }
  }
  private landed(cv: CardView) {
    // after layout() has started tweening, wait for its arrival
    return new Promise<void>((res) => setTimeout(res, 460)).then(() => { this.handLayer.addChild(cv); });
  }

  private async dealAll(u: Update<View, Move, Ev>) {
    this.dealt = true;
    const per = u.view.handSizes[this.me]!; const mineCards = u.view.hand.slice();
    const created: CardView[] = [];
    for (let r = 0; r < per; r++) {
      for (let k = 0; k < this.n; k++) {
        const seat = (this.me + k) % this.n;
        const own = seat === this.me;
        const cv = this.makeAtDeck(own ? mineCards[r]! : null, false);
        if (own) this.mine.set(mineCards[r]!, cv); else this.opp[seat]!.push(cv);
        created.push(cv);
        this.layout(seat);
        this.flyLayer.addChild(cv);
        await sleep(95);
      }
    }
    await sleep(500);
    for (const cv of this.mine.values()) this.handLayer.addChild(cv);
    this.layoutAll();
    await Promise.all([...this.mine.values()].map((cv, i) => sleep(i * 70).then(() => cv.flip(true))));
    this.layoutAll();
    await sleep(250);
  }

  private setWish(s: Suit | null) {
    if (!s) { gsap.to(this.wishSprite, { alpha: 0, duration: 0.2, onComplete: () => { this.wishSprite.visible = false; } }); return; }
    this.wishSprite.texture = suitTexture(s); this.wishSprite.visible = true; this.wishSprite.alpha = 0; this.wishSprite.scale.set(0.1);
    gsap.to(this.wishSprite, { alpha: 1, duration: 0.3 }); gsap.to(this.wishSprite.scale, { x: 0.45, y: 0.45, duration: 0.5, ease: "back.out(2.4)" });
  }

  private impact(x: number, y: number) {
    const ring = new Graphics().circle(0, 0, 60).stroke({ width: 4, color: 0xffffff, alpha: 0.6 });
    ring.position.set(x, y); ring.scale.set(0.6); this.fxLayer.addChild(ring);
    gsap.to(ring.scale, { x: 1.6, y: 1.6, duration: 0.5, ease: "power2.out" });
    gsap.to(ring, { alpha: 0, duration: 0.5, onComplete: () => ring.destroy() });
  }

  private toast(text: string) {
    const tx = new Text({ text, style: { fill: "#ffe08a", fontSize: 54, fontWeight: "800", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 6 } } });
    tx.anchor.set(0.5); tx.position.set(this.geo.center.x, this.geo.center.y - 110); tx.alpha = 0; this.fxLayer.addChild(tx);
    gsap.to(tx, { alpha: 1, y: 300, duration: 0.3 }); gsap.to(tx, { alpha: 0, delay: 0.9, duration: 0.4, onComplete: () => tx.destroy() });
  }

  private async celebrate(winner: number) {
    sfx.win();
    this.toast(winner === this.me ? t("youWin") : t("wins", { n: this.names[winner]! }));
    const colors = [0xffd166, 0xef476f, 0x06d6a0, 0x118ab2, 0xffffff];
    for (let i = 0; i < 140; i++) {
      const p = new Graphics().rect(-5, -3, 10, 6).fill(colors[i % colors.length]!);
      p.position.set(this.geo.center.x + (Math.random() - 0.5) * 300, this.geo.center.y - 60); p.rotation = Math.random() * 6; this.fxLayer.addChild(p);
      const dx = (Math.random() - 0.5) * 1400, up = 200 + Math.random() * 350;
      gsap.to(p, { x: p.x + dx, duration: 2.4, ease: "power1.out" });
      gsap.to(p, { y: p.y - up, duration: 0.7, ease: "power2.out" });
      gsap.to(p, { y: 1000, duration: 1.8, delay: 0.7, ease: "power1.in", onComplete: () => p.destroy() });
      gsap.to(p, { rotation: p.rotation + 14, duration: 2.5 });
    }
    await sleep(1400);
  }

  /** Make the visuals match the authoritative view; heals any drift without animation. */
  private sync(u: Update<View, Move, Ev>) {
    const v = u.view; this.lastView = v;
    const want = new Set(v.hand);
    const same = want.size === this.mine.size && [...want].every((c) => this.mine.has(c));
    if (this.dealt && !same) {
      for (const cv of this.mine.values()) cv.destroy();
      this.mine.clear();
      for (const c of v.hand) { const cv = new CardView(c, true); cv.position.set(DECK.x, DECK.y); this.handLayer.addChild(cv); this.mine.set(c, cv); }
    }
    for (let s = 0; s < this.n; s++) {
      if (s === this.me) continue;
      const list = this.opp[s]!;
      while (list.length > v.handSizes[s]!) list.pop()!.destroy();
      while (list.length < v.handSizes[s]!) { const cv = new CardView(null, false); cv.position.set(DECK.x, DECK.y); this.handLayer.addChild(cv); list.push(cv); }
    }
    if (this.dealt) this.layoutAll();
    const top = this.discardViews[this.discardViews.length - 1];
    if (this.dealt && (!top || top.id !== v.top)) {
      for (const d of this.discardViews) d.destroy();
      const cv = new CardView(v.top, true); cv.position.set(DISCARD.x, DISCARD.y); this.tableLayer.addChild(cv); this.discardViews = [cv];
    }
    this.setWishInstant(v.wish);
    this.deckCount.text = String(v.drawCount);
    this.deckStack.visible = v.drawCount > 0;
    this.deckStack.children.forEach((c, i) => { c.visible = i < Math.max(1, Math.ceil(v.drawCount / 6)); });
    this.plates.forEach((p, s) => { if (p) p.count.text = String(v.handSizes[s]); });
  }
  private setWishInstant(s: Suit | null) {
    if (s) { this.wishSprite.texture = suitTexture(s); this.wishSprite.visible = true; this.wishSprite.alpha = 1; this.wishSprite.scale.set(0.45); }
    else this.wishSprite.visible = false;
  }

  private playableCards(): Set<Card> {
    return new Set(this.legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play").map((m) => m.card));
  }
  private refreshInteractive() {
    const v = this.lastView; if (!v) return;
    const playable = this.busy ? new Set<Card>() : this.playableCards();
    for (const [card, cv] of this.mine) {
      const ok = playable.has(card);
      cv.eventMode = ok ? "static" : "none"; cv.cursor = ok ? "pointer" : "default";
      cv.removeAllListeners();
      if (ok) {
        cv.on("pointerover", () => gsap.to(cv, { y: cv.slot.y - 36, duration: 0.18, ease: "power2.out" }));
        cv.on("pointerout", () => gsap.to(cv, { y: cv.slot.y, duration: 0.18 }));
        cv.on("pointertap", () => this.tryPlay(card));
      }
      gsap.to(cv, { y: ok && this.legalTurn() ? cv.slot.y - 14 : cv.slot.y, duration: 0.25 });
      (cv as any).alpha = 1;
    }
    this.deckStack.eventMode = !this.busy && this.legal.some((m) => m.t === "draw") ? "static" : "none";
    this.passBtn.style.display = !this.busy && this.legal.some((m) => m.t === "pass") ? "block" : "none";
    this.passBtn.textContent = v.pendingSkip ? t("pass") : t("pass");
    for (let s = 0; s < this.n; s++) gsap.to(this.plates[s]!.ring, { alpha: v.winner === null && v.turn === s ? 1 : 0, duration: 0.25 });
    if (v.winner !== null) { this.banner.style.display = "none"; return; }
    let msg = "";
    if (v.turn === this.me) msg = v.pendingDraw > 0 ? t("mustDraw", { n: v.pendingDraw }) : v.pendingSkip ? t("mustSkip") : t("yourTurn");
    else msg = t("turnOf", { n: this.names[v.turn] ?? "" });
    this.banner.textContent = msg; this.banner.style.display = this.busy ? "none" : "block";
  }
  private legalTurn() { return this.legal.length > 0; }

  private send(m: Move) { if (this.busy) return; this.busy = true; this.legal = []; this.refreshInteractive(); this.hooks.submit(m); }
  private tryDraw() { if (this.legal.some((m) => m.t === "draw")) this.send({ t: "draw" }); }
  private tryPlay(card: Card) {
    const moves = this.legal.filter((m): m is Extract<Move, { t: "play" }> => m.t === "play" && m.card === card);
    if (!moves.length) return;
    if (moves.length === 1) return this.send(moves[0]!);
    // jack: choose a suit
    const box = document.createElement("div"); box.className = "suits";
    box.innerHTML = `<div class="box"><div>${t("wish")}</div><div class="opts"></div></div>`;
    const opts = box.querySelector(".opts")!;
    const sym: Record<Suit, string> = { C: "♣", S: "♠", H: "♥", D: "♦" };
    for (const s of SUIT_ORDER) {
      const b = document.createElement("button"); b.textContent = sym[s]; b.style.color = s === "H" || s === "D" ? "#c62828" : "#1b1b22";
      b.onclick = () => { box.remove(); this.send({ t: "play", card, wish: s }); };
      opts.append(b);
    }
    this.ui.append(box);
  }
}
