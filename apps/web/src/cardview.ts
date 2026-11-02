import { Container, Graphics, PerspectiveMesh, Rectangle, Sprite, Texture } from "pixi.js";
import gsap from "gsap";
import type { Card } from "@cards/engine";
import { sfx } from "./sfx.ts";
import { backTexture, faceTexture, shadowTexture, CARD_H, CARD_W, S } from "./cardart.ts";

const D = 1150;                     // camera distance for the perspective projection, in card pixels
const HW = CARD_W / 2, HH = CARD_H / 2;
export const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

let glareTex: Texture | null = null;
function glareTexture(): Texture {
  if (glareTex) return glareTex;
  const c = document.createElement("canvas"); c.width = CARD_W * 2; c.height = CARD_H * 2; const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.38, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.85)"); g.addColorStop(0.62, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(2, 2, c.width - 4, c.height - 4, 28); ctx.fill();
  return (glareTex = Texture.from(c));
}

/**
 * One card on the table. Flat sprites when at rest; as soon as the card moves, is hovered or flips it is drawn as a
 * perspective-projected mesh: it leans into its motion, tilts towards the pointer, turns over in real 3D and catches a
 * moving sheen. The soft shadow grows with `lift`.
 */
/** What a scene hands to its own cards so the player can drag them into a new order. */
export interface DragCtl {
  canvas: HTMLCanvasElement;
  /** the own hand in its current order */
  order(): CardView[];
  /** put the card at this position of the hand and lay the hand out again */
  move(card: Card, index: number): void;
}

/** A player's own ordering of the hand, on top of the scene's default sort. */
export class HandOrder {
  custom: Card[] | null = null;
  apply(def: Card[]): Card[] {
    if (!this.custom) return def;
    const have = new Set(def), kept = this.custom.filter((c) => have.has(c)), seen = new Set(kept);
    return [...kept, ...def.filter((c) => !seen.has(c))];
  }
  move(cur: Card[], card: Card, index: number) {
    const o = cur.filter((c) => c !== card); o.splice(clamp(index, 0, o.length), 0, card); this.custom = o;
  }
  reset() { this.custom = null; }
}

export class CardView extends Container {
  id: Card | null;
  faceUp: boolean;
  /** layout slot the card is heading to; used by hand layout */
  slot = { x: 0, y: 0, rot: 0, scale: 1 };
  /** 0..PI while the card turns over (tweened by flip) */
  flipA = 0;
  /** extra 0..1 rise used by flips, on top of lift */
  pop = 0;

  private inner = new Container();
  private face = new Sprite();
  private back = new Sprite(backTexture());
  private shadow = new Sprite(shadowTexture());
  private mesh: PerspectiveMesh | null = null;
  private sheen: PerspectiveMesh | null = null;
  private _lift = 0;
  private flipTo: boolean | null = null; private soundDone = false;
  private lastX = NaN; private lastY = NaN;
  private leanX = 0; private leanY = 0;               // smoothed lean from motion
  private hoverX = 0; private hoverY = 0;             // smoothed tilt towards the pointer
  private overP: { x: number; y: number } | null = null;
  private sh = { w: 1, h: 1, x: 0, y: 0 };                // the shadow follows the projected outline
  private glowG: Graphics | null = null; private glowUntil = 0;
  /** set by the scene on own-hand cards: lets the player drag the card to re-sort the hand */
  drag: DragCtl | null = null;
  dragging = false;
  private _dim = false;
  /** greyed out: a card that cannot be played right now */
  get dimmed() { return this._dim; }
  set dimmed(v: boolean) { this._dim = v; this.face.tint = v ? 0x8d8d8d : 0xffffff; }
  private noTap = false;

  constructor(id: Card | null, faceUp: boolean) {
    super();
    this.id = id; this.faceUp = faceUp;
    for (const s of [this.face, this.back, this.shadow]) { s.anchor.set(0.5); s.scale.set(1 / S); }
    this.shadow.alpha = 0.55;
    this.inner.addChild(this.back, this.face);
    this.addChild(this.shadow, this.inner);
    this.hitArea = new Rectangle(-HW, -HH, CARD_W, CARD_H);
    this.setFace(faceUp);
    this.lift = 0;
    this.bindHover();
    gsap.ticker.add(this.tick);
  }

