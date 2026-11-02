export type Suit = "C" | "S" | "H" | "D"; // clubs, spades, hearts, diamonds
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
/** A card is a plain string like "H7" or "ST" (suit + rank). Extra copies from double decks carry apostrophes ("ST'"), so every physical card has a unique id. */
export type Card = `${Suit}${Rank}${string}`;

export const SUITS: readonly Suit[] = ["C", "S", "H", "D"];
export const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export const suitOf = (c: Card): Suit => c[0] as Suit;
export const rankOf = (c: Card): Rank => c[1] as Rank;

/** Build a deck from the given ranks (e.g. 7..A for a 32-card deck). `copies` for double decks. */
export function makeDeck(ranks: readonly Rank[] = RANKS, copies = 1): Card[] {
  const deck: Card[] = [];
  for (let k = 0; k < copies; k++) for (const s of SUITS) for (const r of ranks) deck.push(`${s}${r}${"'".repeat(k)}` as Card);
  return deck;
}
export const SKAT_RANKS: readonly Rank[] = ["7", "8", "9", "T", "J", "Q", "K", "A"];
