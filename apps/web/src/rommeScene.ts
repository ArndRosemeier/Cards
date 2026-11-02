import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import gsap from "gsap";
import { isJoker, rankOf, suitOf, RANKS, type Card } from "@cards/engine";
import type { Ev, Move, View } from "@cards/romme";
import { parseMeld } from "@cards/romme";
import type { Update } from "@cards/net";
import { sfx } from "./sfx.ts";
import { CardView, sleep, tween } from "./cardview.ts";
import { drawFelt } from "./cardart.ts";
import { t } from "./i18n.ts";
import { LAYOUTS, type GameScene, type SceneHooks } from "./trickScene.ts";

const W = 1600, H = 900;
const STOCK = { x: 700, y: 540 }, DISC = { x: 860, y: 540 };
const SUIT_ORDER = ["C", "H", "S", "D"];
const sortSuit = (h: Card[]) => h.slice().sort((a, b) => (isJoker(a) ? 1 : 0) - (isJoker(b) ? 1 : 0) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)));
const sortRank = (h: Card[]) => h.slice().sort((a, b) => (isJoker(a) ? 1 : 0) - (isJoker(b) ? 1 : 0) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)));

interface MeldView { owner: number; cards: CardView[]; frame: Graphics }

export class RommeScene implements GameScene<Update<View, Move, Ev>> {
  private world = new Container(); private bg = new Sprite();
  private tableLayer = new Container(); private meldLayer = new Container(); private handLayer = new Container(); private flyLayer = new Container(); private fxLayer = new Container();
  private mine = new Map<Card, CardView>(); private opp: CardView[][] = []; private melds: MeldView[] = [];
  private stockStack = new Container(); private stockText = new Text({ text: "", style: { fill: "#fff", fontSize: 22, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } });
  private discardView: CardView | null = null;
  private plates: { ring: Graphics; count: Text; name: Text }[] = [];
  private queue: Update<View, Move, Ev>[] = []; private running = false; private ready = false; private dealt = false; private busy = true; private destroyed = false; private finished = false;
  private view: View | null = null; private legal: Move[] = []; private me = 0; private n = 0; private names: string[] = [];
  private selection = new Set<Card>(); private staged: Card[][] = []; private sortMode: "suit" | "rank" = "suit";
  private actions = document.createElement("div"); private banner = document.createElement("div"); private board = document.createElement("div");
  private readonly app: Application; private readonly ui: HTMLElement; private readonly hooks: SceneHooks<Move>;

  constructor(app: Application, ui: HTMLElement, hooks: SceneHooks<Move>) {
    this.app = app; this.ui = ui; this.hooks = hooks;
    app.stage.addChild(this.bg, this.world);
    this.world.addChild(this.tableLayer, this.meldLayer, this.handLayer, this.flyLayer, this.fxLayer); this.handLayer.sortableChildren = true;
    this.bg.texture = Texture.from(drawFelt(W, H));
    this.stockStack.position.set(STOCK.x, STOCK.y); this.stockText.anchor.set(0.5); this.stockText.position.set(STOCK.x, STOCK.y + 92);
    this.tableLayer.addChild(this.stockStack, this.stockText);
    this.stockStack.eventMode = "static"; this.stockStack.cursor = "pointer"; this.stockStack.on("pointertap", () => this.draw("stock"));
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
    if (this.view?.over && !this.finished && !this.destroyed) { this.finished = true; const sc = this.view.scores; this.hooks.onFinished(sc.indexOf(Math.min(...sc)), this.names, this.me); }
  }

