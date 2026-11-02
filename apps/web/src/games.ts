import type { Application } from "pixi.js";
import type { GameDef } from "@cards/net";
import { MauMau, defaultConfig as mauCfg, mauMauBot } from "@cards/maumau";
import { Hearts, defaultConfig as heartsCfg, heartsBot, type View as HView, type Move as HMove } from "@cards/hearts";
import { RANKS, suitOf, rankOf, type Card } from "@cards/engine";
import { Skat, defaultConfig as skatCfg, skatBot, BIDS, type View as SView, type Move as SMove } from "@cards/skat";
import { Doppelkopf, defaultConfig as dokoCfg, dokoBot, isTrump as dokoTrump, strength as dokoStrength, type View as DView, type Move as DMove, type Mode as DMode } from "@cards/doppelkopf";
import { Schafkopf, defaultConfig as schafCfg, schafkopfBot, isTrump as schafTrump, strength as schafStrength, type View as SKView, type Move as SKMove, type Mode as SKMode } from "@cards/schafkopf";
import { Holdem, defaultConfig as holdemCfg, holdemBot } from "@cards/holdem";
import { Romme, defaultConfig as rommeCfg, rommeBot } from "@cards/romme";
import { RommeScene } from "./rommeScene.ts";
import { Canasta, defaultConfig as canastaCfg, canastaBot } from "@cards/canasta";
import { CanastaScene } from "./canastaScene.ts";
import { Bridge, defaultConfig as bridgeCfg, bridgeBot, callText, type View as BView, type Move as BMove } from "@cards/bridge";
import { MauScene } from "./mauScene.ts";
import { HoldemScene } from "./holdemScene.ts";
import { TrickScene, type GameScene, type SceneHooks, type TrickUi } from "./trickScene.ts";
import { t } from "./i18n.ts";
import { withLevel } from "./levels.ts";

