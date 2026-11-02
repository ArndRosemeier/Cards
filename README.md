# Cards

Multiplayer card games (Skat, Doppelkopf, Texas Hold'em, Bridge, Rommé, Schafkopf, Hearts, Canasta, Mau-Mau) on GameHub, with AI for any seat.
Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
npm install
npm test        # rules tests (Node >= 22.18, no browser)
npm run typecheck
```

- `packages/engine` seeded RNG, cards, the `GameRules` interface
- `packages/games/*` one rules module per game (Mau-Mau first)
