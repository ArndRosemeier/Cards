import { loadCuedSession, type CuedSession } from "./cued.ts";
import { Application } from "pixi.js";
import gsap from "gsap";
import { confetti } from "./fx.ts";
import { createMenuScene } from "./menuScene.ts";
import { showRules } from "./rulesText.ts";
import { connect, OnlineSession, TableHost, hostLocal, joinLocal, extractCode, type LocalHost, type GameHub, type SeatSpec } from "@cards/net";
import { handshake, inviteOne, withTimeout, hasNearbyLink, clearNearbyLink } from "./nearby.ts";
import { entryOf, GAME_ENTRIES, type GameEntry } from "./games.ts";
import type { GameScene, SceneHooks } from "./trickScene.ts";
import { sfx, music } from "./sfx.ts";
import { EMOTES } from "./emote.ts";
import { setTableTheme, preloadBackgrounds, preloadCardArt, BACKS, getBack, setBack, getFourColor, setFourColor } from "./cardart.ts";
import { getLang, setLang, t } from "./i18n.ts";
import { Rng } from "@cards/engine";
import { cardsInMove, hintText } from "./hint.ts";
import { getStats, recordResult, resetStats } from "./stats.ts";
import { VERSION, BUILD_SHA, BUILD_DATE } from "./version.ts";
import { CHANGELOG } from "./changelog.ts";
import { botDelay, botWait, setBotWait, botVar, setBotVar, BOT_WAIT_MIN, BOT_WAIT_MAX, savedGame, saveGame, savedCount, saveCount } from "./prefs.ts";
import { viewSize, pickGeo } from "./geo.ts";
import { startRecording, recordUpdate, handCount, clearHands, downloadText, downloadJson } from "./handstore.ts";

type Session = OnlineSession<any, any, any, any, any>;
let gameId = savedGame((id) => !!entryOf(id)) ?? "maumau";
const ui = document.getElementById("ui")!;
const ALL_BOTS = ["Anna", "Ben", "Clara", "Dario", "Eva", "Finn", "Gina", "Hugo", "Ines", "Jonas", "Kira", "Leo"];
const pickBotNames = () => ALL_BOTS.map((n) => ({ n, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.n).slice(0, 6);
const q = new URLSearchParams(location.search);
const fast = !!q.get("fast");
const KEY = import.meta.env.VITE_GAMEHUB_KEY, HUB_URL = import.meta.env.VITE_GAMEHUB_URL;

const entry = (): GameEntry => entryOf(gameId);
const defOf = () => { const d = entry().def; return { ...d, botDelay: fast ? () => 100 : botDelay }; };

let app: Application;
let scene: GameScene<any> | null = null;
document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest?.(".btn")) sfx.click(); });
preloadBackgrounds(); preloadCardArt();
/* keep tweens on the wall clock (the default lag smoothing slows them on a busy frame, so a slow device would look stuck while dealing) */
gsap.ticker.lagSmoothing(0);
let teardown: (() => void) | null = null;
/** the newest update for the own seat: what the hint button asks the bot about */
let lastEmote = 0;
let lastUpdate: any = null;
/** The newest update that reached the scene, kept even after the own move cleared lastUpdate (used to rebuild the table when the screen turns). */
let lastDelivered: any = null;
/** Makes the current game's scene again (with the same hooks); set where a scene is created. */
let remakeScene: (() => GameScene<any>) | null = null;
/** Hand an update to the scene. Scenes that fix their layout at start (Hold'em, Rummy, Canasta) are started again, from the current state, when the screen turned. */
function deliver(u: any) {
  lastUpdate = lastDelivered = u;
  scene?.receive(u);
}

function toast(text: string) {
  ui.querySelector(".hint-toast")?.remove();
  const el = document.createElement("div"); el.className = "hint-toast"; el.textContent = text; ui.append(el);
  setTimeout(() => el.remove(), 5000);
}
function hintNow() {
  const u = lastUpdate;
  if (!u || !u.legal?.length || u.result) return toast(t("hintWait"));
  const m: any = defOf().makeBot({ kind: "bot", name: "", level: 1 }).choose(u.view, u.legal, Rng.fromSeed(Date.now()));
  scene?.hint?.(cardsInMove(m));
  toast(hintText(m, gameId));
}

