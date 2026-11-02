# Cards: architecture proposal (draft for review)

Goal: one app that hosts many card games, with polished graphics and animation on every action, multiplayer for all games, and any seat fillable by an AI. Multiplayer runs on GameHub (`games.futuremagic.de`).

## 1. What GameHub gives us, and what it does not

I read the whole `gameserver` repo (README, protocol, patterns, lobby, cued, `client/gamehub.ts`).

- GameHub is a dumb in-memory relay. One client in each room is the **host** and is the only authority. It publishes `setState`/`sendDelta` (sequenced, replayed to late joiners). Everyone else sends intents with `send(msg, to)`.
- Auth is an **app key** per game (not secret, ships in the bundle). Limits: 60 msg/s per player, 1 MiB per message, 100 rooms and 16 players per room by default. Nothing is persisted.
- The lobby (`apps.json` with a `gamehub` block) and cued (identity pass) are optional integrations.
- A reconnect gets a **new player id**. When the host drops, the lowest id becomes host.

Three consequences for a card game:

1. **Hidden information.** `state` and `delta` go to *everyone*. Hands, the Skat skat, the Hold'em deck and the Bridge dummy phase cannot go through them. Only `send(data, to)` is private. So the public table goes through `setState`, and each player's private view goes through targeted `msg`.
2. **Host migration loses hands.** The new host can rebuild public state from the last snapshot, but not the leaving host's hand or the undealt deck. We need a private backup (section 5).
3. **Trust.** The host client sees every hand, so a modified host client could cheat. This is acceptable for a friends' app, and I would state it openly. If you ever want public or ranked play, the same rules engine can run unchanged in a small Node authority server. That is the reason for the clean split below.

