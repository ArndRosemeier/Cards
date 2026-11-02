import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import gsap from "gsap";
import { isJoker, rankOf, suitOf, RANKS, type Card } from "@cards/engine";
import { checkMelds, checkPile, isCanasta, isWild, points, seatsOf, sideOf, type Ev, type Move, type View } from "@cards/canasta";
import type { Update } from "@cards/net";
import { sfx } from "./sfx.ts";
import { CardView, sleep, tween } from "./cardview.ts";
import { tableTexture } from "./cardart.ts";
import { t } from "./i18n.ts";
import { LAYOUTS, type GameScene, type SceneHooks } from "./trickScene.ts";

const W = 1600, H = 900;
const STOCK = { x: 270, y: 520 }, DISC = { x: 400, y: 520 };
const SUIT_ORDER = ["C", "H", "S", "D"];
const sortHand = (h: Card[]) => h.slice().sort((a, b) => (isWild(a) ? 1 : 0) - (isWild(b) ? 1 : 0) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)));
const MS = 0.45, CW = CardView.W * MS, CH = CardView.H * MS; // meld card scale / size

interface MeldView { side: number; idx: number; kind: "meld" | "reds"; cards: CardView[]; frame: Graphics; label: Text }
const FONT = "Segoe UI, sans-serif";

export class CanastaScene implements GameScene<Update<View, Move, Ev>> {
  private world = new Container(); private bg = new Sprite();
  private tableLayer = new Container(); private meldLayer = new Container(); private handLayer = new Container(); private flyLayer = new Container(); private fxLayer = new Container();
  private mine = new Map<Card, CardView>(); private opp: CardView[][] = []; private groups: MeldView[] = [];
  private stockStack = new Container(); private stockText = new Text({ text: "", style: { fill: "#fff", fontSize: 22, fontWeight: "700", fontFamily: FONT } });
  private pileDepth = new Container(); private pileText = new Text({ text: "", style: { fill: "#fff", fontSize: 20, fontWeight: "700", fontFamily: FONT } });
  private frozenMark = new Text({ text: "❄", style: { fill: "#9fe0ff", fontSize: 40, fontFamily: FONT, stroke: { color: "#06303f", width: 5 } } });
  private glow = new Graphics();
  private discardView: CardView | null = null;
  private plates: { ring: Graphics; count: Text }[] = [];
  private queue: Update<View, Move, Ev>[] = []; private running = false; private ready = false; private dealt = false; private busy = true; private destroyed = false; private finished = false;
  private view: View | null = null; private legal: Move[] = []; private me = 0; private n = 0; private names: string[] = [];
  private selection = new Set<Card>(); private staged: Card[][] = [];
  private actions = document.createElement("div"); private banner = document.createElement("div"); private board = document.createElement("div");
  private readonly app: Application; private readonly ui: HTMLElement; private readonly hooks: SceneHooks<Move>;