  // ---------------------------------------------------------------- hover (survives removeAllListeners)
  private bindHover() {
    this.on("pointerover", (e) => { this.overP = e.getLocalPosition(this); });
    this.on("pointermove", (e) => { this.overP = e.getLocalPosition(this); });
    this.on("pointerout", () => { this.overP = null; });
    this.on("pointerdown", (e) => this.startDrag(e.client.x, e.client.y));
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (this.noTap && (event === "pointertap" || event === "click" || event === "tap")) return false;
    return super.emit(event as never, ...(args as never[]));
  }
  private startDrag(sx: number, sy: number) {
    const ctl = this.drag; if (!ctl || !this.parent || !this.id) return;
    const toLocal = (cx: number, cy: number) => { const r = ctl.canvas.getBoundingClientRect(); return this.parent!.toLocal({ x: cx - r.left, y: cy - r.top }); };
    let grab = { x: 0, y: 0 }, last = -1;
    const move = (ev: PointerEvent) => {
      if (!this.dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 10) return;
        this.dragging = true; gsap.killTweensOf(this); gsap.killTweensOf(this.scale);
        const p0 = toLocal(sx, sy); grab = { x: this.x - p0.x, y: this.y - p0.y };
        this.scale.set(this.slot.scale * 1.06); this.parent?.addChild(this);
        this.overP = null; sfx.click();
      }
      const p = toLocal(ev.clientX, ev.clientY);
      this.position.set(p.x + grab.x, p.y + grab.y);
      this.rotation += (this.slot.rot * 0.4 - this.rotation) * 0.3;
      const xs = ctl.order().map((c) => c.slot.x).sort((a, b) => a - b);
      let idx = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - this.x) < Math.abs(xs[idx]! - this.x)) idx = i;
      if (idx !== last) { last = idx; ctl.move(this.id!, idx); this.parent?.addChild(this); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (!this.dragging) return;
      this.dragging = false; this.noTap = true; setTimeout(() => { this.noTap = false; }, 120);
      ctl.move(this.id!, Math.max(last, 0));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }
  override removeAllListeners(event?: string | symbol): this { super.removeAllListeners(event as never); this.bindHover(); return this; }
  override destroy(options?: Parameters<Container["destroy"]>[0]): void { gsap.ticker.remove(this.tick); super.destroy(options); }

  // ---------------------------------------------------------------- shape and light
  get lift() { return this._lift; }
  set lift(v: number) {
    this._lift = v;
    const l = v + this.pop;
    this.shadow.position.set(l * 16 + 2 + this.sh.x, l * 26 + 4 + this.sh.y);
    this.shadow.scale.set(((1 + l * 0.1) * this.sh.w) / S, ((1 + l * 0.1) * this.sh.h) / S);
    this.shadow.alpha = 0.55 - l * 0.2;
  }
  setFace(up: boolean) {
    this.faceUp = up;
    if (up && this.id) this.face.texture = faceTexture(this.id);
    this.face.visible = up && !!this.id;
    this.back.visible = !this.face.visible;
  }
  reveal(id: Card) { this.id = id; if (this.faceUp) this.setFace(true); }

  /** Pulse a gold outline around the card for a few seconds (used by the hint button). */
  glowFor(seconds: number) {
    if (!this.glowG) {
      const g = new Graphics();
      g.roundRect(-HW - 7, -HH - 7, CARD_W + 14, CARD_H + 14, 16).stroke({ width: 12, color: 0xffd35c, alpha: 0.28 });
      g.roundRect(-HW - 3, -HH - 3, CARD_W + 6, CARD_H + 6, 12).stroke({ width: 4, color: 0xffe9a0, alpha: 1 });
      g.eventMode = "none"; this.glowG = g; this.addChild(g);
    }
    this.glowUntil = performance.now() + seconds * 1000; this.glowG.visible = true;
  }
  private tickGlow() {
    const g = this.glowG; if (!g || !g.visible) return;
    const left = this.glowUntil - performance.now();
    if (left <= 0) { g.visible = false; return; }
    g.alpha = Math.min(1, left / 400) * (reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(performance.now() / 160));
  }

  private tick = () => {
    this.tickGlow();
    // lean into the direction of travel (the card is a loose sheet on the table)
    const dx = Number.isNaN(this.lastX) ? 0 : clamp(this.x - this.lastX, -60, 60), dy = Number.isNaN(this.lastY) ? 0 : clamp(this.y - this.lastY, -60, 60);
    this.lastX = this.x; this.lastY = this.y;
    const k = reducedMotion ? 0 : 1;
    this.leanY += (clamp(dx * 0.011 * k, -0.42, 0.42) - this.leanY) * 0.2;
    this.leanX += (clamp(-dy * 0.011 * k, -0.42, 0.42) - this.leanX) * 0.2;
    // tilt towards the pointer while hovered
    const p = this.overP, hy = p ? clamp(-(p.x / HW) * 0.42, -0.45, 0.45) : 0, hx = p ? clamp((p.y / HH) * 0.4, -0.45, 0.45) : 0;
    this.hoverY += (hy - this.hoverY) * 0.25; this.hoverX += (hx - this.hoverX) * 0.25;
    const ty = this.leanY + this.hoverY, tx = this.leanX + this.hoverX;
    const active = this.flipA > 0 || Math.abs(ty) > 0.004 || Math.abs(tx) > 0.004 || this.pop > 0;
    if (!active) { this.showFlat(true); return; }
    this.renderMesh(ty, tx);
  };

  private showFlat(flat: boolean) {
    if (flat === this.inner.visible) return;
    this.inner.visible = flat;
    if (flat) { this.sh = { w: 1, h: 1, x: 0, y: 0 }; this.lift = this._lift; }
    if (this.mesh) this.mesh.visible = !flat;
    if (this.sheen) this.sheen.visible = !flat && this.sheen.alpha > 0.01;
  }
  private ensureMesh() {
    if (this.mesh) return;
    this.mesh = new PerspectiveMesh({ texture: this.back.texture, verticesX: 9, verticesY: 9 });
    this.sheen = new PerspectiveMesh({ texture: glareTexture(), verticesX: 5, verticesY: 5 }); this.sheen.blendMode = "add"; this.sheen.alpha = 0;
    this.addChild(this.mesh, this.sheen);
    if (this.glowG) this.addChild(this.glowG);
  }
  private renderMesh(ty: number, tx: number) {
    this.ensureMesh(); const mesh = this.mesh!, sheen = this.sheen!;
    // which side shows: past the edge-on point the other face is visible
    let turn = ty, front = this.faceUp;
    if (this.flipA > 0) { if (this.flipA > Math.PI / 2) { turn += this.flipA - Math.PI; front = this.flipTo ?? !this.faceUp; } else turn += this.flipA; }
    const tex = front && this.id ? faceTexture(this.id) : backTexture();
    if (mesh.texture !== tex) mesh.texture = tex;
    const cy = Math.cos(turn), sy = Math.sin(turn), cx = Math.cos(tx), sx = Math.sin(tx), rise = (this._lift + this.pop) * 70;
    const c: number[] = [];
    for (const [px, py] of [[-HW, -HH], [HW, -HH], [HW, HH], [-HW, HH]] as const) {
      const x1 = px * cy, z1 = -px * sy, y2 = py * cx - z1 * sx, z2 = py * sx + z1 * cx, f = D / (D + z2 - rise);
      c.push(x1 * f, y2 * f);
    }
    const xs = [c[0]!, c[2]!, c[4]!, c[6]!], ys = [c[1]!, c[3]!, c[5]!, c[7]!];
    this.sh = { w: clamp((Math.max(...xs) - Math.min(...xs)) / CARD_W, 0.03, 1.3), h: clamp((Math.max(...ys) - Math.min(...ys)) / CARD_H, 0.5, 1.3), x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    this.lift = this._lift;
    mesh.setCorners(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    sheen.setCorners(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    // light from the upper left: faces turned towards it are brighter; a sheen sweeps across when the tilt hits the glossy angle
    const facing = cy * cx, shade = clamp(0.8 + 0.2 * facing + 0.07 * (sy - sx) * (cy >= 0 ? 1 : -1), 0.72, 1.05), g = Math.round(clamp(shade * (this._dim ? 0.55 : 1), 0, 1) * 255);
    mesh.tint = (g << 16) | (g << 8) | g;
    sheen.alpha = front ? clamp(1 - Math.abs(ty * 1.1 + tx * 0.8 - 0.2) * 3.4, 0, 1) * 0.42 * Math.min(1, Math.abs(ty) * 6 + Math.abs(tx) * 6) : 0;
    sheen.visible = sheen.alpha > 0.01;
    this.showFlat(false);
    if (this.flipA > Math.PI / 2 && !this.soundDone) { this.soundDone = true; sfx.flip(); }
  }

  /** Turn the card over around its vertical axis in real perspective; resolves when finished. */
  flip(toUp: boolean, duration = 0.34): Promise<void> {
    if (this.faceUp === toUp) return Promise.resolve();
    return new Promise((resolve) => {
      this.flipTo = toUp; this.soundDone = false; this.flipA = 0.0001;
      gsap.to(this, { pop: 0.9, duration: duration / 2, ease: "power2.out", onUpdate: () => { this.lift = this._lift; } });
      gsap.to(this, { pop: 0, duration: duration / 2, delay: duration / 2, ease: "power2.in", onUpdate: () => { this.lift = this._lift; } });
      gsap.to(this, { flipA: Math.PI, duration, ease: "power2.inOut", onComplete: () => {
        this.flipA = 0; this.flipTo = null; this.pop = 0; this.setFace(toUp); this.lift = this._lift; resolve();
      } });
    });
  }
  static readonly W = CARD_W;
  static readonly H = CARD_H;
}

export function tween(target: object, vars: gsap.TweenVars): Promise<void> {
  return new Promise((resolve) => { gsap.to(target, { ...vars, onComplete: () => resolve() }); });
}
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A tiny card-back icon to the left of a hand-size number, so "10" reads as "10 cards". */
export function addCountIcon(count: Container) {
  const g = new Graphics();
  g.roundRect(-30, -10, 13, 19, 3).fill({ color: 0x1c2a5c }).stroke({ width: 1.5, color: 0xe8c66a });
  g.roundRect(-26.5, -6, 6, 11, 2).stroke({ width: 1, color: 0xe8c66a, alpha: 0.7 });
  count.addChild(g);
}
