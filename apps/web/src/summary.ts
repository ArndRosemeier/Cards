import gsap from "gsap";
import { t } from "./i18n.ts";

export interface SummaryRow { name: string; from: number; to: number; me?: boolean }
const fast = new URLSearchParams(location.search).get("fast") === "1";

/** Short overlay at the end of a round: who gained or lost how much, counting up. Resolves when dismissed (tap or timer). */
export function roundSummary(ui: HTMLElement, rows: SummaryRow[], title: string, lowBetter = false): Promise<void> {
  if (!rows.some((r) => r.to !== r.from)) return Promise.resolve();
  return new Promise((resolve) => {
    const el = document.createElement("div"); el.className = "roundsum";
    const best = lowBetter ? Math.min(...rows.map((r) => r.to - r.from)) : Math.max(...rows.map((r) => r.to - r.from)), isBest = (d: number) => d === best && (lowBetter ? true : best > 0);
    el.innerHTML = `<div class="rs-box"><div class="rs-title">${title}</div>${rows.map((r, i) => `<div class="rs-row${r.me ? " me" : ""}${isBest(r.to - r.from) ? " best" : ""}"><span>${r.name}</span><b class="rs-d" data-i="${i}">0</b><i class="rs-t">${r.from}</i></div>`).join("")}<div class="rs-hint">${t("tapContinue")}</div></div>`;
    ui.append(el);
    const box = el.firstElementChild as HTMLElement;
    gsap.fromTo(box, { y: 24, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: "back.out(1.6)" });
    const sign = (n: number) => (n > 0 ? "+" : "") + n;
    rows.forEach((r, i) => {
      const d = el.querySelector<HTMLElement>(`.rs-d[data-i="${i}"]`)!, tot = d.nextElementSibling as HTMLElement, o = { v: 0 }, delta = r.to - r.from;
      d.classList.toggle("pos", lowBetter ? delta < 0 : delta > 0); d.classList.toggle("neg", lowBetter ? delta > 0 : delta < 0);
      gsap.to(o, { v: delta, duration: fast ? 0.3 : 0.9, delay: 0.35 + i * 0.12, ease: "power2.out", onUpdate: () => { d.textContent = sign(Math.round(o.v)); tot.textContent = String(r.from + Math.round(o.v)); } });
    });
    let done = false;
    const close = () => { if (done) return; done = true; gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => { el.remove(); resolve(); } }); };
    el.addEventListener("pointerdown", close);
    setTimeout(close, fast ? 900 : 3800 + rows.length * 120);
  });
}
