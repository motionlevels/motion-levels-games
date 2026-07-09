# Game Contract

This repo models a Motion Levels game as a small deterministic TypeScript
module.

## Concepts

- **Manifest**: catalog metadata for the game, including id, label, player
  bounds, default duration, configuration schema, and display entry.
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
The SDK-wide default seed is `137`; manifests do not define per-game seed
defaults. Explicit seeds are normalized to the seeded RNG's unsigned 32-bit
domain.

## Manifest-driven configuration

`manifest.config.vars` is the only schema for game options. Every variable has
a required default, and numeric variables may declare their bounds and UI step.
`normalizeGameConfig` fills defaults, coerces values, clamps numeric bounds,
rejects undeclared options, and resolves difficulty against the manifest before
the game receives its configuration. The playground and media generator use
that same SDK path.

Export reusable variable descriptors from `manifest.ts` when game logic needs a
value. Pass the descriptor to `readGameConfigOption` so defaults and ranges are
not repeated in `game.ts`:

```ts
export const gameConfigVars = {
  pointsToWin: {
    key: "points_to_win",
    label: "Points to win",
    type: "int",
    default: 5,
    min: 1,
    max: 21,
    step: 1
  }
} satisfies Record<string, GameConfigVar>;

export const manifest: GameManifest = {
  // ...
  config: { vars: Object.values(gameConfigVars) }
};

const pointsToWin = readGameConfigOption(config.options, gameConfigVars.pointsToWin);
```

Player-count constraints and `allowAny` belong only in `manifest.players`.
Difficulty choices and their default belong only in
`manifest.config.difficulty`.
`defaultGamePlayerCount` supplies `0` for `allowAny` games and `players.min`
for strict games so playground, media, and runtime defaults remain identical.

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

## Player Counts

By default, `manifest.players.min` and `manifest.players.max` describe the
valid player-count range and the SDK clamps incoming counts into that range.
Use `manifest.players.allowAny: true` only for games whose board and gameplay
do not depend on the exact number of real players. In that mode `playerCount: 0`
means "unspecified/any", and positive counts are preserved instead of clamped.

For two-team games such as Ping Pong, `allowAny` is acceptable because the
floor always renders red and blue halves; the player display can keep showing
Rojo and Azul even if the booking has a different number of people. For games
where each person changes targets, scoring, or layout, keep `allowAny` off and
use the actual configured players. The `defaultPlayers(count, players)` helper
uses supplied player names when available and falls back to `Player 1`,
`Player 2`, and so on.

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
