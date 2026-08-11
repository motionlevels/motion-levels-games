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
   If working with Jose on the `dev` branch, also read
   `docs/jose-game-authoring.md`.
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
   The playground uses the shared TypeScript SDK engine at 50fps, so `ml.step()`
   advances one frame unless you pass an explicit millisecond delta.

## Playtest Loop

Run short, repeatable playthroughs:

```js
ml.reset();
ml.resume();
ml.press(8, 16);
ml.pause();
ml.step(2000);
ml.resume();
ml.release(8, 16);
ml.tap(4, 4);
ml.pause();
ml.step(1000);

const feedback = await ml.capture(["display", "boardPhysical", "boardPreview", "combined"]);
console.log(ml.getState(), feedback.combined.dataUrl);
```

Prefer physical tile coordinates unless deliberately testing the rotated preview.
Use `{ space: "preview" }` only when interacting with the visible board layout.
`ml.getState()` includes the active `seed`, `playerCount`, `difficulty`, and
game `options`; keep those values with any feedback so regressions are
reproducible. Use `playerCount: 0` only for games with
`manifest.players.allowAny: true`; strict player-count games should be tested
inside their declared min/max range. For `allowAny` games, valid values are `0`
plus the manifest's declared min/max range; other positive values are clamped.
Treat `allowAny: true` as the default for games whose board and rules are
independent of booking size. Use a strict count only with a documented gameplay
dependency, and verify that Any mode still waits for the physical players the
current board requires.

For product agent/character work, select Duelo and activate the shared Jugar 3D
surface. Keep its seed, tick and checksum with every capture:

```js
const lab = ml.agentLab;
lab.setActive(true);
lab.setAgentCount(8);
lab.setProfile("mixed");
lab.setQualityTier("capture");
lab.pause();
lab.reset();
lab.step(125);
const state = lab.getState();
const image = await lab.capture(); // actual WebGL drawing-buffer size

lab.stopRecording();
lab.replay.enter();
lab.replay.seek(100);
const replayImage = await lab.capture();
```

Wait for `state.performance?.budgetReady` before judging a quality tier. Assert
both `structuralWithinBudget` and `withinBudget`, retain the measured calls,
triangles, resource counts, memory proxy, renderer identity, and caveats with
the capture. On SwiftShader, compare against the explicit software-CI p95
ceiling and state clearly that the result is regression evidence rather than
venue-hardware certification; never omit the still-reported hardware timing
miss. Structural overages are failures in every environment.

Agent-surface steps are 20 ms fixed ticks. Exercise same/new seed, Duelo's 2–8
player range, every quality tier, local and host pause, single-step, replay
play/pause/seek/speed, agent selection, path/target overlays, record/export,
and an honest native capture. Repeating the same replay seek must retain the
checksum and image. Inspect the selected controller explanation and route;
never infer decisions from floor colours or animation. Return to Floor mode
and confirm normal player input and the game-owned display are unchanged.

The surface records exact shared `GameSession` presentation frames in the
current page. Batched `step(n)` calls advance authority one fixed tick at a time
and retain all intermediate frames while presenting only the final frame.
Replay consumes that trajectory without constructing another engine or
regenerating decisions; exit restores the parked live session.

Treat this exact presentation trajectory as browser-memory evidence, not as a
portable file format. `exportReplay()` uses the `replay-runtime` envelope for
diagnostic metadata, controller actions, state samples and checksums, but it
does not contain the authoritative floor press/release stream or the full
Jugar 3D frame sequence. It therefore cannot reproduce authority or exact
presentation after reload, and there is no trajectory import API. Keep
captures in the same page session when exact visual replay matters. For a
portable, headlessly verifiable Duelo replay, record and verify the real input
stream through `@motion-levels-games/duelo/replay` instead.

Paused games reject player input. For deterministic playtests, call `resume()`,
send `press`, `release`, or `tap` synchronously, and call `pause()` again before
advancing with `step()`. Never expect an input sent while paused to be queued or
applied later. A paused display must replace its normal TV phase status with
`En pausa` without changing the underlying game snapshot.

Configuration returned by `ml.getState()` is manifest-normalized: defaults are
filled, numeric bounds are enforced, undeclared options are removed, and an
invalid difficulty falls back to the manifest default. Tests should assert
those normalized values rather than duplicating manifest constraints.

When reviewing playground behavior, verify that a selected game survives a
reload, every configuration change restarts the engine, and dialogs/selectors
pause only while they are active. Include a manually paused case so closing a
control cannot accidentally resume the game.
Also attempt floor and API input while paused and verify that snapshot, paddle,
targets, and held-player readiness do not change. Capture the native display
and confirm that its status says `En pausa` for both manual and temporary UI
pause locks.

