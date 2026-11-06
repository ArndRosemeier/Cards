/** Menu choices that survive a reload: the last game and, per game, the player count (offline) and the table size (online). */
interface Prefs { game?: string; players?: Record<string, number>; seats?: Record<string, number> }
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