const token = (() => {
  try { let v = sessionStorage.getItem("token"); if (!v) { v = crypto.randomUUID(); sessionStorage.setItem("token", v); } return v; } catch { return crypto.randomUUID(); }
})();
/** Opened from cued (the friends' portal)? Then the pass tells who is playing; without a pass everything is as before. */
let cued: CuedSession | null = null, cuedError = "";
try { cued = loadCuedSession("cards.cued-pass"); } catch (e) { cuedError = e instanceof Error ? e.message : String(e); }
const cuedName = cued && !cued.expired ? cued.identity.name.slice(0, 20) : "";
const savedName = () => { if (cuedName) return cuedName; try { return localStorage.getItem("name") ?? ""; } catch { return ""; } };
const savedLevel = (): number => { try { return localStorage.getItem("level") === "0" ? 0 : 1; } catch { return 1; } };
const saveLevel = (n: number) => { try { localStorage.setItem("level", String(n)); } catch { /* ignore */ } };
const saveName = (n: string) => { if (cuedName) return; try { localStorage.setItem("name", n); } catch { /* ignore */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Keeps the canvas and every scene in step with the real size of the play area. Scenes listen to "cards:resize", which is only sent
 * after the canvas has its new size (Pixi's own resize runs a frame later than the window event, so scenes used to lay out for the
 * previous size). After resuming from the background or turning the screen, iOS reports the final size late, so the size is checked
 * again a few times.
 */
function keepFitted(stage: HTMLElement) {
  let last = { w: stage.clientWidth, h: stage.clientHeight };
  const fit = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h || (w === last.w && h === last.h)) return;
    last = { w, h }; app.renderer.resize(w, h); window.dispatchEvent(new Event("cards:resize"));
  };
  // The screen turned: scenes that fix their layout at start are made again, at once, from the newest state. (Not while typing: on Android the on-screen keyboard shrinks the page and would look like a turn.)
  const turnCheck = () => {
    const s = scene, a = document.activeElement;
    if (!s || !remakeScene || !lastDelivered || s.portraitLayout === undefined) return;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    if (s.portraitLayout !== pickGeo(viewSize().w, viewSize().h).portrait) { s.destroy(); scene = remakeScene(); scene.receive({ ...lastDelivered, events: [] }); }
  };
  window.addEventListener("cards:resize", turnCheck);
  document.addEventListener("focusout", () => setTimeout(turnCheck, 350));
  const settle = () => { window.scrollTo(0, 0); fit(); for (const ms of [60, 250, 800, 2000]) setTimeout(fit, ms); };
  // safety net: if the browser ever skips a resize notification (iPad after resume, split view), the next tick catches it
  setInterval(() => { if (document.visibilityState === "visible") fit(); }, 1000);
  // no pinch zoom / page zoom: a zoomed page looks like a shrunken or shifted table, and iOS ignores user-scalable=no
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", settle); window.addEventListener("orientationchange", settle);
  window.addEventListener("pageshow", settle); window.addEventListener("focus", settle);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") settle(); });
  window.visualViewport?.addEventListener("resize", settle);
  // let the browser restore the graphics context after the app was in the background
  app.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
}

