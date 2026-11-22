/** Menu choices that survive a reload: the last game and, per game, the player count (offline) and the table size (online). */
interface Prefs { botWait?: number; botVar?: number; game?: string; players?: Record<string, number>; seats?: Record<string, number> }
const KEY = "cards.prefs";
const load = (): Prefs => { try { const p = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return p && typeof p === "object" ? p : {}; } catch { return {}; } };
const save = (p: Prefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } };

export const savedGame = (valid: (id: string) => boolean): string | null => { const g = load().game; return g && valid(g) ? g : null; };
export const saveGame = (id: string) => save({ ...load(), game: id });
/** The remembered count for a game when it is still allowed, else null. */
export const savedCount = (kind: "players" | "seats", game: string, allowed: number[]): number | null => {
  const n = load()[kind]?.[game]; return typeof n === "number" && allowed.includes(n) ? n : null;
};
export const saveCount = (kind: "players" | "seats", game: string, n: number) => { const p = load(); save({ ...p, [kind]: { ...(p[kind] ?? {}), [game]: n } }); };

/** Average thinking time of computer players in seconds (the old fixed behaviour was about 1.25 s). */
export const BOT_WAIT_MIN = 0.2, BOT_WAIT_MAX = 5, BOT_WAIT_DEFAULT = 1.25;
let botWaitCache: number | null = null;
export const botWait = (): number => { if (botWaitCache === null) { const v = load().botWait; botWaitCache = typeof v === "number" && v >= BOT_WAIT_MIN && v <= BOT_WAIT_MAX ? v : BOT_WAIT_DEFAULT; } return botWaitCache; };
export const setBotWait = (v: number) => { botWaitCache = Math.min(BOT_WAIT_MAX, Math.max(BOT_WAIT_MIN, v)); save({ ...load(), botWait: botWaitCache }); };
/** Random variation of the thinking time, as a fraction of the average (0 = always the same, 1 = anywhere from nearly instant to double). */
export const BOT_VAR_DEFAULT = 0.3;
let botVarCache: number | null = null;
export const botVar = (): number => { if (botVarCache === null) { const v = load().botVar; botVarCache = typeof v === "number" && v >= 0 && v <= 1 ? v : BOT_VAR_DEFAULT; } return botVarCache; };
export const setBotVar = (v: number) => { botVarCache = Math.min(1, Math.max(0, v)); save({ ...load(), botVar: botVarCache }); };
/** Delay before a computer move, in ms: the chosen average plus or minus the chosen random share. Read live, so a change applies to the running game. */
export const botDelay = (rng: { int(n: number): number }): number => Math.max(80, Math.round(botWait() * 1000 * (1 + botVar() * (rng.int(2001) - 1000) / 1000)));
