# Deterministic agents, replay, and 3D character architecture

Status: implementation baseline, 2026-08-10.

This document re-baselines the 3D-character and AI plan against the canonical
`motionlevels/motion-levels-games` repository. It is the ownership contract for
the first vertical slice and supersedes assumptions from older Motion Go or
`motion-levels-first` code.

## Decisions

1. `GameInstance` remains authoritative for rules, collisions, scoring,
   hazards, objectives, lives, and results.
2. Humans, bots, scripts, and replay all reach a game through timestamped
   floor press/release input. A brain cannot call rule functions directly.
3. Replayable simulation uses integer fixed ticks. Existing millisecond runner
   protocol input remains supported at the adapter boundary.
4. Every stochastic decision uses the SDK seeded RNG or a stable child stream
   derived from game seed and agent ID. Ambient `Math.random()` is forbidden
   in replayable logic.
5. Agent observations/actions/snapshots are versioned and their structured
   nested data is defensively copied and recursively frozen. Runtime snapshots
   include scheduler deadlines, queued force-replan state, and the complete
   stuck-detector sample window for exact continuation. Three.js consumes
   `AgentSnapshot`; it never infers intent, collision, or outcome from pixels.
6. Checksums cover canonical game state, agent state, and authoritative floor
   frames. They exclude React state, camera, post-processing, GLB pose, and
   other presentation-only data.
7. Cruce Galáctico is the reference slice. It has ordered objectives,
   deterministic moving hazard rectangles, shared lives, timeout, and explicit
   win/failure outcomes without touching the unrelated Suelo Seguro work.

```text
manifest + game definition
          |
          v
GameInstance / 50 Hz fixed-tick harness <--- human, bot, replay, script input
          |                       |
          | snapshots/events      | checksums + replay frames
          v                       v
  agent observation adapter    replay-runtime
          |
          v
 agent-runtime brain -> validated abstract action -> floor input adapter
          |
          v
 AgentSnapshot ----------------> character-runtime -> Three.js renderer
```

## Current canonical state flow

- `packages/game-sdk` owns framework-neutral `GameManifest`, `GameInstance`,
  `GameSnapshot`, floor frames, ready gates, the nominal 50 Hz engine, and the
  seeded RNG.
- `apps/playground/src/gameRegistry.ts` discovers `games/*/src/index.ts` with
  `import.meta.glob`. `App.tsx` creates the real game engine, advances it with
  a frame accumulator, and renders the game-owned `PlayerDisplay` and floor.
- `apps/playground/src/mediaAssets.ts` applies each manifest's deterministic
  preview inputs to the same engine and captures the canonical floor and TV
  surfaces.
- `packages/runner` uses the explicit production registry and JSONL protocol.
  It normalizes config, dispatches floor inputs/ticks, and emits the same
  snapshot/frame plus the game-owned display bundle.
- Venue Go code verifies the pinned bundle revision/digest and supervises the
  Node runner. It forwards input and time; it does not need a third rule
  implementation for canonical TypeScript games.

The SDK engine's `tickTo()` accepts arbitrary absolute milliseconds and calls
one game tick. The new replay/headless harness owns fixed integer cadence
without silently changing the existing runner protocol.

## Existing preview drift

The platform `/games/play` and website `/jugar` previews compile canonical
vendored games, but their local `core/session.ts`, `core/avatar.ts`, and
`core/bots.ts` add a second continuous-avatar simulation. Bots currently inspect
rendered floor colours and use `Math.random()`. Game outcomes still pass through
canonical floor input, but bot intention, movement, and 3D position are not
deterministic or portable.

Platform and website each carry 25 minigame source files; 19 are byte-identical,
including session, bots, avatar movement, the Three.js arena/floor/TV, and both
characters. Those files should consume the canonical runtime packages (or move
to one shared preview package) rather than evolve independently.

## Rule duplication inventory

Generated and immutable copies are expected:

- `platform/app/vendor/motion-levels-games` is generated from the pinned games
  revision and must not be edited.
- `game-bundles/motion-levels-games/<revision>` is an immutable release bundle.

Actual compatibility debt remains in the venue runtime, which still registers
native/Motion Go implementations overlapping ten canonical games: Duelo, Lava,
Memoria v2, Memory Challenge, Patrones, both Ping Pong versions, Saltos,
Tetris, and Whack-a-Mole. New agent/replay logic belongs only in canonical
TypeScript. Native versions remain rollback paths until parity evidence permits
retirement.

## Asset audit and canonical rig

The only third-party 3D binary found is Tung Tung Tung Sahur:

- 269,968-byte processed GLB, SHA-256
  `0107681fe307b9b8200abbfbf711659c6e837c8293f833b3c7fbdc5438fb9d92`;
- one 1,436-triangle skinned mesh, one material, three embedded 512 px WebP
  textures, one 31-joint Mixamo skin;
- one 1.033-second clip, `Armature|walk`;
- KAG3D, Sketchfab source, CC-BY-4.0, commercial use permitted with credit.

Sahur is an audited interim asset, not the canonical skeleton: one walk clip
cannot cover reactions, jumps, interaction, or celebration. The canonical
`motion-athlete-v1` procedural humanoid uses a documented A-pose, +Y up, +Z
forward, metre scale, and 20 required bones. Explorer, Runner, Trickster, and
Guardian share it and differ only in silhouette attachments and palette.

`packages/character-runtime` owns the rig vocabulary, minimum animation
library, interruption/cross-fade graph, in-place interpolation, procedural
head-look/body-lean/blink/emotion signals, quality tiers, performance sampler,
GLB inspector, asset budgets, and the audited Sahur copy/attribution.

## Runtime packages

- `@motion-levels-games/agent-runtime`: contracts, seeded brains, profiles,
  dynamic-cost grid/A*, reservations, explanations, replanning, game-family
  policies, and legacy patrol adaptation.
- `@motion-levels-games/replay-runtime`: canonical JSON/checksums, fixed-tick
  headless execution, input/event/snapshot recording, playback/pause/seek/
  speed, golden verification, ghost tracks, and anonymisation.
- `@motion-levels-games/character-runtime`: presentation-only character state,
  rig/clip/asset validation, animation signalling, interpolation, quality, and
  instrumentation.
- The playground integration owns developer controls and the disposable
  Three.js scene. Cruce owns its observation/input adapter because checkpoint
  and hazard semantics are game-specific.

## Acceptance boundary

- Rendering enabled or disabled cannot change a game result.
- A seed plus action stream must reproduce the same checksum sequence.
- Bot actions must become the same press/release operations as human input.
- The renderer receives positions, facing, action, intention, target, and
  emotion as snapshots; it contains no rule/collision functions.
- Reference bots reserve objectives, avoid predicted hazards, and recover from
  blocked/expired routes.
- `ReplayPlayer.seek()` returns the nearest validated periodic snapshot and the
  ordered input frames needed by consumers with a state-restoration contract.
  Cruce currently replays recorded authoritative inputs from tick zero because
  `GameInstance` has no hydration API; it does not regenerate historical game
  outcomes from pixels or current brain actions, and seeking cannot change the
  final authoritative checksum.
- Headless batches run without WebGL and report completion, duration, score,
  collisions, deadlocks, replans, and route diversity.
- Ten-character work is a renderer/headless stress case. Cruce's booking
  maximum remains four until a separate product decision changes its player
  semantics.

The executable batch thresholds, stored baseline comparison, CI matrix, and
visual-capture contract are documented in `docs/agent-quality-gates.md` and run
through `npm run benchmark:agents`.