const skatSuit = ["C", "S", "H", "D"];
const CLASSIC: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2 };
const classicPoints = (cards: Card[]) => cards.reduce((n, c) => n + (CLASSIC[rankOf(c)] ?? 0), 0);
const heartsPoints = (cards: Card[]) => cards.reduce((n, c) => n + (suitOf(c) === "H" ? 1 : c.startsWith("SQ") ? 13 : 0), 0);
const skatRank = ["A", "T", "K", "Q", "9", "8", "7"];
const skatOrder = (hand: Card[]) => hand.slice().sort((a, b) => {
  const ka = rankOf(a) === "J" ? -10 + skatSuit.indexOf(suitOf(a)) : skatSuit.indexOf(suitOf(a)) * 10 + skatRank.indexOf(rankOf(a));
  const kb = rankOf(b) === "J" ? -10 + skatSuit.indexOf(suitOf(b)) : skatSuit.indexOf(suitOf(b)) * 10 + skatRank.indexOf(rankOf(b));
  return ka - kb;
});
const skatUi: TrickUi<SMove, SView> = {
  points: classicPoints,
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: (m) => (m.t === "cards" ? m.cards : null),
  label: (m) => {
    switch (m.t) {
      case "bid": return t("bidV", { v: m.value });
      case "pass": return t("skatPass");
      case "hold": return t("skatHold");
      case "pickup": return t("pickup");
      case "handgame": return t("handGame");
      case "ouvert": return t("ouvertBtn");
      case "game": return t("game" + m.game);
      case "announce": return t("ann_" + m.level);
      default: return null;
    }
  },
  order: skatOrder,
  trump: (v) => (v.game && v.game !== "R" ? `${t("trumpLabel")}: ${t("game" + v.game)}` : null),
  talonFaceUp: () => false,
  status: (v, names, me) => {
    if (v.over) return "";
    const who = v.turn === me ? "" : names[v.turn ?? 0] ?? "";
    switch (v.phase) {
      case "bid": return v.turn === me ? (v.caller === me ? t("yourBid") : t("yourHold", { v: BIDS[v.bidLevel] ?? 18 })) : t("bidding", { n: who });
      case "skat": return v.turn === me ? t("pickOrHand") : t("declChoosing", { n: who });
      case "discard": return v.turn === me ? t("discard2") : t("declChoosing", { n: who });
      case "declare": return v.turn === me ? t("chooseGame") : t("declChoosing", { n: who });
      case "announce": return v.turn === me ? t("annChoose") : t("declChoosing", { n: who });
      default: return v.turn === me ? t("yourTurn") : t("turnOf", { n: who });
    }
  },
  extra: (v, names) => [`${t("roundNo", { a: v.round + 1, b: v.rounds })}`, ...(v.declarer !== null && v.game ? [`${names[v.declarer]}: ${t("game" + v.game)}${v.ouvert ? " Ouvert" : v.handGame ? " Hand" : ""}${v.announce === "schneider" ? " · " + t("announce_schneider") : v.announce === "schwarz" ? " · " + t("announce_schwarz") : ""} (${v.contract})`] : v.game === "R" ? [t("gameR")] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};

const dokoOrder = (hand: Card[], v?: DView) => {
  const mode: DMode = !v || v.mode === "normal" || v.mode === "hochzeit" ? "soloD" : v.mode;
  const key = (c: Card) => dokoTrump(c, mode) ? -1000 - dokoStrength(c, mode) : SUIT_ORDER.indexOf(suitOf(c)) * 100 - dokoStrength(c, mode);
  return hand.slice().sort((a, b) => key(a) - key(b));
};
const dokoUi: TrickUi<DMove, DView> = {
  points: classicPoints,
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: () => null,
  label: (m) => {
    if (m.t === "reserve") return t(m.mode === "ok" ? "dk_healthyBtn" : m.mode === "hochzeit" ? "dk_hochzeit" : "dk_" + m.mode);
    if (m.t === "announce") return currentDokoTeam === "re" ? "Re" : "Kontra";
    return null;
  },
  order: dokoOrder,
  status: (v, names, me) => {
    currentDokoTeam = v.team;
    if (v.over) return "";
    const who = v.turn === me ? "" : names[v.turn ?? 0] ?? "";
    if (v.phase === "reserve") return v.turn === me ? t("dk_askReserve") : t("dk_reserving", { n: who });
    return v.turn === me ? t("yourTurn") : t("turnOf", { n: who });
  },
  extra: (v) => [t("roundNo", { a: v.round + 1, b: v.rounds }), ...(v.team ? [`${t("dk_team")}: ${v.team === "re" ? "Re" : "Kontra"}`] : []), ...(v.mode !== "normal" && v.phase === "play" ? [t("dk_" + v.mode)] : []),
    ...(v.announced.re ? ["Re!"] : []), ...(v.announced.kontra ? ["Kontra!"] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};
let currentDokoTeam: DView["team"] = null;

const schafOrder = (hand: Card[], v?: SKView) => {
  const mode: SKMode = v?.mode ?? "sauC";
  const key = (c: Card) => schafTrump(c, mode) ? -1000 - schafStrength(c, mode) : SUIT_ORDER.indexOf(suitOf(c)) * 100 - schafStrength(c, mode);
  return hand.slice().sort((a, b) => key(a) - key(b));
};
const schafUi: TrickUi<SKMove, SKView> = {
  points: classicPoints,
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: () => null,
  label: (m) => (m.t === "pass" ? t("sk_passBtn") : m.t === "game" ? t("sk_" + m.mode) : null),
  trump: (v) => (v.mode && v.mode !== "ramsch" ? `${t("trumpLabel")}: ${t("sk_" + v.mode)}` : null),
  order: schafOrder,
  status: (v, names, me) => {
    if (v.over) return "";
    const who = v.turn === me ? "" : names[v.turn ?? 0] ?? "";
    if (v.phase === "choose") {
      let bi = -1; v.offers.forEach((o, i) => { if (o && o !== "pass") bi = i; }); // every later bid outranks the earlier ones
      const hi = bi >= 0 ? ` · ${t("sk_declared", { n: bi === me ? t("youName") : names[bi] ?? "", g: t("sk_" + v.offers[bi]) })}` : "";
      return (v.turn === me ? t("sk_choose") : t("sk_choosing", { n: who })) + hi;
    }
    return v.turn === me ? t("yourTurn") : t("turnOf", { n: who });
  },
  extra: (v, names) => [t("roundNo", { a: v.round + 1, b: v.rounds }), ...(v.mode && v.mode !== "ramsch" && v.declarer !== null ? [`${names[v.declarer]}: ${t("sk_" + v.mode)}`] : v.mode === "ramsch" ? [t("sk_ramsch")] : []),
    ...(v.role ? [t("sk_role_" + v.role)] : []), ...(v.partnerKnown !== null ? [`${t("sk_partnerIs")} ${names[v.partnerKnown]}`] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};

const SYM: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠", N: "NT" };
const callHtml = (c: any): string => c.t === "bid" ? `${c.level}<span class="${c.suit === "H" || c.suit === "D" ? "red" : ""}">${SYM[c.suit]}</span>` : c.t === "pass" ? "–" : c.t === "double" ? "X" : "XX";
/** compass letters as seen from the own seat: you are South, the next seat clockwise is West */
const compass = (seat: number, me: number) => ["S", "W", "N", "E"][(seat - me + 4) % 4]!;
const bridgeUi: TrickUi<BMove, BView> = {
  teams: true,
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: () => null,
  label: () => null,
  trump: (v) => (v.contract ? `${t("trumpLabel")}: ${SYM[v.contract.suit]}` : null),
  order: (hand, v) => {
    const trump = v?.contract?.suit && v.contract.suit !== "N" ? v.contract.suit : null;
    const order = ["S", "H", "C", "D"];
    return hand.slice().sort((a, b) => {
      const sa = suitOf(a) === trump ? -1 : order.indexOf(suitOf(a)), sb = suitOf(b) === trump ? -1 : order.indexOf(suitOf(b));
      return sa - sb || RANKS.indexOf(rankOf(b)) - RANKS.indexOf(rankOf(a));
    });
  },
  status: (v, names, me) => {
    if (v.over) return "";
    if (v.phase === "auction") return v.turn === me ? t("br_yourCall") : t("br_calling", { n: names[v.turn ?? 0] ?? "" });
    if (v.controller === me && v.playTurn !== null && v.playTurn !== me) return t("br_playDummy");
    return v.turn === me ? t("yourTurn") : t("turnOf", { n: names[v.turn ?? 0] ?? "" });
  },
  extra: (v, names) => [`${t("roundNo", { a: v.board, b: v.boards })}`, `${t("br_vul")}: ${v.vul[0] && v.vul[1] ? t("br_both") : v.vul[(v.you as number) % 2] ? "NS" : v.vul[((v.you as number) + 1) % 2] ? "EW" : t("br_none")}`,
    ...(v.contract ? [`${v.contract.level}${SYM[v.contract.suit]}${["", " X", " XX"][v.contract.doubled]} ${compass(v.contract.declarer, v.you as number)} · ${v.tricks[v.contract.declarer % 2]}/${v.tricks[0] + v.tricks[1]}`] : [])],
  panel: (v, legal, ctx) => {
    if (v.phase === "over") return null;
    const box = document.createElement("div"); box.className = "bidbox";
    if (v.phase === "auction") {
      const hist = document.createElement("div"); hist.className = "auction";
      hist.innerHTML = [0, 1, 2, 3].map((s) => `<b>${compass(s, v.you as number)}${s === v.dealer ? "*" : ""}</b>`).join("") + [...Array(v.dealer).fill(null), ...v.auction].map((a: any) => `<span>${a ? callHtml(a.call) : ""}</span>`).join("");
      if (v.turn === ctx.me) {
        const grid = document.createElement("div"); grid.className = "bidgrid";
        for (let level = 1; level <= 7; level++) for (const su of ["C", "D", "H", "S", "N"]) {
          const mv = legal.find((m) => m.t === "bid" && m.level === level && m.suit === su);
          const b = document.createElement("button"); b.innerHTML = callHtml({ t: "bid", level, suit: su }); b.disabled = !mv; if (mv) b.onclick = () => ctx.send(mv); grid.append(b);
        }
        const row = document.createElement("div"); row.className = "bidrow";
        for (const [k, label] of [["pass", t("pass2")], ["double", "X"], ["redouble", "XX"]] as const) {
          const mv = legal.find((m) => m.t === k); const b = document.createElement("button"); b.textContent = label; b.disabled = !mv; if (mv) b.onclick = () => ctx.send(mv); row.append(b);
        }
        box.append(grid, row);
      }
      box.append(hist); return box;
    }
    return null;
  },
  winner: (v) => (v.scores[0]! >= v.scores[1]! ? 0 : 1),
};

export interface GameEntry {
  id: string;
  players: number[];            // selectable seat counts
  def: GameDef<any, any, any, any, any>;
  scene(app: Application, ui: HTMLElement, hooks: SceneHooks<any>): GameScene<any>;
}

const SUIT_ORDER = ["C", "H", "S", "D"];
/** A=11, ten=10, K=4, Q=3, J=2 (Skat, Doppelkopf and Schafkopf all count this way) */
const stdOrder = (hand: Card[]) => hand.slice().sort((a, b) => SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)));

const heartsUi: TrickUi<HMove, HView> = {
  lowBetter: true,
  points: heartsPoints,
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: (m) => (m.t === "cards" ? m.cards : null),
  label: () => null,
  order: stdOrder,
  status: (v, names, me) => {
    if (v.over) return "";
    if (v.phase === "pass") return v.waiting ? t("waitingOthers") : t("passCards", { dir: t(["passLeft", "passRight", "passAcross"][v.passDir] ?? "passLeft") });
    return v.turn === me ? t("yourTurn") : t("turnOf", { n: names[v.turn ?? 0] ?? "" });
  },
  extra: (v) => [`${t("roundPoints")}: ${v.roundPoints.join(" / ")}`],
  winner: (v) => v.scores.indexOf(Math.min(...v.scores)),
};

export const GAME_ENTRIES: GameEntry[] = [
  {
    id: "maumau", players: [2, 3, 4, 5],
    def: { id: "maumau", rules: MauMau, config: mauCfg, makeBot: (spec) => withLevel(mauMauBot, spec.level) },
    scene: (app, ui, hooks) => new MauScene(app, ui, hooks),
  },
  {
    id: "hearts", players: [4],
    def: { id: "hearts", rules: Hearts, config: heartsCfg, makeBot: (spec) => withLevel(heartsBot, spec.level) },
    scene: (app, ui, hooks) => new TrickScene(app, ui, heartsUi, hooks),
  },
  {
    id: "skat", players: [3],
    def: { id: "skat", rules: Skat, config: skatCfg, makeBot: (spec) => withLevel(skatBot, spec.level) },
    scene: (app, ui, hooks) => new TrickScene(app, ui, skatUi, hooks),
  },
  {
    id: "doppelkopf", players: [4],
    def: { id: "doppelkopf", rules: Doppelkopf, config: dokoCfg, makeBot: (spec) => withLevel(dokoBot, spec.level) },
    scene: (app, ui, hooks) => new TrickScene(app, ui, dokoUi, hooks),
  },
  {
    id: "schafkopf", players: [4],
    def: { id: "schafkopf", rules: Schafkopf, config: schafCfg, makeBot: (spec) => withLevel(schafkopfBot, spec.level) },
    scene: (app, ui, hooks) => new TrickScene(app, ui, schafUi, hooks),
  },
  {
    id: "holdem", players: [2, 3, 4, 5, 6],
    def: { id: "holdem", rules: Holdem, config: holdemCfg, makeBot: (spec) => withLevel(holdemBot, spec.level) },
    scene: (app, ui, hooks) => new HoldemScene(app, ui, hooks),
  },
  {
    id: "romme", players: [2, 3, 4],
    def: { id: "romme", rules: Romme, config: rommeCfg, makeBot: (spec) => withLevel(rommeBot, spec.level) },
    scene: (app, ui, hooks) => new RommeScene(app, ui, hooks),
  },
  {
    id: "canasta", players: [2, 3, 4],
    def: { id: "canasta", rules: Canasta, config: canastaCfg, makeBot: (spec) => withLevel(canastaBot, spec.level) },
    scene: (app, ui, hooks) => new CanastaScene(app, ui, hooks),
  },
  {
    id: "bridge", players: [4],
    def: { id: "bridge", rules: Bridge, config: bridgeCfg, makeBot: (spec) => withLevel(bridgeBot, spec.level) },
    scene: (app, ui, hooks) => new TrickScene(app, ui, bridgeUi, hooks),
  },
];
export const entryOf = (id: string) => GAME_ENTRIES.find((g) => g.id === id)!;
