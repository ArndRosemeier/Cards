import type { Application } from "pixi.js";
import type { GameDef } from "@cards/net";
import { MauMau, defaultConfig as mauCfg, mauMauBot } from "@cards/maumau";
import { Hearts, defaultConfig as heartsCfg, heartsBot, type View as HView, type Move as HMove } from "@cards/hearts";
import { RANKS, suitOf, rankOf, type Card } from "@cards/engine";
import { Skat, defaultConfig as skatCfg, createSkatBot, BIDS, type View as SView, type Move as SMove } from "@cards/skat";
import { Doppelkopf, defaultConfig as dokoCfg, dokoBot, isTrump as dokoTrump, strength as dokoStrength, type View as DView, type Move as DMove, type Mode as DMode } from "@cards/doppelkopf";
import { Schafkopf, defaultConfig as schafCfg, schafkopfBot, isTrump as schafTrump, strength as schafStrength, type View as SKView, type Move as SKMove, type Mode as SKMode } from "@cards/schafkopf";
import { Holdem, defaultConfig as holdemCfg, createHoldemBot, PERSONAS, type Persona } from "@cards/holdem";
import { Romme, defaultConfig as rommeCfg, rommeBot } from "@cards/romme";
import { RommeScene } from "./rommeScene.ts";
import { Canasta, defaultConfig as canastaCfg, canastaBot } from "@cards/canasta";
import { CanastaScene } from "./canastaScene.ts";
import { Bridge, defaultConfig as bridgeCfg, bridgeBot, callText, explainCall, type View as BView, type Move as BMove } from "@cards/bridge";
import { MauScene } from "./mauScene.ts";
import { HoldemScene } from "./holdemScene.ts";
import { TrickScene, type GameScene, type SceneHooks, type TrickUi } from "./trickScene.ts";
import { t, getLang } from "./i18n.ts";
import { withLevel } from "./levels.ts";

/**
 * Each Hold'em bot at a table gets a playing quirk most of the time (see PERSONAS in the holdem package: measured in
 * 300-game tournaments, none of them changes the win rate by more than a few points). Quirks are not repeated
 * within the last three bots, so a table is varied. Hints (nameless bots) always use the plain bot.
 */
const recentQuirks: string[] = [];
function pickPersona(): Persona | undefined {
  if (Math.random() < 0.25) return undefined;
  const pool = PERSONAS.filter((p) => !recentQuirks.includes(p.id));
  const p = pool[Math.floor(Math.random() * pool.length)];
  if (p) { recentQuirks.push(p.id); if (recentQuirks.length > 3) recentQuirks.shift(); }
  return p;
}

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
/** Card points of the own side (Doppelkopf, Schafkopf): both sides once they are known, else just the own points. */
function teamLine(tp: { mine: number; opp: number | null; complete: boolean } | null): string[] {
  if (!tp) return [];
  return [tp.opp !== null ? t("ptsTeam", { a: tp.mine, b: tp.opp }) : t("skPtsSolo", { a: tp.mine })];
}
/** Card points of the player's own side, always visible during play (Ramsch: own points). */
function skatPoints(v: SView): string[] {
  if (v.phase !== "play" || v.game === "N" || typeof v.you !== "number") return [];
  const me = v.you, pts = v.cardPts;
  if (v.game === "R" || v.declarer === null) return [t("skPtsSolo", { a: pts[me] ?? 0 })];
  const decl = v.declarer, declPts = (pts[decl] ?? 0) + (me === decl ? v.skatPts : 0);
  const oppPts = pts.reduce((a, n, i) => (i === decl ? a : a + n), 0);
  return me === decl ? [t("skPtsDecl", { a: declPts, b: oppPts })] : [t("skPtsOpp", { a: oppPts, b: declPts })];
}
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
  extra: (v, names) => [`${t("roundNo", { a: v.round + 1, b: v.rounds })}`, ...skatPoints(v), ...(v.declarer !== null && v.game ? [`${names[v.declarer]}: ${t("game" + v.game)}${v.ouvert ? " Ouvert" : v.handGame ? " Hand" : ""}${v.announce === "schneider" ? " · " + t("announce_schneider") : v.announce === "schwarz" ? " · " + t("announce_schwarz") : ""} (${v.contract})`] : v.game === "R" ? [t("gameR")] : [])],
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
  extra: (v) => [t("roundNo", { a: v.round + 1, b: v.rounds }), ...teamLine(v.teamPts), ...(v.team ? [`${t("dk_team")}: ${v.team === "re" ? "Re" : "Kontra"}`] : []), ...(v.mode !== "normal" && v.phase === "play" ? [t("dk_" + v.mode)] : []),
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
  extra: (v, names) => [t("roundNo", { a: v.round + 1, b: v.rounds }), ...teamLine(v.teamPts), ...(v.mode && v.mode !== "ramsch" && v.declarer !== null ? [`${names[v.declarer]}: ${t("sk_" + v.mode)}`] : v.mode === "ramsch" ? [t("sk_ramsch")] : []),
    ...(v.role ? [t("sk_role_" + v.role)] : []), ...(v.partnerKnown !== null ? [`${t("sk_partnerIs")} ${names[v.partnerKnown]}`] : [])],
  winner: (v) => v.scores.indexOf(Math.max(...v.scores)),
};

