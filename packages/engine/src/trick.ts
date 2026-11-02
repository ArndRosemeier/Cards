import type { Card } from "./cards.ts";
import type { Seat } from "./rules.ts";

/**
 * Shared vocabulary for trick-taking and hand-based card games, so one scene can animate all of them.
 * Games add their own fields to the view, and may add their own event types the scene ignores.
 */
export type TrickEv =
  | { t: "newRound" }
  | { t: "dealt"; seat: Seat | "talon"; count: number }
  | { t: "transfer"; from: Seat | "talon"; to: Seat | "talon"; cards: Card[] } // "??" cards are hidden from the viewer
  | { t: "played"; seat: Seat; card: Card }
  | { t: "trickDone"; winner: Seat }
  | { t: "say"; seat: Seat | null; key: string; vars?: Record<string, string | number> };

export interface TrickViewBase {
  you: Seat | "public";
  hand: Card[];
  handSizes: number[];
  talon: number;                       // face-down cards in the middle (skat etc.)
  trick: { seat: Seat; card: Card }[]; // cards currently in the trick area
  turn: Seat | null;
  scores: number[];                    // match scores per seat
  over: boolean;
}

export const HIDDEN = "??" as Card;
export const hide = (cards: Card[]): Card[] => cards.map(() => HIDDEN);
