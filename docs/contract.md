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
  snapshot and optional frame, then renders the display using generic
  primitives from `@motion-levels-games/display-kit`. Runners supply shared TV
  state around it with `PlayerDisplayRuntimeProvider`.

## Runtime Boundary

The SDK is framework-agnostic and has no platform, database, hardware, Go, or
WASM dependency. A production integration can later adapt `Frame`, input events,
and `GameSnapshot` to the existing Motion Levels runtime surfaces.

The shared TypeScript engine lives in `@motion-levels-games/game-sdk`. Its
baseline is 50fps (`DEFAULT_ENGINE_FPS`), matching the production floor engine,
and playground/platform runners should
advance games through that engine instead of owning separate timing semantics.
The SDK-wide default seed is `137`; manifests do not define per-game seed
defaults. Explicit seeds are normalized to the seeded RNG's unsigned 32-bit
domain.

Runners treat pause as a hard player-input boundary. They must not forward
press, release, or tap events while paused, and must release any already-held
inputs when entering pause so readiness zones and controls cannot stick after
resume. A development runner may expose explicit deterministic stepping while
paused, but stepping must only evolve the state established before pause and
must not apply blocked player input.

Pause is runtime state, not a game phase transition. A runner wraps the game
display with `PlayerDisplayRuntimeProvider` and passes its effective pause state
once. Every `GameDisplayShell` below that provider automatically replaces its
normal Spanish phase label with `En pausa` while leaving the snapshot unchanged,
so scores, rounds, readiness, and game-specific content remain stable. Games
must not manually thread or recreate the runner's pause state.

The interactive playground floor models occupied physical tiles. Starting a
mouse or touch drag on an empty tile presses every crossed tile; starting on an
occupied tile releases every crossed tile. Those inputs remain active after
pointer-up so one gesture can represent several simultaneous players, but they
do not add persistent tile decoration: the rendered game frame remains the
only persistent floor visual. `aria-pressed` exposes occupancy semantically
without CSS styling. Pausing or restarting clears all occupied preview tiles.

## Manifest-driven configuration

`manifest.config.vars` is the only schema for game options. Every variable has
a required default and a required `playerFacing` boolean. The playground shows
all variables and labels each one as player-facing or internal; production
player menus expose only variables whose `playerFacing` value is `true`.
Numeric variables may declare their bounds and UI step.
`normalizeGameConfig` fills defaults, coerces values, clamps numeric bounds,
rejects undeclared options, and resolves difficulty against the manifest before
the game receives its configuration. The playground and media generator use
that same SDK path.

Values likely to change during gameplay tuning—such as speed, spawn pressure,
or transition duration—should begin as manifest variables rather than hidden
constants. Once playtesting settles them, either retain the supported option,
set `playerFacing: false` to keep an operator-only control, or hardcode the
chosen value and remove the variable entirely.

Export reusable variable descriptors from `manifest.ts` when game logic needs a
value. Pass the descriptor to `readGameConfigOption` so defaults and ranges are
not repeated in `game.ts`:

