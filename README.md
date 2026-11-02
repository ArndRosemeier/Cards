# Cards

Nine card games in one app, all multiplayer over [GameHub](https://games.futuremagic.de), and any seat can be played by the computer.
UI in German and English. Procedural card art, animated table (PixiJS + GSAP), synthesized sound, installable as a PWA.

| Game | Players | Notes |
|---|---|---|
| Mau-Mau | 2–5 | |
| Hearts | 4 | pass 3, shooting the moon, 100 points |
| Skat | 3 | bidding, hand games, grand/null/suit, Ramsch |
| Doppelkopf | 4 | Hochzeit and the six solos, Re/Kontra, Fuchs/Karlchen/Doppelkopf |
| Schafkopf | 4 | Sauspiel, Wenz, Solo, Ramsch |
| Texas Hold'em | 2–6 | tournament, side pots, rising blinds |
| Rommé | 2–4 | 110 cards, 40-point opening, lay-off |
| Bridge | 4 | auction, dummy play, duplicate scoring |
| Canasta | 2–4 | partners with 4 players, frozen pile, red threes, canastas |

Known simplifications: Skat has no Ouvert games, Bridge bots bid with a basic point count (no conventions), Canasta uses fixed going-out rules (needs one canasta).

## Run

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # rules, bots and online play against a local mock hub (Node >= 22.18)
npm run typecheck
npm run build      # static site in apps/web/dist
```

Handy URL parameters for development: `?autostart=1&game=canasta&players=4&seed=3&auto=1&fast=1` starts a local game (`auto` lets bot logic play your seat), `?room=CODE` joins an online room.

## Deploy

`apps/web/dist` is a static site with relative paths: put it on any static host (GitHub Pages, Netlify, an nginx folder). A service worker caches it, so solo play against bots also works offline.
The GameHub app key is in `apps/web/.env.production` (`VITE_GAMEHUB_KEY`, optional `VITE_GAMEHUB_URL`); the app id is `cards`. Keys identify the app and are shipped in the client by design.
To list the app in the GameHub lobby, register its URL in GameHub's app list (see the gameserver repo).

## How it works

- `packages/engine`: seeded RNG, cards, the `GameRules` interface (`setup`, `legalMoves`, `apply`, `view`, `result`) and the `Bot` interface.
- `packages/games/*`: one pure rules module plus bot per game. State is plain JSON, randomness only from the seeded RNG, `view()` is the only place information is hidden.
- `packages/net`: `TableHost` (authoritative table, seats are human or bot) and `OnlineSession` (the room creator hosts, others join; if the host leaves, the next player takes over from a snapshot and the bots keep the empty seats).
- `apps/web`: menu, table scenes (one per game family), card rendering, sound, i18n.

Design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
