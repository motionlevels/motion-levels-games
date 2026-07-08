# AGENTS.md

Guidance for AI agents and humans working in this repository.

## Scope

This repo is the TypeScript-first home for Motion Levels games and local game
development tooling. Keep it independent from the production platform in v1:
no database, venue hardware, Motion Go, or platform API coupling.

## Workflow

- Pull before new work and before pushing.
- Keep commits small and focused.
- Run `npm test` and `npm run build` before publishing changes when practical.
- Prefer deterministic game logic. Any randomness should flow through the SDK
  seeded RNG helpers.

## Package Boundaries

- `packages/game-sdk` owns framework-agnostic contracts and helpers.
- `packages/display-kit` owns reusable React display primitives.
- Each game owns its `manifest.ts`, `game.ts`, `display.tsx`, and `fixtures.ts`.
- `apps/playground` is for local development only.

