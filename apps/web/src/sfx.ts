/** Sound: sampled effects (public/audio/*.mp3, generated, see public/audio/manifest.json) with the procedural synth below as instant fallback
 *  until they are decoded. Music is a crossfaded playlist of streamed clips. Lazily created on first use after a user gesture. */
const FILES: Record<string, string[]> = {
  place: ["place2", "place3", "place4"], flip: ["flip1", "flip2", "flip3"], deal: ["deal1", "deal2"], chip: ["chip1", "chip2", "chip3"],
  shuffle: ["shuffle"], sweep: ["sweep"], win: ["win"], lose: ["lose"], turn: ["turn"], click: ["click"],
  nope: ["nope"], hint: ["hint"], points: ["points"], allin: ["allin"], chipstack: ["chipstack"], canasta: ["canasta"], reveal: ["reveal"],
  joker: ["joker"], roundwin: ["roundwin"], roundlose: ["roundlose"], draw: ["draw"], trick: ["trick"], knock: ["knock"],
};
const GAIN: Record<string, number> = { place: 0.7, flip: 0.5, deal: 0.45, chip: 0.6, shuffle: 0.6, sweep: 0.5, win: 0.7, lose: 0.6, turn: 0.4, click: 0.5, nope: 0.6, hint: 0.5, points: 0.4, allin: 0.7, chipstack: 0.6, canasta: 0.7, reveal: 0.7, joker: 0.6, roundwin: 0.7, roundlose: 0.6, draw: 0.5, trick: 0.55, knock: 0.6 };
const bank: Record<string, AudioBuffer[]> = {};
let loading = false;
function load(c: AudioContext) {
  if (loading) return; loading = true;
  for (const [k, names] of Object.entries(FILES)) for (const n of names) {
    fetch(new URL(`audio/${n}.mp3`, document.baseURI).href).then((r) => r.ok ? r.arrayBuffer() : Promise.reject()).then((b) => c.decodeAudioData(b))
      .then((buf) => { (bank[k] ??= []).push(buf); }).catch(() => { /* fallback synth stays */ });
  }
}
function sample(k: string, delay = 0, rate = 1): boolean {
  const c = ac(); const list = bank[k]; if (!c || !list?.length) return false;
  let b = list[Math.floor(Math.random() * list.length)]; if (list.length > 1) b = list[(list.indexOf(b) + 1) % list.length];
  const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
  const g = c.createGain(); g.gain.value = (GAIN[k] ?? 0.6) * (0.88 + Math.random() * 0.12);
  src.connect(g).connect(c.destination); src.start(c.currentTime + delay); return true;
}

let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem("muted") === "1"; } catch { return false; } })();
let noise: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    load(ctx);
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
  place() { const n = performance.now(); if (n - lastPlace < 45) return; lastPlace = n; if (sample("place")) return; burst(1800 + Math.random() * 500, 0.9, 0.07, 0.35); burst(300, 1, 0.09, 0.25, "lowpass"); },
  flip() { if (sample("flip")) return; burst(5200, 0.7, 0.05, 0.16, "highpass"); },
  deal() { if (sample("deal")) return; burst(3200, 0.8, 0.045, 0.2); },
  chip() { if (sample("chip")) return; tone(2400 + Math.random() * 300, 0.05, 0.12, "triangle"); tone(3400, 0.04, 0.07, "triangle", 0.035); },
  sweep() { if (sample("sweep")) return; burst(900, 0.6, 0.25, 0.18, "lowpass"); },
  shuffle() { if (sample("shuffle")) return; for (let i = 0; i < 12; i++) burst(3000 + Math.random() * 2000, 0.8, 0.04, 0.12, "bandpass", i * 0.05); },
  win() { if (sample("win")) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, 0.12, "triangle", i * 0.09)); },
  lose() { if (sample("lose")) return; [392, 330].forEach((f, i) => tone(f, 0.5, 0.1, "triangle", i * 0.25)); },
  /** it is your turn */
  turn() { if (sample("turn")) return; tone(700, 0.06, 0.06, "sine"); },
  click() { if (sample("click")) return; tone(900, 0.03, 0.05, "square"); },
  /** illegal move / refused card */
  nope() { if (sample("nope")) return; tone(180, 0.12, 0.12, "sawtooth"); },
  hint() { if (sample("hint")) return; tone(880, 0.25, 0.08, "sine"); tone(1320, 0.3, 0.06, "sine", 0.12); },
  /** "+n" score popup */
  points() { if (sample("points")) return; tone(1500, 0.06, 0.07, "triangle"); },
  /** Hold'em all-in / big stack pushed */
  allin() { if (sample("allin")) return; sfx.chip(); },
  chipstack() { if (sample("chipstack")) return; sfx.chip(); },
  /** Canasta completed */
  canasta() { if (sample("canasta")) return; sfx.win(); },
  /** Re! / Kontra / announcement stinger */
  reveal() { if (sample("reveal")) return; sfx.win(); },
  /** Rommé joker swap */
  joker() { if (sample("joker")) return; sfx.win(); },
  roundwin() { if (sample("roundwin")) return; sfx.win(); },
  roundlose() { if (sample("roundlose")) return; sfx.lose(); },
  /** drawing a card from the stock */
  draw() { if (sample("draw")) return; sfx.deal(); },
  /** a trick being collected */
  trick() { if (sample("trick")) return; sfx.sweep(); },
  /** check / pass knock */
  knock() { if (sample("knock")) return; tone(220, 0.05, 0.12, "triangle"); tone(220, 0.05, 0.1, "triangle", 0.12); },
  tick() { tone(900, 0.04, 0.06, "square"); },
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem("muted", muted ? "1" : "0"); } catch { /* ignore */ } music.sync(); return muted; },
};

