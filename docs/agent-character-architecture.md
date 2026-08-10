# Product agents, replay, and Jugar 3D architecture

Status: implementation baseline, 2026-08-10.

This is the ownership contract for deterministic product agents and 3D game
presentation. Duelo is the first product vertical slice. Cruce Galáctico
remains a useful engineering regression harness, but it is not the production
3D reference and it does not own a second browser session.

## Non-negotiable boundaries

1. `GameInstance` owns rules, collisions, scoring, objectives and results.
2. `@motion-levels-games/jugar-3d` owns the sole production 3D `GameSession`,
   fixed-step clock, continuous avatars and canonical R3F Stage extracted from
   the deployed platform `/jugar` implementation.
3. A product controller consumes an observation supplied by that session and
   returns an action. It never creates, resets or advances a game engine.
4. `GameSession` applies movement and translates avatar occupancy into the same
   timestamped floor press/release input that a human produces.
5. Replayable decisions use the game seed or stable derived streams. Ambient
   randomness and wall/rAF time do not enter authority.
6. `@motion-levels-games/replay-runtime` is the only portable replay schema and
   checksum owner. Jugar may retain exact presentation frames in memory for
   same-page visual seek without inventing another file format.
7. Rendering is presentation-only. Disabling the Stage, seeking a retained
   frame, or changing character quality cannot change a game checksum.

```text
game module
  ├─ createGame(config) ───────────────┐
  ├─ PlayerDisplay                     │
  └─ createSessionController?          │
                                       v
                           Jugar 3D GameSession (one engine, 50 Hz)
                              │                 │
                 observation │                 │ state/frame/events
                              v                 v
                    product controller     canonical R3F Stage + TV
                              │                 │
               action + semantic path          └─ retained presentation frame
                              │
                              └─ avatar movement ──> floor press/release
```

## Shared package ownership

- `packages/game-sdk` owns framework-neutral manifests, game instances, floor
  frames, snapshots, events, engine cadence and seeded RNG.
- `packages/agent-runtime` owns reusable deterministic planning/behavior
  contracts. Games choose which semantics they expose to it.
- `packages/replay-runtime` owns versioned replay JSON, checksums, recorder,
  player, seek cursor, anonymisation and headless verification.
- `packages/character-runtime` remains the framework-neutral character/rig and
  quality vocabulary for consumers that need it.
- `packages/jugar-3d` owns extracted production React/R3F presentation and the
  browser session that connects product controllers to real game authority.
- `apps/playground` wraps that shared package with additive developer controls;
  it does not own another renderer, game engine or bot policy.

The Jugar package peer-depends on the host's React, React DOM, Three, R3F and
Drei versions so platform and website do not load duplicate Three contexts. It
has no bundler-specific `process.env` access. Host-only analytics, model URLs,
game entries and capture/debug options are injected.

## Product controller seam

A supported game exports `createSessionController`. Jugar constructs one
controller per automated avatar with the same session seed and profile; a
game-level director may then derive stable per-player streams and coordinate a
team. Every tick supplies:

- tick, authoritative milliseconds and fixed delta;
- the supplied live `GameInstance`, frame and snapshot;
- immutable self/avatar presentation state.

The returned action may include a target, an ordered semantic path and an
explanation. Jugar follows waypoints continuously at configured bot speed and
does not apply the human arrival-easing curve at every AI target. Human click
movement retains its original easing.

Duelo's controller/director derives remaining targets from renderer-neutral
game semantics such as `targetClaimed`; it never samples rendered floor
colours. Its rival-aware route survives the Jugar boundary through
`action.path`. Deterministic product tests run the real shared session to a
single valid terminal winner for player counts 2–8.

Jugar retains its pre-game ready-zone choreography because it represents the
physical player handshake, not running gameplay policy. Games without an
explicit product controller use a clearly labelled seeded compatibility
controller for legacy Jugar companion roaming. That fallback goes through the
same controller observation/action map; there is no parallel running-bot path.
The playground `Agents 3D` surface remains disabled for those unsupported
games.

## Replay and presentation

`GameSession` advances only complete fixed ticks. rAF partitions do not change
authority, pausing re-anchors the accumulator so resume cannot catch up wall
time, and explicit developer steps work while paused.

During recording the playground retains each exact `SessionTrajectoryFrame`:
engine state, avatars, debug route/explanation, tick, presentation clock and
checksum. Batched stepping records every authority tick but renders only the
last. Replay seek swaps presentation state while parking live authority; exit
restores the live avatars/session exactly.

Character jump, idle, victory and locomotion phases sample
`session.presentationMillis`. Locomotion has no render-history phase/blend
accumulator, so repeated seeks to one recorded tick produce the same pose.
`exportReplay()` uses a `replay-runtime` diagnostic envelope; it does not
contain the authoritative input stream. The larger visual trajectory is
intentionally page-local and is not a second portable schema. Portable Duelo
authority verification is owned by the game-specific `/replay` tooling
subpath, which records the real press/release inputs.

## Canonical Stage and assets

The shared Stage preserves the deployed Jugar camera, arena, LED floor, TV,
Robot and Sahur composition. Sahur remains a credited interim GLB; the Robot
is the dependable procedural/default asset. Capture, coarse-pointer and fit
debug behavior are explicit props rather than environment-global branches.
Every host owns one Canvas/session and disposes through normal React/R3F
lifecycle.

The playground keeps `Floor / Agents 3D` in the standard top bar at all widths.
The switch is always visible, disabled when the selected game has no product
controller, and the active agent surface uses the remaining viewport height.
Path/target overlays and a selected-agent explanation are additive controls on
the same Stage.

## Acceptance evidence

- identical seed and different rAF partitions yield identical state;
- pause/resume has no catch-up and explicit steps are exact;
- restart/dispose rebuild controllers once and preserve a single game engine;
- Duelo controller paths become in-bounds floor input through that engine;
- real Duelo Jugar sessions terminate deterministically for 2–8 players;
- repeated replay seeks retain checksum, avatar state and character pose;
- capture never claims a resolution larger than the real drawing buffer;
- switching back to Floor restores the normal player display/input surface;
- browser captures and reviewed visual baselines use the shared Duelo Stage.

Cruce headless runs continue to exercise generic agent-runtime behavior and
stress metrics. They are engineering coverage only and must not be confused
with the Duelo product-session gate.