const SYM: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠", N: "NT" };
const callHtml = (c: any): string => c.t === "bid" ? `${c.level}<span class="${c.suit === "H" || c.suit === "D" ? "red" : ""}">${SYM[c.suit]}</span>` : c.t === "pass" ? "–" : c.t === "double" ? "X" : "XX";
/** compass letters as seen from the own seat: you are South, the next seat clockwise is West */
const compass = (seat: number, me: number) => ["S", "W", "N", "E"][(seat - me + 4) % 4]!;
let auctionOpen = false;
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const callCell = (c: any): string => c.t === "pass" ? `<i>${t("pass2")}</i>` : callHtml(c);
let explainOn = (() => { try { return localStorage.getItem("bridgeExplain") === "1"; } catch { return false; } })();
let explainSel: number | null = null, explainLen = 0;
/** The bidding history as a classic table: one column per seat in playing order (W, N, E, S as seen from the own seat), with names, the dealer marked, one row per round.
 * The "?" button turns on bid explanations: the meaning of the latest call (or of the one you tap) under the table. */
function auctionTable(v: any, names: string[], me: number): HTMLElement {
  const wrap = document.createElement("div"); wrap.className = "auctionwrap";
  const el = document.createElement("div"); el.className = "auction";
  const colOf = (seat: number) => (seat - me - 1 + 8) % 4;
  const seatOf = (col: number) => (me + 1 + col) % 4;
  const head = [0, 1, 2, 3].map((c) => { const s = seatOf(c); return `<b class="${s % 2 === me % 2 ? "us" : ""}">${compass(s, me)}${s === v.dealer ? '<sup>D</sup>' : ""}<small>${s === me ? t("you") : esc(names[s] ?? "")}</small></b>`; }).join("");
  const auction = v.auction as any[];
  const info = auction.map((_, i) => (explainOn ? explainCall(auction, i) : null));
  const rows: ({ html: string; i: number } | null)[][] = []; let last = 9;
  auction.forEach((a, i) => { const col = colOf(a.seat); if (!rows.length || col <= last) rows.push([null, null, null, null]); rows[rows.length - 1]![col] = { html: callCell(a.call) + (info[i] ? '<sup class="qm">?</sup>' : ""), i }; last = col; });
  if (v.phase === "auction" && v.turn !== null) { const col = colOf(v.turn); if (!rows.length || col <= last) rows.push([null, null, null, null]); rows[rows.length - 1]![col] = { html: "…", i: -1 }; last = col; }
  if (!rows.length) rows.push([null, null, null, null]);
  const flat = rows.flat(), lastIdx = flat.reduce((m, c, i) => (c !== null && c.i >= 0 ? i : m), -1);
  el.innerHTML = head + flat.map((c, i) => `<span data-i="${c ? c.i : -2}" class="${c && c.i === -1 ? "now" : i === lastIdx ? "last" : ""}${c && c.i >= 0 && info[c.i] ? " ex" : ""}">${c ? c.html : ""}</span>`).join("");
  const box = document.createElement("div"); box.className = "bidexplain";
  const toggle = document.createElement("button"); toggle.className = "bidq" + (explainOn ? " on" : ""); toggle.textContent = "?"; toggle.title = t("br_explain");
  const paint = () => {
    const idx = explainSel !== null && explainSel < auction.length ? explainSel : auction.length - 1;
    const x = idx >= 0 ? info[idx] ?? null : null, a = auction[idx];
    const who = a ? (a.seat === me ? t("you") : names[a.seat] ?? "") : "";
    box.style.display = explainOn ? "block" : "none";
    el.querySelectorAll("span.sel").forEach((n) => n.classList.remove("sel"));
    if (explainSel !== null) el.querySelector(`span[data-i="${explainSel}"]`)?.classList.add("sel");
    const L = getLang();
    box.innerHTML = !explainOn || !a ? "" : x ? `<b>${esc(who)}: ${callText(a.call)}${x.name[L] === callText(a.call) ? "" : ` · ${esc(x.name[L])}`}</b><br>${esc(x.text[L])}` : `<b>${esc(who)}: ${callText(a.call)}</b><br>${esc(t("br_natural"))}`;
  };
  if (auction.length !== explainLen) { explainSel = null; explainLen = auction.length; }
  toggle.onclick = () => { explainOn = !explainOn; try { localStorage.setItem("bridgeExplain", explainOn ? "1" : "0"); } catch { /* ignore */ } toggle.classList.toggle("on", explainOn); explainSel = null; const fresh = auctionTable(v, names, me); fresh.style.display = wrap.style.display; wrap.replaceWith(fresh); };
  el.addEventListener("click", (e) => { const sp = (e.target as HTMLElement).closest("span[data-i]") as HTMLElement | null; if (!sp || !explainOn) return; const i = Number(sp.dataset.i); if (i >= 0) { explainSel = i; paint(); } });
  paint();
  wrap.append(toggle, el, box);
  return wrap;
}
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
    const table = auctionTable(v, ctx.names, ctx.me);
    if (v.phase === "auction") {
      box.append(table);
      if (v.turn === ctx.me && !ctx.busy) {
        const pick = document.createElement("div"); pick.className = "bidpick";
        const grid = document.createElement("div"); grid.className = "bidgrid";
        for (let level = 1; level <= 7; level++) for (const su of ["C", "D", "H", "S", "N"]) {
          const mv = legal.find((m) => m.t === "bid" && m.level === level && m.suit === su);
          const b = document.createElement("button"); b.innerHTML = callHtml({ t: "bid", level, suit: su }); b.disabled = !mv; if (mv) b.onclick = () => ctx.send(mv); grid.append(b);
        }
        const row = document.createElement("div"); row.className = "bidrow";
        for (const [k, label] of [["pass", t("pass2")], ["double", "X"], ["redouble", "XX"]] as const) {
          const mv = legal.find((m) => m.t === k); const b = document.createElement("button"); b.textContent = label; b.disabled = !mv; if (mv) b.onclick = () => ctx.send(mv); row.append(b);
        }
        pick.append(grid, row); box.prepend(pick);
      }
      return box;
    }
    // during play: a small chip that opens the bidding history
    if (!v.auction.length) return null;
    box.className = "bidbox bidmini";
    const chip = document.createElement("button"); chip.className = "bidchip";
    const paint = () => { chip.textContent = `${t("br_auction")} ${auctionOpen ? "▴" : "▾"}`; const w = box.querySelector(".auctionwrap") as HTMLElement | null; if (w) w.style.display = auctionOpen ? "block" : "none"; };
    chip.onclick = () => { auctionOpen = !auctionOpen; paint(); };
    box.append(chip, table); paint(); return box;
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
    def: { id: "skat", rules: Skat, config: skatCfg, makeBot: (spec) => withLevel(createSkatBot(), spec.level) },
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
    def: { id: "holdem", rules: Holdem, config: holdemCfg, makeBot: (spec) => withLevel(createHoldemBot(spec.name ? pickPersona() : undefined), spec.level) },
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
