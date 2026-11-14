import { HandRecorder, handsToText, type FedUpdate, type HandRecord } from "@cards/holdem";

/**
 * Hand histories of Hold'em, kept on this device (localStorage, newest last, the last MAX hands) and downloadable as
 * PokerStars-style text or as JSON for analysis. The recorder sees what this player sees: their own hole cards and the
 * ones shown at showdown. In solo games each computer decision also carries its analysis (equity, pot odds, quirk).
 */
const KEY = "cards.hands.holdem", MAX = 1500;
let recorder: HandRecorder | null = null, label = "solo";

const load = (): HandRecord[] => { try { const a = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
function save(hands: HandRecord[]) {
  let list = hands.slice(-MAX);
  for (;;) { try { localStorage.setItem(KEY, JSON.stringify(list)); return; } catch { if (list.length < 20) return; list = list.slice(Math.ceil(list.length / 5)); } }   // storage full: drop the oldest fifth
}

/** Start recording a new table (one per game started). */
export function startRecording(tableLabel: string) { recorder = new HandRecorder(Date.now().toString(36)); label = tableLabel; }
export function stopRecording() { recorder = null; }
export function recordUpdate(u: FedUpdate) {
  if (!recorder) return;
  const done = recorder.feed(u); if (!done.length) return;
  save([...load(), ...done.map((h) => ({ ...h, table: label }))]);
}
export const handCount = () => load().length;
export const clearHands = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

function download(name: string, mime: string, text: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
export function downloadText() { download(`cards-holdem-hands-${stamp()}.txt`, "text/plain;charset=utf-8", handsToText(load(), "Cards")); }
export function downloadJson() {
  download(`cards-holdem-hands-${stamp()}.json`, "application/json", JSON.stringify({ format: "cards-hand-history", version: 1, game: "holdem", exported: new Date().toISOString(), hands: load() }, null, 1));
}