  private setup(u: Update<View, Move, Ev>) {
    this.me = u.view.you as number; this.n = u.view.handSizes.length; this.names = u.seats.map((s) => s.name); this.opp = Array.from({ length: this.n }, () => []);
    const anchors = LAYOUTS[this.n]!;
    for (let s = 0; s < this.n; s++) {
      const rel = (s - this.me + this.n) % this.n, a = anchors[rel]!;
      const box = new Graphics(), ring = new Graphics();
      const name = new Text({ text: s === this.me ? t("you") : this.names[s]!, style: { fill: "#f4efe4", fontSize: 22, fontWeight: "600", fontFamily: "Segoe UI, sans-serif" } }); name.anchor.set(0.5); name.position.set(-18, 0);
      const count = new Text({ text: "", style: { fill: "#e8c66a", fontSize: 20, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } }); count.anchor.set(0.5); count.position.set(78, 0);
      box.roundRect(-100, -26, 200, 52, 26).fill({ color: 0, alpha: 0.45 }).stroke({ width: 1.5, color: 0xe8c66a, alpha: 0.5 });
      ring.roundRect(-104, -30, 208, 60, 30).stroke({ width: 3, color: 0xffe08a }); ring.alpha = 0;
      const plate = new Container(); plate.addChild(ring, box, name, count);
      if (rel === 0) plate.position.set(260, 640); else if (a.dy === -1) plate.position.set(a.cx, a.cy + 100); else plate.position.set(a.cx + (a.dx === -1 ? 170 : -170), a.cy + 130);
      this.tableLayer.addChild(plate); this.plates[s] = { ring, count, name };
    }
    for (let i = 0; i < 3; i++) { const c = new CardView(null, false); c.position.set(-i * 1.5, -i * 1.5); c.scale.set(0.8); this.stockStack.addChild(c); }
  }
  private anchor(seat: number) { return LAYOUTS[this.n]![(seat - this.me + this.n) % this.n]!; }
  private handOf(seat: number): CardView[] {
    if (seat !== this.me) return this.opp[seat]!;
    const order = this.sortMode === "suit" ? sortSuit([...this.mine.keys()]) : sortRank([...this.mine.keys()]);
    return order.map((c) => this.mine.get(c)!);
  }
  private fan(seat: number, i: number, n: number) {
    const a = this.anchor(seat), own = seat === this.me;
    const step = own ? Math.min(62, 1050 / Math.max(n, 1)) : Math.min(22, 330 / Math.max(n, 1));
    const tt = i - (n - 1) / 2, lx = tt * step, ly = tt * tt * (own ? 0.5 : 0.3), cos = Math.cos(a.rot), sin = Math.sin(a.rot);
    return { x: a.cx + lx * cos - ly * sin + (own ? 0 : 0), y: a.cy + (own ? 20 : 0) + lx * sin + ly * cos, rot: a.rot + tt * 0.02, scale: own ? 0.95 : 0.5 };
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

  private layoutMelds(animate = true) {
    // left-to-right, wrapping rows, in the central area
    let x = 250, y = 190; const rowH = 120, maxX = 1350;
    for (const m of this.melds) {
      const step = 34, wdt = (m.cards.length - 1) * step + 70;
      if (x + wdt > maxX) { x = 250; y += rowH; }
      m.cards.forEach((cv, i) => {
        if (cv.parent !== this.meldLayer) this.meldLayer.addChild(cv);
        const sl = { x: x + 35 + i * step, y: y + 50, rot: 0, scale: 0.5 }; cv.slot = sl;
        gsap.to(cv, { x: sl.x, y: sl.y, rotation: 0, duration: animate ? 0.4 : 0, ease: "power3.out", overwrite: "auto" }); gsap.to(cv.scale, { x: 0.5, y: 0.5, duration: animate ? 0.4 : 0 });
        cv.zIndex = i;
      });
      m.frame.clear().roundRect(x - 6, y - 8, wdt + 12, 116, 14).stroke({ width: 2, color: m.owner === this.me ? 0xffe08a : 0xffffff, alpha: 0.35 }).fill({ color: 0x000000, alpha: 0.12 });
      m.frame.eventMode = "static"; m.frame.cursor = "pointer"; m.frame.removeAllListeners();
      const idx = this.melds.indexOf(m); m.frame.on("pointertap", () => this.tryLayoff(idx));
      x += wdt + 22;
    }
    this.meldLayer.sortableChildren = true;
  }

  private mk(id: Card | null, up: boolean, at = STOCK) { const cv = new CardView(id, up); cv.position.set(at.x, at.y); cv.scale.set(0.8); this.flyLayer.addChild(cv); return cv; }
  private async fly(cv: CardView, to: { x: number; y: number; rot: number; scale: number }, d = 0.5) {
    this.flyLayer.addChild(cv);
    gsap.to(cv, { lift: 1, duration: d * 0.45 }); gsap.to(cv, { lift: 0, duration: d * 0.45, delay: d * 0.55 });
    gsap.to(cv, { rotation: to.rot, duration: d, ease: "power2.inOut" }); gsap.to(cv.scale, { x: to.scale, y: to.scale, duration: d, ease: "power2.inOut" });
    await tween(cv, { x: to.x, y: to.y, duration: d, ease: "power3.inOut" });
    sfx.place();
  }
  private takeFrom(seat: number, card: Card): CardView {
    if (seat === this.me) { const cv = this.mine.get(card) ?? this.mk(card, true); this.mine.delete(card); return cv; }
    const h = this.opp[seat]!; const cv = h.splice(Math.floor(h.length / 2), 1)[0] ?? this.mk(null, false); return cv;
  }

  private async animate(ev: Ev, u: Update<View, Move, Ev>) {
    switch (ev.t) {
      case "newRound": {
        const all = [...this.mine.values(), ...this.opp.flat(), ...this.melds.flatMap((m) => m.cards), ...(this.discardView ? [this.discardView] : [])];
        this.melds.forEach((m) => m.frame.destroy()); this.melds = []; this.mine.clear(); this.opp = Array.from({ length: this.n }, () => []); this.discardView = null; this.staged = []; this.selection.clear();
        all.forEach((c) => gsap.to(c, { alpha: 0, duration: 0.4, onComplete: () => c.destroy() })); this.dealt = false; await sleep(this.ready && all.length ? 450 : 0); break;
      }
      case "dealt": if (!this.dealt) await this.dealAll(u); break;
      case "draw": {
        const own = ev.seat === this.me; let cv: CardView;
        if (ev.from === "discard") { cv = this.discardView ?? this.mk(ev.card, true, DISC); this.discardView = null; cv.reveal(ev.card); } else { cv = this.mk(own ? ev.card : null, false); }
        if (own) this.mine.set(ev.card, cv); else this.opp[ev.seat]!.push(cv);
        this.layout(ev.seat); const sl = this.fan(ev.seat, 0, 1);
        await this.fly(cv, sl, 0.5); if (own && !cv.faceUp) await cv.flip(true, 0.25); this.layout(ev.seat);
        if (ev.from === "discard") this.refreshDiscard(u.view); break;
      }
      case "meld": {
        for (let gi = 0; gi < ev.groups.length; gi++) {
          const cards = ev.groups[gi]!; const mv: MeldView = { owner: ev.seat, cards: [], frame: new Graphics() }; this.meldLayer.addChild(mv.frame); this.melds.push(mv);
          const mine = ev.seat === this.me;
          for (const c of cards) { const cv = this.takeFrom(ev.seat, c); cv.reveal(c); if (!mine) void cv.flip(true, 0.3); mv.cards.push(cv); }
          this.staged = this.staged.filter((g) => !g.some((c) => cards.includes(c)));
          this.layoutMelds(); this.layout(ev.seat); await sleep(380);
        }
        break;
      }
      case "layoff": {
        const mv = this.melds[ev.meld]; if (!mv) break; const mine = ev.seat === this.me;
        for (const c of ev.cards) { const cv = this.takeFrom(ev.seat, c); cv.reveal(c); if (!mine) void cv.flip(true, 0.3); mv.cards.push(cv); }
        mv.cards = ev.result.map((id) => mv.cards.find((x) => x.id === id)!).filter(Boolean);
        this.layoutMelds(); this.layout(ev.seat); await sleep(350); break;
      }
      case "discard": {
        const mine = ev.seat === this.me; const cv = this.takeFrom(ev.seat, ev.card); cv.reveal(ev.card); if (!mine) void cv.flip(true, 0.3);
        this.layout(ev.seat); const old = this.discardView; this.discardView = cv;
        await this.fly(cv, { x: DISC.x, y: DISC.y, rot: (Math.random() - 0.5) * 0.4, scale: 0.8 }, 0.5); old?.destroy(); break;
      }
      case "reshuffle": this.toast(t("rm_reshuffle")); await sleep(500); break;
      case "say": this.toast(t(ev.key, ev.vars ?? {})); await sleep(900); break;
    }
  }
  private async dealAll(u: Update<View, Move, Ev>) {
    this.dealt = true; const per = u.view.handSizes[this.me]!; const mine = u.view.hand.slice();
    for (let r = 0; r < per; r++) for (let k = 0; k < this.n; k++) {
      const seat = (this.me + k) % this.n, own = seat === this.me;
      if (own) { const id = mine[r]!; const cv = this.mk(id, false); this.mine.set(id, cv); } else this.opp[seat]!.push(this.mk(null, false));
      this.layout(seat); await sleep(55);
    }
    const top = u.view.discardTop; if (top) { const cv = this.mk(top, false); await this.fly(cv, { x: DISC.x, y: DISC.y, rot: 0.05, scale: 0.8 }, 0.45); await cv.flip(true); this.discardView = cv; }
    await sleep(300); for (const cv of this.mine.values()) this.handLayer.addChild(cv); this.layoutAll();
    await Promise.all([...this.mine.values()].map((cv, i) => sleep(i * 40).then(() => cv.flip(true)))); this.layoutAll();
  }
  private refreshDiscard(v: View) {
    if (!v.discardTop) { this.discardView?.destroy(); this.discardView = null; return; }
    if (!this.discardView || this.discardView.id !== v.discardTop) { this.discardView?.destroy(); const cv = new CardView(v.discardTop, true); cv.position.set(DISC.x, DISC.y); cv.scale.set(0.8); this.tableLayer.addChild(cv); this.discardView = cv; this.discardView.eventMode = "static"; }
  }
  private toast(text: string) {
    const tx = new Text({ text, style: { fill: "#ffe08a", fontSize: 44, fontWeight: "800", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 6 } } }); tx.anchor.set(0.5); tx.position.set(800, 120); tx.alpha = 0; this.fxLayer.addChild(tx);
    gsap.to(tx, { alpha: 1, duration: 0.3 }); gsap.to(tx, { alpha: 0, delay: 1.1, duration: 0.4, onComplete: () => tx.destroy() });
  }

