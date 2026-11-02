import { Container, Sprite, Texture, Graphics } from "pixi.js";
import gsap from "gsap";

export const EMOTES = ["thumbs", "clap", "hmm", "oops"] as const;
const cache = new Map<string, Promise<Texture | null>>();
function load(id: string): Promise<Texture | null> {
  let p = cache.get(id);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(Texture.from(img));
      img.onerror = () => resolve(null);
      img.src = new URL(`emotes/${id}.webp`, document.baseURI).href;
    });
    cache.set(id, p);
  }
  return p;
}

/** A small painted reaction bubble that pops above a seat's plate, floats up and fades. */
export function popEmote(layer: Container, x: number, y: number, id: string) {
  void load(id).then((tex) => {
    if (!tex || layer.destroyed) return;
    const c = new Container(); c.position.set(x, y - 40);
    const bg = new Graphics().circle(0, 0, 44).fill({ color: 0x0b2a1c, alpha: 0.88 }).stroke({ width: 3, color: 0xe8c66a });
    const sp = new Sprite(tex); sp.anchor.set(0.5); sp.scale.set(70 / Math.max(tex.width, tex.height));
    c.addChild(bg, sp); c.scale.set(0.2); c.alpha = 0; layer.addChild(c);
    gsap.to(c, { alpha: 1, duration: 0.15 }); gsap.to(c.scale, { x: 1, y: 1, duration: 0.45, ease: "back.out(2.2)" });
    gsap.to(c, { y: y - 120, duration: 2.6, ease: "power1.out" });
    gsap.to(c, { alpha: 0, delay: 2.1, duration: 0.5, onComplete: () => c.destroy({ children: true }) });
  });
}
