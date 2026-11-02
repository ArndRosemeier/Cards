import { Container, Sprite } from "pixi.js";
import gsap from "gsap";
import type { Card } from "@cards/engine";
import { sfx } from "./sfx.ts";
import { backTexture, faceTexture, shadowTexture, CARD_H, CARD_W, S } from "./cardart.ts";

/** One card on the table: face, back, soft shadow that grows with `lift` for a floating, 3D feel. */
export class CardView extends Container {
  id: Card | null;
  faceUp: boolean;
  private inner = new Container();
  private face = new Sprite();
  private back = new Sprite(backTexture());
  private shadow = new Sprite(shadowTexture());
  private _lift = 0;
  /** layout slot the card is heading to; used by hand layout */
  slot = { x: 0, y: 0, rot: 0, scale: 1 };

  constructor(id: Card | null, faceUp: boolean) {
    super();
    this.id = id; this.faceUp = faceUp;
    for (const s of [this.face, this.back, this.shadow]) { s.anchor.set(0.5); s.scale.set(1 / S); }
    this.shadow.alpha = 0.55;
    this.inner.addChild(this.back, this.face);
    this.addChild(this.shadow, this.inner);
    this.setFace(faceUp);
    this.lift = 0;
  }
  get lift() { return this._lift; }
  set lift(v: number) {
    this._lift = v;
    this.shadow.position.set(v * 16 + 2, v * 26 + 4);
    this.shadow.scale.set((1 + v * 0.1) / S);
    this.shadow.alpha = 0.55 - v * 0.2;
    this.inner.scale.y = this.inner.scale.y; // keep reference stable
  }
  setFace(up: boolean) {
    this.faceUp = up;
    if (up && this.id) this.face.texture = faceTexture(this.id);
    this.face.visible = up && !!this.id;
    this.back.visible = !this.face.visible;
  }
  reveal(id: Card) { this.id = id; if (this.faceUp) this.setFace(true); }
  /** Flip around the vertical axis; resolves when finished. */
  flip(toUp: boolean, duration = 0.28): Promise<void> {
    if (this.faceUp === toUp) return Promise.resolve();
    return new Promise((resolve) => {
      gsap.to(this.inner.scale, { x: 0, duration: duration / 2, ease: "power2.in", onComplete: () => {
        this.setFace(toUp); sfx.flip();
        gsap.to(this.inner.scale, { x: 1, duration: duration / 2, ease: "power2.out", onComplete: () => resolve() });
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