  constructor(app: Application, ui: HTMLElement, hooks: SceneHooks<Move>) {
    this.app = app; this.ui = ui; this.hooks = hooks;
    app.stage.addChild(this.bg, this.world);
    this.world.addChild(this.tableLayer, this.meldLayer, this.handLayer, this.flyLayer, this.fxLayer); this.handLayer.sortableChildren = true;
    this.bg.texture = tableTexture(W, H);
    this.stockStack.position.set(STOCK.x, STOCK.y); this.stockText.anchor.set(0.5); this.stockText.position.set(STOCK.x, STOCK.y + 112);
    this.pileDepth.position.set(DISC.x, DISC.y); this.pileText.anchor.set(0.5); this.pileText.position.set(DISC.x, DISC.y + 112);
    this.frozenMark.anchor.set(0.5); this.frozenMark.position.set(DISC.x + 62, DISC.y - 86); this.frozenMark.visible = false;
    this.glow.roundRect(-70, -100, 140, 200, 14).stroke({ width: 5, color: 0xffe08a }); this.glow.position.set(DISC.x, DISC.y); this.glow.scale.set(0.8); this.glow.alpha = 0;
    this.tableLayer.addChild(this.stockStack, this.stockText, this.pileDepth, this.pileText, this.glow, this.frozenMark);
    this.stockStack.eventMode = "static"; this.stockStack.cursor = "pointer"; this.stockStack.on("pointertap", () => this.draw());
    this.actions.className = "actions"; this.actions.style.bottom = "calc(env(safe-area-inset-bottom) + 262px)";
    this.banner.className = "banner"; this.banner.style.display = "none"; this.board.className = "board";
    ui.append(this.actions, this.banner, this.board);
    this.resize(); window.addEventListener("resize", this.onResize);
  }
  private onResize = () => this.resize();
  private resize() { const w = this.app.screen.width, h = this.app.screen.height, s = Math.min(w / W, h / H); this.world.scale.set(s); this.world.position.set((w - W * s) / 2, (h - H * s) / 2); this.bg.width = w; this.bg.height = h; }
  destroy() { this.destroyed = true; window.removeEventListener("resize", this.onResize); gsap.killTweensOf("*"); this.actions.remove(); this.banner.remove(); this.board.remove(); this.app.stage.removeChildren(); }

  receive(u: Update<View, Move, Ev>) { this.queue.push(u); void this.drain(); }
  private async drain() {
    if (this.running) return; this.running = true;
    while (this.queue.length && !this.destroyed) {
      const u = this.queue.shift()!; this.busy = true; this.legal = []; this.refresh();
      try {
        if (!this.ready) { this.ready = true; this.setup(u); this.dealt = !u.events.some((e) => e.t === "dealt"); }
        for (const ev of u.events) await this.animate(ev, u);
      } catch (e) { console.error("animation error", e); }
      this.sync(u.view);
      if (!this.queue.length) { this.busy = false; this.legal = u.legal; this.refresh(); }
    }
    this.running = false;
    if (this.view?.over && !this.finished && !this.destroyed) { this.finished = true; const sc = this.view.scores; this.hooks.onFinished(sc.indexOf(Math.max(...sc)), this.names, this.me); }
  }

