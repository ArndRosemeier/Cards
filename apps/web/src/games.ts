import type { Application } from "pixi.js";
import type { GameDef } from "@cards/net";
import { MauMau, defaultConfig as mauCfg, mauMauBot } from "@cards/maumau";
import { Hearts, defaultConfig as heartsCfg, heartsBot, type View as HView, type Move as HMove } from "@cards/hearts";
import { RANKS, suitOf, rankOf, type Card } from "@cards/engine";
import { MauScene } from "./mauScene.ts";
import { TrickScene, type GameScene, type SceneHooks, type TrickUi } from "./trickScene.ts";
import { t } from "./i18n.ts";

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
];
export const entryOf = (id: string) => GAME_ENTRIES.find((g) => g.id === id)!;