  private sync(v: View) {
    this.view = v;
    if (this.dealt) {
      const want = new Set(v.hand); const same = want.size === this.mine.size && [...want].every((c) => this.mine.has(c));
      if (!same) { for (const cv of this.mine.values()) cv.destroy(); this.mine.clear(); for (const c of v.hand) { const cv = this.mk(c, true); this.handLayer.addChild(cv); this.mine.set(c, cv); } }
      for (let s = 0; s < this.n; s++) { if (s === this.me) continue; const l = this.opp[s]!; while (l.length > v.handSizes[s]!) l.pop()!.destroy(); while (l.length < v.handSizes[s]!) { const cv = this.mk(null, false); this.handLayer.addChild(cv); l.push(cv); } }
      const sig = (ms: { cards: Card[] }[]) => ms.map((m) => m.cards.join(",")).join("|");
      if (sig(this.melds.map((m) => ({ cards: m.cards.map((c) => c.id!) }))) !== sig(v.melds)) {
        this.melds.forEach((m) => { m.cards.forEach((c) => c.destroy()); m.frame.destroy(); }); this.melds = [];
        for (const m of v.melds) { const mv: MeldView = { owner: m.owner, cards: m.cards.map((c) => { const cv = this.mk(c, true); return cv; }), frame: new Graphics() }; this.meldLayer.addChild(mv.frame); this.melds.push(mv); }
      }
      this.layoutAll(); this.layoutMelds(false); this.refreshDiscard(v);
    }
    this.stockText.text = String(v.stock); this.stockStack.visible = v.stock > 0;
    this.stockStack.children.forEach((c, i) => { c.visible = i < Math.max(1, Math.ceil(v.stock / 30)); });
    this.refresh();
  }

