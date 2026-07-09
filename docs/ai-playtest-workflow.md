# AI Playtest Workflow

This document is the canonical workflow for AI agents that playtest Motion
Levels games in this repository. Keep this file in sync with
`docs/playground-ai-api.md` whenever the playground API changes.

## Goal

Use the local playground as a deterministic feedback loop for gameplay and TV
display quality. The agent should observe both the board and the player display,
make small code changes, and verify improvements with captures and tests.

## Start Here

1. Read `AGENTS.md`, `docs/contract.md`, and `docs/playground-ai-api.md`.
2. When creating a new game, start with:

```sh
npm run create:game -- <game-id> "Display Name"
```

   The playground discovers games from `games/*/src/index.ts`, so new games
   should appear in the selector automatically while Vite is running.
3. Inspect the target game under `games/<game-id>/`, especially `README.md`, `game.ts`,
   `display.tsx`, `manifest.ts`, fixtures, and tests.
4. Start the playground:

```sh
npm run dev --workspace apps/playground
```

5. Open the Vite URL and wait for:

```js
document.documentElement.dataset.motionLevelsPlaygroundApi === "ready"
```

6. Use `window.ml` or `window.motionLevelsPlayground` for deterministic control.
   The playground uses the shared TypeScript SDK engine at 30fps, so `ml.step()`
   advances one frame unless you pass an explicit millisecond delta.

## Playtest Loop

Run short, repeatable playthroughs:

```js
await ml.pause();
ml.reset();
ml.tap(4, 4);
ml.step(500);
ml.tap(10, 27);
ml.step(1000);

const feedback = await ml.capture(["display", "boardPhysical", "boardPreview", "combined"]);
console.log(ml.getState(), feedback.combined.dataUrl);
```

Prefer physical tile coordinates unless deliberately testing the rotated preview.
Use `{ space: "preview" }` only when interacting with the visible board layout.

## Evaluate

For every playthrough, judge both surfaces:

- **Gameplay:** Is the goal understandable? Does input timing feel fair? Are
  successes, misses, readiness, and transitions clear?
- **Board:** Can a person on the floor infer what to do from lights alone? Are
  important objects visible and distinguishable?
- **Player display:** Does the TV explain state, score, round progress, target,
  and latest feedback without selectable/browser-looking elements?
- **Agent feedback:** Do `ml.getState()` and captures provide enough evidence to
  diagnose the next change?

## Change Discipline

- Keep game logic deterministic; randomness must flow through SDK seeded RNG
  helpers.
- Keep `manifest.id` exactly equal to the `games/<game-id>` directory name.
- Let the playground discover games through `games/*/src/index.ts`; do not add
  manual game imports to `apps/playground/src/App.tsx`.
- Prefer focused edits in the target game and shared display/game helpers.
- Keep `apps/playground` changes about tooling only; do not put game-specific
  gameplay rules there.
- Update fixtures/tests when changing expected game behavior or display output.
- If the playground API changes, update `docs/playground-ai-api.md` and this
  workflow in the same change.

## Verification

Before handing off:

```sh
npm test --workspaces --if-present
npm run validate:games
npm run build
```

Also run at least one browser playthrough with the playground API and capture:

```js
await ml.pause();
ml.reset();
ml.step(250);
await ml.capture(["display", "boardPhysical", "combined"]);
```

Report:

- commands run and their result
- screenshots or capture dimensions used for evidence
- what changed in gameplay and/or player display
- any remaining risk or untested scenario
