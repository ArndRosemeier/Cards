/** Win/loss record per game, kept in this browser only. */
export interface Rec { played: number; won: number; streak: number; best: number }
const KEY = "stats.v1";
function load(): Record<string, Rec> { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } }
export function getStats(): Record<string, Rec> { return load(); }
export function recordResult(game: string, won: boolean) {
  const all = load(); const r = all[game] ?? { played: 0, won: 0, streak: 0, best: 0 };
  r.played++; if (won) { r.won++; r.streak++; r.best = Math.max(r.best, r.streak); } else r.streak = 0;
  all[game] = r;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
export function resetStats() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
