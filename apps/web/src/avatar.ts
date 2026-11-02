import { Container, Graphics, Sprite, Texture, type Text } from "pixi.js";

/** Painted portraits for the computer players (public/avatars/<name>.webp). A missing file just leaves the plain plate. */
const KNOWN = new Set(["anna", "ben", "clara", "dario", "eva", "finn"]);
const cache = new Map<string, Promise<Texture | null>>();
function load(key: string): Promise<Texture | null> {
  let p = cache.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(Texture.from(img));
      img.onerror = () => resolve(null);
      img.src = new URL(`avatars/${key}.webp`, document.baseURI).href;
    });
    cache.set(key, p);
  }
  return p;
}

/** Put a round portrait at the left end of a name plate and move the name over a little. */
export function addAvatar(plate: Container, name: string, label: Text, x = -73, y = 0, r = 23) {
  const key = name.toLowerCase();
  if (!KNOWN.has(key)) return;
  void load(key).then((tex) => {
    if (!tex || plate.destroyed || label.destroyed) return;
    const sp = new Sprite(tex); sp.anchor.set(0.5); sp.position.set(x, y); sp.width = sp.height = r * 2;
    const mask = new Graphics().circle(x, y, r).fill(0xffffff); sp.mask = mask;
    const rim = new Graphics().circle(x, y, r).stroke({ width: 2, color: 0xe8c66a, alpha: 0.9 });
    plate.addChild(sp, mask, rim); label.x += 12;
  });
}
