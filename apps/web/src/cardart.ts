import { Texture } from "pixi.js";
import type { Card, Suit } from "@cards/engine";

export const CARD_W = 140, CARD_H = 200;
export const S = 2; // texture supersampling; sprites are scaled by 1/S
const RED = "#c62828", BLACK = "#1b1b22";
export const suitColor = (s: Suit) => (s === "H" || s === "D" ? RED : BLACK);

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w * S; c.height = h * S;
  const ctx = c.getContext("2d")!;
  ctx.scale(S, S);
  return { c, ctx };
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

/** Draw a suit symbol centred at (cx,cy) with height ~size. Vector, so no font dependency. */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: Suit, cx: number, cy: number, size: number, color = suitColor(suit)) {
  ctx.save(); ctx.translate(cx, cy); const k = size / 100; ctx.scale(k, k); ctx.fillStyle = color; ctx.beginPath();
  if (suit === "H") {
    ctx.moveTo(0, 46); ctx.bezierCurveTo(-70, -2, -52, -52, -22, -46); ctx.bezierCurveTo(-8, -43, 0, -30, 0, -22);
    ctx.bezierCurveTo(0, -30, 8, -43, 22, -46); ctx.bezierCurveTo(52, -52, 70, -2, 0, 46);
  } else if (suit === "D") {
    ctx.moveTo(0, -50); ctx.bezierCurveTo(12, -26, 30, -10, 42, 0); ctx.bezierCurveTo(30, 10, 12, 26, 0, 50);
    ctx.bezierCurveTo(-12, 26, -30, 10, -42, 0); ctx.bezierCurveTo(-30, -10, -12, -26, 0, -50);
  } else if (suit === "S") {
    ctx.moveTo(0, -50); ctx.bezierCurveTo(8, -30, 58, -10, 48, 18); ctx.bezierCurveTo(42, 38, 14, 36, 6, 20);
    ctx.bezierCurveTo(8, 34, 12, 44, 22, 50); ctx.lineTo(-22, 50); ctx.bezierCurveTo(-12, 44, -8, 34, -6, 20);
    ctx.bezierCurveTo(-14, 36, -42, 38, -48, 18); ctx.bezierCurveTo(-58, -10, -8, -30, 0, -50);
  } else {
    ctx.arc(0, -26, 22, 0, Math.PI * 2); ctx.moveTo(-26, 12); ctx.arc(-26, 12, 22, 0, Math.PI * 2);
    ctx.moveTo(26, 12); ctx.arc(26, 12, 22, 0, Math.PI * 2);
    ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.bezierCurveTo(-4, 24, -10, 40, -22, 50); ctx.lineTo(22, 50);
    ctx.bezierCurveTo(10, 40, 4, 24, 6, 0);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

const PIPS: Record<string, [number, number][]> = {
  "2": [[1, 0], [1, 1]], "3": [[1, 0], [1, .5], [1, 1]], "4": [[0, 0], [2, 0], [0, 1], [2, 1]],
  "5": [[0, 0], [2, 0], [1, .5], [0, 1], [2, 1]], "6": [[0, 0], [2, 0], [0, .5], [2, .5], [0, 1], [2, 1]],
  "7": [[0, 0], [2, 0], [1, .25], [0, .5], [2, .5], [0, 1], [2, 1]],
  "8": [[0, 0], [2, 0], [1, .25], [0, .5], [2, .5], [1, .75], [0, 1], [2, 1]],
  "9": [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, .5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  "T": [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};
const RANK_LABEL: Record<string, string> = { T: "10" };

function drawJoker(): HTMLCanvasElement {
  const { c, ctx } = canvas(CARD_W, CARD_H);
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#f1ead9");
  ctx.fillStyle = g; rr(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 14); ctx.fill(); ctx.strokeStyle = "rgba(60,50,30,.35)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = "#7c3aed"; ctx.font = "800 15px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.save(); ctx.translate(18, 110); ctx.rotate(-Math.PI / 2); ctx.fillText("JOKER", 0, 0); ctx.restore();
  ctx.save(); ctx.translate(CARD_W - 18, 90); ctx.rotate(Math.PI / 2); ctx.fillText("JOKER", 0, 0); ctx.restore();
  ctx.translate(CARD_W / 2, CARD_H / 2); ctx.fillStyle = "#e11d48";
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, r = i % 2 ? 16 : 40; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  return c;
}

function drawFace(card: Card): HTMLCanvasElement {
  if (card[0] === "X") return drawJoker();
  const suit = card[0] as Suit, rank = card[1]!;
  const { c, ctx } = canvas(CARD_W, CARD_H);
  const col = suitColor(suit);
  // card body
  ctx.shadowColor = "rgba(0,0,0,.0)";
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#f1ead9");
  ctx.fillStyle = g; rr(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 14); ctx.fill();
  ctx.strokeStyle = "rgba(60,50,30,.35)"; ctx.lineWidth = 1.2; ctx.stroke();
  // corner indices
  const label = RANK_LABEL[rank] ?? rank;
  const corner = (flip: boolean) => {
    ctx.save();
    if (flip) { ctx.translate(CARD_W, CARD_H); ctx.rotate(Math.PI); }
    ctx.fillStyle = col; ctx.font = "700 26px Georgia, 'Times New Roman', serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 20, 25);
    drawSuit(ctx, suit, 20, 50, 17);
    ctx.restore();
  };
  corner(false); corner(true);
  const px = (c: number) => 36 + (c * (CARD_W - 72)) / 2 + (c === 1 ? 0 : 0);
  const py = (r: number) => 36 + r * (CARD_H - 72);
  if (rank === "A") {
    drawSuit(ctx, suit, CARD_W / 2, CARD_H / 2, 64);
  } else if (PIPS[rank]) {
    for (const [cx, ry] of PIPS[rank]!) {
      const x = px(cx), y = py(ry);
      if (ry > 0.5) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI); drawSuit(ctx, suit, 0, 0, 27); ctx.restore(); }
      else drawSuit(ctx, suit, x, y, 27);
    }
  } else {
    // court cards: ornate frame + big monogram
    const x = 30, y = 28, w = CARD_W - 60, h = CARD_H - 56;
    const fg = ctx.createLinearGradient(x, y, x + w, y + h);
    fg.addColorStop(0, "#f7e7b0"); fg.addColorStop(1, "#e6c36a");
    ctx.fillStyle = fg; rr(ctx, x, y, w, h, 8); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; rr(ctx, x + 3, y + 3, w - 6, h - 6, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 3, CARD_H / 2); ctx.lineTo(x + w - 3, CARD_H / 2); ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "800 54px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(rank, CARD_W / 2, CARD_H / 2 - 22);
    ctx.save(); ctx.translate(CARD_W / 2, CARD_H / 2 + 22); ctx.rotate(Math.PI); ctx.fillText(rank, 0, 0); ctx.restore();
    drawSuit(ctx, suit, CARD_W / 2, CARD_H / 2 + 18, 24); drawSuit(ctx, suit, CARD_W / 2, CARD_H / 2 - 18, 24);
  }
  return c;
}

function drawBack(): HTMLCanvasElement {
  const { c, ctx } = canvas(CARD_W, CARD_H);
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, "#1c3a8a"); g.addColorStop(1, "#0d1f57");
  ctx.fillStyle = "#f4efe4"; rr(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 14); ctx.fill();
  ctx.fillStyle = g; rr(ctx, 7, 7, CARD_W - 14, CARD_H - 14, 9); ctx.fill();
  ctx.save(); rr(ctx, 7, 7, CARD_W - 14, CARD_H - 14, 9); ctx.clip();
  ctx.strokeStyle = "rgba(232,198,106,.35)"; ctx.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 14) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CARD_H, CARD_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, CARD_H); ctx.lineTo(i + CARD_H, 0); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "#e8c66a"; ctx.lineWidth = 2; rr(ctx, 12, 12, CARD_W - 24, CARD_H - 24, 7); ctx.stroke();
  // emblem
  ctx.fillStyle = "#0d1f57"; ctx.beginPath(); ctx.ellipse(CARD_W / 2, CARD_H / 2, 30, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#e8c66a"; ctx.lineWidth = 2; ctx.stroke();
  drawSuit(ctx, "S", CARD_W / 2, CARD_H / 2 - 2, 34, "#e8c66a");
  return c;
}

