import { Application } from "pixi.js";
import { connect, OnlineSession, TableHost, type GameDef, type SeatSpec, type Update } from "@cards/net";
import { MauMau, defaultConfig, mauMauBot, type Ev, type Move, type View } from "@cards/maumau";
import { MauScene } from "./mauScene.ts";
import { getLang, setLang, t } from "./i18n.ts";

type Upd = Update<View, Move, Ev>;
const ui = document.getElementById("ui")!;
const BOT_NAMES = ["Anna", "Ben", "Clara", "Dario", "Eva", "Finn"];
const q = new URLSearchParams(location.search);
const fast = !!q.get("fast");
const KEY = import.meta.env.VITE_GAMEHUB_KEY, HUB_URL = import.meta.env.VITE_GAMEHUB_URL;

const def: GameDef<any, any, Move, View, Ev> = {
  id: "maumau", rules: MauMau, config: defaultConfig, makeBot: () => mauMauBot, ...(fast ? { botDelay: () => 100 } : {}),
};

let app: Application;
let scene: MauScene | null = null;
let teardown: (() => void) | null = null;

const token = (() => {
  try { let v = sessionStorage.getItem("token"); if (!v) { v = crypto.randomUUID(); sessionStorage.setItem("token", v); } return v; } catch { return crypto.randomUUID(); }
})();
const savedName = () => { try { return localStorage.getItem("name") ?? ""; } catch { return ""; } };
const saveName = (n: string) => { try { localStorage.setItem("name", n); } catch { /* ignore */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function boot() {
  app = new Application();
  await app.init({ resizeTo: window, antialias: true, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  document.getElementById("stage")!.append(app.canvas);
  if (q.get("autostart")) return startLocal(q.get("name") ?? "Arnd", Number(q.get("players") ?? 3), Number(q.get("seed") ?? Date.now()));
  if (q.get("room")) return showOnline(q.get("room")!);
  showMenu();
}

const GAMES: [string, boolean][] = [["maumau", true], ["holdem", false], ["skat", false], ["doppelkopf", false], ["romme", false], ["bridge", false], ["schafkopf", false], ["hearts", false], ["canasta", false]];

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

function showMenu() {
  let players = 3; let name = savedName();
  const render = () => {
    const w = panel(`<h1>${t("title")}</h1><div class="sub">${t("vsBots")}</div>
      <div class="games">${GAMES.map(([g, on]) => `<button class="game ${g === "maumau" ? "sel" : ""}" ${on ? "" : "disabled"}>${t(g)}${on ? "" : `<small>${t("soon")}</small>`}</button>`).join("")}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${[2, 3, 4, 5].map((n) => `<button class="${n === players ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div></div>
      ${langRow()}
      <div class="row" style="justify-content:flex-end"><button class="btn" id="online">${t("online")}</button><button class="btn primary" id="go">${t("play")}</button></div>`);
    const nm = () => (name = (w.querySelector("#nm") as HTMLInputElement).value.trim());
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); players = Number(b.dataset.n); render(); }));
    bindLang(w, () => { nm(); render(); });
    (w.querySelector("#go") as HTMLButtonElement).onclick = () => { nm(); name ||= t("you"); saveName(name); startLocal(name, players, Date.now()); };
    (w.querySelector("#online") as HTMLButtonElement).onclick = () => { nm(); if (name) saveName(name); showOnline(); };
  };
  render();
}

// ---------------------------------------------------------------- online
function showOnline(prefill = "") {
  let name = savedName(); let seats = 4; let err = "";
  let rooms: { id: string; name: string; players: number; maxPlayers: number; meta: any }[] = [];
  const hub = connect({ url: HUB_URL, app: "cards", appKey: KEY });
  const poll = async () => { try { rooms = (await hub.listRooms()).filter((r) => (r.meta as any)?.game === "maumau"); } catch { rooms = []; } if (alive) render(); };
  let alive = true;
  const timer = setInterval(poll, 5000); void poll();
  const stop = () => { alive = false; clearInterval(timer); hub.close(); };
  const render = () => {
    const w = panel(`<h1>${t("online")}</h1><div class="sub">${t("maumau")}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${esc(name)}" placeholder="${t("you")}"></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${[2, 3, 4, 5].map((n) => `<button class="${n === seats ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
        <button class="btn primary" id="create">${t("createRoom")}</button></div>
      <div class="row"><label>${t("code")}</label><input type="text" id="code" maxlength="6" value="${esc(prefill)}" style="text-transform:uppercase"><button class="btn" id="join">${t("join")}</button></div>
      <div class="sub" style="margin:16px 0 6px">${t("openRooms")}</div>
      <div id="rooms">${rooms.length ? rooms.map((r) => `<div class="row"><span style="flex:1">${esc(r.name)} · ${r.players}/${(r.meta as any)?.seats ?? r.maxPlayers}</span><button class="btn" data-code="${r.id}">${t("join")}</button></div>`).join("") : `<div class="sub">${t("noRooms")}</div>`}</div>
      ${err ? `<div style="color:#ff9d9d;margin:8px 0">${esc(err)}</div>` : ""}
      ${langRow()}<div class="row"><button class="btn" id="back">${t("back")}</button></div>`);
    const nm = () => { name = (w.querySelector("#nm") as HTMLInputElement).value.trim() || t("you"); saveName(name); return name; };
    w.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { nm(); seats = Number(b.dataset.n); render(); }));
    bindLang(w, () => { nm(); render(); });
    (w.querySelector("#back") as HTMLButtonElement).onclick = () => { stop(); showMenu(); };
    (w.querySelector("#create") as HTMLButtonElement).onclick = async () => {
      const n = nm(); stop();
      try { enterRoom(await OnlineSession.create(def, { url: HUB_URL, appKey: KEY, name: n, token }, { name: `${n}`, seats })); }
      catch { err = t("connFail"); showOnline(); }
    };
    const joinCode = async (code: string) => {
      const n = nm(); stop();
      try { enterRoom(await OnlineSession.join(def, { url: HUB_URL, appKey: KEY, name: n, token }, code.trim().toUpperCase())); }
      catch (e: any) { err = e?.code === "room_full" ? t("roomFull") : t("connFail"); showOnline(code); }
    };
    (w.querySelector("#join") as HTMLButtonElement).onclick = () => joinCode((w.querySelector("#code") as HTMLInputElement).value);
    w.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((b) => (b.onclick = () => joinCode(b.dataset.code!)));
  };
  render();
  teardown = stop;
}

function enterRoom(session: OnlineSession<any, any, Move, View, Ev>) {
  let started = false;
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
    (w.querySelector("#start") as HTMLButtonElement | null)?.addEventListener("click", () => session.startGame(BOT_NAMES));
    teardown = () => { /* lobby view only */ };
  };
  let gameShown = false;
  session.on("lobby", (l) => { if (l.phase === "lobby") showLobby(); else if (!gameShown) showGame(); });
  session.on("update", (u) => { if (!gameShown) showGame(); scene?.receive(u); });
  session.on("error", (c) => { if (c === "host_lost" || c === "connection_closed") { session.leave(); showMenu(); } else if (c === "room_full") { showMenu(); } });
  const showGame = () => {
    gameShown = started = true;
    teardown?.(); scene?.destroy(); ui.innerHTML = "";
    scene = new MauScene(app, ui, { submit: (m) => session.submit(m), onFinished: (w, names) => setTimeout(() => showResult(w, names, session), 1500) });
    addHud(() => { session.leave(); scene?.destroy(); scene = null; showMenu(); });
  };
  showLobby();
}

function addHud(onMenu: () => void) {
  const hud = document.createElement("div"); hud.className = "hud";
  hud.innerHTML = `<button class="btn">${t("menu")}</button>`;
  (hud.firstElementChild as HTMLButtonElement).onclick = onMenu;
  ui.append(hud);
}

function showResult(winner: number, names: string[], session: OnlineSession<any, any, Move, View, Ev> | null, again?: () => void) {
  if (ui.querySelector(".result")) return;
  const me = session ? session.mySeat : 0;
  const r = document.createElement("div"); r.className = "result";
  r.innerHTML = `<div class="panel"><h1>${winner === me ? t("youWin") : t("wins", { n: esc(names[winner] ?? "") })}</h1>
    <div class="btns">${again ? `<button class="btn primary" id="again">${t("again")}</button>` : ""}<button class="btn" id="menu">${t("menu")}</button></div></div>`;
  (r.querySelector("#again") as HTMLButtonElement | null)?.addEventListener("click", () => again!());
  (r.querySelector("#menu") as HTMLButtonElement).onclick = () => { session?.leave(); showMenu(); };
  ui.append(r);
}

// ---------------------------------------------------------------- local play
function startLocal(name: string, players: number, seed: number) {
  teardown?.(); scene?.destroy(); ui.innerHTML = "";
  const seats: SeatSpec[] = [{ kind: "human", name }, ...Array.from({ length: players - 1 }, (_, i): SeatSpec => ({ kind: "bot", name: BOT_NAMES[i]! }))];
  const host = new TableHost(MauMau, defaultConfig, seats, () => mauMauBot, { seed, ...(fast ? { botDelay: () => 100 } : {}) });
  scene = new MauScene(app, ui, {
    submit: (m) => host.submit(0, m),
    onFinished: (w) => setTimeout(() => showResult(w, seats.map((s) => s.name), null, () => startLocal(name, players, Date.now())), 1500),
  });
  teardown = () => host.dispose();
  addHud(() => { host.dispose(); scene?.destroy(); scene = null; showMenu(); });
  host.attach(0, (u: Upd) => {
    scene?.receive(u);
    if (q.get("auto") && u.legal.length && !u.result) setTimeout(() => host.submit(0, mauMauBot.choose(u.view, u.legal, host.rng)), fast ? 150 : 1800);
  });
  host.start();
}

void boot();
