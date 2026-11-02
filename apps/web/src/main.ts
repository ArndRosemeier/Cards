import { Application } from "pixi.js";
import { TableHost, type SeatSpec } from "@cards/net";
import { MauMau, defaultConfig, mauMauBot } from "@cards/maumau";
import { MauScene } from "./mauScene.ts";
import { getLang, setLang, t } from "./i18n.ts";

const ui = document.getElementById("ui")!;
const BOT_NAMES = ["Anna", "Ben", "Clara", "Dario"];
let app: Application;
let current: { host: TableHost<any, any, any, any, any>; scene: MauScene } | null = null;

async function boot() {
  app = new Application();
  await app.init({ resizeTo: window, antialias: true, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  document.getElementById("stage")!.append(app.canvas);
  showMenu();
  const q = new URLSearchParams(location.search);
  if (q.get("autostart")) startMauMau(q.get("name") ?? "Arnd", Number(q.get("players") ?? 3), Number(q.get("seed") ?? Date.now()));
}

const GAMES: [string, boolean][] = [["maumau", true], ["holdem", false], ["skat", false], ["doppelkopf", false], ["romme", false], ["bridge", false], ["schafkopf", false], ["hearts", false], ["canasta", false]];

function showMenu() {
  ui.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "menu";
  let players = 3;
  let name = (() => { try { return localStorage.getItem("name") ?? ""; } catch { return ""; } })();
  const render = () => {
    wrap.innerHTML = `<div class="panel">
      <h1>${t("title")}</h1><div class="sub">${t("vsBots")}</div>
      <div class="games">${GAMES.map(([g, on]) => `<button class="game ${g === "maumau" ? "sel" : ""}" ${on ? "" : "disabled"}>${t(g)}${on ? "" : `<small>${t("soon")}</small>`}</button>`).join("")}</div>
      <div class="row"><label>${t("name")}</label><input type="text" id="nm" maxlength="20" value="${name.replace(/"/g, "")}" placeholder="${t("you")}"></div>
      <div class="row"><label>${t("players")}</label><div class="seg" id="pl">${[2, 3, 4, 5].map((n) => `<button class="${n === players ? "sel" : ""}" data-n="${n}">${n}</button>`).join("")}</div></div>
      <div class="row"><label>${t("language")}</label><div class="seg" id="lg">${["de", "en"].map((l) => `<button class="${getLang() === l ? "sel" : ""}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" id="go">${t("play")}</button></div></div>`;
    wrap.querySelectorAll<HTMLButtonElement>("#pl button").forEach((b) => (b.onclick = () => { players = Number(b.dataset.n); name = (wrap.querySelector("#nm") as HTMLInputElement).value; render(); }));
    wrap.querySelectorAll<HTMLButtonElement>("#lg button").forEach((b) => (b.onclick = () => { name = (wrap.querySelector("#nm") as HTMLInputElement).value; setLang(b.dataset.l as "de" | "en"); render(); }));
    (wrap.querySelector("#go") as HTMLButtonElement).onclick = () => {
      name = (wrap.querySelector("#nm") as HTMLInputElement).value.trim() || t("you");
      try { localStorage.setItem("name", name); } catch { /* ignore */ }
      startMauMau(name, players, Date.now());
    };
  };
  render(); ui.append(wrap);
}

function startMauMau(name: string, players: number, seed: number) {
  current?.host.dispose(); current?.scene.destroy();
  ui.innerHTML = "";
  const seats: SeatSpec[] = [{ kind: "human", name }, ...Array.from({ length: players - 1 }, (_, i): SeatSpec => ({ kind: "bot", name: BOT_NAMES[i]! }))];
  const host = new TableHost(MauMau, defaultConfig, seats, () => mauMauBot, { seed, ...(new URLSearchParams(location.search).get("fast") ? { botDelay: () => 100 } : {}) });
  const scene = new MauScene(app, ui, {
    submit: (m) => host.submit(0, m),
    onFinished: (w) => { setTimeout(() => showResult(w, seats, name, players, seed), 1500); },
  });
  current = { host, scene };
  const hud = document.createElement("div"); hud.className = "hud";
  hud.innerHTML = `<button class="btn">${t("menu")}</button>`;
  (hud.firstElementChild as HTMLButtonElement).onclick = () => { host.dispose(); scene.destroy(); showMenu(); };
  ui.append(hud);
  host.attach(0, (u) => {
    scene.receive(u);
    if (new URLSearchParams(location.search).get("auto") && u.legal.length && !u.result) {
      setTimeout(() => host.submit(0, mauMauBot.choose(u.view, u.legal, (host as any).rng)), new URLSearchParams(location.search).get("fast") ? 150 : 1800 + Math.random() * 500);
    }
  });
  host.start();
}

function showResult(winner: number, seats: SeatSpec[], name: string, players: number, _seed: number) {
  if (ui.querySelector(".result")) return;
  const r = document.createElement("div"); r.className = "result";
  r.innerHTML = `<div class="panel"><h1>${winner === 0 ? t("youWin") : t("wins", { n: seats[winner]!.name })}</h1>
    <div class="btns"><button class="btn primary" id="again">${t("again")}</button><button class="btn" id="menu">${t("menu")}</button></div></div>`;
  (r.querySelector("#again") as HTMLButtonElement).onclick = () => startMauMau(name, players, Date.now());
  (r.querySelector("#menu") as HTMLButtonElement).onclick = () => { current?.host.dispose(); current?.scene.destroy(); showMenu(); };
  ui.append(r);
}

void boot();
