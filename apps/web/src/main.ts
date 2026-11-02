import { Application } from "pixi.js";
import gsap from "gsap";
import { confetti } from "./fx.ts";
import { createMenuScene } from "./menuScene.ts";
import { showRules } from "./rulesText.ts";
import { connect, OnlineSession, TableHost, type SeatSpec } from "@cards/net";
import { entryOf, GAME_ENTRIES, type GameEntry } from "./games.ts";
import type { GameScene } from "./trickScene.ts";
import { sfx, music } from "./sfx.ts";
import { EMOTES } from "./emote.ts";
import { setTableTheme, preloadBackgrounds, preloadCardArt, BACKS, getBack, setBack, getFourColor, setFourColor } from "./cardart.ts";
import { getLang, setLang, t } from "./i18n.ts";
import { Rng } from "@cards/engine";
import { cardsInMove, hintText } from "./hint.ts";
import { getStats, recordResult, resetStats } from "./stats.ts";

type Session = OnlineSession<any, any, any, any, any>;
let gameId = "maumau";
const ui = document.getElementById("ui")!;
const ALL_BOTS = ["Anna", "Ben", "Clara", "Dario", "Eva", "Finn", "Gina", "Hugo", "Ines", "Jonas", "Kira", "Leo"];
const pickBotNames = () => ALL_BOTS.map((n) => ({ n, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.n).slice(0, 6);
const q = new URLSearchParams(location.search);
const fast = !!q.get("fast");
const KEY = import.meta.env.VITE_GAMEHUB_KEY, HUB_URL = import.meta.env.VITE_GAMEHUB_URL;

const entry = (): GameEntry => entryOf(gameId);
const defOf = () => { const d = entry().def; return fast ? { ...d, botDelay: () => 100 } : d; };

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
const savedName = () => { try { return localStorage.getItem("name") ?? ""; } catch { return ""; } };
const savedLevel = (): number => { try { return localStorage.getItem("level") === "0" ? 0 : 1; } catch { return 1; } };
const saveLevel = (n: number) => { try { localStorage.setItem("level", String(n)); } catch { /* ignore */ } };
const saveName = (n: string) => { try { localStorage.setItem("name", n); } catch { /* ignore */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function boot() {
  app = new Application();
  await app.init({ resizeTo: window, antialias: true, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  document.getElementById("stage")!.append(app.canvas);
  if (q.get("autostart")) {
    gameId = q.get("game") ?? "maumau"; const ok = entry().players, want = Number(q.get("players") ?? 3);
    return startLocal(q.get("name") ?? "Arnd", ok.includes(want) ? want : ok.includes(3) ? 3 : ok[ok.length - 1]!, Number(q.get("seed") ?? Date.now()));
  }
  if (q.get("room")) return autoJoin(q.get("room")!.trim().toUpperCase());
  showMenu();
}

const GAMES: string[] = ["maumau", "hearts", "holdem", "skat", "doppelkopf", "romme", "bridge", "schafkopf", "canasta"];
const live = (g: string) => GAME_ENTRIES.some((e) => e.id === g);

function panel(html: string): HTMLElement {
  teardown?.(); teardown = null; scene?.destroy(); scene = null; ui.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "menu";
  wrap.innerHTML = `<div class="panel">${html}</div>`; ui.append(wrap);
  return wrap;
}
const langRow = () => `<div class="row"><label>${t("language")}</label><div class="seg" id="lg">${["de", "en"].map((l) => `<button class="${getLang() === l ? "sel" : ""}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div></div>`;
function bindLang(w: HTMLElement, rerender: () => void) {
  w.querySelectorAll<HTMLButtonElement>("#lg button").forEach((b) => (b.onclick = () => { setLang(b.dataset.l as "de" | "en"); rerender(); }));
}

let menuFx: { destroy(): void } | null = null;
const killMenuFx = () => { menuFx?.destroy(); menuFx = null; };
function showMenu() {
  music.stop(); if (!menuFx) menuFx = createMenuScene(app);
  let players = entry().players.includes(3) ? 3 : entry().players[0]!; let name = savedName();
  const render = () => {
    const w = panel(`<img class="logo" src="cards/logo.webp" alt=""><h1>${t("title")}</h1><div class="sub">${t("vsBots")}</div>
      <div class="games">${GAMES.map((g) => `<button class="game ${g === gameId ? "sel" : ""}" data-g="${g}" ${live(g) ? "" : "disabled"}>${t(g)}${live(g) ? "" : `<small>${t("soon")}</small>`}</button>`).join("")}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${entry().players.map((n) => `<button class="${n === players ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div></div>
      <div class="row"><label>${t("computer")}</label><div class="seg" id="lv">${[0, 1].map((l) => `<button class="${savedLevel() === l ? "sel" : ""}" data-lv="${l}">${t(l ? "lvNormal" : "lvEasy")}</button>`).join("")}</div></div>
      ${langRow()}
      <div class="row"><label>${t("fourColor")}</label><div class="seg" id="fc"><button class="${getFourColor() ? "" : "sel"}" data-v="0">${t("off")}</button><button class="${getFourColor() ? "sel" : ""}" data-v="1">${t("on")}</button></div></div>
      <div class="row"><label>${t("cardBack")}</label><div class="seg backs" id="bk">${BACKS.map((b) => `<button class="${getBack() === b ? "sel" : ""}" data-b="${b}"><img src="cards/${b}.webp" alt=""></button>`).join("")}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="stats">${t("stats")}</button><button class="btn" id="rules">${t("rules")}</button><button class="btn" id="online">${t("online")}</button><button class="btn primary" id="go">${t("play")}</button></div>`);
    (w.querySelector("#stats") as HTMLButtonElement).onclick = showStats;
    (w.querySelector("#rules") as HTMLButtonElement).onclick = () => showRules(ui, gameId, t(gameId), t("close"));
    w.querySelectorAll<HTMLButtonElement>("#lv button").forEach((b) => (b.onclick = () => { saveLevel(Number(b.dataset.lv)); w.querySelectorAll("#lv button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    const nm = () => (name = (w.querySelector("#nm") as HTMLInputElement).value.trim());
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); players = Number(b.dataset.n); render(); }));
    w.querySelectorAll<HTMLButtonElement>("[data-g]:not([disabled])").forEach((b) => (b.onclick = () => { nm(); gameId = b.dataset.g!; if (!entry().players.includes(players)) players = entry().players[entry().players.length - 1]!; render(); }));
    w.querySelectorAll<HTMLButtonElement>("#fc button").forEach((b) => (b.onclick = () => { setFourColor(b.dataset.v === "1"); w.querySelectorAll("#fc button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    w.querySelectorAll<HTMLButtonElement>("#bk button").forEach((b) => (b.onclick = () => { setBack(b.dataset.b!); w.querySelectorAll("#bk button").forEach((x) => x.classList.toggle("sel", x === b)); }));
    bindLang(w, () => { nm(); render(); });
    (w.querySelector("#go") as HTMLButtonElement).onclick = () => { nm(); name ||= t("you"); saveName(name); startLocal(name, players, Date.now()); };
    (w.querySelector("#online") as HTMLButtonElement).onclick = () => { nm(); if (name) saveName(name); showOnline(); };
  };
  render();
}

function showStats() {
  const all = getStats(), rows = GAMES.filter((g) => all[g]);
  const o = document.createElement("div"); o.className = "rules-overlay";
  o.innerHTML = `<div class="rules"><h2>${t("stats")}</h2>${rows.length ? `<table class="stats"><tr><th></th><th>${t("statsPlayed")}</th><th>${t("statsWon")}</th><th>${t("statsRate")}</th><th>${t("statsStreak")}</th></tr>${rows.map((g) => { const r = all[g]!; return `<tr><td>${t(g)}</td><td>${r.played}</td><td>${r.won}</td><td>${Math.round((100 * r.won) / r.played)}%</td><td>${r.streak} (${r.best})</td></tr>`; }).join("")}</table>` : `<div class="sub">${t("statsEmpty")}</div>`}
    <div class="btns" style="gap:8px">${rows.length ? `<button class="btn" id="rst">${t("statsReset")}</button>` : ""}<button class="btn primary" id="x">${t("close")}</button></div></div>`;
  (o.querySelector("#x") as HTMLButtonElement).onclick = () => o.remove();
  (o.querySelector("#rst") as HTMLButtonElement | null)?.addEventListener("click", () => { resetStats(); o.remove(); showStats(); });
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
  let name = savedName(); let seats = entry().players.includes(4) ? 4 : entry().players[0]!; let err = err0;
  let rooms: { id: string; name: string; players: number; maxPlayers: number; meta: any }[] = [];
  const hub = connect({ url: HUB_URL, app: "cards", appKey: KEY });
  let lobbyErr = false;
  const poll = async () => { try { rooms = (await hub.listRooms()).filter((r) => (r.meta as any)?.game === gameId); lobbyErr = false; } catch { rooms = []; lobbyErr = true; } if (alive && !document.querySelector("#create:disabled")) render(); };
  let alive = true;
  const timer = setInterval(poll, 5000); void poll();
  const stop = () => { alive = false; clearInterval(timer); hub.close(); };
  const render = () => {
    const w = panel(`<h1>${t("online")}</h1><div class="sub">${t(gameId)}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${entry().players.map((n) => `<button class="${n === seats ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
        <button class="btn primary" id="create">${t("createRoom")}</button></div>
      <div class="row"><label>${t("code")}</label><input type="text" id="code" maxlength="6" value="${esc(prefill)}" style="text-transform:uppercase"><button class="btn" id="join">${t("join")}</button></div>
      <div class="sub" style="margin:16px 0 6px">${t("openRooms")}</div>
      <div id="rooms">${rooms.length ? rooms.map((r) => `<div class="row"><span style="flex:1">${esc(r.name)} · ${r.players}/${(r.meta as any)?.seats ?? r.maxPlayers}</span><button class="btn" data-code="${r.id}">${t("join")}</button></div>`).join("") : `<div class="sub">${lobbyErr ? t("lobbyDown") : t("noRooms")}</div>`}</div>
      ${err ? `<div style="color:#ff9d9d;margin:8px 0">${esc(err)}</div>` : ""}
      ${langRow()}<div class="row"><button class="btn" id="back">${t("back")}</button></div>`);
    const nm = () => { name = (w.querySelector("#nm") as HTMLInputElement).value.trim() || t("you"); saveName(name); return name; };
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); seats = Number(b.dataset.n); render(); }));
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

function enterRoom(session: Session) {
  let started = false;
  chatLog = []; chatSink = null;
  session.on("chat", (seat, name, text) => { const l: ChatLine = { seat, name, text, mine: seat === session.mySeat }; chatLog.push(l); if (chatLog.length > 200) chatLog.shift(); chatSink?.(l); });
  const showLobby = () => {
    if (started) return;
    const l = session.lobby;
    const link = `${location.origin}${location.pathname}?room=${session.code}`;
    const w = panel(`<h1>${t("online")}</h1><div class="sub">${t("code")}: <b style="color:#e8c66a;font-size:22px;letter-spacing:.15em">${session.code}</b></div>
      <div id="seats">${l.seats.map((s, i) => `<div class="row"><span style="flex:1">${i + 1}. ${s.kind === "open" ? `<i style="opacity:.6">${t("seatOpenHuman")}</i>` : esc(s.name || t("seatBot")) + (s.kind === "host" ? ` · ${t("host")}` : s.kind === "bot" ? ` · ${t("seatBot")}` : "")}</span>
        ${session.isHost && i > 0 && (s.kind === "open" || s.kind === "bot") ? `<button class="btn" data-i="${i}" data-k="${s.kind === "open" ? "bot" : "open"}">${s.kind === "open" ? t("seatBot") : t("open")}</button>` : ""}</div>`).join("")}</div>
      <div class="row"><button class="btn" id="copy">${t("copyLink")}</button></div>
      <div class="row" style="justify-content:space-between"><button class="btn" id="leave">${t("leave")}</button>
      ${session.isHost ? `<button class="btn primary" id="start">${t("startGame")}</button>` : `<span class="sub">${t("onlyHost")}</span>`}</div>`);
    w.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) => (b.onclick = () => session.setSeatKind(Number(b.dataset.i), b.dataset.k as "open" | "bot")));
    (w.querySelector("#copy") as HTMLButtonElement).onclick = (e) => { void navigator.clipboard?.writeText(link); (e.target as HTMLElement).textContent = t("copied"); };
    (w.querySelector("#leave") as HTMLButtonElement).onclick = () => { session.leave(); showMenu(); };
    (w.querySelector("#start") as HTMLButtonElement | null)?.addEventListener("click", () => session.startGame(pickBotNames()));
    teardown = () => { /* lobby view only */ };
  };
  let gameShown = false;
  session.on("lobby", (l) => { if (l.phase === "lobby") showLobby(); else if (!gameShown) showGame(); });
  session.on("update", (u) => { if (!gameShown) showGame(); lastUpdate = u; scene?.receive(u); });
  session.on("emote", (seat, id) => scene?.emote?.(seat, id));
  session.on("error", (c) => { if (c === "host_lost" || c === "connection_closed") { session.leave(); showMenu(); toast(t(c === "host_lost" ? "hostLost" : "connLost")); } else if (c === "room_full") { session.leave(); showOnline("", t("roomFull")); } });
  const showGame = () => {
    gameShown = started = true;
    killMenuFx(); teardown?.(); scene?.destroy(); ui.innerHTML = "";
    setTableTheme(gameId);
    scene = entry().scene(app, ui, { submit: (m) => { lastUpdate = null; session.submit(m); }, onFinished: (w, names, _me, sc) => setTimeout(() => showResult(w, names, session, undefined, sc), 1500) });
    addHud(() => { session.leave(); scene?.destroy(); scene = null; showMenu(); }, (id) => { const me = session.mySeat; if (me === null || Date.now() - lastEmote < 1500) return; lastEmote = Date.now(); session.sendEmote(id); scene?.emote?.(me, id); }, (text) => session.sendChat(text));
  };
  showLobby();
}

interface ChatLine { seat: number; name: string; text: string; mine: boolean }
let chatLog: ChatLine[] = [];
let chatSink: ((l: ChatLine) => void) | null = null;

function addHud(onMenu: () => void, onEmote?: (id: string) => void, onChat?: (text: string) => void) {
  const hud = document.createElement("div"); hud.className = "hud";
  hud.innerHTML = `<button class="btn">${t("menu")}</button><button class="btn" id="hintbtn" title="${t('hint')}">💡</button><button class="btn" id="emobtn" title="${t('emote')}">☺</button>${onChat ? `<button class="btn" id="chatbtn" title="${t('chat')}">💬<span class="badge" hidden></span></button>` : ""}<button class="btn" id="rulesbtn">?</button><button class="btn" id="mute">${sfx.muted ? "🔇" : "🔊"}</button><button class="btn" id="mus">${music.off ? "♪̸" : "♪"}</button>`;
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
  (hud.querySelector("#mute") as HTMLButtonElement).onclick = (e) => { (e.target as HTMLElement).textContent = sfx.toggle() ? "🔇" : "🔊"; };
  (hud.querySelector("#mus") as HTMLButtonElement).onclick = (e) => { (e.target as HTMLElement).textContent = music.toggle() ? "♪̸" : "♪"; };
  ui.append(hud);
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
  const host = new TableHost(d.rules, d.config, seats, d.makeBot, { seed, ...(fast ? { botDelay: () => 100 } : {}) });
  setTableTheme(gameId);
  scene = entry().scene(app, ui, {
    submit: (m: any) => { lastUpdate = null; host.submit(0, m); },
    onFinished: (w, _n, _m, sc) => setTimeout(() => showResult(w, seats.map((s) => s.name), null, () => startLocal(name, players, Date.now()), sc), 1500),
  });
  teardown = () => host.dispose();
  const botEmote = (id?: string) => { if (players < 2) return; const seat = 1 + Math.floor(Math.random() * (players - 1)); scene?.emote?.(seat, id ?? EMOTES[Math.floor(Math.random() * EMOTES.length)]!); lastBotEmote = Date.now(); };
  addHud(() => { host.dispose(); scene?.destroy(); scene = null; showMenu(); }, (id) => {
    if (Date.now() - lastEmote < 1500) return; lastEmote = Date.now(); scene?.emote?.(0, id);
    if (Math.random() < 0.6) setTimeout(() => botEmote(id === "thumbs" ? "clap" : id === "oops" ? "hmm" : id === "clap" ? "thumbs" : "oops"), 900 + Math.random() * 900);
  });
  let lastBotEmote = Date.now();
  host.attach(0, (u: any) => {
    lastUpdate = u; scene?.receive(u);
    if (!q.get("auto") && Date.now() - lastBotEmote > 45000 && Math.random() < 0.03) botEmote();
    if (q.get("auto") && u.legal.length && !u.result) setTimeout(() => host.submit(0, d.makeBot({ kind: "bot", name: "" }).choose(u.view, u.legal, host.rng)), fast ? 150 : 1800);
  });
  host.start();
}

if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
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