One GameHub app (`cards`) is enough. The game id goes into room `meta` (`{game:"skat", v:1}`), and the lobby can filter by it.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language/build | TypeScript, Vite, npm workspaces | Same as your other projects. Node 22 can run engine tests with no browser. |
| Rendering | **PixiJS v8** (WebGL/WebGPU) | Fast sprites, filters and shaders, particles. Handles dozens of cards with shadows, glow and blur at 60 fps on phones. |
| Animation | **GSAP** timelines (or Pixi's ticker plus a small tween layer if you prefer no dependency) | Sequencing is the hard part here. Timelines compose well. |
| UI chrome (menus, lobby, settings, chat) | Plain DOM and CSS over the canvas | Accessible, easy to style, no canvas text-input pain. |
| Audio | Web Audio (Howler optional) | Deal, flip, slide, chips, win stingers. |
| AI | Pure TS, run in a **Web Worker** | UI never stalls during search. |
| Cards | Procedural **SVG** decks rasterised to texture atlases at load time (French, German-suit, plus themes) | Crisp at any DPI, small download, swappable skins. |
| Table/background art | Generated images like the lobby background (WebP) | Atmospheric, cheap to ship. |
| App shape | Static site on `apps.futuremagic.de/cards/`, installable PWA | No server code. Works on desktop and mobile. |

I rejected full 3D (three.js). It costs a lot for little gain on card games. Pixi with perspective-style transforms, soft shadows and shaders reads as "elite" without the weight.

## 3. Package layout (new repo)

```
cards/
  packages/
    engine/        pure TS, no DOM, deterministic: cards, decks, seeded RNG, GameRules interface, trick/meld helpers
    games/
      skat/  doppelkopf/  holdem/  bridge/  romme/   (later: schafkopf, hearts, canasta, maumau)
        rules.ts   the game's rules module (the only thing you write per game)
        ai.ts      heuristics for that game
        view/      game-specific table layout and animation mapping
    ai/            bot interface, generic search (PIMC / MCTS), difficulty presets, worker wrapper
    net/           GameHub wrapper: room protocol, seat management, host loop, migration
    ui/            Pixi scene kit: card sprites, hands, piles, trick area, chips, animation director, DOM shell
  apps/web/        the actual app: menu, lobby, game picker, settings, PWA
  tools/           headless simulation runner (bots vs bots, rule tests), deck/asset builders
```

Dependency direction is one-way: `engine` ← `games` ← `ai`/`net`/`ui` ← `apps/web`. The engine and rules never import the network or the renderer, so the same code runs in the host client, in a worker, in tests, and later on a server.

## 4. The core abstraction: a rules module

Every game implements one interface. Everything else (networking, AI, rendering) is generic over it.

```ts
interface GameRules<Config, State, Move, View, Ev> {
  id: string; minSeats: number; maxSeats: number;
  setup(config: Config, seats: number, rng: Rng): State;       // deals, picks dealer
  activeSeats(s: State): Seat[];                               // usually one; bidding/Rommé can differ
  legalMoves(s: State, seat: Seat): Move[];                    // enumerable, so UI and AI share it
  apply(s: State, seat: Seat, m: Move, rng: Rng): { state: State; events: Ev[] };
  view(s: State, seat: Seat | "public" | "spectator"): View;   // redaction lives here, nowhere else
  result(s: State): Result | null;                             // scores, winners, round vs match
}
```

Design rules that make everything else fall out:

- **State is plain JSON and immutable-style**, so it can be serialised, diffed, cloned for AI search, and replayed.
- **All randomness comes from a seeded `Rng` in the host**, so a game is reproducible from `(config, seed, move list)`. That gives free replays, bug reports from a move log, and deterministic tests.
- **`apply` returns semantic events**, e.g. `dealt{seat,cards}`, `played{seat,card}`, `trickWon{seat,cards}`, `bid{seat,value}`, `shown`, `potAwarded`. Rendering never reads the state diff. It plays events. This is what makes "animation for every action" systematic rather than ad hoc.
- **`view(state, seat)` is the single place information is hidden.** It is the same function the host uses to build private messages and the AI uses to build its observation. If it is correct, there is no leak anywhere.
- **Bidding, declarer/partner reveals and card-passing are ordinary moves**, so Skat bidding, Doppelkopf announcements (Re/Kontra), Bridge auction and Hold'em betting rounds need no special casing.
- Configurable variants live in `Config` (Skat: Ramsch on/off, Bock rounds; Doppelkopf: Schweinchen, Hochzeit, Solo types; Bridge: rubber vs duplicate scoring; Hold'em: blinds, stack size, tournament or cash; Rommé: joker count, minimum meld value).

## 5. Multiplayer model on GameHub

**Seats, not connections.** A table has N seats. Each seat is `human(connectionId, seatToken)`, `bot(level)` or `empty`. The host owns the seat map and publishes it in public state, so any seat can be flipped to a bot in the lobby, or mid-game when someone leaves (a bot can take over a dropped player's seat immediately).

**Flow for a move:**

```
player UI --msg{move}--> host
host: rules.legalMoves check -> rules.apply(state, seat, move, rng)
host --sendDelta{seq, events(public form)}--> everyone         (animations play from this)
host --msg{private events/new hand}--> each affected seat      (own hand, passed cards, skat pickup)
every ~N moves / on need-snapshot: host --setState(publicView)--> late joiners
```

- **Public channel (`setState` and `sendDelta`)**: table state as seen by a spectator: card counts, played cards, bids, scores, whose turn, seat map. Events are redacted for public (a face-down deal shows card *backs* flying; a play shows the face).
- **Private channel (`send(..., to)`)**: that seat's hand and anything only they may see. Because `view()` produces both, there is one code path.
- **Late join and reconnect**: the joiner gets the latest public snapshot from GameHub automatically, then asks the host for its private view, authenticated by a `seatToken` kept in `localStorage`. Because GameHub assigns a new player id on reconnect, identity must live at app level: the seat token, optionally tied to a cued `sub`.
- **Host migration.** Whenever state changes, the host also sends the full authoritative state (including hidden hands, deck and RNG state) as a private `msg` to a **designated successor** (lowest other player id). On `host` event, the successor is promoted. It resumes from its shadow copy and re-announces the seat map. If no shadow exists (successor also gone), the table falls back to "abandon hand, redeal, keep match score". The successor learns all hidden cards, which is the same trust you already place in the host.
- **Bandwidth**: card games are tiny. A move is well under 1 KB, nowhere near 60 msg/s, so no special batching is needed.
- **Turn timers and pause** are host-driven and published as a deadline timestamp in public state; AI seats are not subject to them.

## 6. AI players

```ts
interface Bot { choose(obs: View, legal: Move[], ctx: {rng, budgetMs, level}): Promise<Move> }
```

- A bot only ever sees `view(state, seat)`, the same observation a human gets. No peeking by construction.
- Bots run **on the host** (in a worker), because the host already owns authority, so a bot is just another intent source. If the host migrates, bots migrate with it, since they are stateless apart from the move log.
- **Per-game heuristic layer** (always present, gives the "easy" and "normal" levels and makes the opening moves fast): bidding evaluators for Skat, Doppelkopf and Bridge; pot-odds and hand-strength tables for Hold'em; meld planning for Rommé.
- **Generic search layer for hard levels**: *determinised Monte Carlo* (PIMC, also called perfect-information MC with sampling). The bot samples worlds consistent with what it has seen (reconstructable from `view` plus the move log, using the rules' own constraints such as void suits), plays each candidate move out with the heuristic policy, and picks the best average. It is generic over `GameRules`, so each new trick-taking game gets a strong bot almost for free. Hold'em hard mode adds simple opponent modelling and equity calculation.
- **Personalities and delays**: a randomised think delay and light "tells" (hesitation on tricky decisions) so bots feel like players, and an optional AI-explains-itself debug overlay while we develop.
- Bot-vs-bot **simulation harness** in `tools/` plays thousands of games headless. That finds rule bugs and lets us tune difficulty by win rate.

## 7. Rendering and animation

Core idea: an **animation director** consumes the event stream and returns timelines. The model has already moved on; visuals catch up in order.

- **Scene kit (`ui`)**: `CardSprite` (front, back, edge thickness, shadow, hover lift), `Hand` (fan or line layout with drag or tap and legal-move highlighting), `Pile`/`Deck`, `TrickArea`, `ChipStack`, `Meld` rows (Rommé), `SeatPlate` (avatar, name, bid bubble, turn ring, bot badge).
- **Event → timeline mapping** is a table per game: `dealt` is a staggered flick from the deck with a slight spin and settle bounce; `played` is an arc to the trick area with a thud and dust; `trickWon` is a sweep to the winner with a glow; Hold'em chips fly into the pot and split on a win; Rommé melds snap into rows; shuffles use a riffle animation. Every event type must have an entry, which is checked in tests, so nothing is silently un-animated.
- **Skippable and speed control**: a queue with fast-forward. Animations never block input unless they must, and a late-joining or reconnecting client jumps straight to the final state with no replay.
- **Feel**: easing and secondary motion (settle, overshoot), soft contact shadows, a depth-of-field blur on cards in flight, particle bursts on big wins (Grand Hand, Slam, royal flush), camera-style subtle table parallax with device tilt on mobile, sound for every event.
- **Layout**: responsive with a fixed logical table (e.g. 1920×1080) scaled to the viewport, 2 to 6 seats arranged around it. Portrait phones get a bottom-hand layout with the opponents compressed along the top.
- **Themes**: card deck (French or German), card back, table felt or wood, each a data-driven skin.
- **Accessibility**: colour-blind suit symbols, large-card mode, reduced-motion switch, sounds on or off.

## 8. App shell and integration

- **Flow**: pick game → choose table (create, join by code, or the lobby list) → configure seats (human, bot, or open, with a difficulty per bot) and variant options → play → score screen → rematch.
- **Solo vs bots needs no network.** A local "host" is just the same host loop talking to in-process seats, which also makes offline play and PWA install natural.
- **Lobby**: one entry in `apps.json` with a `gamehub` block (`app: "cards"`, `join: "?room={code}"`), and a custom lobby card. Room names and `meta.game` let the lobby show which game is running.
- **cued**: optional and cheap. Use `client/cued.ts` to pre-fill the name and avatar and as the stable player id for seat tokens.
- **Persistence**: nothing server-side in v1. Settings, statistics and seat tokens live in `localStorage`. Match history or leaderboards would need ServerStore, as a later step.

## 9. Games and rough difficulty

| Game | Seats | Notes | Rough effort |
|---|---|---|---|
| Texas Hold'em | 2–9 | Simplest rules, but the betting engine, side pots and showdown need care. A good first game because it is mostly chips and animation. | S |
| Mau-Mau | 2–5 | Trivial rules, fine as the first end-to-end vertical slice. | XS |
| Hearts | 4 | Clean trick-taking, passing phase. Good PIMC test case. | S |
| Skat | 3 (+dealer) | Bidding (Reizen), many game types (suit, Grand, Null), Schneider/Schwarz, Ramsch. Heavy scoring rules, with strong German club rules (ISkO) to follow. | M |
| Schafkopf | 4 | Bavarian trump rules, many game types. Fits the Skat machinery. | M |
| Doppelkopf | 4 | Hidden partnerships (Re/Kontra), Hochzeit, Soli, Schweinchen, announcements, big rule variance, so it needs a good config system. | L |
| Rommé | 2–6 | Simultaneous-ish meld logic, jokers, laying off, scoring. UI heavy (drag to build melds). | M–L |
| Bridge | 4 | Auction, conventions, contract scoring, dummy reveal. Strong bots are genuinely hard. A solid mid-level bot plus a plain auction is realistic. | L |
| Canasta | 4 | Meld rules, pickup pile, partnership scoring. | M–L |

Suggested order: Mau-Mau (vertical slice that proves engine, net, AI and animation) → Hold'em → Hearts → Skat → Doppelkopf → Rommé → Bridge, with Schafkopf and Canasta where they fit.

## 10. Milestones

0. **Repo and skeleton**: monorepo, engine types, seeded RNG, test runner, Vite app, GameHub wrapper, CI.
1. **Vertical slice (Mau-Mau)**: rules, heuristic bot, host loop, 2 humans and 2 bots over GameHub, Pixi table with full event animation, lobby entry. This is the proof that the architecture works.
2. **Hold'em** (chips, pots, betting UI) and **host migration + reconnect hardening**.
3. **Skat**, then Hearts and Doppelkopf, with the generic PIMC bot.
4. **Rommé, Bridge**, polish pass (sound, themes, mobile layout, accessibility).
5. Extras (Schafkopf, Canasta), stats and match history.

## 11. Risks

- **Animation for *every* action** is a lot of work across many games. The event-to-timeline table and the "every event has an animation" test keep it systematic.
- **Rules ambiguity**: Skat, Doppelkopf and Rommé each have many regional variants. I would implement the official rules (ISkO, DDV Turnierregeln, Bridge laws) as defaults and expose the common variants as options.
- **Bridge AI quality** is a long-tail problem. Plan for "decent", not "world class".
- **Host cheating or host loss** (section 1 and 5). Accepted for a friends' app, with the server-authority path kept open.

## 12. Decisions (Arnd, 2026-11-02)

- v1 games: Skat, Doppelkopf, Texas Hold'em, Bridge, Rommé plus Schafkopf, Hearts, Canasta, Mau-Mau.
- UI languages: German and English from day one (i18n in the shell).
- Trust: host sees all cards. Friendly play, not competitive.
- Rendering: PixiJS plus GSAP confirmed. **3D is welcome where it adds something**: the table scene (cards in flight, depth of field, lighting, shadows) may use Three.js instead of or alongside Pixi. This will be decided in a short prototype in milestone 1 (same Mau-Mau scene in both, compare look and phone performance). Because rendering only consumes events, the choice does not touch rules, net or AI.
- Quality bar: best card-game app available. Flawless animation on every action; AI-generated images, music and sound effects via OpenRouter.
- GameHub app `cards` (key mode) exists; repo is ArndRosemeier/Cards.
