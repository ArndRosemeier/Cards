import type { Card } from "@cards/engine";
import { t } from "./i18n.ts";

/** Every card id mentioned anywhere in a move (cards are strings like "H7" or "XJ1"; keywords like "draw" start lowercase). */
export function cardsInMove(m: unknown, out: Card[] = []): Card[] {
  if (typeof m === "string") { if (m.length >= 2 && /^[A-Z]/.test(m)) out.push(m as Card); }
  else if (Array.isArray(m)) m.forEach((x) => cardsInMove(x, out));
  else if (m && typeof m === "object") Object.values(m).forEach((x) => cardsInMove(x, out));
  return out;
}

/** One localized sentence for a suggested move. */
export function hintText(m: any, game: string): string {
  switch (m.t) {
    case "bid": return game === "bridge" ? t("hint_bid", { v: `${m.level}${m.suit === "N" ? "NT" : m.suit}` }) : t("hint_bid", { v: m.value });
    case "raise": return t("hint_raise", { to: m.to });
    case "draw": return m.from === "discard" ? t("hint_drawDiscard") : t("hint_draw");
    case "game": return t("hint_game", { g: m.game ? t("game" + m.game) : m.mode ? t("sk_" + m.mode) : "" });
    case "announce": return t("hint_announce");
    default: { const k = "hint_" + m.t; const s = t(k); return s === k ? t("hint_generic") : s; }
  }
}