  private setup(u: Update<View, Move, Ev>) {
    this.me = u.view.you as number; this.n = u.view.handSizes.length; this.names = u.seats.map((s) => s.name); this.opp = Array.from({ length: this.n }, () => []);
    const anchors = LAYOUTS[this.n]!;
    for (let s = 0; s < this.n; s++) {
      const rel = (s - this.me + this.n) % this.n, a = anchors[rel]!;
      const box = new Graphics(), ring = new Graphics();
      const name = new Text({ text: s === this.me ? t("you") : this.names[s]!, style: { fill: "#f4efe4", fontSize: 22, fontWeight: "600", fontFamily: FONT } }); name.anchor.set(0.5); name.position.set(-18, 0);
      const count = new Text({ text: "", style: { fill: "#e8c66a", fontSize: 20, fontWeight: "700", fontFamily: FONT } }); count.anchor.set(0.5); count.position.set(78, 0);
      const mate = u.view.teams && sideOf(this.n, s) === sideOf(this.n, this.me);
      box.roundRect(-100, -26, 200, 52, 26).fill({ color: mate ? 0x3b2f08 : 0, alpha: 0.5 }).stroke({ width: 1.5, color: 0xe8c66a, alpha: mate ? 0.9 : 0.5 });
      ring.roundRect(-104, -30, 208, 60, 30).stroke({ width: 3, color: 0xffe08a }); ring.alpha = 0;
      const plate = new Container(); plate.addChild(ring, box, name, count);
      if (rel === 0) plate.position.set(250, 835); else if (a.dy === -1) plate.position.set(a.cx - 300, a.cy); else plate.position.set(a.cx, a.cy + 200);
      this.tableLayer.addChild(plate); this.plates[s] = { ring, count };
    }
    for (let i = 0; i < 4; i++) { const c = new CardView(null, false); c.position.set(-i * 1.5, -i * 1.5); c.scale.set(0.8); this.stockStack.addChild(c); }
  }
  private anchor(seat: number) { return LAYOUTS[this.n]![(seat - this.me + this.n) % this.n]!; }
  private handOf(seat: number): CardView[] {
    if (seat !== this.me) return this.opp[seat]!;
    return sortHand([...this.mine.keys()]).map((c) => this.mine.get(c)!);
  }
  private fan(seat: number, i: number, n: number) {
    const a = this.anchor(seat), own = seat === this.me;
    const step = own ? Math.min(62, 1050 / Math.max(n, 1)) : Math.min(22, 330 / Math.max(n, 1));
    const tt = i - (n - 1) / 2, lx = tt * step, ly = tt * tt * (own ? 0.5 : 0.3), cos = Math.cos(a.rot), sin = Math.sin(a.rot);
    return { x: a.cx + lx * cos - ly * sin, y: a.cy + (own ? 20 : 0) + lx * sin + ly * cos, rot: a.rot + tt * 0.02, scale: own ? 0.95 : 0.5 };
  }
  private layout(seat: number, animate = true) {
    const hand = this.handOf(seat);
    hand.forEach((cv, i) => {
      cv.slot = this.fan(seat, i, hand.length); if (cv.parent !== this.handLayer) this.handLayer.addChild(cv); cv.zIndex = i;
      const d = animate ? 0.4 : 0; const staged = this.staged.some((g) => g.includes(cv.id!));
      gsap.to(cv, { x: cv.slot.x, y: cv.slot.y - (this.selection.has(cv.id!) ? 40 : staged ? 70 : 0), rotation: cv.slot.rot, duration: d, ease: "power3.out", overwrite: "auto" });
      gsap.to(cv.scale, { x: cv.slot.scale, y: cv.slot.scale, duration: d });
    });
    const p = this.plates[seat]; if (p) p.count.text = String(hand.length);
  }
  private layoutAll(a = true) { for (let s = 0; s < this.n; s++) this.layout(s, a); }