function drawShadow(): HTMLCanvasElement {
  const pad = 30;
  const { c, ctx } = canvas(CARD_W + pad * 2, CARD_H + pad * 2);
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 18; ctx.fillStyle = "#000";
  rr(ctx, pad + 4, pad + 4, CARD_W - 8, CARD_H - 8, 12); ctx.fill();
  return c;
}

export function drawFelt(w: number, h: number): HTMLCanvasElement {
  const { c, ctx } = canvas(w / 2, h / 2); // half-res is plenty for a soft surface
  const g = ctx.createRadialGradient(w / 4, h / 4 - 40, 40, w / 4, h / 4, w / 2.2);
  g.addColorStop(0, "#1f7a52"); g.addColorStop(0.55, "#145a3b"); g.addColorStop(1, "#06190f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w / 2, h / 2);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = new Map<string, Texture>();
const tex = (key: string, make: () => HTMLCanvasElement) => {
  let t = cache.get(key);
  if (!t) { t = Texture.from(make()); cache.set(key, t); }
  return t;
};
export const faceTexture = (card: Card) => { const k = (card[0] === "X" ? "X1" : card.slice(0, 2)) as Card; return tex(k, () => drawFace(k)); };
export const backTexture = () => tex("back", drawBack);
export const shadowTexture = () => tex("shadow", drawShadow);
export const suitTexture = (suit: Suit) => tex("suit" + suit, () => {
  const { c, ctx } = canvas(64, 64);
  ctx.fillStyle = "#f6f1e4"; ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#e8c66a"; ctx.lineWidth = 3; ctx.stroke();
  drawSuit(ctx, suit, 32, 32, 36);
  return c;
});