After any pointer floor interaction, move the pointer completely outside the
floor and inspect the board. Latched inputs may remain logically active, but no
outline, glow, brightness, scale, or other tile decoration may remain; only the
game-rendered frame may persist. Keyboard `:focus-visible` styling is allowed
only while that tile genuinely has visible keyboard focus.

For every multiplayer `player-ready` game, use the real interactive floor to
click all readiness zones sequentially with one mouse at the maximum supported
player count. Confirm the clicks latch, the game reaches `starting`, and the
countdown reaches `running`. Direct `ml.press(...)` calls are useful for
deterministic edge cases, but they do not replace this human-input regression.

Generate catalog-style media when reviewing a game card or TV display:

```js
const media = await ml.media("ping-pong", {
  difficulty: "hard",
  playerCount: 0,
  options: { points_to_win: 7 }
});
console.log({
  thumbnail: media.assets.thumbnail.dataUrl,
  animation: media.assets.animation.dataUrl,
  playerDisplay: media.assets.playerDisplay.dataUrl
});
```

Use the generated `thumbnailSmall`, `thumbnail`, `animation`, and
`playerDisplay` assets instead of hand-rolled screenshots when checking how a
game should appear outside the live playground.

## Evaluate

For every playthrough, judge both surfaces:

- **Gameplay:** Is the goal understandable? Does input timing feel fair? Are
  successes, misses, readiness, and transitions clear?
- **Start lifecycle:** Does selection remain in `waiting`? Do the floor and TV
  show where players must stand, does `starting` visibly count down, and does
  leaving a required zone cancel the countdown?
- **Player count:** If the game is unchanged by group size, does the selector
  offer `0 / Any` and produce the same board/rules as its concrete count? If it
  is strict, is the count-dependent behavior visible and tested?
- **Win transitions:** Does a round win pause scoring and celebrate clearly on
  both surfaces before the next round? Does the final game win have a distinct,
  satisfying animation before reset, with the winner and completed result
  still readable?
- **Board:** Can a person on the floor infer what to do from lights alone? Are
  important objects visible and distinguishable?
- **Player display:** Does the TV explain state, score, round progress, target,
  and latest feedback without selectable/browser-looking elements? Inspect the
  rendered image for overflow, collisions, clipping, ellipses, mid-word
  breaks, awkward wrapping, and text that is out of scale with its container.
- **Distance readability:** Are score, round/progress, lives, and time the
  largest readable elements their available cards allow? Flag large empty
  metric panels containing desktop-sized values, and test the widest realistic
  values before increasing type.
- **Lives:** When present, are remaining lives solid red hearts and lost lives
  the same solid heart shape in muted gray? Does the shared `LivesMeter` keep
  every slot visible at full, partial, and zero lives without wrapping? Do
  remaining hearts pulse calmly, and do lost and regained slots use the shared
  distinct transitions without overpowering the rest of the display?
- **Agent feedback:** Do `ml.getState()` and captures provide enough evidence to
  diagnose the next change?

## Change Discipline

- Keep game logic deterministic; randomness must flow through SDK seeded RNG
  helpers.
- Keep the immutable UUID/hash in `manifest.id`, the package/directory name in
  `manifest.slug`, and any previous names in `manifest.aliases`.
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
await ml.media();
```

For a new game or a material player-display change, the browser pass must
include a native `display` capture at 1920x1080 for every main phase the game
supports. Populate representative worst-case content: longest expected labels
and player names, maximum scores and timer widths, dense event/status text, and
finished-state messaging. Open and visually inspect each rendered capture;
tests, DOM snapshots, and dimensions alone cannot detect bad visual hierarchy
or text that technically fits but still looks out of place. Do not hand off the
game until all text fits cleanly without ellipses or clipping and remains
balanced within its container.

Judge the same captures at reduced on-screen scale to approximate venue
distance. Primary metrics must remain immediately legible and visually
dominant; if their cards have unused space, increase them until the widest
expected value approaches a safe fit.

For every new game, capture representative floor and native player-display
frames during the final game-win animation. If the game has rounds, capture the
round-win animation separately and verify that it finishes before the next
round begins. Tests must prove that scoring input is ignored during both
transitions and that reset/round advancement happens only after their
deterministic durations.

For games with lives, capture the native player display at full, partially
depleted, and zero lives. Confirm that every state uses the shared red/gray
heart treatment and keeps the maximum number of slots visible. Trigger at least
one life loss and one life increase or reset to inspect both transitions, and
confirm that reduced-motion preferences disable all heart animation.

Report:

- commands run and their result
- screenshots or capture dimensions used for evidence
- phases and worst-case text values visually inspected
- round-win and game-win animation states inspected
- what changed in gameplay and/or player display
- any remaining risk or untested scenario