  // -------------------------------------------------------------- interaction
  private myTurn() { return !this.busy && this.legal.length > 0; }
  private send(m: Move) { if (this.busy) return; this.busy = true; this.legal = []; this.selection.clear(); this.staged = []; this.layoutAll(); this.refresh(); this.hooks.submit(m); }
  private draw(from: "stock" | "discard") { if (this.myTurn() && this.legal.some((m) => m.t === "draw" && m.from === from)) this.send({ t: "draw", from }); }
  private tryLayoff(meld: number) {
    if (!this.myTurn() || this.view?.phase !== "play" || !this.selection.size) return;
    const m = this.view.melds[meld]; if (!m) return;
    if (!this.view.opened[this.me]) { this.toast(t("rm_openFirst")); return; }
    if (parseMeld([...m.cards, ...this.selection])) this.send({ t: "layoff", cards: [...this.selection], meld });
    else this.toast(t("rm_noFit"));
  }
  private toggle(card: Card) {
    if (this.staged.some((g) => g.includes(card))) return;
    if (this.selection.has(card)) this.selection.delete(card); else this.selection.add(card);
    this.layout(this.me); this.refresh();
  }
  private refresh() {
    const v = this.view; if (!v) return;
    const turn = this.myTurn();
    for (const [card, cv] of this.mine) {
      cv.eventMode = turn && v.phase === "play" ? "static" : "none"; cv.cursor = "pointer"; cv.removeAllListeners();
      if (turn && v.phase === "play") cv.on("pointertap", () => this.toggle(card));
    }
    this.stockStack.eventMode = turn && v.phase === "draw" ? "static" : "none";
    if (this.discardView) { this.discardView.eventMode = turn && v.phase === "draw" ? "static" : "none"; this.discardView.cursor = "pointer"; this.discardView.removeAllListeners(); if (turn && v.phase === "draw") this.discardView.on("pointertap", () => this.draw("discard")); }
    this.actions.innerHTML = "";
    const btn = (label: string, cls: string, fn: () => void, disabled = false) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.disabled = disabled; b.onclick = fn; this.actions.append(b); return b; };
    if (turn && v.phase === "play") {
      const sel = [...this.selection]; const meld = sel.length >= 3 ? parseMeld(sel) : null; const opened = v.opened[this.me]!;
      const stagedVal = this.staged.reduce((a, g) => a + (parseMeld(g)?.value ?? 0), 0);
      if (!opened) {
        btn(`${t("rm_addGroup")}${meld ? ` (${meld.value})` : ""}`, "", () => { this.staged.push(sel); this.selection.clear(); this.layout(this.me); this.refresh(); }, !meld);
        if (this.staged.length) {
          btn(`${t("rm_open")} ${stagedVal}/${v.minOpen}`, "primary", () => this.send({ t: "meld", groups: this.staged }), stagedVal < v.minOpen);
          btn(t("rm_unstage"), "", () => { this.staged = []; this.layout(this.me); this.refresh(); });
        }
      } else btn(`${t("rm_meld")}${meld ? ` (${meld.value})` : ""}`, "primary", () => this.send({ t: "meld", groups: [sel] }), !meld);
      btn(t("rm_discard"), opened || !this.staged.length ? "primary" : "", () => this.send({ t: "discard", card: sel[0]! }), sel.length !== 1 || (v.taken === sel[0] && v.handSizes[this.me]! > 1));
    }
    if (this.dealt) btn(this.sortMode === "suit" ? "123" : "♣♥", "small", () => { this.sortMode = this.sortMode === "suit" ? "rank" : "suit"; this.layout(this.me); });
    for (let s = 0; s < this.n; s++) gsap.to(this.plates[s]!.ring, { alpha: !v.over && v.turn === s ? 1 : 0, duration: 0.25 });
    let msg = ""; if (!v.over) msg = v.turn === this.me ? (v.phase === "draw" ? t("rm_drawPrompt") : t("rm_playPrompt")) : t("turnOf", { n: this.names[v.turn ?? 0] ?? "" });
    this.banner.textContent = msg; this.banner.style.display = this.busy || !msg ? "none" : "block";
    this.board.innerHTML = this.names.map((nm, i) => `<div class="${v.turn === i ? "on" : ""}"><span>${i === this.me ? t("you") : nm}</span><b>${v.scores[i]}</b></div>`).join("") + `<div class="x">${t("roundNo", { a: v.round + 1, b: v.rounds })}</div><div class="x">${t("rm_minOpen", { n: v.minOpen })}</div>`;
  }
}
