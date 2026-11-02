import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import gsap from "gsap";

let vignetteTex: Texture | null = null;
function vignette(): Texture {
  if (vignetteTex) return vignetteTex;
  const c = document.createElement("canvas"); c.width = c.height = 256; const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 118, 40, 128, 128, 182);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.55, "rgba(0,0,0,0.12)"); g.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return (vignetteTex = Texture.from(c));
}
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let listening = false;
function listen() {
  if (listening) return; listening = true;
  window.addEventListener("pointermove", (e) => { pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2; pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2; });
  window.addEventListener("deviceorientation", (e) => { if (e.gamma !== null && e.beta !== null) { pointer.tx = Math.max(-1, Math.min(1, e.gamma / 25)); pointer.ty = Math.max(-1, Math.min(1, (e.beta - 50) / 25)); } });
}

/**
 * Atmosphere around the table: a soft vignette under the cards, drifting light motes above them and a slight parallax of the
 * backdrop that follows the pointer (or the tilt of the phone). Removes itself when the scene's backdrop goes away.
 */
export function attachAmbience(app: Application, bg: Sprite) {
  listen();
  const vig = new Sprite(vignette()); const motes = new Container();
  app.stage.addChildAt(vig, 1); app.stage.addChild(motes);
  const dots = Array.from({ length: 26 }, () => {
    const g = new Graphics().circle(0, 0, 1 + Math.random() * 2.2).fill({ color: 0xfff1c9, alpha: 1 }); g.blendMode = "add";
    const d = { g, x: Math.random(), y: Math.random(), s: 0.01 + Math.random() * 0.03, ph: Math.random() * 6.28, a: 0.1 + Math.random() * 0.28 };
    motes.addChild(g); return d;
  });
  let last = performance.now();
  const tick = () => {
    if (bg.destroyed || !bg.parent) { gsap.ticker.remove(tick); vig.destroy(); motes.destroy({ children: true }); return; }
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const w = app.screen.width, h = app.screen.height;
    vig.width = w; vig.height = h;
    pointer.x += (pointer.tx - pointer.x) * 0.06; pointer.y += (pointer.ty - pointer.y) * 0.06;
    const base = (bg as unknown as { base?: { x: number; y: number } }).base;
    if (base) bg.position.set(base.x - pointer.x * 14, base.y - pointer.y * 9);
    for (const d of dots) {
      d.y -= d.s * dt; d.ph += dt * 0.6; if (d.y < -0.05) { d.y = 1.05; d.x = Math.random(); }
      d.g.position.set((d.x + Math.sin(d.ph) * 0.012) * w, d.y * h); d.g.alpha = d.a * (0.6 + 0.4 * Math.sin(d.ph * 1.7));
    }
  };
  gsap.ticker.add(tick);
}
