# AGENTS.md

Guidance for AI agents and humans working in this repository.

## Scope

This repo is the TypeScript-first home for Motion Levels games and local game
development tooling. Keep it independent from the production platform in v1:
no database, venue hardware, Motion Go, or platform API coupling.

## Language

- **The player display is Spanish only.** Every string a player can see or hear
  on the TV display — metric labels, captions, status text, phase labels, and
  event/cue messages returned from `game.ts` — must be written in Spanish. This
  is the venue-facing surface; there is no English fallback and no i18n layer.
- This applies to `display.tsx`, the player-facing strings in `game.ts`
  (`GameEvent.message`), `fixtures.ts` snapshots (they drive media previews),
  and the shared primitives in `packages/display-kit`.
- Developer-only surfaces stay in English: the `apps/playground` chrome
  (buttons, control labels, the debug panel), code identifiers, `phase` enum
  values, comments, docs, and commit messages.
- Keep game terminology consistent with the platform's Spanish (e.g. `baldosa`
  for tile, `punto`/`peloteo` for point/rally, `objetivo` for target).

## Player Display Layout

- **Never truncate player-facing text mid-word.** Do not use
  `text-overflow: ellipsis` with `white-space: nowrap` on any string a player
  reads on the TV display — it produces half-words like `Pendien…`. Size the
  text so the expected content fits, and let it wrap on whole words
  (`white-space: normal`) instead of clipping. This rule covers `display.tsx`
  and every primitive in `packages/display-kit`.
- The debug/dev chrome in `apps/playground` is exempt (ellipsis there is fine).
- Treat the playground surface aspect ratios as hardware contracts: the player
  display is always **16:9** and the floor is always **16:32**. Size either
  surface from one constrained axis and derive the other with `aspect-ratio`;
  never independently force both width and height. Empty surrounding space is
  preferable to stretching either surface.

## Developer UI Consistency

- Prefer icons for compact, repeated developer actions. Every icon-only button
  must still have an accessible label and a tooltip.
- Every playground dialog or popover must use the shared
  `PopoverCloseButton`; do not add text-based or separately styled close
  controls.
- Adjacent compact icon actions must render as segmented groups with collapsed
  shared borders and no gaps. Use the playground control color tokens instead
  of introducing one-off button colors.

## Workflow

- Pull before new work and before pushing.
- Keep commits small and focused.
- After every task or prompt that changes repository files, commit the completed
  work before handing it off. Do not leave finished changes uncommitted.
- Never force-push or rewrite Git history. Do not use `git push --force`,
  `git push --force-with-lease`, rebase, commit amendment, or equivalent
  history-rewriting operations. Use normal forward commits and merge commits.
- Jose's game-authoring branch is `dev`. Merge latest `main` into `dev` with a
  normal merge before starting or publishing `dev` work.
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
  merge `origin/main` into `dev` when work resumes there or before pushing
  `dev` changes. A normal `main` push does not require immediately updating
  `dev`.