  // ---------------------------------------------------------------- melds
  private groupOf(side: number, idx: number, kind: "meld" | "reds" = "meld"): MeldView | undefined { return this.groups.find((g) => g.side === side && g.idx === idx && g.kind === kind); }
  private newGroup(side: number, idx: number, kind: "meld" | "reds"): MeldView {
    const mv: MeldView = { side, idx, kind, cards: [], frame: new Graphics(), label: new Text({ text: "", style: { fill: "#ffe08a", fontSize: 18, fontWeight: "800", fontFamily: FONT, stroke: { color: "#000", width: 4 } } }) };
    mv.label.anchor.set(0.5); this.meldLayer.addChild(mv.frame, mv.label); this.groups.push(mv); return mv;
  }
  private layoutMelds(animate = true) {
    const own = this.view?.mySide ?? 0;
    const regions = [{ x0: 470, y0: 455, sides: [own] }, { x0: 470, y0: 215, sides: Array.from({ length: this.view?.sides ?? 0 }, (_, i) => i).filter((i) => i !== own) }];
    for (const r of regions) {
      const items = this.groups.filter((g) => r.sides.includes(g.side)).sort((a, b) => r.sides.indexOf(a.side) - r.sides.indexOf(b.side) || (a.kind === "reds" ? -1 : 0) - (b.kind === "reds" ? -1 : 0) || a.idx - b.idx);
      const maxX = 1450, gap = 18; let step = 26, rows = 1;
      const fit = (st: number) => { let x = r.x0, rr = 1; for (const g of items) { const w = (Math.max(g.cards.length, 1) - 1) * st + CW; if (x + w > maxX) { x = r.x0; rr++; } x += w + gap; } return rr; };
      for (const st of [26, 22, 18, 15, 12]) { step = st; rows = fit(st); if (rows <= 2) break; }
      let x = r.x0, row = 0;
      for (const g of items) {
        const w = (Math.max(g.cards.length, 1) - 1) * step + CW;
        if (x + w > maxX) { x = r.x0; row++; }
        const y = r.y0 + row * (CH + 14);
        g.cards.forEach((cv, i) => {
          if (cv.parent !== this.meldLayer) this.meldLayer.addChild(cv);
          const wild = !!cv.id && g.kind === "meld" && isWild(cv.id);
          const sl = { x: x + CW / 2 + i * step, y: y + CH / 2 + (wild ? 8 : 0), rot: wild ? 0.14 : 0, scale: g.kind === "reds" ? MS * 0.8 : MS }; cv.slot = sl; cv.zIndex = i + 1;
          gsap.to(cv, { x: sl.x, y: sl.y, rotation: sl.rot, duration: animate ? 0.4 : 0, ease: "power3.out", overwrite: "auto" }); gsap.to(cv.scale, { x: sl.scale, y: sl.scale, duration: animate ? 0.4 : 0 });
        });
        const can = g.kind === "meld" && g.cards.length >= 7, natural = can && !g.cards.some((c) => !!c.id && isWild(c.id));
        const mineSide = g.side === own;
        g.frame.clear().roundRect(x - 6, y - 8, w + 12, CH + 24, 12)
          .stroke({ width: can ? 3.5 : 2, color: can ? (natural ? 0xffd34d : 0xd8dde6) : mineSide ? 0xffe08a : 0xffffff, alpha: can ? 0.95 : 0.35 }).fill({ color: can ? 0xffd34d : 0, alpha: can ? 0.1 : 0.12 });
        g.label.text = g.kind === "reds" ? "" : g.cards.length >= 7 ? (natural ? "★ " : "☆ ") + g.cards.length : String(g.cards.length);
        g.label.position.set(x + w - 4, y + CH + 10); g.label.visible = g.kind === "meld";
        g.frame.eventMode = g.kind === "meld" && mineSide ? "static" : "none"; g.frame.cursor = "pointer"; g.frame.removeAllListeners();
        if (g.kind === "meld" && mineSide) g.frame.on("pointertap", () => this.addToMeld(g.idx));
        x += w + gap;
      }
    }
    this.meldLayer.sortableChildren = true;
  }

  // ---------------------------------------------------------------- flights
  private mk(id: Card | null, up: boolean, at: { x: number; y: number } = STOCK) { const cv = new CardView(id, up); cv.position.set(at.x, at.y); cv.scale.set(0.8); this.flyLayer.addChild(cv); return cv; }
  private async fly(cv: CardView, to: { x: number; y: number; rot: number; scale: number }, d = 0.5) {
    this.flyLayer.addChild(cv);
    gsap.to(cv, { lift: 1, duration: d * 0.45 }); gsap.to(cv, { lift: 0, duration: d * 0.45, delay: d * 0.55 });
    gsap.to(cv, { rotation: to.rot, duration: d, ease: "power2.inOut" }); gsap.to(cv.scale, { x: to.scale, y: to.scale, duration: d, ease: "power2.inOut" });
    await tween(cv, { x: to.x, y: to.y, duration: d, ease: "power3.inOut" });
    sfx.place();
  }
  private takeFrom(seat: number, card: Card): CardView {
    if (seat === this.me) { const cv = this.mine.get(card) ?? this.mk(card, true, this.fan(seat, 0, 1)); this.mine.delete(card); return cv; }
    const h = this.opp[seat]!; return h.splice(Math.floor(h.length / 2), 1)[0] ?? this.mk(null, false, this.fan(seat, 0, 1));
  }
  private addToGroup(g: MeldView, seat: number, cards: Card[], result?: Card[]) {
    for (const c of cards) { const cv = this.takeFrom(seat, c); cv.reveal(c); if (seat !== this.me) void cv.flip(true, 0.3); g.cards.push(cv); }
    if (result) g.cards = result.map((id) => g.cards.find((x) => x.id === id)!).filter(Boolean);
  }
  private sideSeatOf(seat: number) { return sideOf(this.n, seat); }

