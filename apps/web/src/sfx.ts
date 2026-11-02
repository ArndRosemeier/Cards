/** Tiny procedural sound effects (Web Audio), no asset files. Lazily created on first use after a user gesture. */
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem("muted") === "1"; } catch { return false; } })();
let noise: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return ctx;
  } catch { return null; }
}
function burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = "bandpass", delay = 0) {
  const c = ac(); if (!c || !noise) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource(); src.buffer = noise;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  src.connect(f).connect(g).connect(c.destination); src.start(t0, Math.random() * 0.1, dur + 0.02);
}
function tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", delay = 0) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}

let lastPlace = 0;
export const sfx = {
  /** a card landing on the table */
  place() { const n = performance.now(); if (n - lastPlace < 45) return; lastPlace = n; burst(1800 + Math.random() * 500, 0.9, 0.07, 0.35); burst(300, 1, 0.09, 0.25, "lowpass"); },
  flip() { burst(5200, 0.7, 0.05, 0.16, "highpass"); },
  deal() { burst(3200, 0.8, 0.045, 0.2); },
  chip() { tone(2400 + Math.random() * 300, 0.05, 0.12, "triangle"); tone(3400, 0.04, 0.07, "triangle", 0.035); },
  sweep() { burst(900, 0.6, 0.25, 0.18, "lowpass"); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, 0.12, "triangle", i * 0.09)); },
  tick() { tone(900, 0.04, 0.06, "square"); },
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem("muted", muted ? "1" : "0"); } catch { /* ignore */ } return muted; },
};
