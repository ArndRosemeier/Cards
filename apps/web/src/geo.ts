import type { Sprite } from "pixi.js";

/** Table geometry. Scenes lay out in a fixed logical world and scale it to the screen; phones held upright get a tall world. */
export type Anchor = { cx: number; cy: number; rot: number; dx: number; dy: number };
const A = (cx: number, cy: number, rot: number, dx: number, dy: number): Anchor => ({ cx, cy, rot, dx, dy });
const P = Math.PI;

export interface Geo {
  portrait: boolean; W: number; H: number; center: { x: number; y: number };
  layouts: Record<number, Anchor[]>;
  ownPlate: { x: number; y: number }; talonY: number; toast: { dx: number; dy: number };
  ownStep: number; ownWidth: number; ownScale: number; dummyWidth: number; dummyStep: number; dummyScale: number;
  /** where a seat's name plate sits */
  plate(a: Anchor, rel: number): { x: number; y: number };
}

export const LAND: Geo = {
  portrait: false, W: 1600, H: 900, center: { x: 800, y: 440 },
  layouts: {
    2: [A(800, 770, 0, 0, 1), A(800, 125, P, 0, -1)],
    3: [A(800, 770, 0, 0, 1), A(130, 450, P / 2, -1, 0), A(1470, 450, -P / 2, 1, 0)],
    4: [A(800, 770, 0, 0, 1), A(130, 450, P / 2, -1, 0), A(800, 125, P, 0, -1), A(1470, 450, -P / 2, 1, 0)],
    5: [A(800, 770, 0, 0, 1), A(130, 500, P / 2, -1, 0), A(520, 125, P, -0.6, -1), A(1080, 125, P, 0.6, -1), A(1470, 500, -P / 2, 1, 0)],
  },
  ownPlate: { x: 170, y: 668 }, talonY: 250, toast: { dx: 330, dy: 200 }, ownStep: 118, ownWidth: 1300, ownScale: 1, dummyWidth: 620, dummyStep: 46, dummyScale: 0.72,
  plate: (a, rel) => (rel === 0 ? { x: 170, y: 668 } : a.dy === -1 ? { x: a.cx, y: a.cy + 100 } : { x: a.cx + (a.dx === -1 ? 170 : -170), y: a.cy }),
};

export const PORT: Geo = {
  portrait: true, W: 720, H: 1280, center: { x: 360, y: 640 },
  layouts: {
    2: [A(360, 1075, 0, 0, 1), A(360, 170, P, 0, -1)],
    3: [A(360, 1075, 0, 0, 1), A(90, 640, P / 2, -1, 0), A(630, 640, -P / 2, 1, 0)],
    4: [A(360, 1075, 0, 0, 1), A(90, 640, P / 2, -1, 0), A(360, 170, P, 0, -1), A(630, 640, -P / 2, 1, 0)],
    5: [A(360, 1075, 0, 0, 1), A(90, 720, P / 2, -1, 0), A(200, 170, P, -0.6, -1), A(520, 170, P, 0.6, -1), A(630, 720, -P / 2, 1, 0)],
  },
  ownPlate: { x: 150, y: 1240 }, talonY: 390, toast: { dx: 250, dy: 290 }, ownStep: 80, ownWidth: 560, ownScale: 1.15, dummyWidth: 480, dummyStep: 36, dummyScale: 0.52,
  plate: (a, rel) => (rel === 0 ? { x: 150, y: 1240 } : a.dy === -1 ? { x: a.cx, y: a.cy + 100 } : { x: a.cx + (a.dx === -1 ? 20 : -20), y: a.cy + 235 }),
};

/** Upright phones (tall, narrow screens) get the portrait geometry. */
export const pickGeo = (w: number, h: number, allowPortrait = true): Geo => (allowPortrait && h > w * 1.15 && w < 900 ? PORT : LAND);

/** Scale a background sprite to cover the screen without distorting it. */
export function cover(bg: Sprite, w: number, h: number) {
  const tw = bg.texture.width || 1, th = bg.texture.height || 1, s = Math.max(w / tw, h / th) * 1.04; // a little overscan for the parallax
  bg.scale.set(s); bg.position.set((w - tw * s) / 2, (h - th * s) / 2);
  (bg as unknown as { base: { x: number; y: number } }).base = { x: bg.position.x, y: bg.position.y };
}

/** Keep the action buttons just above the own hand at every window size by publishing a CSS variable. */
export function setActionsBottom(g: Geo, w: number, h: number, seats: number) {
  const root = document.documentElement.style;
  const s = Math.min(w / g.W, h / g.H), top = (h - g.H * s) / 2 + (g.layouts[seats]![0]!.cy - 150 * g.ownScale) * s;
  root.setProperty("--actions-bottom", `${Math.round(h - top + 8)}px`);
}
