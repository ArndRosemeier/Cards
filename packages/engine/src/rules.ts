import type { Rng } from "./rng.ts";

export type Seat = number;

export interface GameResult { winners: Seat[]; scores: number[] }

/**
 * The one interface every game implements. Networking, AI and rendering are generic over it.
 * State must be plain JSON. All randomness comes from the passed Rng. `apply` returns semantic
 * events; the renderer plays events and never diffs state. `view` is the only place information is hidden.
 */
export interface GameRules<Config, State, Move, View, Ev> {
  readonly id: string;
  readonly minSeats: number;
  readonly maxSeats: number;
  setup(config: Config, seats: number, rng: Rng): { state: State; events: Ev[] };
  activeSeats(state: State): Seat[];
  legalMoves(state: State, seat: Seat): Move[];
  apply(state: State, seat: Seat, move: Move, rng: Rng): { state: State; events: Ev[] };
  view(state: State, seat: Seat | "public"): View;
  result(state: State): GameResult | null;
  /** Hide what `seat` may not see in an event (e.g. cards drawn by someone else). Default: unchanged. */
  redactEvent?(event: Ev, seat: Seat): Ev;
}

/** A computer player. Sees only its own view plus the legal moves, never the hidden state. */
export interface Bot<View, Move> {
  choose(view: View, legal: Move[], rng: Rng): Move;
  /** Optional table talk that belongs to the move `choose` just returned: an id the clients turn into a line (once). */
  say?(): string | null;
}