```ts
export const gameConfigVars = {
  pointsToWin: {
    key: "points_to_win",
    label: "Points to win",
    playerFacing: true,
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

Large authored documents such as editable level catalogs travel through
`GameConfig.content`, not `options`. Content must carry a versioned `schema`;
the host supplies it before construction and the game validates its complete
shape before using it. The engine stays deterministic and performs no network
I/O. `options` remains reserved for the small manifest-declared controls shown
to players/operators.

Player-count constraints and `allowAny` belong only in `manifest.players`.
Difficulty choices and their default belong only in
`manifest.config.difficulty`.
`defaultGamePlayerCount` supplies `0` for `allowAny` games and `players.min`
for strict games so playground, media, and runtime defaults remain identical.
`gamePlayerCountOptions` and `gameDifficultyOptions` produce the exact selector
choices from those manifest declarations.

Every manifest also owns three pieces of production-facing metadata:

- `availability.development` and `availability.production` decide whether a
  game may enter the development or production bundle catalog.
- `catalog` contains intrinsic category, color, duration/mode/audio labels, and
  rules. Platform-owned visibility, featured state, ordering, narration, and
  usage statistics are deliberately not part of the game manifest.
- `preview` is a deterministic seed, configuration, input timeline, and capture
  window used to generate the catalog thumbnail, animation, and player-display
  capture. CI never substitutes a generic preview script.

The published bundle keeps the game contract's camelCase `playerFacing` field.
Platform importers map it to any storage-specific naming at their boundary;
the games contract does not expose database-shaped `player_facing` fields.

## Expected Game Shape

Every game should keep a single source of truth:

- `README.md`
- `manifest.ts`
- `game.ts`
- `display.tsx`
- `fixtures.ts`

Every new game has an immutable UUID or content-addressed hash in `manifest.id`.
The human-readable `manifest.slug` matches `games/<slug>` and the package name
`@motion-levels-games/<slug>`. Slugs may be renamed; retain previous names in
`manifest.aliases`. The runner resolves the canonical id and every declared
alias, and CI rejects alias collisions. Older packages without `manifest.slug`
keep their legacy id until they receive an explicit identity migration.

The game logic should be deterministic. Use `createSeededRng(seed)` from the SDK
for randomness so tests, fixtures, and local playback can be reproduced.

## Shared Effects And Animation

Reusable floor-effect geometry lives in `@motion-levels-games/game-sdk/effects`.
These helpers mutate a provided frame using explicit deterministic inputs such
as an engine-derived step; they do not own clocks, game phases, palettes, or
win conditions. `paintDiamondRing` is the shared readiness/target-ring
primitive, while `paintDiamondWave` provides expanding celebration bands with
either a fixed color or a per-cell color callback.

Keep game-specific choreography inside the game and compose these primitives
instead of building a generic animation state machine. Reusable TV components
and CSS motion belong in `packages/display-kit`; a display-only effect tied to
one game remains namespaced to that game until a second real use case appears.

## Lives

A game that uses lives reports both the current `lives` and its `maxLives` in
the snapshot. Player displays render them with the shared `LivesMeter` from
`@motion-levels-games/display-kit`: every available life is a solid red heart,
and every lost life remains visible as the same solid heart shape in muted
gray. Do not use outline hearts, green hearts, text-built heart strings, or
game-specific life palettes. Games without a lives mechanic keep `lives: -1`;
the field must never carry remaining points, rounds, or other progress.

Keep the total slot count stable while lives are lost so players can read both
remaining and lost lives at a glance. Fixtures and tests must cover full,
partially depleted, and zero-life states, and browser verification must inspect
the native player display for clipping or wrapping in each state. `LivesMeter`
also owns the shared calm pulse and the lost/regained life transitions; games
must not recreate or override that motion locally.

## Distance Readability

The TV is read from across the venue, not at desktop distance. Primary values
such as score, round/progress, lives, and time should use the largest type that
fits their containers for the widest expected value. Do not leave a small
number floating inside a large metric card; use that space to increase the
critical information's scale.

Labels, instructions, decorative previews, and secondary details remain
subordinate to live metrics. Prefer the shared primary metric layouts in
`@motion-levels-games/display-kit`, then visually inspect native 1920x1080 and
scaled-playground captures with both typical and maximum-width values. Reduce
type only when the realistic worst case would clip, collide, or wrap badly.

## Player Counts

Every manifest explicitly declares `players.allowAny`. The authoring default is
`true` whenever the board, readiness zones, rules, and scoring do not depend on
the configured group size. In that mode `playerCount: 0` means
"unspecified/any", so a larger group can keep its booking intact and rotate
through a turn-based game. Positive counts are still clamped into the declared
`min`–`max` range, so `allowAny` adds one choice rather than disabling the
manifest constraint.

Use `allowAny: false` only when the exact count materially changes per-player
zones, targets, turns, scoring, teams, or board layout. Document why the count
matters and test every supported value. Any mode still uses the game's physical
player-readiness zones; it does not permit autoplay without players present.

For two-team games such as Ping Pong, `allowAny` is acceptable because the
floor always renders red and blue halves; the player display can keep showing
Rojo and Azul even if the booking has a different number of people. For games
where each person changes targets, scoring, or layout, keep `allowAny` off and
use the actual configured players. The `defaultPlayers(count, players)` helper
uses supplied player names when available and falls back to `Player 1`,
`Player 2`, and so on.

## Player Readiness and Start Policy

Every manifest must declare one start policy:

```ts
start: { mode: "player-ready" }
```

`player-ready` is the normal policy. The game starts in `waiting`, maps the
required players or teams to explicit floor zones, and feeds press/release
events to `createPlayerReadyGate`. Once every zone is occupied, the gate enters
`starting` for the shared two-second countdown. It enters `running` only if all
required zones stay occupied through the release-grace window. Gameplay timers,
targets, and scoring begin at that transition, never during selection or
initialization.

Use `createHorizontalPlayerReadyZones(count)` for evenly divided floor zones,
or pass game-specific rectangular zones such as an Arkanoid control area. The
snapshot must report `readyPlayers`, `requiredPlayers`, and `countdownMillis` so
the display and external runners can explain the transition. Standard displays
should render `PlayerReadyOverlay`; bespoke versus displays may provide an
equivalent waiting/countdown treatment.

Multiplayer `player-ready` manifests must declare `releaseGraceMillis` from
1,000 through 2,000 milliseconds. In the development playground, latched floor
occupancy must let one person click each readiness zone sequentially with one
mouse, including at the manifest's maximum player count. Browser coverage must
exercise those real interactive-floor clicks instead of proving initialization
only through simultaneous playground API presses.

An immediate start is deliberately noisy and must be explicit:

```ts
start: { mode: "immediate" }
```

Use it only when the game specification explicitly requires autoplay on
selection. The validator rejects missing or malformed start policies, and the
scaffold generates the player-ready lifecycle by default.

## Round And Game Win Transitions

Every game must end with a deliberate game-win animation on both the floor and
player display. A round-based game must also pause between rounds for a shorter,
distinct round-win animation. The transition should identify the winning
player or team, keep the completed score visible, and be unmistakable from
normal play, readiness, or the next start countdown.

Model celebrations as deterministic timed game states. Ignore scoring input
during the transition, retain the completed result in the snapshot, and only
advance the round or reset after the animation duration has elapsed. Tests and
fixtures must exercise representative frames from the round-win transition
when applicable and the final game-win transition for every game. Browser
verification must inspect captures of both the floor and native 1920x1080
player display while each celebration is active.

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
Preserve the scaffolded waiting and starting states when replacing its example
gameplay; define intentional player-detection zones before adding running-state
logic. Implement a game-win animation before considering the scaffolded game
complete, and add a separate round-win animation if the game introduces rounds.
If the game uses lives, expose `maxLives` and use the shared `LivesMeter`
instead of implementing heart markup or colors inside the game.
The scaffold enables `0 / Any` by default. Keep it unless the implemented game
materially changes its board or rules by configured player count.

Before a new game is considered complete, run it in the browser and visually
inspect native 1920x1080 player-display captures. Review every supported main
phase with representative worst-case content, including long labels and player
names, maximum-width scores and timers, dense status/event text, and the final
result. Text must remain inside its container, wrap on whole words when needed,
and preserve a clear visual hierarchy. Ellipses, clipping, collisions,
mid-word breaks, and text that is disproportionately large or small must be
fixed before handoff. Automated tests and capture-size checks do not replace
viewing the rendered images.
