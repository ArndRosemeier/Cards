import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import gsap from "gsap";
import type { Card } from "@cards/engine";
import { CardView } from "./cardview.ts";
import { cover } from "./geo.ts";

const SUITS = ["S", "H", "D", "C"], RANKS = ["A", "K", "Q", "J", "T", "9"];
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

/** The backdrop behind the menu: the painted room, with a slow drift of 3D cards that now and then turn over. */
export function createMenuScene(app: Application) {
  const root = new Container(); app.stage.addChild(root);
  const bg = new Sprite(); const shade = new Graphics(); const cards = new Container(); const motes = new Container();
  root.addChild(bg, shade, cards, motes);
  Assets.load("/bg/menu.webp").then((tex) => { if (!bg.destroyed) { bg.texture = tex; cover(bg, app.screen.width, app.screen.height); } }).catch(() => {});
  const onMove = (e: PointerEvent) => { pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2; pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2; };
  window.addEventListener("pointermove", onMove);

  const items = Array.from({ length: 18 }, (_, i) => {
    const id = `${SUITS[Math.floor(Math.random() * 4)]}${RANKS[Math.floor(Math.random() * RANKS.length)]}` as Card;
    const depth = Math.random(), cv = new CardView(id, Math.random() < 0.5);
    cv.scale.set(0.34 + depth * 0.7); cv.alpha = 0.45 + depth * 0.45; cards.addChild(cv);
    const it = { cv, depth, x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.012, vy: 0.006 + Math.random() * 0.014, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.25, next: 2 + Math.random() * 7 };
    return it;
  });
  items.sort((a, b) => a.depth - b.depth).forEach((it, i) => { cards.setChildIndex(it.cv, i); });
  for (let i = 0; i < 30; i++) {
    const g = new Graphics().circle(0, 0, 1 + Math.random() * 2.4).fill({ color: 0xffe9b0, alpha: 1 }); g.blendMode = "add"; g.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height); g.alpha = 0.1 + Math.random() * 0.3; motes.addChild(g);
  }

  let last = performance.now(), t = 0;
  const tick = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const w = app.screen.width, h = app.screen.height;
    pointer.x += (pointer.tx - pointer.x) * 0.05; pointer.y += (pointer.ty - pointer.y) * 0.05;
    if (bg.texture.width > 1) { cover(bg, w, h); const b = (bg as unknown as { base: { x: number; y: number } }).base; bg.position.set(b.x - pointer.x * 16, b.y - pointer.y * 10); }
    shade.clear().rect(0, 0, w, h).fill({ color: 0x06100b, alpha: 0.38 });
    for (const it of items) {
      it.x += it.vx * dt; it.y += it.vy * dt * (0.5 + it.depth); it.r += it.vr * dt; it.next -= dt;
      if (it.y > 1.15) { it.y = -0.15; it.x = Math.random(); }
      if (it.x > 1.1) it.x = -0.1; if (it.x < -0.1) it.x = 1.1;
      if (it.next <= 0) { it.next = 4 + Math.random() * 8; void it.cv.flip(!it.cv.faceUp, 0.9); }
      it.cv.position.set(it.x * w - pointer.x * (10 + 36 * it.depth), it.y * h - pointer.y * (6 + 24 * it.depth)); it.cv.rotation = it.r + Math.sin(t * 0.4 + it.x * 9) * 0.15;
    }
    for (const m of motes.children) { m.y -= 6 * dt; m.x += Math.sin(t + m.y * 0.01) * 4 * dt; if (m.y < -4) { m.y = h + 4; m.x = Math.random() * w; } }
  };
  gsap.ticker.add(tick);
  return {
    destroy() { gsap.ticker.remove(tick); window.removeEventListener("pointermove", onMove); items.forEach((it) => gsap.killTweensOf(it.cv)); root.destroy({ children: true }); },
  };
}
