import type { Application } from "pixi.js";
import type { GameDef } from "@cards/net";
import { MauMau, defaultConfig as mauCfg, mauMauBot } from "@cards/maumau";
import { Hearts, defaultConfig as heartsCfg, heartsBot, type View as HView, type Move as HMove } from "@cards/hearts";
import { RANKS, suitOf, rankOf, type Card } from "@cards/engine";
import { Skat, defaultConfig as skatCfg, skatBot, BIDS, type View as SView, type Move as SMove } from "@cards/skat";
import { Doppelkopf, defaultConfig as dokoCfg, dokoBot, isTrump as dokoTrump, strength as dokoStrength, type View as DView, type Move as DMove, type Mode as DMode } from "@cards/doppelkopf";
import { Schafkopf, defaultConfig as schafCfg, schafkopfBot, isTrump as schafTrump, strength as schafStrength, type View as SKView, type Move as SKMove, type Mode as SKMode } from "@cards/schafkopf";
import { MauScene } from "./mauScene.ts";
import { TrickScene, type GameScene, type SceneHooks, type TrickUi } from "./trickScene.ts";
import { t } from "./i18n.ts";

const skatSuit = ["C", "S", "H", "D"];
const skatRank = ["A", "T", "K", "Q", "9", "8", "7"];
const skatOrder = (hand: Card[]) => hand.slice().sort((a, b) => {
  const ka = rankOf(a) === "J" ? -10 + skatSuit.indexOf(suitOf(a)) : skatSuit.indexOf(suitOf(a)) * 10 + skatRank.indexOf(rankOf(a));
  const kb = rankOf(b) === "J" ? -10 + skatSuit.indexOf(suitOf(b)) : skatSuit.indexOf(suitOf(b)) * 10 + skatRank.indexOf(rankOf(b));
  return ka - kb;
});
const skatUi: TrickUi<SMove, SView> = {
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: (m) => (m.t === "cards" ? m.cards : null),
  label: (m) => {
    switch (m.t) {
      case "bid": return t("bidV", { v: m.value });
      case "pass": return t("skatPass");
      case "hold": return t("skatHold");
      case "pickup": return t("pickup");
      case "handgame": return t("handGame");
      case "game": return t("game" + m.game);
      default: return null;
    }
  },
  order: skatOrder,
  talonFaceUp: () => false,
  status: (v, names, me) => {
    if (v.over) return "";
    const who = v.turn === me ? "" : names[v.turn ?? 0] ?? "";
    switch (v.phase) {
      case "bid": return v.turn === me ? (v.caller === me ? t("yourBid") : t("yourHold", { v: BIDS[v.bidLevel] ?? 18 })) : t("bidding", { n: who });
      case "skat": return v.turn === me ? t("pickOrHand") : t("declChoosing", { n: who });
      case "discard": return v.turn === me ? t("discard2") : t("declChoosing", { n: who });
      case "declare": return v.turn === me ? t("chooseGame") : t("declChoosing", { n: who });
      default: return v.turn === me ? t("yourTurn") : t("turnOf", { n: who });
    }
  },
  extra: (v, names) => [`${t("roundNo", { a: v.round + 1, b: v.rounds })}`, ...(v.declarer !== null && v.game ? [`${names[v.declarer]}: ${t("game" + v.game)}${v.handGame ? " Hand" : ""} (${v.contract})`] : v.game === "R" ? [t("gameR")] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};

const dokoOrder = (hand: Card[], v?: DView) => {
  const mode: DMode = !v || v.mode === "normal" || v.mode === "hochzeit" ? "soloD" : v.mode;
  const key = (c: Card) => dokoTrump(c, mode) ? -1000 - dokoStrength(c, mode) : SUIT_ORDER.indexOf(suitOf(c)) * 100 - dokoStrength(c, mode);
  return hand.slice().sort((a, b) => key(a) - key(b));
};
const dokoUi: TrickUi<DMove, DView> = {
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
  cardOfMove: (m) => (m.t === "play" ? m.card : null),
  cardsOfMove: () => null,
  label: (m) => (m.t === "pass" ? t("sk_passBtn") : m.t === "game" ? t("sk_" + m.mode) : null),
  order: schafOrder,
  status: (v, names, me) => {
    if (v.over) return "";
    const who = v.turn === me ? "" : names[v.turn ?? 0] ?? "";
    if (v.phase === "choose") return v.turn === me ? t("sk_choose") : t("sk_choosing", { n: who });
    return v.turn === me ? t("yourTurn") : t("turnOf", { n: who });
  },
  extra: (v, names) => [t("roundNo", { a: v.round + 1, b: v.rounds }), ...(v.mode && v.mode !== "ramsch" && v.declarer !== null ? [`${names[v.declarer]}: ${t("sk_" + v.mode)}`] : v.mode === "ramsch" ? [t("sk_ramsch")] : []),
    ...(v.role ? [t("sk_role_" + v.role)] : []), ...(v.partnerKnown !== null ? [`${t("sk_partnerIs")} ${names[v.partnerKnown]}`] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};

export interface GameEntry {
  id: string;
  players: number[];            // selectable seat counts
  def: GameDef<any, any, any, any, any>;
  scene(app: Application, ui: HTMLElement, hooks: SceneHooks<any>): GameScene<any>;
}

const SUIT_ORDER = ["C", "H", "S", "D"];
const stdOrder = (hand: Card[]) => hand.slice().sort((a, b) => SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)));

const heartsUi: TrickUi<HMove, HView> = {
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
    def: { id: "maumau", rules: MauMau, config: mauCfg, makeBot: () => mauMauBot },
    scene: (app, ui, hooks) => new MauScene(app, ui, hooks),
  },
  {
    id: "hearts", players: [4],
    def: { id: "hearts", rules: Hearts, config: heartsCfg, makeBot: () => heartsBot },
    scene: (app, ui, hooks) => new TrickScene(app, ui, heartsUi, hooks),
  },
  {
    id: "skat", players: [3],
    def: { id: "skat", rules: Skat, config: skatCfg, makeBot: () => skatBot },
    scene: (app, ui, hooks) => new TrickScene(app, ui, skatUi, hooks),
  },
  {
    id: "doppelkopf", players: [4],
    def: { id: "doppelkopf", rules: Doppelkopf, config: dokoCfg, makeBot: () => dokoBot },
    scene: (app, ui, hooks) => new TrickScene(app, ui, dokoUi, hooks),
  },
  {
    id: "schafkopf", players: [4],
    def: { id: "schafkopf", rules: Schafkopf, config: schafCfg, makeBot: () => schafkopfBot },
    scene: (app, ui, hooks) => new TrickScene(app, ui, schafUi, hooks),
  },
];
export const entryOf = (id: string) => GAME_ENTRIES.find((g) => g.id === id)!;
