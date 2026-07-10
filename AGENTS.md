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
- Keep `GameEvent.message` concise and never end it with a period. Event lists
  supply their own visual separation, so terminal periods add noise.

## Player Display Layout

- Runners must wrap player displays in the shared
  `PlayerDisplayRuntimeProvider`. `GameDisplayShell` reads its pause state from
  that provider and owns the Spanish `En pausa` TV status; do not mutate the
  game snapshot phase or recreate pause labels inside individual games.
- **A rendered visual inspection is mandatory for every new game and every
  material player-display change.** Open the game in the playground, capture
  the native 1920x1080 `display` surface, and actually inspect the image before
  finishing the task. DOM assertions, successful builds, and checking capture
  dimensions are useful but do not replace looking at the rendered display.
- Inspect representative content for every main phase (`waiting`, `starting`,
  `running`, and `finished` when supported), including the longest expected
  labels, player names, scores, timers, and event text. Look specifically for
  text escaping or colliding with its container, clipped text, ellipses,
  mid-word breaks, awkward wrapping, and text that is visually too large or
  too small for the surrounding hierarchy. Fix every issue before handoff.
- Design the player display for people reading it from across the venue. Make
  primary score, round/progress, lives, and time values as large as their cards
  safely allow. Large unused space around a small primary value is a defect,
  not breathing room. Use the widest expected value to determine the maximum
  safe type size, then verify it at native 1920x1080 and in the scaled preview.
- Keep a distance-first hierarchy: critical live metrics must dominate labels,
  secondary explanations, decorative previews, and debug-like detail. Prefer
  the shared primary metric layouts in `packages/display-kit` so improvements
  apply consistently across games.
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
- Games with lives must render them with the shared `LivesMeter` from
  `@motion-levels-games/display-kit`. Remaining lives are solid red hearts;
  lost lives stay visible as the same solid heart shape in muted gray. Never
  substitute green hearts, outline hearts, ad hoc text glyph strings, or
  game-specific life colors or animations. The shared meter owns the calm idle
  pulse and the lost/regained transitions so motion stays consistent across
  games. Include `maxLives` in the snapshot so the display does not duplicate
  the game's starting-life constant. Games without a lives mechanic use
  `lives: -1`; never repurpose `lives` for score, rounds, or progress.
- Test and visually inspect the lives display at full, partially depleted, and
  zero lives. Every state must preserve the same number of heart slots and fit
  its container without clipping or wrapping.

## Game Start Lifecycle

- Every game manifest must explicitly declare `start.mode`. Use
  `player-ready` by default. `immediate` is an exceptional opt-in and is allowed
  only when the product requirement explicitly says the game should autoplay
  as soon as it is selected.
- A `player-ready` game must begin in `waiting`, detect the required real
  players through intentional floor zones, transition to `starting`, and only
  enter `running` after the shared countdown. Selecting or initializing the
  game must never start its gameplay timer.
- The floor and player display must both animate while waiting and while
  starting. Waiting motion should make the required player zones obvious;
  starting motion must clearly communicate that play is imminent.
- Keep player presence live throughout the countdown. If a required player
  leaves after the release-grace window, cancel the countdown and return to
  `waiting`.
- Use `createPlayerReadyGate` and rectangular player zones from
  `@motion-levels-games/game-sdk`; expose `readyPlayers`, `requiredPlayers`, and
  `countdownMillis` in the snapshot. Use the shared `PlayerReadyOverlay` for
  standard solo/cooperative displays instead of creating a one-off overlay.

## Player Count Policy

- Every manifest must explicitly set `players.allowAny`. Default it to `true`
  when the board, readiness zones, scoring, and rules do not change with the
  configured player count. This lets larger groups choose `0 / Any` and take
  turns without rearranging bookings or teams.
- Set `allowAny: false` only when the exact number of configured players
  materially changes gameplay, such as per-player zones, targets, turns,
  scoring, team composition, or board layout. Document that dependency in the
  game README and test each supported count.
