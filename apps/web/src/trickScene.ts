import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import gsap from "gsap";
import type { Card, TrickEv, TrickViewBase, Seat } from "@cards/engine";
import type { Update } from "@cards/net";
import { sfx } from "./sfx.ts";
import { CardView, HandOrder, type DragCtl, addCountIcon, sleep, tween } from "./cardview.ts";
import { CARD_H, tableTexture } from "./cardart.ts";
import { t } from "./i18n.ts";
import { attachAmbience } from "./ambience.ts";
import { LAND, pickGeo, cover, setActionsBottom, type Anchor, type Geo } from "./geo.ts";
export const W = LAND.W, H = LAND.H, LAYOUTS = LAND.layouts;
export type { Anchor };

/** How a game's moves map onto the generic table UI. */
export interface TrickUi<M, V> {
  cardOfMove(m: M): Card | null;               // a move that plays one card
  cardsOfMove(m: M): Card[] | null;            // a move that selects several cards (pass, discard)
  label(m: M): string | null;                  // other moves become buttons with this text (null: hide)
  status(v: V, names: string[], me: number): string;
  order(hand: Card[], v?: V): Card[];                 // how the own hand is sorted
  /** extra panel rows next to the scores, e.g. "bid 24" */
  extra?(v: V, names: string[]): string[];
  talonFaceUp?(v: V): boolean;
  /** custom panel (e.g. the Bridge bidding box). Return null to hide. */
  panel?(v: V, legal: M[], ctx: { send(m: M): void; names: string[]; me: number }): HTMLElement | null;
  winner(v: V): number;                        // who won the match (for the result screen)
}

export interface SceneHooks<M> { submit(m: M): void; onFinished(winner: number, names: string[], me: number, scores?: number[]): void }
export interface GameScene<U> {
  receive(u: U): void; destroy(): void;
  /** Hint button: make these cards of the own hand glow. */
  hint?(cards: Card[]): void;
}

export class TrickScene<V extends TrickViewBase, M, E extends TrickEv> implements GameScene<Update<V, M, E>> {
  private world = new Container();
  private bg = new Sprite();
  private tableLayer = new Container();
  private handLayer = new Container();
  private flyLayer = new Container();
  private fxLayer = new Container();
  private geo: Geo = LAND;
  private plates: { label: Text; count: Text; ring: Graphics; box: Container }[] = [];
  private mine = new Map<Card, CardView>();
  private opp: CardView[][] = [];
  private talon: CardView[] = [];
  private dummy = new Map<Card, CardView>();
  private dummySeat: number | null = null;
  private panelEl = document.createElement("div");
  private lastTrick: { seat: Seat; card: Card }[] = []; private lastBtn = document.createElement("button");
  private trick = new Map<Seat, CardView>();
  private queue: Update<V, M, E>[] = [];
  private running = false;
  private ready = false;
  private dealt = false;
  private busy = true;
  private legal: M[] = [];
  private view: V | null = null;
  private me = 0;
  private n = 0;
  private names: string[] = [];
  private selection = new Set<Card>();
  private destroyed = false;
  private finished = false;
  private banner = document.createElement("div");
  private actions = document.createElement("div");
  private board = document.createElement("div");
  private readonly app: Application;
  private readonly ui: HTMLElement;
  private readonly adapter: TrickUi<M, V>;
  private readonly hooks: SceneHooks<M>;