  private async animate(ev: Ev, u: Update<View, Move, Ev>) {
    switch (ev.t) {
      case "newRound": {
        const all = [...this.mine.values(), ...this.opp.flat(), ...this.groups.flatMap((g) => g.cards), ...(this.discardView ? [this.discardView] : [])];
        this.groups.forEach((g) => { g.frame.destroy(); g.label.destroy(); }); this.groups = []; this.mine.clear(); this.opp = Array.from({ length: this.n }, () => []); this.discardView = null; this.staged = []; this.selection.clear();
        all.forEach((c) => gsap.to(c, { alpha: 0, duration: 0.4, onComplete: () => c.destroy() })); this.dealt = false; await sleep(this.ready && all.length ? 450 : 0); break;
      }
      case "dealt": if (!this.dealt) await this.dealAll(u); break;
      case "draw": {
        const own = ev.seat === this.me; const cv = this.mk(own ? ev.card : null, false);
        if (own) this.mine.set(ev.card, cv); else this.opp[ev.seat]!.push(cv);
        this.layout(ev.seat); await this.fly(cv, this.fan(ev.seat, 0, 1), 0.45); if (own && !cv.faceUp) await cv.flip(true, 0.25); this.layout(ev.seat); break;
      }
      case "reds": {
        const sd = this.sideSeatOf(ev.seat); const g = this.groupOf(sd, 0, "reds") ?? this.newGroup(sd, 0, "reds");
        this.addToGroup(g, ev.seat, ev.cards); this.layoutMelds(); this.layout(ev.seat); sfx.chip(); await sleep(450); break;
      }
      case "pile": {
        const sd = this.sideSeatOf(ev.seat), own = ev.seat === this.me;
        const g = this.groupOf(sd, ev.meld) ?? this.newGroup(sd, ev.meld, "meld");
        const top = this.discardView ?? this.mk(ev.top, true, DISC); this.discardView = null; top.reveal(ev.top); await top.flip(true, 0.2); g.cards.push(top);
        this.addToGroup(g, ev.seat, ev.used); g.cards = ev.result.map((id) => g.cards.find((x) => x.id === id)!).filter(Boolean);
        this.layoutMelds(); this.layout(ev.seat); sfx.sweep(); await sleep(420);
        // the rest of the pile slides into the hand
        const fl: Promise<void>[] = [];
        ev.taken.forEach((c, i) => {
          const cv = this.mk(own ? c : null, own, DISC); if (own) this.mine.set(c, cv); else this.opp[ev.seat]!.push(cv);
          this.layout(ev.seat); fl.push(sleep(i * 70).then(() => this.fly(cv, this.fan(ev.seat, 0, 1), 0.5)));
        });
        await Promise.all(fl); this.layout(ev.seat); this.pileDepth.removeChildren(); break;
      }
      case "meld": {
        const sd = this.sideSeatOf(ev.seat);
        for (const it of ev.items) {
          const g = this.groupOf(sd, it.meld) ?? this.newGroup(sd, it.meld, "meld");
          this.addToGroup(g, ev.seat, it.cards); g.cards = it.result.map((id) => g.cards.find((x) => x.id === id)!).filter(Boolean);
          this.staged = this.staged.filter((s) => !s.some((c) => it.cards.includes(c)));
          this.layoutMelds(); this.layout(ev.seat); await sleep(360);
        }
        break;
      }
      case "discard": {
        const mine = ev.seat === this.me; const cv = this.takeFrom(ev.seat, ev.card); cv.reveal(ev.card); if (!mine) void cv.flip(true, 0.3);
        this.layout(ev.seat); const old = this.discardView; this.discardView = cv;
        if (old) { const back = new CardView(null, false); back.position.set(0, 0); back.scale.set(0.8); back.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); this.pileDepth.addChild(back); old.destroy(); if (this.pileDepth.children.length > 4) this.pileDepth.removeChildAt(0).destroy(); }
        await this.fly(cv, { x: DISC.x, y: DISC.y, rot: (Math.random() - 0.5) * 0.3, scale: 0.8 }, 0.5);
        if (isWild(ev.card)) { this.frozenMark.visible = true; this.frozenMark.alpha = 0; gsap.to(this.frozenMark, { alpha: 1, duration: 0.3 }); }
        break;
      }
      case "say": this.toast(t(ev.key, ev.vars ?? {})); sfx.win(); await sleep(ev.key === "ca_canasta" ? 900 : 1200); break;
    }
  }
  private async dealAll(u: Update<View, Move, Ev>) {
    this.dealt = true; const per = u.view.handSizes[this.me]!; const mine = u.view.hand.slice();
    for (let r = 0; r < per; r++) for (let k = 0; k < this.n; k++) {
      const seat = (this.me + k) % this.n, own = seat === this.me;
      if (own) { const id = mine[r]!; const cv = this.mk(id, false); this.mine.set(id, cv); } else this.opp[seat]!.push(this.mk(null, false));
      this.layout(seat); await sleep(r < 6 ? 45 : 30);
    }
    const top = u.view.discardTop; if (top) { const cv = this.mk(top, false); await this.fly(cv, { x: DISC.x, y: DISC.y, rot: 0.05, scale: 0.8 }, 0.45); await cv.flip(true); this.discardView = cv; }
    await sleep(250); for (const cv of this.mine.values()) this.handLayer.addChild(cv); this.layoutAll();
    await Promise.all([...this.mine.values()].map((cv, i) => sleep(i * 35).then(() => cv.flip(true)))); this.layoutAll();
  }
  private toast(text: string) {
    const tx = new Text({ text, style: { fill: "#ffe08a", fontSize: 54, fontWeight: "800", fontFamily: FONT, stroke: { color: "#000", width: 7 } } }); tx.anchor.set(0.5); tx.position.set(800, 400); tx.alpha = 0; tx.scale.set(0.6); this.fxLayer.addChild(tx);
    gsap.to(tx, { alpha: 1, duration: 0.25 }); gsap.to(tx.scale, { x: 1, y: 1, duration: 0.4, ease: "back.out(2)" }); gsap.to(tx, { alpha: 0, delay: 1.0, duration: 0.4, onComplete: () => tx.destroy() });
  }
  private note(text: string) { this.banner.textContent = text; this.banner.style.display = "block"; this.banner.classList.add("err"); setTimeout(() => { this.banner.classList.remove("err"); this.refresh(); }, 1800); sfx.tick(); }

  // ---------------------------------------------------------------- state sync
  private sync(v: View) {
    this.view = v;
    if (this.dealt) {
      const want = new Set(v.hand); const same = want.size === this.mine.size && [...want].every((c) => this.mine.has(c));
      if (!same) { for (const cv of this.mine.values()) cv.destroy(); this.mine.clear(); for (const c of v.hand) { const cv = this.mk(c, true, this.fan(this.me, 0, 1)); this.handLayer.addChild(cv); this.mine.set(c, cv); } }
      for (let s = 0; s < this.n; s++) { if (s === this.me) continue; const l = this.opp[s]!; while (l.length > v.handSizes[s]!) l.pop()!.destroy(); while (l.length < v.handSizes[s]!) { const cv = this.mk(null, false, this.fan(s, 0, 1)); this.handLayer.addChild(cv); l.push(cv); } }
      const sig = (gs: { side: number; kind: string; idx: number; cards: string[] }[]) => gs.slice().sort((a, b) => a.side - b.side || a.kind.localeCompare(b.kind) || a.idx - b.idx).map((g) => `${g.side}${g.kind}${g.idx}:${g.cards.join(",")}`).join("|");
      const have = this.groups.filter((g) => g.cards.length).map((g) => ({ side: g.side, kind: g.kind, idx: g.idx, cards: g.cards.map((c) => c.id!) }));
      const want2 = [...v.melds.flatMap((ms, side) => ms.map((m, idx) => ({ side, kind: "meld", idx, cards: m.cards }))), ...v.reds.flatMap((r, side) => (r.length ? [{ side, kind: "reds", idx: 0, cards: r }] : []))];
      if (sig(have) !== sig(want2)) {
        this.groups.forEach((g) => { g.cards.forEach((c) => c.destroy()); g.frame.destroy(); g.label.destroy(); }); this.groups = [];
        for (const w of want2) { const g = this.newGroup(w.side, w.idx, w.kind as "meld" | "reds"); g.cards = w.cards.map((c) => { const cv = this.mk(c, true); this.meldLayer.addChild(cv); return cv; }); }
      }
      this.layoutAll(); this.layoutMelds(false); this.syncPile(v);
    }
    this.stockText.text = String(v.stock); this.stockStack.visible = v.stock > 0;
    this.stockStack.children.forEach((c, i) => { c.visible = i < Math.max(1, Math.ceil(v.stock / 25)); });
    this.frozenMark.visible = v.frozen && !!v.discardTop;
    this.refresh();
  }
  private syncPile(v: View) {
    if (!v.discardTop) { this.discardView?.destroy(); this.discardView = null; this.pileDepth.removeChildren().forEach((c) => c.destroy()); this.pileText.text = ""; return; }
    if (!this.discardView || this.discardView.id !== v.discardTop) { this.discardView?.destroy(); const cv = new CardView(v.discardTop, true); cv.position.set(DISC.x, DISC.y); cv.scale.set(0.8); this.tableLayer.addChild(cv); this.discardView = cv; }
    const depth = Math.min(4, v.discardSize - 1);
    while (this.pileDepth.children.length > depth) this.pileDepth.removeChildAt(0).destroy();
    while (this.pileDepth.children.length < depth) { const b = new CardView(null, false); b.scale.set(0.8); b.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); b.rotation = (Math.random() - 0.5) * 0.08; this.pileDepth.addChild(b); }
    this.pileText.text = String(v.discardSize);
  }

  // ---------------------------------------------------------------- interaction
  private myTurn() { return !this.busy && this.legal.length > 0; }
  private send(m: Move) {
    if (this.busy) return; this.busy = true; const legal = this.legal; this.legal = []; const sel = new Set(this.selection), st = this.staged; this.selection.clear(); this.staged = []; this.layoutAll(); this.refresh();
    try { this.hooks.submit(m); } catch (e) { console.error("illegal move", e); this.busy = false; this.legal = legal; this.selection = sel; this.staged = st; this.layoutAll(); this.refresh(); }
  }
  private draw() { if (this.myTurn() && this.view?.phase === "draw" && this.legal.some((m) => m.t === "draw")) this.send({ t: "draw" }); }
  private takePile() {
    const v = this.view; if (!v || !this.myTurn() || v.phase !== "draw") return;
    const cards = [...this.selection], err = checkPile(v, cards, this.staged); if (err) { this.note(t(err)); return; }
    this.send({ t: "pile", cards, extra: this.staged.slice() });
  }
  private addToMeld(idx: number) {
    const v = this.view; if (!v || !this.myTurn() || v.phase !== "play" || !this.selection.size) return;
    const groups = [...this.staged.map((cards) => ({ to: null as number | null, cards })), { to: idx as number | null, cards: [...this.selection] }];
    const err = checkMelds(v, groups); if (err) { this.note(t(err)); return; }
    this.send({ t: "meld", groups });
  }
  private toggle(card: Card) {
    if (this.staged.some((g) => g.includes(card))) return;
    if (this.selection.has(card)) this.selection.delete(card); else this.selection.add(card);
    this.layout(this.me); this.refresh();
  }
  private refresh() {
    const v = this.view; if (!v) return;
    const turn = this.myTurn(), opened = (v.melds[v.mySide]?.length ?? 0) > 0;
    for (const [card, cv] of this.mine) {
      cv.eventMode = turn ? "static" : "none"; cv.cursor = "pointer"; cv.removeAllListeners();
      if (turn) cv.on("pointertap", () => this.toggle(card));
    }
    this.stockStack.eventMode = turn && v.phase === "draw" ? "static" : "none";
    const canPile = turn && v.phase === "draw" && !!v.discardTop;
    if (this.discardView) { this.discardView.eventMode = canPile ? "static" : "none"; this.discardView.cursor = "pointer"; this.discardView.removeAllListeners(); if (canPile) this.discardView.on("pointertap", () => this.takePile()); }
    gsap.killTweensOf(this.glow); gsap.to(this.glow, { alpha: turn && v.phase === "draw" && this.legal.some((m) => m.t === "pile") ? 0.9 : 0, duration: 0.3 });
    if (turn && v.phase === "draw" && this.legal.some((m) => m.t === "pile")) gsap.to(this.glow, { alpha: 0.35, duration: 0.9, yoyo: true, repeat: -1, delay: 0.3 });

    this.actions.innerHTML = "";
    const btn = (label: string, cls: string, fn: () => void, disabled = false) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.disabled = disabled; b.onclick = fn; this.actions.append(b); return b; };
    const sel = [...this.selection];
    const stagedVal = this.staged.reduce((a, g) => a + g.reduce((x, c) => x + points(c), 0), 0);
    const stagedBtns = () => {
      if (opened) return;
      btn(t("ca_stage"), "", () => { this.staged.push(sel); this.selection.clear(); this.layout(this.me); this.refresh(); }, sel.length < 3);
      if (this.staged.length) btn(t("rm_unstage"), "", () => { this.staged = []; this.layout(this.me); this.refresh(); });
    };
    if (turn && v.phase === "draw") {
      btn(t("ca_takePile", { n: v.discardSize }), sel.length || this.staged.length ? "primary" : "", () => this.takePile(), !v.discardTop);
      stagedBtns();
    } else if (turn && v.phase === "play") {
      if (!opened) {
        stagedBtns();
        if (this.staged.length) btn(`${t("rm_open")} ${stagedVal}/${v.minOpen}`, "primary", () => { const groups = this.staged.map((cards) => ({ to: null as number | null, cards })); const err = checkMelds(v, groups); if (err) this.note(t(err)); else this.send({ t: "meld", groups }); }, stagedVal < v.minOpen);
      } else btn(t("ca_newMeld"), "primary", () => { const groups = [{ to: null as number | null, cards: sel }]; const err = checkMelds(v, groups); if (err) this.note(t(err)); else this.send({ t: "meld", groups }); }, sel.length < 3);
      btn(t("rm_discard"), "primary", () => this.send({ t: "discard", card: sel[0]! }), sel.length !== 1 || !this.legal.some((m) => m.t === "discard" && m.card === sel[0]));
    }
    for (let s = 0; s < this.n; s++) gsap.to(this.plates[s]!.ring, { alpha: !v.over && v.turn === s ? 1 : 0, duration: 0.25 });
    let msg = ""; if (!v.over) msg = v.turn === this.me ? (v.phase === "draw" ? t("ca_drawPrompt") : t("ca_playPrompt")) : t("turnOf", { n: this.names[v.turn ?? 0] ?? "" });
    if (!this.banner.classList.contains("err")) { this.banner.textContent = msg; this.banner.style.display = this.busy || !msg ? "none" : "block"; }
    this.board.innerHTML = Array.from({ length: v.sides }, (_, sd) => {
      const names = seatsOf(this.n, sd).map((s) => (s === this.me ? t("you") : this.names[s])).join(" + "), on = v.turn !== null && sideOf(this.n, v.turn) === sd;
      return `<div class="${on ? "on" : ""}"><span>${names}</span><b>${v.sideScores[sd]}</b></div>`;
    }).join("") + `<div class="x">${t("ca_target", { n: v.target })} · ${t("ca_roundNo", { n: v.round + 1 })}</div>` + (opened ? "" : `<div class="x">${t("rm_minOpen", { n: v.minOpen })}</div>`)
      + (v.round > 0 ? `<div class="x">${t("ca_last")}: ${v.lastRound.map((x) => (x > 0 ? "+" : "") + x).join(" / ")}</div>` : "");
  }
}
void isJoker; void isCanasta;
