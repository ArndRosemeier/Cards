import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import gsap from "gsap";
import type { Card } from "@cards/engine";
import type { Ev, Move, View } from "@cards/holdem";
import type { Update } from "@cards/net";
import { CardView, sleep, tween } from "./cardview.ts";
import { drawFelt } from "./cardart.ts";
import { t } from "./i18n.ts";
import type { GameScene, SceneHooks } from "./trickScene.ts";

const W = 1600, H = 900;
const TABLE = { x: 800, y: 430, rx: 640, ry: 290 };
const DECK = { x: 800, y: 175 };
const SLOT = (i: number) => ({ x: 800 + (i - 2) * 128, y: 405 });
const POT = { x: 800, y: 300 };

const CHIPS: [number, number][] = [[1000, 0xe3b341], [500, 0x7c4dab], [100, 0x2b2b30], [25, 0x2e8b57], [5, 0xc0392b], [1, 0xe9e4d4]];
function chipStack(amount: number): Container {
  const c = new Container(); let rest = amount; let col = 0;
  for (const [den, color] of CHIPS) {
    const n = Math.min(Math.floor(rest / den), 8); if (!Math.floor(rest / den)) continue;
    rest -= Math.floor(rest / den) * den;
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      g.ellipse(0, 0, 17, 9).fill(color).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      g.ellipse(0, 0, 11, 5.5).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
      g.position.set(col * 36, -i * 4.5); c.addChild(g);
    }
    col++; if (col > 3) break;
  }
  c.pivot.set(Math.max(0, (col - 1) * 18), 0);
  return c;
}

interface SeatUi { plate: Container; name: Text; stack: Text; status: Text; ring: Graphics; cards: CardView[]; betSpot: { x: number; y: number }; betNode: Container; pos: { x: number; y: number }; handLabel: Text }