  constructor(app: Application, ui: HTMLElement, adapter: TrickUi<M, V>, hooks: SceneHooks<M>) {
    this.geo = pickGeo(app.screen.width, app.screen.height);
    this.app = app; this.ui = ui; this.adapter = adapter; this.hooks = hooks;
    app.stage.addChild(this.bg, this.world); attachAmbience(app, this.bg);
    this.world.addChild(this.tableLayer, this.handLayer, this.flyLayer, this.fxLayer);
    this.bg.texture = tableTexture(this.geo.W, this.geo.H);
    this.banner.className = "banner"; this.banner.style.display = "none";
    this.actions.className = "actions";
    this.board.className = "board";
    this.panelEl.className = "panelbox"; this.panelEl.style.display = "none";
    this.lastBtn.className = "btn lasttrick"; this.lastBtn.textContent = t("lastTrick"); this.lastBtn.style.display = "none"; this.lastBtn.onclick = () => this.showLastTrick();
    ui.append(this.banner, this.actions, this.board, this.panelEl, this.lastBtn);
    this.resize();
    window.addEventListener("resize", this.onResize);
  }
  private onResize = () => this.resize();
  private resize() {
    const w = this.app.screen.width, h = this.app.screen.height, g = pickGeo(w, h);
    const changed = g !== this.geo; this.geo = g;
    const s = Math.min(w / g.W, h / g.H);
    this.world.scale.set(s); this.world.position.set((w - g.W * s) / 2, (h - g.H * s) / 2);
    cover(this.bg, w, h);
    document.body.classList.toggle("portrait", g.portrait);
    setActionsBottom(g, w, h, this.n || 4);
    if (changed && this.ready) this.applyGeo();
  }
  /** The screen turned between landscape and portrait: move everything to its new place. */
  private applyGeo() {
    this.placePlates();
    for (const cv of this.trick.keys()) { const sl = this.trickSlot(cv); const v = this.trick.get(cv)!; gsap.killTweensOf(v); v.position.set(sl.x, sl.y); }
    this.layoutAll(false); this.layoutTalon();
  }
  hint(cards: Card[]) { for (const c of cards) (this.mine.get(c) ?? this.dummy.get(c))?.glowFor(7); }
  destroy() {
    this.destroyed = true; document.body.classList.remove("portrait"); document.documentElement.style.removeProperty("--actions-bottom");
    window.removeEventListener("resize", this.onResize);
    gsap.killTweensOf("*");
    this.banner.remove(); this.actions.remove(); this.board.remove(); this.panelEl.remove(); this.lastBtn.remove();
    this.app.stage.removeChildren();
  }

