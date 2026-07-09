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

The shared TypeScript engine lives in `@motion-levels-games/game-sdk`. Its
baseline is 30fps (`DEFAULT_ENGINE_FPS`), and playground/platform runners should
advance games through that engine instead of owning separate timing semantics.

## Expected Game Shape

Every game should keep a single source of truth:

- `README.md`
- `manifest.ts`
- `game.ts`
- `display.tsx`
- `fixtures.ts`

The directory name is part of the contract. For a game in `games/<id>`,
`manifest.id` must exactly equal `<id>`, and the package name must be
`@motion-levels-games/<id>`. CI enforces this through `npm run validate:games`.

The game logic should be deterministic. Use `createSeededRng(seed)` from the SDK
for randomness so tests, fixtures, and local playback can be reproduced.

## Creating Games

Use the scaffold command instead of copying another game by hand:

```sh
npm run create:game -- color-chase "Color Chase"
```

The scaffold creates the package, manifest, game logic, player display,
fixtures, tests, and README. The playground discovers games from
`games/*/src/index.ts`, so new games should appear in the selector automatically
while the Vite dev server is running. Run `npm install` before committing so the
workspace lockfile knows about the new package, then run `npm run check`.
