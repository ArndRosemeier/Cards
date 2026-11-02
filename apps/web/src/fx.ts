/** Gold-and-colour confetti on a full-screen canvas; removes itself when the pieces have fallen. */
export function confetti(host: HTMLElement, seconds = 3.2) {
  const c = document.createElement("canvas"); c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const dpr = Math.min(window.devicePixelRatio || 1, 2); c.width = host.clientWidth * dpr; c.height = host.clientHeight * dpr; host.append(c);
  const ctx = c.getContext("2d"); if (!ctx) { c.remove(); return; }
  const colors = ["#f2d37e", "#e8c66a", "#ffffff", "#d94f4f", "#4fa3d9", "#5fc98a"];
  const parts = Array.from({ length: 140 }, () => ({
    x: c.width * (0.2 + Math.random() * 0.6), y: c.height * 0.35, vx: (Math.random() - 0.5) * 16 * dpr, vy: -(6 + Math.random() * 12) * dpr,
    w: (5 + Math.random() * 7) * dpr, h: (3 + Math.random() * 5) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[Math.floor(Math.random() * colors.length)]!,
  }));
  const t0 = performance.now();
  const step = (now: number) => {
    const el = (now - t0) / 1000; ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.42 * dpr; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.r * 1.7)); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, el - seconds + 1)); ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (el < seconds && c.isConnected) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
}