export class HoldemScene implements GameScene<Update<View, Move, Ev>> {
  private world = new Container();
  private bg = new Sprite();
  private tableG = new Graphics();
  private layerA = new Container(); private layerB = new Container(); private layerFx = new Container();
  private seats: SeatUi[] = [];
  private community: (CardView | null)[] = [null, null, null, null, null];
  private potNode = new Container(); private potText = new Text({ text: "", style: { fill: "#fff", fontSize: 26, fontWeight: "700", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 4 } } });
  private dealerBtn = new Container();
  private disp = { stacks: [] as number[], bets: [] as number[], pot: 0 };
  private queue: Update<View, Move, Ev>[] = [];
  private running = false; private ready = false; private busy = true; private destroyed = false; private finished = false;
  private view: View | null = null; private legal: Move[] = [];
  private me = 0; private n = 0; private names: string[] = [];
  private controls = document.createElement("div"); private banner = document.createElement("div"); private board = document.createElement("div");
  private readonly app: Application; private readonly ui: HTMLElement; private readonly hooks: SceneHooks<Move>;
  private raiseTo = 0;

  constructor(app: Application, ui: HTMLElement, hooks: SceneHooks<Move>) {
    this.app = app; this.ui = ui; this.hooks = hooks;
    app.stage.addChild(this.bg, this.world);
    this.world.addChild(this.tableG, this.layerA, this.layerB, this.layerFx);
    this.bg.texture = Texture.from(drawFelt(W, H));
    this.drawTable();
    this.potNode.position.set(POT.x, POT.y); this.potText.anchor.set(0.5); this.potText.position.set(POT.x, POT.y + 34);
    this.layerA.addChild(this.potNode, this.potText);
    const d = new Graphics().circle(0, 0, 16).fill(0xf4efe4).stroke({ width: 2, color: 0x222222 }); const dt = new Text({ text: "D", style: { fill: "#222", fontSize: 18, fontWeight: "800" } }); dt.anchor.set(0.5); this.dealerBtn.addChild(d, dt);
    this.layerB.addChild(this.dealerBtn);
    this.controls.className = "hcontrols"; this.banner.className = "banner"; this.banner.style.display = "none"; this.board.className = "board";
    ui.append(this.controls, this.banner, this.board);
    this.resize(); window.addEventListener("resize", this.onResize);
  }
  private onResize = () => this.resize();
  private resize() {
    const w = this.app.screen.width, h = this.app.screen.height, s = Math.min(w / W, h / H);
    this.world.scale.set(s); this.world.position.set((w - W * s) / 2, (h - H * s) / 2); this.bg.width = w; this.bg.height = h;
  }
  destroy() {
    this.destroyed = true; window.removeEventListener("resize", this.onResize); gsap.killTweensOf("*");
    this.controls.remove(); this.banner.remove(); this.board.remove(); this.app.stage.removeChildren();
  }
  private drawTable() {
    const g = this.tableG;
    g.ellipse(TABLE.x, TABLE.y + 10, TABLE.rx + 38, TABLE.ry + 38).fill({ color: 0x000000, alpha: 0.35 });
    g.ellipse(TABLE.x, TABLE.y, TABLE.rx + 30, TABLE.ry + 30).fill(0x4a2c17).stroke({ width: 4, color: 0x2a170b });
    g.ellipse(TABLE.x, TABLE.y, TABLE.rx + 8, TABLE.ry + 8).fill(0x2e1a0d);
    g.ellipse(TABLE.x, TABLE.y, TABLE.rx, TABLE.ry).fill(0x0f6b43).stroke({ width: 3, color: 0x0a4a2e });
    g.ellipse(TABLE.x, TABLE.y, TABLE.rx - 60, TABLE.ry - 50).stroke({ width: 2, color: 0xe8c66a, alpha: 0.25 });
  }

  receive(u: Update<View, Move, Ev>) { this.queue.push(u); void this.drain(); }
  private async drain() {
    if (this.running) return; this.running = true;
    while (this.queue.length && !this.destroyed) {
      const u = this.queue.shift()!; this.busy = true; this.legal = []; this.refresh();
      try {
        if (!this.ready) { this.ready = true; this.setup(u); }
        for (const ev of u.events) await this.animate(ev, u);
      } catch (e) { console.error("animation error", e); }
      this.sync(u.view);
      if (!this.queue.length) { this.busy = false; this.legal = u.legal; this.refresh(); }
    }
    this.running = false;
    if (this.view?.over && !this.finished && !this.destroyed) { this.finished = true; this.hooks.onFinished(this.view.stacks.findIndex((x) => x > 0), this.names, this.me); }
  }

  private seatPos(seat: number) {
    const rel = (seat - this.me + this.n) % this.n;
    const th = (rel / this.n) * Math.PI * 2;
    return { x: TABLE.x - Math.sin(th) * (TABLE.rx - 40), y: TABLE.y + Math.cos(th) * (TABLE.ry - 20), th };
  }
  private setup(u: Update<View, Move, Ev>) {
    this.me = u.view.you as number; this.n = u.view.stacks.length; this.names = u.seats.map((s) => s.name);
    const first = u.events.some((e) => e.t === "newHand");
    this.disp.stacks = u.view.stacks.map((x, i) => (first ? x + u.view.bets[i]! : x)); this.disp.bets = first ? Array(this.n).fill(0) : u.view.bets.slice(); this.disp.pot = first ? 0 : u.view.pot - u.view.bets.reduce((a, b) => a + b, 0);
    for (let s = 0; s < this.n; s++) {
      const p = this.seatPos(s); const mine = s === this.me;
      const plate = new Container(); plate.position.set(p.x, mine ? 790 : p.y + (p.y < TABLE.y ? 62 : -62));
      const box = new Graphics().roundRect(-100, -34, 200, 68, 20).fill({ color: 0x000000, alpha: 0.6 }).stroke({ width: 2, color: 0xe8c66a, alpha: 0.6 });
      const ring = new Graphics().roundRect(-106, -40, 212, 80, 24).stroke({ width: 4, color: 0xffe08a }); ring.alpha = 0;
      const name = new Text({ text: mine ? t("you") : this.names[s]!, style: { fill: "#f4efe4", fontSize: 21, fontWeight: "600", fontFamily: "Segoe UI, sans-serif" } }); name.anchor.set(0.5); name.position.set(0, -12);
      const stack = new Text({ text: "", style: { fill: "#e8c66a", fontSize: 22, fontWeight: "700", fontFamily: "Segoe UI, sans-serif" } }); stack.anchor.set(0.5); stack.position.set(0, 12);
      const status = new Text({ text: "", style: { fill: "#ffe08a", fontSize: 20, fontWeight: "700", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 4 } } }); status.anchor.set(0.5); status.position.set(0, mine ? -52 : 52);
      const handLabel = new Text({ text: "", style: { fill: "#fff", fontSize: 20, fontWeight: "700", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 4 } } }); handLabel.anchor.set(0.5); handLabel.position.set(0, mine ? -78 : 76);
      plate.addChild(ring, box, name, stack, status, handLabel); this.layerA.addChild(plate);
      const bx = p.x + (TABLE.x - p.x) * 0.38, by = p.y + (TABLE.y + 10 - p.y) * 0.4 + (mine ? -40 : 0);
      const betNode = new Container(); betNode.position.set(bx, by); this.layerA.addChild(betNode);
      this.seats[s] = { plate, name, stack, status, ring, cards: [], betSpot: { x: bx, y: by }, betNode, pos: { x: p.x, y: p.y }, handLabel };
    }
  }

  private holeSlot(seat: number, i: number) {
    const mine = seat === this.me, sp = this.seats[seat]!;
    if (mine) return { x: 800 + (i - 0.5) * 150, y: 690, rot: (i - 0.5) * 0.12, scale: 0.95 };
    return { x: sp.pos.x + (i - 0.5) * 46, y: sp.pos.y + (sp.pos.y < TABLE.y ? 0 : -4), rot: (i - 0.5) * 0.15, scale: 0.42 };
  }
  private mk(id: Card | null, up: boolean, at = DECK) { const cv = new CardView(id, up); cv.position.set(at.x, at.y); cv.scale.set(0.4); this.layerB.addChild(cv); return cv; }
  private async fly(cv: CardView, to: { x: number; y: number; rot: number; scale: number }, d = 0.5) {
    this.layerB.addChild(cv);
    gsap.to(cv, { lift: 1, duration: d * 0.45 }); gsap.to(cv, { lift: 0, duration: d * 0.45, delay: d * 0.55 });
    gsap.to(cv, { rotation: to.rot, duration: d, ease: "power2.inOut" }); gsap.to(cv.scale, { x: to.scale, y: to.scale, duration: d, ease: "power2.inOut" });
    await tween(cv, { x: to.x, y: to.y, duration: d, ease: "power3.inOut" });
  }
  private flyChips(from: { x: number; y: number }, to: { x: number; y: number }, amount: number): Promise<void> {
    const c = chipStack(Math.max(1, Math.min(amount, 300))); c.position.set(from.x, from.y); c.alpha = 0.95; this.layerFx.addChild(c);
    return tween(c, { x: to.x, y: to.y, duration: 0.5, ease: "power2.inOut" }).then(() => { c.destroy(); });
  }
  private setBet(seat: number, amount: number) {
    const sp = this.seats[seat]!; sp.betNode.removeChildren().forEach((c) => c.destroy());
    if (amount <= 0) return;
    const st = chipStack(amount); sp.betNode.addChild(st);
    const tx = new Text({ text: String(amount), style: { fill: "#fff", fontSize: 20, fontWeight: "700", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 4 } } }); tx.anchor.set(0.5); tx.position.set(0, 24); sp.betNode.addChild(tx);
  }
  private renderPot() {
    this.potNode.removeChildren().forEach((c) => c.destroy());
    if (this.disp.pot > 0) this.potNode.addChild(chipStack(this.disp.pot));
    this.potText.text = this.disp.pot > 0 ? String(this.disp.pot) : "";
  }
  private renderStacks() { this.seats.forEach((s, i) => { s.stack.text = String(this.disp.stacks[i] ?? 0); }); }
  private placeDealer(seat: number) {
    const sp = this.seats[seat]!; const dx = (TABLE.x - sp.pos.x) * 0.22, dy = (TABLE.y - sp.pos.y) * 0.22;
    gsap.to(this.dealerBtn, { x: sp.pos.x + dx + 70, y: sp.pos.y + dy, duration: 0.6, ease: "power2.inOut" });
  }
  private clearHand() {
    for (const s of this.seats) { s.cards.forEach((c) => c.destroy()); s.cards = []; s.status.text = ""; s.handLabel.text = ""; this.setBet(this.seats.indexOf(s), 0); s.plate.alpha = 1; }
    this.community.forEach((c) => c?.destroy()); this.community = [null, null, null, null, null];
  }

  private async animate(ev: Ev, u: Update<View, Move, Ev>) {
    switch (ev.t) {
      case "newHand": {
        this.clearHand(); this.disp.bets = Array(this.n).fill(0); this.renderStacks(); this.renderPot();
        this.placeDealer(ev.dealer); await sleep(350); break;
      }
      case "blind": {
        this.disp.stacks[ev.seat]! -= ev.amount; this.disp.bets[ev.seat]! += ev.amount; this.renderStacks();
        await this.flyChips(this.seats[ev.seat]!.plate.position, this.seats[ev.seat]!.betSpot, ev.amount); this.setBet(ev.seat, this.disp.bets[ev.seat]!);
        this.seats[ev.seat]!.status.text = ""; break;
      }
      case "dealHole": {
        // deal in table order; one card per seat per pass is approximated by seat-by-seat with a short stagger
        const sp = this.seats[ev.seat]!; const mine = ev.seat === this.me;
        for (let i = 0; i < ev.cards.length; i++) {
          const cv = this.mk(mine ? ev.cards[i]! : null, false); sp.cards.push(cv);
          void this.fly(cv, this.holeSlot(ev.seat, i), 0.45).then(() => { if (mine) return sleep(120).then(() => cv.flip(true)); });
          await sleep(70);
        }
        break;
      }
      case "act": {
        const sp = this.seats[ev.seat]!;
        const label = ev.action === "fold" ? t("hFold") : ev.action === "check" ? t("hCheck") : ev.action === "call" ? t("hCall") : ev.action === "allin" ? t("hAllIn") : t("hRaiseTo", { n: ev.to });
        sp.status.text = label; gsap.fromTo(sp.status.scale, { x: 1.4, y: 1.4 }, { x: 1, y: 1, duration: 0.3, ease: "back.out(2)" });
        if (ev.amount > 0) {
          this.disp.stacks[ev.seat]! -= ev.amount; this.disp.bets[ev.seat]! += ev.amount; this.renderStacks();
          await this.flyChips(sp.plate.position, sp.betSpot, ev.amount); this.setBet(ev.seat, this.disp.bets[ev.seat]!);
        }
        if (ev.action === "fold") { sp.cards.forEach((c, i) => gsap.to(c, { x: DECK.x, y: DECK.y, alpha: 0, rotation: c.rotation + 1, duration: 0.45, delay: i * 0.05 })); gsap.to(sp.plate, { alpha: 0.5, duration: 0.3 }); await sleep(450); }
        else await sleep(260);
        break;
      }
      case "sweep": {
        const jobs: Promise<void>[] = [];
        this.disp.bets.forEach((b, i) => { if (b > 0) { jobs.push(this.flyChips(this.seats[i]!.betSpot, POT, b)); this.disp.pot += b; this.setBet(i, 0); } });
        this.disp.bets = Array(this.n).fill(0); await Promise.all(jobs); this.renderPot();
        this.seats.forEach((s) => { s.status.text = ""; }); break;
      }
      case "community": {
        const start = ev.street === "flop" ? 0 : ev.street === "turn" ? 3 : 4;
        for (let i = 0; i < ev.cards.length; i++) {
          const cv = this.mk(ev.cards[i]!, false); this.community[start + i] = cv; const sl = SLOT(start + i);
          await this.fly(cv, { ...sl, rot: 0, scale: 0.82 }, 0.5); await cv.flip(true, 0.3); await sleep(80);
        }
        break;
      }
      case "show": {
        const sp = this.seats[ev.seat]!;
        if (ev.seat !== this.me) {
          sp.cards.forEach((c, i) => { c.reveal(ev.cards[i]!); gsap.to(c.scale, { x: 0.62, y: 0.62, duration: 0.3 }); gsap.to(c, { y: c.y - (sp.pos.y < TABLE.y ? -30 : 30), duration: 0.3 }); });
          await Promise.all(sp.cards.map((c) => c.flip(true, 0.35)));
        }
        sp.handLabel.text = t("hh_" + ev.hand); await sleep(450); break;
      }
      case "award": {
        const sp = this.seats[ev.seat]!;
        await this.flyChips(POT, sp.plate.position, ev.amount); this.disp.pot = Math.max(0, this.disp.pot - ev.amount); this.disp.stacks[ev.seat]! += ev.amount; this.renderPot(); this.renderStacks();
        sp.status.text = `+${ev.amount}`; gsap.fromTo(sp.plate.scale, { x: 1.12, y: 1.12 }, { x: 1, y: 1, duration: 0.5, ease: "elastic.out(1,0.5)" });
        this.sparkle(sp.plate.position); await sleep(900); break;
      }
      case "out": gsap.to(this.seats[ev.seat]!.plate, { alpha: 0.3, duration: 0.5 }); break;
      case "say": this.toast(t(ev.key, ev.vars ?? {})); await sleep(600); break;
    }
    void u;
  }
  private sparkle(at: { x: number; y: number }) {
    for (let i = 0; i < 28; i++) {
      const p = new Graphics().circle(0, 0, 3 + Math.random() * 3).fill(i % 2 ? 0xffe08a : 0xffffff); p.position.set(at.x, at.y); this.layerFx.addChild(p);
      const a = Math.random() * 6.28, d = 60 + Math.random() * 110;
      gsap.to(p, { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, alpha: 0, duration: 0.9, ease: "power2.out", onComplete: () => p.destroy() });
    }
  }
  private toast(text: string) {
    const tx = new Text({ text, style: { fill: "#ffe08a", fontSize: 40, fontWeight: "800", fontFamily: "Segoe UI, sans-serif", stroke: { color: "#000", width: 6 } } }); tx.anchor.set(0.5); tx.position.set(800, 190); tx.alpha = 0; this.layerFx.addChild(tx);
    gsap.to(tx, { alpha: 1, duration: 0.3 }); gsap.to(tx, { alpha: 0, delay: 1.1, duration: 0.4, onComplete: () => tx.destroy() });
  }

  /** Match visuals to the authoritative view; heals drift. */
  private sync(v: View) {
    this.view = v;
    this.disp.stacks = v.stacks.slice(); this.disp.bets = v.bets.slice(); this.disp.pot = v.pot - v.bets.reduce((a, b) => a + b, 0);
    this.renderStacks(); this.renderPot(); v.bets.forEach((b, i) => this.setBet(i, b));
    for (let i = 0; i < 5; i++) {
      const want = v.community[i]; const cur = this.community[i];
      if (want && cur?.id !== want) { cur?.destroy(); const cv = this.mk(want, true, SLOT(i)); const sl = SLOT(i); cv.position.set(sl.x, sl.y); cv.scale.set(0.82); this.community[i] = cv; }
      if (!want && cur) { cur.destroy(); this.community[i] = null; }
    }
    v.out.forEach((o, i) => { this.seats[i]!.plate.alpha = o ? 0.3 : v.folded[i] && v.phase !== "over" ? 0.5 : 1; });
    for (let s = 0; s < this.n; s++) {
      const sp = this.seats[s]!; const inHand = v.inHand[s] && !v.out[s];
      const want = s === this.me ? v.hand.length : inHand ? 2 : 0;
      if (sp.cards.length !== want && !v.folded[s]) {
        sp.cards.forEach((c) => c.destroy()); sp.cards = [];
        for (let i = 0; i < want; i++) { const id = s === this.me ? v.hand[i]! : null; const cv = this.mk(id, s === this.me); const sl = this.holeSlot(s, i); cv.position.set(sl.x, sl.y); cv.rotation = sl.rot; cv.scale.set(sl.scale); sp.cards.push(cv); }
      }
    }
    this.placeDealer(v.dealer);
    this.raiseTo = Math.max(v.minRaiseTo, Math.min(this.raiseTo || v.minRaiseTo, v.maxRaiseTo));
    this.refresh();
  }

  private send(m: Move) { if (this.busy) return; this.busy = true; this.legal = []; this.refresh(); this.hooks.submit(m); }
  private refresh() {
    const v = this.view; if (!v) return;
    for (let s = 0; s < this.n; s++) gsap.to(this.seats[s]!.ring, { alpha: !v.over && v.turn === s ? 1 : 0, duration: 0.25 });
    this.controls.innerHTML = "";
    const mineTurn = !this.busy && this.legal.length > 0;
    if (mineTurn) {
      const call = this.legal.find((m) => m.t === "call"), check = this.legal.find((m) => m.t === "check"), fold = this.legal.find((m) => m.t === "fold");
      const raises = this.legal.filter((m): m is Extract<Move, { t: "raise" }> => m.t === "raise");
      const row = document.createElement("div"); row.className = "hrow";
      const btn = (label: string, cls: string, fn: () => void) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.onclick = fn; row.append(b); return b; };
      if (fold) btn(t("hFold"), "", () => this.send(fold));
      if (check) btn(t("hCheck"), "", () => this.send(check));
      if (call) btn(`${t("hCall")} ${Math.min(v.toCall, v.stacks[this.me]!)}`, "primary", () => this.send(call));
      this.controls.append(row);
      if (raises.length) {
        const lo = v.minRaiseTo, hi = v.maxRaiseTo; if (this.raiseTo < lo || this.raiseTo > hi) this.raiseTo = lo;
        const r2 = document.createElement("div"); r2.className = "hrow";
        const slider = document.createElement("input"); slider.type = "range"; slider.min = String(lo); slider.max = String(hi); slider.step = String(Math.max(1, Math.round(v.bb / 2))); slider.value = String(this.raiseTo);
        const lab = document.createElement("span"); lab.className = "hamt";
        const upd = () => { lab.textContent = this.raiseTo >= hi ? t("hAllIn") + " " + hi : String(this.raiseTo); go.textContent = (this.raiseTo >= hi ? t("hAllIn") : v.toCall > 0 || this.legal.some((m) => m.t === "call") ? t("hRaiseTo", { n: this.raiseTo }) : t("hBet", { n: this.raiseTo })); };
        const go = document.createElement("button"); go.className = "btn primary";
        slider.oninput = () => { this.raiseTo = Number(slider.value); upd(); };
        go.onclick = () => this.send({ t: "raise", to: this.raiseTo });
        const quick = (label: string, to: number) => { const b = document.createElement("button"); b.className = "btn small"; b.textContent = label; b.onclick = () => { this.raiseTo = Math.max(lo, Math.min(hi, Math.round(to))); slider.value = String(this.raiseTo); upd(); }; r2.append(b); };
        const pot = v.pot;
        quick("½", v.bets[this.me]! + v.toCall + (pot + v.toCall) / 2 + 0); quick("¾", v.bets[this.me]! + v.toCall + (pot + v.toCall) * 0.75); quick("Pot", v.bets[this.me]! + v.toCall + (pot + v.toCall)); quick("All-in", hi);
        r2.append(slider, lab, go); upd(); this.controls.append(r2);
      }
    }
    this.banner.textContent = v.over ? "" : v.turn === this.me ? t("yourTurn") : t("turnOf", { n: this.names[v.turn ?? 0] ?? "" });
    this.banner.style.display = this.busy || v.over ? "none" : "block";
    this.board.innerHTML = this.names.map((nm, i) => `<div class="${v.turn === i ? "on" : ""}" style="${v.out[i] ? "opacity:.35" : ""}"><span>${i === this.me ? t("you") : nm}</span><b>${v.stacks[i]}</b></div>`).join("") + `<div class="x">${t("hHand", { n: v.handNo })} · ${v.sb}/${v.bb}</div>`;
  }
}