  receive(u: Update<V, M, E>) { this.queue.push(u); void this.drain(); }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.destroyed) {
      const u = this.queue.shift()!;
      this.busy = true; this.legal = []; this.refresh();
      try {
        if (!this.ready) { this.ready = true; this.setup(u); this.dealt = !u.events.some((e) => e.t === "dealt"); }
        for (const ev of u.events) await this.animate(ev, u);
      } catch (e) { console.error("animation error", e); }
      this.sync(u.view);
      if (!this.queue.length) { this.busy = false; this.legal = u.legal; this.selection.clear(); this.refresh(); }
    }
    this.running = false;
    if (this.view?.over && !this.finished && !this.destroyed) {
      this.finished = true;
      this.hooks.onFinished(this.adapter.winner(this.view), this.names, this.me, this.view.scores.slice());
    }
  }

  private setup(u: Update<V, M, E>) {
    this.me = u.view.you as number; this.n = u.view.handSizes.length;
    this.names = u.seats.map((s) => s.name);
    this.opp = Array.from({ length: this.n }, () => []);
    for (let s = 0; s < this.n; s++) {
      const box = new Graphics(), ring = new Graphics();
      const label = new Text({ text: s === this.me ? t("you") : this.names[s]!, style: { fill: "#f4efe4", fontSize: 24, fontWeight: "600", fontFamily: "Segoe UI, sans-serif" } });
      const count = new Text({ text: "", style: { fill: "#e8c66a", fontSize: 22, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } });
      label.anchor.set(0.5); count.anchor.set(0.5); addCountIcon(count);
      const w = 200, h = 54;
      box.roundRect(-w / 2, -h / 2, w, h, 27).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 1.5, color: 0xe8c66a, alpha: 0.5 });
      ring.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 31).stroke({ width: 3, color: 0xffe08a }); ring.alpha = 0;
      label.position.set(-20, 0); count.position.set(w / 2 - 30, 0);
      const plate = new Container(); plate.addChild(ring, box, label, count);
      this.tableLayer.addChild(plate);
      this.plates[s] = { label, count, ring, box: plate };
    }
    this.placePlates();
  }
  private placePlates() {
    for (let s = 0; s < this.n; s++) { const rel = (s - this.me + this.n) % this.n, p = this.geo.plate(this.geo.layouts[this.n]![rel]!, rel); this.plates[s]!.box.position.set(p.x, p.y); }
  }

  private anchor(seat: number) { return this.geo.layouts[this.n]![(seat - this.me + this.n) % this.n]!; }
  private trickSlot(seat: number) {
    const a = this.anchor(seat);
    return { x: this.geo.center.x + a.dx * 95, y: this.geo.center.y + a.dy * 70, rot: (Math.random() - 0.5) * 0.3 + (a.dx !== 0 ? 0.1 : 0), scale: 0.95 };
  }
  private talonSlot(i: number) { return { x: this.geo.center.x - 55 + i * 110, y: this.geo.talonY, rot: 0, scale: 0.8 }; }

  private order = new HandOrder(); private dragCtl: DragCtl | null = null;
  private ctl(): DragCtl { return (this.dragCtl ??= { canvas: this.app.canvas as HTMLCanvasElement, order: () => this.handOf(this.me), move: (card, i) => { this.order.move(this.handOf(this.me).map((c) => c.id!), card, i); this.layout(this.me); } }); }
  private handOf(seat: number): CardView[] {
    if (seat === this.dummySeat && seat !== this.me) return this.adapter.order([...this.dummy.keys()], this.view ?? undefined).map((c) => this.dummy.get(c)!);
    if (seat !== this.me) return this.opp[seat]!;
    const order = this.order.apply(this.adapter.order([...this.mine.keys()], this.view ?? undefined));
    return order.map((c) => this.mine.get(c)!);
  }
  private fanSlot(seat: number, i: number, n: number) {
    const a = this.anchor(seat), own = seat === this.me, dum = seat === this.dummySeat && !own;
    const g = this.geo, step = own ? Math.min(g.ownStep, g.ownWidth / Math.max(n, 1)) : dum ? Math.min(g.dummyStep, g.dummyWidth / Math.max(n, 1)) : Math.min(28, 420 / Math.max(n, 1));
    const tt = i - (n - 1) / 2, lx = tt * step, ly = tt * tt * (own ? 0.9 : 0.5);
    const cos = Math.cos(a.rot), sin = Math.sin(a.rot);
    return { x: a.cx + lx * cos - ly * sin, y: a.cy + lx * sin + ly * cos, rot: a.rot + tt * (own ? 0.03 : 0.03), scale: own ? g.ownScale : dum ? g.dummyScale : 0.56 };
  }
  private layout(seat: number, animate = true) {
    const hand = this.handOf(seat);
    hand.forEach((cv, i) => {
      cv.slot = this.fanSlot(seat, i, hand.length);
      if (seat === this.me) cv.drag = this.ctl();
      if (cv.dragging) return;
      this.handLayer.addChild(cv);
      const d = animate ? 0.45 : 0;
      gsap.to(cv, { x: cv.slot.x, y: cv.slot.y, rotation: cv.slot.rot, duration: d, ease: "power3.out", overwrite: "auto" });
      gsap.to(cv.scale, { x: cv.slot.scale, y: cv.slot.scale, duration: d, ease: "power3.out" });
    });
    const p = this.plates[seat]; if (p) p.count.text = String(hand.length);
  }
  private layoutAll(animate = true) { for (let s = 0; s < this.n; s++) this.layout(s, animate); }
  private layoutTalon() { this.talon.forEach((cv, i) => { const sl = this.talonSlot(i); cv.slot = sl; gsap.to(cv, { x: sl.x, y: sl.y, rotation: sl.rot, duration: 0.4, ease: "power3.out" }); gsap.to(cv.scale, { x: sl.scale, y: sl.scale, duration: 0.4 }); }); }

  private newView(id: Card | null, up: boolean, at = { x: this.geo.center.x, y: this.geo.center.y }) {
    const cv = new CardView(id, up); cv.position.set(at.x, at.y); cv.scale.set(0.8); this.flyLayer.addChild(cv); return cv;
  }
  private async fly(cv: CardView, to: { x: number; y: number; rot: number; scale: number }, duration = 0.5) {
    this.flyLayer.addChild(cv);
    gsap.to(cv, { lift: 1, duration: duration * 0.45, ease: "power2.out" });
    gsap.to(cv, { lift: 0, duration: duration * 0.45, delay: duration * 0.55, ease: "power2.in" });
    gsap.to(cv.scale, { x: to.scale * 1.15, y: to.scale * 1.15, duration: duration * 0.5, ease: "power2.out" });
    gsap.to(cv.scale, { x: to.scale, y: to.scale, duration: duration * 0.5, delay: duration * 0.5, ease: "bounce.out" });
    gsap.to(cv, { rotation: to.rot, duration, ease: "power2.inOut" });
    await tween(cv, { x: to.x, y: to.y, duration, ease: "power3.inOut" });
    sfx.place();
  }

  private takeFrom(seat: Seat | "talon", card: Card): CardView {
    if (seat === "talon") return this.talon.pop() ?? this.newView(card, false);
    if (this.dummy.has(card)) { const cv = this.dummy.get(card)!; this.dummy.delete(card); return cv; }
    if (seat === this.me) return this.mine.get(card) ?? this.newView(card, true);
    const h = this.opp[seat]!;
    return h.splice(Math.floor(h.length / 2), 1)[0] ?? this.newView(null, false);
  }

  private async animate(ev: E, u: Update<V, M, E>) {
    switch (ev.t) {
      case "newRound": {
        const all = [...this.mine.values(), ...this.opp.flat(), ...this.talon, ...this.trick.values(), ...this.dummy.values()];
        this.dummy.clear(); this.dummySeat = null; this.mine.clear(); this.order.reset(); this.opp = Array.from({ length: this.n }, () => []); this.talon = []; this.trick.clear();
        all.forEach((c) => { gsap.to(c, { alpha: 0, duration: 0.4, onComplete: () => c.destroy() }); });
        this.dealt = false; this.selection.clear(); this.lastTrick = []; this.lastBtn.style.display = "none";
        await sleep(this.ready && all.length ? 450 : 0);
        break;
      }
      case "dealt": if (!this.dealt) await this.dealAll(u); break;
      case "transfer": {
        const moved: Promise<void>[] = [];
        for (const c of ev.cards) {
          const cv = this.takeFrom(ev.from, c);
          if (ev.from === this.me) this.mine.delete(c);
          if (ev.to === "talon") this.talon.push(cv);
          else if (ev.to === this.me) { cv.reveal(c); this.mine.set(c, cv); } else this.opp[ev.to]!.push(cv);
          this.flyLayer.addChild(cv);
          const target = ev.to === "talon" ? this.talonSlot(this.talon.length - 1) : this.fanSlot(ev.to, 0, 1);
          const faceUp = ev.to === this.me || (ev.to === "talon" && !!this.adapter.talonFaceUp?.(u.view));
          moved.push(this.fly(cv, target, 0.55).then(async () => { if (faceUp !== cv.faceUp) await cv.flip(faceUp); }));
          await sleep(110);
        }
        await Promise.all(moved);
        this.layoutAll(); this.layoutTalon();
        await sleep(250);
        break;
      }
      case "played": {
        const cv = this.takeFrom(ev.seat, ev.card);
        if (ev.seat === this.me) this.mine.delete(ev.card); else cv.reveal(ev.card);
        this.layout(ev.seat);
        this.trick.set(ev.seat, cv);
        const flip = cv.faceUp ? Promise.resolve() : cv.flip(true, 0.35);
        await Promise.all([this.fly(cv, this.trickSlot(ev.seat), 0.5), flip]);
        this.impact(cv.x, cv.y);
        break;
      }
      case "trickDone": {
        await sleep(650);
        const a = this.anchor(ev.winner);
        this.lastTrick = [...this.trick].map(([seat, cv]) => ({ seat, card: cv.id! })).filter((p) => p.card); this.lastBtn.style.display = this.lastTrick.length ? "block" : "none";
        const views = [...this.trick.values()]; this.trick.clear();
        await Promise.all(views.map((cv, i) => tween(cv, { x: a.cx, y: a.cy, rotation: cv.rotation + 0.6, alpha: 0, duration: 0.55, delay: i * 0.05, ease: "power2.in" })));
        views.forEach((v) => v.destroy());
        break;
      }
      case "reveal": {
        if (ev.seat === this.me) break;
        this.dummySeat = ev.seat;
        const l = this.opp[ev.seat]!;
        for (const c of ev.cards) { const cv = l.pop() ?? this.newView(null, false); cv.reveal(c); this.dummy.set(c, cv); }
        this.layout(ev.seat);
        await Promise.all([...this.dummy.values()].map((cv, i) => sleep(i * 40).then(() => cv.flip(true, 0.3)))); this.layout(ev.seat); await sleep(250);
        break;
      }
      case "say": this.toast(ev.seat, t(ev.key, ev.vars ?? {})); await sleep(700); break;
    }
  }

  private async dealAll(u: Update<V, M, E>) {
    this.dealt = true;
    const counts = new Map<Seat | "talon", number>();
    for (const e of u.events) if (e.t === "dealt") counts.set(e.seat, e.count);
    const mineCards = u.view.hand.slice();
    const per = Math.max(...counts.values());
    const order: (Seat | "talon")[] = [];
    for (let k = 0; k < this.n; k++) order.push((this.me + k) % this.n);
    order.push("talon");
    const used = new Map<Seat | "talon", number>();
    for (let r = 0; r < per; r++) {
      for (const who of order) {
        const have = used.get(who) ?? 0;
        if (have >= (counts.get(who) ?? 0)) continue;
        used.set(who, have + 1);
        if (who === "talon") { const cv = this.newView(null, false); this.talon.push(cv); this.layoutTalon(); }
        else if (who === this.me) { const id = mineCards[have]!; const cv = this.newView(id, false); this.mine.set(id, cv); this.layout(who); }
        else { const cv = this.newView(null, false); this.opp[who]!.push(cv); this.layout(who); }
        sfx.deal(); await sleep(75);
      }
    }
    await sleep(450);
    for (const cv of this.mine.values()) this.handLayer.addChild(cv);
    this.layoutAll();
    await Promise.all([...this.mine.values()].map((cv, i) => sleep(i * 55).then(() => cv.flip(true))));
    this.layoutAll(); await sleep(200);
  }

  /** Show the previous trick again, face up, until tapped. */
  private showLastTrick() {
    if (!this.lastTrick.length) return;
    const g = this.geo, layer = new Container(); this.fxLayer.addChild(layer);
    const dim = new Graphics().rect(0, 0, g.W, g.H).fill({ color: 0x000000, alpha: 0.6 }); dim.eventMode = "static"; dim.cursor = "pointer"; layer.addChild(dim);
    const title = new Text({ text: t("lastTrick"), style: { fill: "#ffe08a", fontSize: 44, fontWeight: "800", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 6 } } }); title.anchor.set(0.5); title.position.set(g.center.x, g.center.y - (g.portrait ? 300 : 280)); layer.addChild(title);
    for (const [i, { seat, card }] of this.lastTrick.entries()) {
      const a = this.anchor(seat), cv = new CardView(card, true);
      cv.position.set(g.center.x + a.dx * (g.portrait ? 120 : 170), g.center.y + a.dy * (g.portrait ? 140 : 120)); cv.scale.set(0); cv.rotation = (Math.random() - 0.5) * 0.2; layer.addChild(cv);
      gsap.to(cv.scale, { x: 1.15, y: 1.15, duration: 0.35, ease: "back.out(1.6)", delay: 0.06 * i });
      const nm = new Text({ text: seat === this.me ? t("you") : this.names[seat] ?? "", style: { fill: "#f4efe4", fontSize: 24, fontWeight: "600", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 4 } } }); nm.anchor.set(0.5); nm.position.set(cv.x, cv.y + 150); layer.addChild(nm);
    }
    layer.alpha = 0; gsap.to(layer, { alpha: 1, duration: 0.2 });
    dim.on("pointertap", () => gsap.to(layer, { alpha: 0, duration: 0.2, onComplete: () => layer.destroy({ children: true }) }));
  }

  private impact(x: number, y: number) {
    const ring = new Graphics().circle(0, 0, 55).stroke({ width: 4, color: 0xffffff, alpha: 0.5 });
    ring.position.set(x, y); ring.scale.set(0.6); this.fxLayer.addChild(ring);
    gsap.to(ring.scale, { x: 1.5, y: 1.5, duration: 0.45, ease: "power2.out" });
    gsap.to(ring, { alpha: 0, duration: 0.45, onComplete: () => ring.destroy() });
  }
  private toast(seat: Seat | null, text: string) {
    const a = seat === null ? null : this.anchor(seat);
    const tx = new Text({ text, style: { fill: "#ffe08a", fontSize: 44, fontWeight: "800", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 6 } } });
    tx.anchor.set(0.5);
    const c = this.geo.center, x = a ? c.x + a.dx * this.geo.toast.dx : c.x, y = a ? c.y + a.dy * this.geo.toast.dy : c.y - this.geo.toast.dy;
    tx.position.set(x, y); tx.alpha = 0; this.fxLayer.addChild(tx);
    gsap.to(tx, { alpha: 1, y: y - 24, duration: 0.3 }); gsap.to(tx, { alpha: 0, delay: 1.1, duration: 0.4, onComplete: () => tx.destroy() });
  }

  /** Make the visuals match the authoritative view, healing any drift without animation. */
  private sync(v: V) {
    this.view = v;
    if (this.dealt) {
      const want = new Set(v.hand);
      const same = want.size === this.mine.size && [...want].every((c) => this.mine.has(c));
      if (!same) {
        for (const cv of this.mine.values()) cv.destroy();
        this.mine.clear(); this.order.reset();
        for (const c of v.hand) { const cv = this.newView(c, true); this.handLayer.addChild(cv); this.mine.set(c, cv); }
      }
      for (let s = 0; s < this.n; s++) {
        if (s === this.me || s === this.dummySeat) continue;
        const list = this.opp[s]!;
        while (list.length > v.handSizes[s]!) list.pop()!.destroy();
        while (list.length < v.handSizes[s]!) { const cv = this.newView(null, false); this.handLayer.addChild(cv); list.push(cv); }
      }
      if (v.shown) {
        const [seatStr, cards] = Object.entries(v.shown)[0]!; const ds = Number(seatStr);
        if (ds !== this.me) {
          const same = cards.length === this.dummy.size && cards.every((c) => this.dummy.has(c));
          if (!same || this.dummySeat !== ds) {
            for (const cv of this.dummy.values()) cv.destroy(); this.dummy.clear(); this.dummySeat = ds;
            this.opp[ds]!.forEach((c) => c.destroy()); this.opp[ds] = [];
            for (const c of cards) { const cv = this.newView(c, true); this.handLayer.addChild(cv); this.dummy.set(c, cv); }
          }
        }
      } else if (this.dummy.size) { for (const cv of this.dummy.values()) cv.destroy(); this.dummy.clear(); this.dummySeat = null; }
      while (this.talon.length > v.talon) this.talon.pop()!.destroy();
      while (this.talon.length < v.talon) this.talon.push(this.newView(null, false));
      const tr = new Map(v.trick.map((p) => [p.seat, p.card]));
      const ok = tr.size === this.trick.size && [...tr].every(([s, c]) => this.trick.get(s)?.id === c);
      if (!ok) {
        for (const cv of this.trick.values()) cv.destroy();
        this.trick.clear();
        for (const [s, c] of tr) { const cv = this.newView(c, true); const sl = this.trickSlot(s); cv.position.set(sl.x, sl.y); cv.rotation = sl.rot; cv.scale.set(sl.scale); this.trick.set(s, cv); }
      }
      this.layoutAll(); this.layoutTalon();
    }
    this.plates.forEach((p, s) => { if (p) p.count.text = String(v.handSizes[s]); });
  }

  // ------------------------------------------------------------------ interaction
  private playable(): Set<Card> {
    const s = new Set<Card>();
    for (const m of this.legal) { const c = this.adapter.cardOfMove(m); if (c) s.add(c); }
    return s;
  }
  private selectable(): { cards: Set<Card>; k: number } {
    const cards = new Set<Card>(); let k = 0;
    for (const m of this.legal) { const cs = this.adapter.cardsOfMove(m); if (cs) { k = cs.length; cs.forEach((c) => cards.add(c)); } }
    return { cards, k };
  }
  private send(m: M) { if (this.busy) return; this.busy = true; this.legal = []; this.selection.clear(); this.refresh(); this.hooks.submit(m); }

  private refresh() {
    const v = this.view; if (!v) return;
    const play = this.busy ? new Set<Card>() : this.playable();
    const sel = this.busy ? { cards: new Set<Card>(), k: 0 } : this.selectable();
    for (const [card, cv] of [...this.mine, ...this.dummy]) {
      if (cv.dragging) continue;
      const canPlay = play.has(card), canSel = sel.cards.has(card), on = canPlay || canSel;
      cv.eventMode = on || cv.drag ? "static" : "none"; cv.cursor = on ? "pointer" : "default"; cv.removeAllListeners();
      const picked = this.selection.has(card);
      const baseY = cv.slot.y - (picked ? 46 : on && (canSel || this.legal.length) ? 12 : 0);
      gsap.to(cv, { y: baseY, duration: 0.2, overwrite: "auto" });
      if (on) {
        cv.on("pointerover", () => { if (!this.selection.has(card)) gsap.to(cv, { y: cv.slot.y - 34, duration: 0.15, overwrite: "auto" }); });
        cv.on("pointerout", () => { if (!this.selection.has(card)) gsap.to(cv, { y: cv.slot.y - 12, duration: 0.15, overwrite: "auto" }); });
        cv.on("pointertap", () => {
          if (canPlay) { const m = this.legal.find((x) => this.adapter.cardOfMove(x) === card); if (m) this.send(m); return; }
          if (this.selection.has(card)) this.selection.delete(card); else if (this.selection.size < sel.k) this.selection.add(card);
          this.refresh();
        });
      }
    }
    // buttons: confirm for selections, other moves by label
    this.actions.innerHTML = "";
    if (!this.busy) {
      if (sel.k > 0) {
        const b = document.createElement("button"); b.className = "btn primary"; b.textContent = `${t("confirm")} (${this.selection.size}/${sel.k})`;
        b.disabled = this.selection.size !== sel.k;
        b.onclick = () => {
          const m = this.legal.find((x) => { const cs = this.adapter.cardsOfMove(x); return cs && cs.length === this.selection.size && cs.every((c) => this.selection.has(c)); });
          if (m) this.send(m);
        };
        this.actions.append(b);
      }
      for (const m of this.legal) {
        if (this.adapter.cardOfMove(m) || this.adapter.cardsOfMove(m)) continue;
        const label = this.adapter.label(m); if (!label) continue;
        const b = document.createElement("button"); b.className = "btn"; b.textContent = label; b.onclick = () => this.send(m);
        this.actions.append(b);
      }
    }
    for (let s = 0; s < this.n; s++) gsap.to(this.plates[s]!.ring, { alpha: !v.over && v.turn === s ? 1 : 0, duration: 0.25 });
    this.banner.textContent = this.adapter.status(v, this.names, this.me);
    this.banner.style.display = this.busy || v.over || !this.banner.textContent ? "none" : "block";
    const rows = this.names.map((nm, i) => `<div class="${v.turn === i ? "on" : ""}"><span>${i === this.me ? t("you") : nm}</span><b>${v.scores[i] ?? 0}</b></div>`);
    const extra = this.adapter.extra?.(v, this.names) ?? [];
    if (this.adapter.panel) {
      const el = this.busy ? null : this.adapter.panel(v, this.legal, { send: (m) => this.send(m), names: this.names, me: this.me });
      this.panelEl.innerHTML = ""; if (el) { this.panelEl.append(el); this.panelEl.style.display = "block"; } else this.panelEl.style.display = "none";
    }
    this.board.innerHTML = rows.join("") + extra.map((e) => `<div class="x">${e}</div>`).join("");
  }
}
