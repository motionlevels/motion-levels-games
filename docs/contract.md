# Game Contract

This repo models a Motion Levels game as a small deterministic TypeScript
module.

## Concepts

- **Manifest**: catalog metadata for the game, including id, label, player
  bounds, default duration, default seed, and display entry.
- **Frame**: a 16 x 32 tile RGB/hex frame. This maps to the current Motion
  Levels floor concept.
- **Press/release events**: floor input events with tile coordinates and a
  monotonic timestamp. The playground sends pointer events through this same
  path.
- **Snapshot**: display-friendly status. It intentionally resembles the current
  player display shape: phase, score, lives, elapsed/remaining time, active
  targets, players, success, and event cue/message.
- **PlayerDisplay**: React component owned by each game. It receives the
  snapshot and optional frame, then renders the display using generic primitives
  from `@motion-levels-games/display-kit`.

## Runtime Boundary

The SDK is framework-agnostic and has no platform, database, hardware, Go, or
WASM dependency. A production integration can later adapt `Frame`, input events,
and `GameSnapshot` to the existing Motion Levels runtime surfaces.

## Expected Game Shape

Every game should keep a single source of truth:

- `manifest.ts`
- `game.ts`
- `display.tsx`
- `fixtures.ts`

The game logic should be deterministic. Use `createSeededRng(seed)` from the SDK
for randomness so tests, fixtures, and local playback can be reproduced.