/** Background music: crossfaded playlist, streamed through media elements (never decoded whole). */
const SHARED = ["pro_a", "pro_b", "pro_c", "music_a", "music_b", "music_c"];
/** each game opens with its own theme piece, then the shared pool */
const THEME: Record<string, string> = { holdem: "th_casino", skat: "th_bavaria", schafkopf: "th_bavaria", doppelkopf: "th_bavaria", romme: "th_salon", canasta: "th_salon", bridge: "th_club", maumau: "th_play", hearts: "th_club" };
let TRACKS = SHARED;
const MUSIC_VOL = 0.35, FADE = 2.5;
let musicOff = (() => { try { return localStorage.getItem("musicOff") === "1"; } catch { return false; } })();
let playing = false, cur: HTMLAudioElement | null = null, idx = 0, timer = 0;
function fade(a: HTMLAudioElement, to: number, secs: number, done?: () => void) {
  const from = a.volume, t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / (secs * 1000)); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) requestAnimationFrame(step); else done?.(); };
  step();
}
function nextTrack() {
  if (!playing || muted || musicOff) return;
  const a = new Audio(new URL(`audio/${TRACKS[idx++ % TRACKS.length]}.mp3`, document.baseURI).href);
  a.volume = 0; const old = cur; cur = a;
  a.play().then(() => {
    fade(a, MUSIC_VOL, FADE);
    if (old) fade(old, 0, FADE, () => { old.pause(); });
    const len = isFinite(a.duration) ? a.duration : 30;
    timer = window.setTimeout(nextTrack, Math.max(5, len - FADE) * 1000);
  }).catch(() => { cur = old; /* autoplay blocked: retried on the next gesture */ });
}
export const music = {
  start(gameId?: string) {
    const th = gameId ? THEME[gameId] : undefined, rest = [...SHARED].sort(() => Math.random() - 0.5);
    if (!playing || !cur) { TRACKS = th ? [th, ...rest] : rest; idx = 0; }
    playing = true; if (!cur && !muted && !musicOff) nextTrack();
  },
  stop() { playing = false; clearTimeout(timer); if (cur) { const a = cur; cur = null; fade(a, 0, 0.8, () => a.pause()); } },
  sync() { if (muted || musicOff) { clearTimeout(timer); if (cur) { const a = cur; cur = null; fade(a, 0, 0.5, () => a.pause()); } } else if (playing && !cur) nextTrack(); },
  get off() { return musicOff; },
  toggle() { musicOff = !musicOff; try { localStorage.setItem("musicOff", musicOff ? "1" : "0"); } catch { /* ignore */ } music.sync(); return musicOff; },
};