async function boot() {
  app = new Application();
  const stage = document.getElementById("stage")!, size = viewSize();
  // Sized from the #stage element, not from the window: on an iPad the window size is briefly stale when the app comes back from the background or turns.
  await app.init({ width: size.w, height: size.h, antialias: true, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  stage.append(app.canvas);
  keepFitted(stage);
  if (q.get("autostart")) {
    gameId = q.get("game") ?? "maumau"; const ok = entry().players, want = Number(q.get("players") ?? 3);
    return startLocal(q.get("name") ?? "Arnd", ok.includes(want) ? want : ok.includes(3) ? 3 : ok[ok.length - 1]!, Number(q.get("seed") ?? Date.now()));
  }
  if (hasNearbyLink()) return joinNearby(extractCode(location.hash));
  if (q.get("room")) return autoJoin(q.get("room")!.trim().toUpperCase());
  showMenu();
}

const GAMES: string[] = ["maumau", "hearts", "holdem", "skat", "doppelkopf", "romme", "bridge", "schafkopf", "canasta"];
const live = (g: string) => GAME_ENTRIES.some((e) => e.id === g);

/** "Playing as <avatar> Name" for cued members, a hint when the pass expired or is broken, nothing otherwise. */
function cuedBadge(): string {
  if (cuedError) return `<div class="cuedbadge warn">${esc(t("cuedBad"))}</div>`;
  if (!cued) return "";
  const id = cued.identity;
  if (cued.expired) return `<div class="cuedbadge warn">${esc(t("cuedExpired"))}</div>`;
  const av = id.avatarUrl ? `<img src="${esc(id.avatarUrl)}" alt="">` : `<span class="cuedav" style="background:${esc(id.circle.background)};color:${esc(id.circle.text)}">${esc(id.initials)}</span>`;
  return `<div class="cuedbadge">${av}<span>${esc(t("cuedAs"))} <b>${esc(id.name)}</b></span></div>`;
}
function panel(html: string): HTMLElement {
  teardown?.(); teardown = null; scene?.destroy(); scene = null; ui.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "menu";
  wrap.innerHTML = `<div class="panel">${html}</div>`; ui.append(wrap);
  return wrap;
}
/** Two volume sliders (effects, music), saved between sessions. */
function volumeRows(which: "sound" | "pace" | "all" = "all"): HTMLElement {
  const box = document.createElement("div"); box.className = "volrows";
  const mk = (icon: string, label: string, get: () => number, set: (v: number) => void, preview?: () => void) => {
    const row = document.createElement("div"); row.className = "volrow"; row.title = label;
    const ic = document.createElement("span"); ic.className = "volic";
    const sl = document.createElement("input"); sl.type = "range"; sl.min = "0"; sl.max = "100"; sl.step = "1"; sl.value = String(Math.round(get() * 100)); sl.setAttribute("aria-label", label);
    const lab = document.createElement("span"); lab.className = "volname"; lab.textContent = label;
    const paint = () => { const v = Number(sl.value); ic.textContent = v === 0 ? "🔇" : icon; sl.style.setProperty("--p", `${v}%`); };
    sl.oninput = () => { set(Number(sl.value) / 100); paint(); };
    sl.onchange = () => preview?.();
    ic.onclick = () => { if (Number(sl.value) > 0) { ic.dataset.prev = sl.value; sl.value = "0"; } else sl.value = ic.dataset.prev ?? "70"; set(Number(sl.value) / 100); paint(); preview?.(); };
    paint(); row.append(ic, lab, sl); return row;
  };
  // computer pace: how long the computer players "think" before a move
  const pace = document.createElement("div"); pace.className = "volrow"; pace.title = t("botPace");
  const pic = document.createElement("span"); pic.className = "volic"; pic.textContent = "⏱";
  const plab = document.createElement("span"); plab.className = "volname";
  const psl = document.createElement("input"); psl.type = "range"; psl.min = String(BOT_WAIT_MIN * 10); psl.max = String(BOT_WAIT_MAX * 10); psl.step = "1"; psl.value = String(Math.round(botWait() * 10)); psl.setAttribute("aria-label", t("botPace"));
  const ppaint = () => { const v = Number(psl.value); plab.textContent = `${(v / 10).toFixed(1)} s`; psl.style.setProperty("--p", `${((v - BOT_WAIT_MIN * 10) / ((BOT_WAIT_MAX - BOT_WAIT_MIN) * 10)) * 100}%`); };
  psl.oninput = () => { setBotWait(Number(psl.value) / 10); ppaint(); };
  ppaint(); pace.append(pic, plab, psl);
  // random share of that time
  const rnd = document.createElement("div"); rnd.className = "volrow"; rnd.title = t("botVar");
  const ric = document.createElement("span"); ric.className = "volic"; ric.textContent = "🎲";
  const rlab = document.createElement("span"); rlab.className = "volname";
  const rsl = document.createElement("input"); rsl.type = "range"; rsl.min = "0"; rsl.max = "100"; rsl.step = "5"; rsl.value = String(Math.round(botVar() * 100)); rsl.setAttribute("aria-label", t("botVar"));
  const rpaint = () => { const v = Number(rsl.value); rlab.textContent = `± ${v}%`; rsl.style.setProperty("--p", `${v}%`); };
  rsl.oninput = () => { setBotVar(Number(rsl.value) / 100); rpaint(); };
  rpaint(); rnd.append(ric, rlab, rsl);
  if (which !== "pace") box.append(mk("🔊", t("volSfx"), () => sfx.volume, (v) => sfx.setVolume(v), () => sfx.place()), mk("♪", t("volMusic"), () => music.volume, (v) => music.setVolume(v)));
  if (which !== "sound") box.append(pace, rnd);
  return box;
}
const langRow = () => `<div class="row"><label>${t("language")}</label><div class="seg" id="lg">${["de", "en"].map((l) => `<button class="${getLang() === l ? "sel" : ""}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div></div>`;
function bindLang(w: HTMLElement, rerender: () => void) {
  w.querySelectorAll<HTMLButtonElement>("#lg button").forEach((b) => (b.onclick = () => { setLang(b.dataset.l as "de" | "en"); rerender(); }));
}

let menuFx: { destroy(): void } | null = null;
const killMenuFx = () => { menuFx?.destroy(); menuFx = null; };
function showMenu() {
  music.stop(); if (!menuFx) menuFx = createMenuScene(app);
  const defPlayers = () => savedCount("players", gameId, entry().players) ?? (entry().players.includes(3) ? 3 : entry().players[0]!);
  let players = defPlayers(); let name = savedName();
  const render = () => {
    const w = panel(`<img class="logo" src="cards/logo.webp" alt=""><h1>${t("title")}</h1><div class="sub">${t("vsBots")}</div><button class="verchip" id="ver">v${VERSION}${newVersion() ? `<i>${t("newBadge")}</i>` : ""} · ${t("whatsNew")}</button>${cuedBadge()}
      <div class="games">${GAMES.map((g) => `<button class="game ${g === gameId ? "sel" : ""}" data-g="${g}" ${live(g) ? "" : "disabled"}>${t(g)}${live(g) ? "" : `<small>${t("soon")}</small>`}</button>`).join("")}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"${cuedName ? " readonly" : ""}></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${entry().players.map((n) => `<button class="${n === players ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div></div>
      <div class="row"><label>${t("computer")}</label><div class="seg" id="lv">${[0, 1].map((l) => `<button class="${savedLevel() === l ? "sel" : ""}" data-lv="${l}">${t(l ? "lvNormal" : "lvEasy")}</button>`).join("")}</div></div>
      <div class="row"><label>${t("volume")}</label><div id="volslot" class="volinline"></div></div>
      <div class="row"><label>${t("botPaceRow")}</label><div id="paceslot" class="volinline"></div></div>
      ${langRow()}
      <div class="row"><label>${t("fourColor")}</label><div class="seg" id="fc"><button class="${getFourColor() ? "" : "sel"}" data-v="0">${t("off")}</button><button class="${getFourColor() ? "sel" : ""}" data-v="1">${t("on")}</button></div></div>
      <div class="row"><label>${t("cardBack")}</label><div class="seg backs" id="bk">${BACKS.map((b) => `<button class="${getBack() === b ? "sel" : ""}" data-b="${b}"><img src="cards/${b}.webp" alt=""></button>`).join("")}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="stats">${t("stats")}</button><button class="btn" id="rules">${t("rules")}</button><button class="btn" id="online">${t("online")}</button><button class="btn primary" id="go">${t("play")}</button></div>`);
    (w.querySelector("#stats") as HTMLButtonElement).onclick = showStats;
    (w.querySelector("#ver") as HTMLButtonElement).onclick = (e) => { showWhatsNew(); markVersionSeen(); (e.currentTarget as HTMLElement).querySelector("i")?.remove(); };
    (w.querySelector("#rules") as HTMLButtonElement).onclick = () => showRules(ui, gameId, t(gameId), t("close"));
    w.querySelectorAll<HTMLButtonElement>("#lv button").forEach((b) => (b.onclick = () => { saveLevel(Number(b.dataset.lv)); w.querySelectorAll("#lv button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    const nm = () => (name = (w.querySelector("#nm") as HTMLInputElement).value.trim());
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); players = Number(b.dataset.n); saveCount("players", gameId, players); render(); }));
    w.querySelectorAll<HTMLButtonElement>("[data-g]:not([disabled])").forEach((b) => (b.onclick = () => { nm(); gameId = b.dataset.g!; saveGame(gameId); players = defPlayers(); render(); }));
    w.querySelectorAll<HTMLButtonElement>("#fc button").forEach((b) => (b.onclick = () => { setFourColor(b.dataset.v === "1"); w.querySelectorAll("#fc button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    w.querySelectorAll<HTMLButtonElement>("#bk button").forEach((b) => (b.onclick = () => { setBack(b.dataset.b!); w.querySelectorAll("#bk button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    bindLang(w, () => { nm(); render(); });
    w.querySelector("#volslot")!.append(volumeRows("sound")); w.querySelector("#paceslot")!.append(volumeRows("pace"));
    (w.querySelector("#go") as HTMLButtonElement).onclick = () => { nm(); name ||= t("you"); saveName(name); startLocal(name, players, Date.now()); };
    (w.querySelector("#online") as HTMLButtonElement).onclick = () => { nm(); if (name) saveName(name); showOnline(); };
  };
  render();
}

const SEEN_KEY = "cards.seenVersion";
function newVersion(): boolean { try { return localStorage.getItem(SEEN_KEY) !== VERSION; } catch { return false; } }
function markVersionSeen() { try { localStorage.setItem(SEEN_KEY, VERSION); } catch { /* storage unavailable */ } }
function showWhatsNew() {
  const lang = getLang() === "en" ? "en" : "de";
  const o = document.createElement("div"); o.className = "rules-overlay";
  o.innerHTML = `<div class="rules whatsnew"><h2>${t("whatsNew")}</h2><div class="sub">${t("version")} ${VERSION}${BUILD_SHA ? ` · ${t("build")} ${esc(BUILD_SHA)}` : ""} · ${BUILD_DATE.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>
    ${CHANGELOG.map((r) => `<h3>v${r.v} <small>${r.date}</small></h3><ul>${r[lang].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
    <div class="btns"><button class="btn primary" id="x">${t("close")}</button></div></div>`;
  (o.querySelector("#x") as HTMLButtonElement).onclick = () => o.remove();
  ui.append(o);
}

function showHandHistory() {
  const n = handCount(), o = document.createElement("div"); o.className = "rules-overlay";
  o.innerHTML = `<div class="rules"><h2>${t("hh")}</h2><div class="sub">${n ? t("hhCount", { n }) : t("hhNone")}</div>
    <p style="font-size:13px;opacity:.75;line-height:1.4">${t("hhNote")}</p>
    <div class="btns" style="gap:8px;flex-wrap:wrap">${n ? `<button class="btn" id="hclr">${t("hhClear")}</button><button class="btn" id="hjson">${t("hhJson")}</button><button class="btn primary" id="htxt">${t("hhText")}</button>` : ""}<button class="btn" id="x">${t("close")}</button></div></div>`;
  (o.querySelector("#x") as HTMLButtonElement).onclick = () => o.remove();
  (o.querySelector("#htxt") as HTMLButtonElement | null)?.addEventListener("click", downloadText);
  (o.querySelector("#hjson") as HTMLButtonElement | null)?.addEventListener("click", downloadJson);
  (o.querySelector("#hclr") as HTMLButtonElement | null)?.addEventListener("click", () => { clearHands(); o.remove(); showHandHistory(); });
  ui.append(o);
}
const addHandHistoryButton = () => {
  if (gameId !== "holdem") return;
  const hud = document.querySelector<HTMLElement>(".hud"); if (!hud || hud.querySelector("#hhbtn")) return;
  const b = document.createElement("button"); b.className = "btn"; b.id = "hhbtn"; b.title = t("hh"); b.textContent = "📜"; b.onclick = showHandHistory; hud.insertBefore(b, hud.querySelector("#rulesbtn"));
};

function showStats() {
  const all = getStats(), rows = GAMES.filter((g) => all[g]);
  const o = document.createElement("div"); o.className = "rules-overlay";
  o.innerHTML = `<div class="rules"><h2>${t("stats")}</h2>${rows.length ? `<table class="stats"><tr><th></th><th>${t("statsPlayed")}</th><th>${t("statsWon")}</th><th>${t("statsRate")}</th><th>${t("statsStreak")}</th></tr>${rows.map((g) => { const r = all[g]!; return `<tr><td>${t(g)}</td><td>${r.played}</td><td>${r.won}</td><td>${Math.round((100 * r.won) / r.played)}%</td><td>${r.streak} (${r.best})</td></tr>`; }).join("")}</table>` : `<div class="sub">${t("statsEmpty")}</div>`}
    <div class="btns" style="gap:8px">${handCount() ? `<button class="btn" id="hh">${t("hh")} (${handCount()})</button>` : ""}${rows.length ? `<button class="btn" id="rst">${t("statsReset")}</button>` : ""}<button class="btn primary" id="x">${t("close")}</button></div></div>`;
  (o.querySelector("#x") as HTMLButtonElement).onclick = () => o.remove();
  (o.querySelector("#rst") as HTMLButtonElement | null)?.addEventListener("click", () => { resetStats(); o.remove(); showStats(); });
  (o.querySelector("#hh") as HTMLButtonElement | null)?.addEventListener("click", () => { o.remove(); showHandHistory(); });
  ui.append(o);
}

// ---------------------------------------------------------------- online
/** A link like ?room=CODE (from the GameHub lobby or a friend): find out which game the room plays and go straight in. */
async function autoJoin(code: string) {
  const w = panel(`<h1>${t("online")}</h1><div class="sub">${t("connecting")}</div>`); void w;
  const n = savedName() || `${t("guest")} ${10 + Math.floor(Math.random() * 90)}`;
  const peek = connect({ url: HUB_URL, app: "cards", appKey: KEY });
  try {
    await peek.ready;
    let game = ((await peek.listRooms()).find((r) => r.id === code)?.meta as any)?.game as string | undefined;
    if (!game) { await peek.join(code); game = (peek.room?.meta as any)?.game; }   // private (already started) rooms are not listed
    peek.close();
    if (!game || !live(game)) throw Object.assign(new Error("bad room"), { code: "no_such_room" });
    gameId = game;
    enterRoom(await OnlineSession.join(defOf(), { url: HUB_URL, appKey: KEY, name: n, token }, code));
  } catch (e: any) {
    try { peek.close(); } catch { /* ignore */ }
    showOnline(code, e?.code === "room_full" ? t("roomFull") : e?.code === "no_such_room" ? t("roomNotFound") : t("connFail"));
  }
}

function showOnline(prefill = "", err0 = "") {
  let name = savedName(); let seats = savedCount("seats", gameId, entry().players) ?? (entry().players.includes(4) ? 4 : entry().players[0]!); let err = err0;
  let rooms: { id: string; name: string; players: number; maxPlayers: number; meta: any }[] = [];
  const hub = connect({ url: HUB_URL, app: "cards", appKey: KEY });
  let lobbyErr = false;
  const poll = async () => { try { rooms = (await hub.listRooms()).filter((r) => (r.meta as any)?.game === gameId); lobbyErr = false; } catch { rooms = []; lobbyErr = true; } if (alive && !document.querySelector("#create:disabled")) render(); };
  let alive = true;
  const timer = setInterval(poll, 5000); void poll();
  const stop = () => { alive = false; clearInterval(timer); hub.close(); };
  const render = () => {
    const w = panel(`<h1>${t("online")}</h1><div class="sub">${t(gameId)}</div>${cuedBadge()}
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"${cuedName ? " readonly" : ""}></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${entry().players.map((n) => `<button class="${n === seats ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
        <button class="btn primary" id="create">${t("createRoom")}</button></div>
      <div class="row"><label>${t("code")}</label><input type="text" id="code" maxlength="6" value="${esc(prefill)}" style="text-transform:uppercase"><button class="btn" id="join">${t("join")}</button></div>
      <div class="sub" style="margin:16px 0 6px">${t("openRooms")}</div>
      <div id="rooms">${rooms.length ? rooms.map((r) => `<div class="row"><span style="flex:1">${esc(r.name)} · ${r.players}/${(r.meta as any)?.seats ?? r.maxPlayers}</span><button class="btn" data-code="${r.id}">${t("join")}</button></div>`).join("") : `<div class="sub">${lobbyErr ? t("lobbyDown") : t("noRooms")}</div>`}</div>
      <div class="sub" style="margin:16px 0 6px">${t("nearby")}</div>
      <div class="sub" style="margin:0 0 8px;font-size:13px">${t("nearbyInfo")}</div>
      <div class="row"><button class="btn" id="nhost">${t("nearbyHost")}</button><button class="btn" id="njoin">${t("nearbyJoin")}</button></div>
      ${err ? `<div style="color:#ff9d9d;margin:8px 0">${esc(err)}</div>` : ""}
      ${langRow()}<div class="row"><button class="btn" id="back">${t("back")}</button></div>`);
    const nm = () => { name = (w.querySelector("#nm") as HTMLInputElement).value.trim() || t("you"); saveName(name); return name; };
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); seats = Number(b.dataset.n); saveCount("seats", gameId, seats); render(); }));
    bindLang(w, () => { nm(); render(); });
    (w.querySelector("#back") as HTMLButtonElement).onclick = () => { stop(); showMenu(); };
    const busy = (label: string) => {
      w.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
      const m = document.createElement("div"); m.className = "sub"; m.style.margin = "8px 0"; m.textContent = label;
      w.querySelector("#create")!.closest(".row")!.after(m);
    };
    const failText = (e: any) => {
      const detail = String(e?.code ?? e?.message ?? e ?? "").replace(/^gamehub:\s*/, "");
      return detail ? `${t("connFail")} (${detail})` : t("connFail");
    };
    const guard = (): boolean => { if (!KEY) { err = `${t("connFail")} (${t("noKey")})`; render(); return false; } return true; };
    (w.querySelector("#create") as HTMLButtonElement).onclick = async () => {
      const n = nm(); if (!guard()) return;
      busy(t("creating"));
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000));
      try {
        const session = await Promise.race([OnlineSession.create(defOf(), { url: HUB_URL, appKey: KEY, name: n, token }, { name: `${t(gameId)} · ${n}`, seats, public: true }), timeout]);
        stop(); enterRoom(session);
      } catch (e) { console.error("create room failed", e); err = failText(e); render(); }
    };
    (w.querySelector("#nhost") as HTMLButtonElement).onclick = async () => {
      const n = nm();
      busy(t("creating"));
      const hub = hostLocal({ app: "cards", name: n });
      try {
        const session = await withTimeout(OnlineSession.create(defOf(), { hub, name: n, token }, { name: `${t(gameId)} · ${n}`, seats }), 10000);
        stop(); enterRoom(session);
      } catch (e) { console.error("nearby host failed", e); hub.close(); err = failText(e); render(); }
    };
    (w.querySelector("#njoin") as HTMLButtonElement).onclick = () => { nm(); stop(); void joinNearby(""); };
    const joinCode = async (code: string) => {
      const n = nm(); if (!guard()) return;
      busy(t("connecting"));
      try {
        const session = await OnlineSession.join(defOf(), { url: HUB_URL, appKey: KEY, name: n, token }, code.trim().toUpperCase());
        stop(); enterRoom(session);
      } catch (e: any) { console.error("join room failed", e); err = e?.code === "room_full" ? t("roomFull") : e?.code === "no_such_room" ? t("roomNotFound") : failText(e); prefill = code; render(); }
    };
    (w.querySelector("#join") as HTMLButtonElement).onclick = () => joinCode((w.querySelector("#code") as HTMLInputElement).value);
    w.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((b) => (b.onclick = () => joinCode(b.dataset.code!)));
  };
  render();
  teardown = stop;
}

/** Nearby (Wi-Fi) play, joining side: read the host's invite (QR or pasted), show the answer code, then enter the host's room. */
async function joinNearby(inviteCode: string, err = "") {
  const n = savedName() || `${t("guest")} ${10 + Math.floor(Math.random() * 90)}`;
  let hub: GameHub<any, any, any> | null = null, entered = false;
  const w = panel(`<h1>${t("nearby")}</h1>${err ? `<div style="color:#ff9d9d;margin:8px 0">${esc(err)}</div>` : ""}<div id="hs"></div>`);
  const hs = handshake(() => { if (!entered) { hub?.close(); clearNearbyLink(); showMenu(); } });
  w.querySelector("#hs")!.append(hs.el);
  teardown = () => { if (!entered) hub?.close(); hs.close(); };
  if (!inviteCode) { hs.step(t("nearbyScanInvite"), null, (c) => void joinNearby(c)); return; }
  try {
    hs.step(t("nearbyConnecting"), null, null);
    const joined = await joinLocal(inviteCode, { app: "cards", name: n });
    hub = joined.hub;
    hs.step(t("nearbyShowAnswer"), joined.answer, null);
    await withTimeout(hub.ready, 120000);
    await hub.join("");
    const game = (hub.room?.meta as any)?.game as string | undefined;
    if (!game || !live(game)) throw new Error("bad room");
    gameId = game;
    const session = await OnlineSession.join(defOf(), { hub, name: n, token }, "");
    entered = true; clearNearbyLink();
    enterRoom(session);
  } catch (e: any) {
    console.error("nearby join failed", e);
    hub?.close();
    void joinNearby("", `${t("nearbyBad")}: ${String(e?.message ?? e).replace(/^gamehub:\s*/, "")}`);
  }
}

function enterRoom(session: Session) {
  const nearbyHost = typeof (session.hub as any).invite === "function" ? (session.hub as LocalHost) : null;
  const nearby = session.nearby;
  let started = false;
  chatLog = []; chatSink = null;
  session.on("chat", (seat, name, text) => { const l: ChatLine = { seat, name, text, mine: seat === session.mySeat }; chatLog.push(l); if (chatLog.length > 200) chatLog.shift(); chatSink?.(l); });
  const showLobby = () => {
    if (started) return;
    const l = session.lobby;
    const link = `${location.origin}${location.pathname}?room=${session.code}`;
    const w = panel(`<h1>${t("online")}</h1><div class="sub">${nearby ? `<b style="color:#e8c66a;font-size:20px">${t("nearbyTag")}</b>` : `${t("code")}: <b style="color:#e8c66a;font-size:22px;letter-spacing:.15em">${session.code}</b>`}</div>
      <div id="seats">${l.seats.map((s, i) => `<div class="row"><span style="flex:1">${i + 1}. ${s.kind === "open" ? `<i style="opacity:.6">${t("seatOpenHuman")}</i>` : esc(s.name || t("seatBot")) + (s.kind === "host" ? ` · ${t("host")}` : s.kind === "bot" ? ` · ${t("seatBot")}` : "")}</span>
        ${session.isHost && i > 0 && (s.kind === "open" || s.kind === "bot") ? `<button class="btn" data-i="${i}" data-k="${s.kind === "open" ? "bot" : "open"}">${s.kind === "open" ? t("seatBot") : t("open")}</button>` : ""}</div>`).join("")}</div>
      ${nearby ? (nearbyHost ? `<div class="row"><button class="btn primary" id="invite"${l.seats.some((s) => s.kind === "open") ? "" : " disabled"}>${t("nearbyInvite")}</button></div><div class="sub" style="font-size:13px">${t("nearbyKeep")}</div>` : "") : `<div class="row"><button class="btn" id="copy">${t("copyLink")}</button></div>`}
      <div class="row" style="justify-content:space-between"><button class="btn" id="leave">${t("leave")}</button>
      ${session.isHost ? `<button class="btn primary" id="start">${t("startGame")}</button>` : `<span class="sub">${t("onlyHost")}</span>`}</div>`);
    w.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) => (b.onclick = () => session.setSeatKind(Number(b.dataset.i), b.dataset.k as "open" | "bot")));
    (w.querySelector("#invite") as HTMLButtonElement | null)?.addEventListener("click", () => { void inviteOne(document.body, nearbyHost!); });
    (w.querySelector("#copy") as HTMLButtonElement | null)?.addEventListener("click", (e) => { void navigator.clipboard?.writeText(link); (e.target as HTMLElement).textContent = t("copied"); });
    (w.querySelector("#leave") as HTMLButtonElement).onclick = () => { session.leave(); showMenu(); };
    (w.querySelector("#start") as HTMLButtonElement | null)?.addEventListener("click", () => session.startGame(pickBotNames()));
    teardown = () => { /* lobby view only */ };
  };
  let gameShown = false;
  session.on("lobby", (l) => { if (l.phase === "lobby") showLobby(); else if (!gameShown) showGame(); });
  session.on("update", (u) => { if (!gameShown) showGame(); deliver(u); if (gameId === "holdem") recordUpdate(u as any); });
  session.on("emote", (seat, id) => scene?.emote?.(seat, id));
  session.on("error", (c) => { if (c === "host_lost" || c === "connection_closed") { session.leave(); showMenu(); toast(t(c === "host_lost" || session.nearby ? "hostLost" : "connLost")); } else if (c === "room_full") { session.leave(); showOnline("", t("roomFull")); } });
  const showGame = () => {
    gameShown = started = true;
    killMenuFx(); teardown?.(); scene?.destroy(); ui.innerHTML = "";
    if (gameId === "holdem") startRecording(`online ${session.code}`);
    setTableTheme(gameId);
    const hooks = { submit: (m: any) => { lastUpdate = null; session.submit(m); }, onFinished: (w: number, names: string[], _me: number, sc: number[]) => setTimeout(() => showResult(w, names, session, undefined, sc), 1500) };
    scene = entry().scene(app, ui, hooks); remakeScene = () => entry().scene(app, ui, hooks);
    addHud(() => { session.leave(); scene?.destroy(); scene = null; showMenu(); }, (id) => { const me = session.mySeat; if (me === null || Date.now() - lastEmote < 1500) return; lastEmote = Date.now(); session.sendEmote(id); scene?.emote?.(me, id); }, (text) => session.sendChat(text));
  };
  showLobby();
}

interface ChatLine { seat: number; name: string; text: string; mine: boolean }
let chatLog: ChatLine[] = [];
let chatSink: ((l: ChatLine) => void) | null = null;

function addHud(onMenu: () => void, onEmote?: (id: string) => void, onChat?: (text: string) => void) {
  const hud = document.createElement("div"); hud.className = "hud";
  hud.innerHTML = `<button class="btn">${t("menu")}</button><button class="btn" id="hintbtn" title="${t('hint')}">💡</button><button class="btn" id="emobtn" title="${t('emote')}">☺</button>${onChat ? `<button class="btn" id="chatbtn" title="${t('chat')}">💬<span class="badge" hidden></span></button>` : ""}<button class="btn" id="rulesbtn">?</button><button class="btn" id="volbtn" title="${t('volume')}">${sfx.volume === 0 && music.volume === 0 ? "🔇" : "🔊"}<small>▾</small></button>`;
  (hud.firstElementChild as HTMLButtonElement).onclick = onMenu;
  (hud.querySelector("#hintbtn") as HTMLButtonElement).onclick = () => { sfx.hint(); hintNow(); };
  (hud.querySelector("#emobtn") as HTMLButtonElement).onclick = () => {
    const old = ui.querySelector(".emopick"); if (old) { old.remove(); return; }
    const pk = document.createElement("div"); pk.className = "emopick";
    pk.innerHTML = EMOTES.map((id) => `<button data-e="${id}"><img src="emotes/${id}.webp" alt="${id}"></button>`).join("");
    pk.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => { pk.remove(); sfx.click(); onEmote?.(b.dataset.e!); }));
    ui.append(pk);
  };
  if (onChat) mountChat(hud, onChat);
  (hud.querySelector("#rulesbtn") as HTMLButtonElement).onclick = () => showRules(ui, gameId, t(gameId), t("close"));
  (hud.querySelector("#volbtn") as HTMLButtonElement).onclick = (e) => {
    const vb = e.currentTarget as HTMLElement;
    const old = ui.querySelector(".volpop"); if (old) { old.remove(); return; }
    const pop = document.createElement("div"); pop.className = "volpop"; pop.append(volumeRows());
    pop.addEventListener("input", () => { vb.innerHTML = `${sfx.volume === 0 && music.volume === 0 ? "🔇" : "🔊"}<small>▾</small>`; });
    ui.append(pop);
  };
  ui.append(hud); addHandHistoryButton();
  music.start(gameId); sfx.shuffle();
  const rot = document.createElement("div"); rot.className = "rotate"; rot.innerHTML = `<div class="ico">⟳</div><div>${t("rotate")}</div>`; ui.append(rot);
}

/** Folding table chat: a panel under the HUD, a badge on the button and a short preview while it is folded. */
function mountChat(hud: HTMLElement, send: (text: string) => void) {
  const btn = hud.querySelector("#chatbtn") as HTMLButtonElement, badge = btn.querySelector(".badge") as HTMLElement;
  const panelEl = document.createElement("div"); panelEl.className = "chatpanel"; panelEl.hidden = true;
  panelEl.innerHTML = `<div class="chatlog"></div><form class="chatform"><input type="text" maxlength="240" autocomplete="off" placeholder="${esc(t("chatHint"))}"><button class="btn primary" type="submit">➤</button></form>`;
  const preview = document.createElement("div"); preview.className = "chatpreview"; preview.hidden = true;
  const log = panelEl.querySelector(".chatlog") as HTMLElement, input = panelEl.querySelector("input") as HTMLInputElement;
  let unread = 0, previewTimer = 0;
  const add = (l: ChatLine) => {
    const row = document.createElement("div"); row.className = "chatline" + (l.mine ? " mine" : "");
    const who = document.createElement("b"); who.textContent = l.mine ? t("you") : l.name || t("guest"); const tx = document.createElement("span"); tx.textContent = " " + l.text;
    row.append(who, tx); log.append(row); log.scrollTop = log.scrollHeight;
  };
  chatLog.forEach(add);
  const showBadge = () => { badge.hidden = unread === 0; badge.textContent = String(unread); };
  chatSink = (l) => {
    add(l);
    if (l.mine || !panelEl.hidden) return;
    unread++; showBadge(); sfx.click();
    preview.textContent = `${l.name || t("guest")}: ${l.text}`; preview.hidden = false;
    clearTimeout(previewTimer); previewTimer = window.setTimeout(() => { preview.hidden = true; }, 4500);
  };
  btn.onclick = () => {
    panelEl.hidden = !panelEl.hidden; preview.hidden = true;
    if (!panelEl.hidden) { unread = 0; showBadge(); log.scrollTop = log.scrollHeight; input.focus(); }
  };
  (panelEl.querySelector("form") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { send(v); input.value = ""; } };
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { panelEl.hidden = true; input.blur(); } });
  unread = chatLog.filter((l) => !l.mine).length; showBadge();
  ui.append(panelEl, preview);
}

function showResult(winner: number, names: string[], session: Session | null, again?: () => void, scores?: number[]) {
  if (ui.querySelector(".result")) return;
  const me = session ? session.mySeat : 0;
  recordResult(gameId, winner === me);
  if (winner === me) { sfx.win(); sparkles(); } else sfx.lose();
  const r = document.createElement("div"); r.className = "result";
  r.innerHTML = `<div class="panel"><h1>${winner === me ? t("youWin") : t("wins", { n: esc(names[winner] ?? "") })}</h1>${scores ? `<div class="final">${scores.map((s, i) => `<div class="${i === winner ? "win" : ""}"><span>${i === me ? esc(t("you")) : esc(names[i] ?? "")}</span><b>${s}</b></div>`).join("")}</div>` : ""}
    <div class="btns">${again ? `<button class="btn primary" id="again">${t("again")}</button>` : ""}<button class="btn" id="menu">${t("menu")}</button></div></div>`;
  (r.querySelector("#again") as HTMLButtonElement | null)?.addEventListener("click", () => again!());
  (r.querySelector("#menu") as HTMLButtonElement).onclick = () => { session?.leave(); showMenu(); };
  ui.append(r);
  if (winner === me) confetti(r);
}

// ---------------------------------------------------------------- local play
function startLocal(name: string, players: number, seed: number) {
  killMenuFx(); teardown?.(); scene?.destroy(); ui.innerHTML = "";
  const botNames = pickBotNames();
  const seats: SeatSpec[] = [{ kind: "human", name }, ...Array.from({ length: players - 1 }, (_, i): SeatSpec => ({ kind: "bot", name: botNames[i]!, level: savedLevel() }))];
  const d = defOf();
  const host = new TableHost(d.rules, d.config, seats, d.makeBot, { seed, annotate: gameId === "holdem", botDelay: fast ? () => 100 : botDelay });
  if (gameId === "holdem") startRecording("solo");
  setTableTheme(gameId);
  const hooks: SceneHooks<any> = {
    submit: (m: any) => { lastUpdate = null; host.submit(0, m); },
    onFinished: (w, _n, _m, sc) => setTimeout(() => showResult(w, seats.map((s) => s.name), null, () => startLocal(name, players, Date.now()), sc), 1500),
  };
  scene = entry().scene(app, ui, hooks); remakeScene = () => entry().scene(app, ui, hooks);
  teardown = () => host.dispose();
  const botEmote = (id?: string) => { if (players < 2) return; const seat = 1 + Math.floor(Math.random() * (players - 1)); scene?.emote?.(seat, id ?? EMOTES[Math.floor(Math.random() * EMOTES.length)]!); };
  addHud(() => { host.dispose(); scene?.destroy(); scene = null; showMenu(); }, (id) => {
    if (Date.now() - lastEmote < 1500) return; lastEmote = Date.now(); scene?.emote?.(0, id);
    if (Math.random() < 0.6) setTimeout(() => botEmote(id === "thumbs" ? "clap" : id === "oops" ? "hmm" : id === "clap" ? "thumbs" : "oops"), 900 + Math.random() * 900);
  });
  host.attach(0, (u: any) => {
    deliver(u); if (gameId === "holdem") recordUpdate(u);
    if (q.get("auto") && u.legal.length && !u.result) setTimeout(() => host.submit(0, d.makeBot({ kind: "bot", name: "" }).choose(u.view, u.legal, host.rng)), fast ? 150 : 1800);
  });
  host.start();
}

if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
if (import.meta.env.DEV) Object.defineProperty(window, "__scene", { get: () => scene });
void boot();

/** celebratory sparkles (painted spark sprite, additive blend) rising over the result screen */
function sparkles() {
  const src = new URL("cards/spark.webp", document.baseURI).href;
  for (let i = 0; i < 28; i++) {
    const im = document.createElement("img"); im.src = src; im.alt = ""; im.className = "spark";
    const size = 40 + Math.random() * 90, x = Math.random() * 100, dur = 1800 + Math.random() * 1800;
    im.style.cssText = `left:${x}vw;bottom:-10vh;width:${size}px;height:${size}px;animation-duration:${dur}ms;animation-delay:${Math.random() * 900}ms`;
    ui.append(im); setTimeout(() => im.remove(), dur + 1200);
  }
}
