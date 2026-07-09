# AGENTS.md

Guidance for AI agents and humans working in this repository.

## Scope

This repo is the TypeScript-first home for Motion Levels games and local game
development tooling. Keep it independent from the production platform in v1:
no database, venue hardware, Motion Go, or platform API coupling.

## Workflow

- Pull before new work and before pushing.
- Jose's game-authoring branch is `dev`. Rebase `dev` on latest `main` before
  starting or publishing `dev` work; do not merge `main` into `dev`.
- Keep commits small and focused.
- Run `npm test` and `npm run build` before publishing changes when practical.
- Create new games with `npm run create:game -- <game-id> "Display Name"`
  instead of copying an existing game by hand.
- The playground discovers games from `games/*/src/index.ts`; do not add
  manual game imports to `apps/playground/src/App.tsx`.
- Prefer deterministic game logic. Any randomness should flow through the SDK
  seeded RNG helpers.
- Keep `docs/ai-playtest-workflow.md` and `docs/playground-ai-api.md` in sync
  with playground API changes so AI playtest agents always read current repo
  truth instead of stale copied instructions.

## Package Boundaries

- `packages/game-sdk` owns framework-agnostic contracts and helpers.
- `packages/display-kit` owns reusable React display primitives.
- Each game owns its `manifest.ts`, `game.ts`, `display.tsx`, and `fixtures.ts`.
- Every `games/<id>` package must include a `README.md`, and `manifest.id` must
  exactly match `<id>`.
- `apps/playground` is for local development only.

## Jose Dev Branch

- Use `docs/jose-game-authoring.md` for non-technical game-authoring workflow.
- `Dev Games CI` runs on every push to `dev`.
- `Dev Games CI` fails when `origin/main` is not an ancestor of `dev`, so
  rebase `dev` when work resumes there or before pushing `dev` changes. A
  normal `main` push does not require immediately updating `dev`.