- `0 / Any` does not remove physical readiness detection. The game must still
  wait for the real players its current board layout requires before starting.

## Round And Game Win Animations

- Every new game must include a distinct game-winning animation by default.
  Games with rounds must also include a shorter, visually distinct round-win
  animation before advancing to the next round. Single-run games need only the
  game-win animation.
- Render each celebration on both the floor and player display. Clearly show
  who won (player, team, or solo player), preserve the completed score/result,
  and use animation and color that cannot be confused with normal gameplay,
  waiting, or the next round's start countdown.
- Treat win animations as explicit timed transitions. Stop accepting scoring
  input while they run, do not advance the next round or reset the game until
  the celebration finishes, and keep their timing deterministic from engine
  time so tests and captures are reproducible.
- Fixtures and tests must cover the round-win transition when rounds exist and
  the final game-win transition for every game. Browser playtests must capture
  and visually inspect both floor and native player-display animation states.

## Developer UI Consistency

- Persist the last selected playground game and restore it only when its id is
  still present in the discovered game catalog. Every player count,
  difficulty, seed, or manifest setting change must restart the active game.
- Opening any playground dialog or focusing a selector must acquire a temporary
  pause lock. Release only that lock when the UI closes or blurs; never clear a
  manual pause or another open UI's lock. Keep manual pause state separate from
  temporary interaction pause state.
- Effective pause is a hard player-input boundary. While manually paused or
  covered by any temporary pause lock, floor UI and playground API
  `press`/`release`/`tap` calls must not reach the game engine. Release any
  already-held inputs when pause begins so they cannot remain stuck on resume.
  Explicit developer `step()` may advance an existing paused state, but it must
  never make blocked input take effect.
- Prefer icons for compact, repeated developer actions. Every icon-only button
  must still have an accessible label and a tooltip.
- Every playground dialog or popover must use the shared
  `PopoverCloseButton`; do not add text-based or separately styled close
  controls.
- Adjacent compact icon actions must render as segmented groups with collapsed
  shared borders and no gaps. Use the playground control color tokens instead
  of introducing one-off button colors.
- Render playground runtime phases through the shared `PhaseIndicator` and its
  centralized phase tokens. Header, status cards, and future phase surfaces
  must never define their own phase colors.

## Workflow

- Pull before new work and before pushing.
- Keep commits small and focused.
- Use `npm run check:fast` during the edit loop. It combines the fast native
  linter with strict workspace typechecks and should remain quick enough to run
  after every meaningful code edit. Use `npm run lint:fix` only for safe lint
  fixes, then inspect the diff.
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
- A newly scaffolded game is not complete until its player display passes the
  mandatory rendered visual inspection described above.
- A newly scaffolded game is not complete until its game-win animation, and
  round-win animation when applicable, are implemented and verified.
- The playground discovers games from `games/*/src/index.ts`; do not add
  manual game imports to `apps/playground/src/App.tsx`.
- Prefer deterministic game logic. Any randomness should flow through the SDK
  seeded RNG helpers.
- Keep `docs/ai-playtest-workflow.md` and `docs/playground-ai-api.md` in sync
  with playground API changes so AI playtest agents always read current repo
  truth instead of stale copied instructions.

## Package Boundaries

- `packages/game-sdk` owns framework-agnostic contracts and helpers.
- Reusable deterministic floor geometry and animation helpers belong in
  `packages/game-sdk/src/effects.ts` and are exported from
  `@motion-levels-games/game-sdk/effects`. Keep palette, timing, and
  game-specific choreography in the game unless multiple games genuinely use
  the same behavior.
- Treat each manifest config variable as the single source of truth for its
  type, default, bounds, step, and choices. Normalize through
  `normalizeGameConfig` and read the exported variable descriptor with
  `readGameConfigOption`; do not repeat schema values in game logic.
- `packages/display-kit` owns reusable React display primitives, including the
  canonical `LivesMeter`; games must not recreate shared player-display UI.
  Reusable TV motion belongs with the primitive and shared CSS in display-kit,
  while game-only display animation stays namespaced to that game.
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
