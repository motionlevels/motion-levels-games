# Duelo

Duelo is a deterministic 2–8 player free-for-all color race migrated from the
legacy Motion Go implementation.

## Gameplay

Every player receives a color, a 4×4 perimeter start zone, and an equal number
of colored targets on the floor. Once every player remains in their start zone
through the three-second countdown, the mosaic becomes active.

In the development playground, click one tile in each illuminated start zone
in sequence. Floor clicks remain latched after pointer-up, and Duelo keeps a
two-second release grace, so one person can initialize even the eight-player
layout with a single mouse. Click a latched tile again to release it.

Step on colored tiles to claim them for that color. Claimed tiles flash white
and then dim, while the remaining targets keep a calm pulse. The first player
whose color has no targets left wins. The final standings remain visible during
a five-second winner animation, then the game returns to player readiness
automatically.

Floor input has no player identity, so—as in the original game—claiming a tile
always advances the owner of that tile. The physical challenge is to follow and
clear your own color before the other players clear theirs.

## Player count policy

Duelo intentionally uses a strict player count from 2 through 8. The selected
count changes all of the following:

- number and location of readiness zones
- number of competing colors and player cards
- board target allocation
- the per-player target total

For that reason `0 / Any` is not supported. Every supported count has distinct
readiness and board-generation coverage in the test suite.

## Difficulty and fairness

- Medium assigns approximately 60% of the floor as targets
- Hard assigns approximately 90%

The requested density is rounded down to a multiple of the player count so
every competitor receives exactly the same number of targets. The organic
mosaic is selected deterministically from 18 seeded candidates and penalizes
isolated tiles, dense blocks, and long same-color runs.

The base coverage and Hard multiplier remain internal manifest variables while
the game is tuned. Their defaults, bounds, and steps live only in
`src/manifest.ts` and game logic reads those descriptors through the SDK.

## Player display

The Spanish player display keeps every player in a fixed screen position. Each
card shows the full player name, remaining tiles, claimed/target progress, and
readiness or race status. Two-player games use oversized cards; the layout
adapts through two, three, and four columns for larger rosters without
truncating names. Waiting, countdown, claim, leader, pause, and winner motion
all preserve the same roster positions.

## Semantic agents and Jugar 3D

Duelo exports a renderer-neutral semantic controller from the package root and
from `@motion-levels-games/duelo/session-controller`:

```ts
const controller = createSessionController({
  id: "duelo-bot-1",
  seed: 137,
  playerIndex: 1,
  game: existingDueloGame,
  manifest,
  profile: "mixed"
});

const command = controller.step({
  tick,
  atMillis,
  deltaMillis,
  gameId: "duelo",
  game: existingDueloGame,
  frame,
  snapshot,
  self,
  avatars
});
```

The factory is structurally compatible with Jugar 3D's optional session
controller contract without importing Jugar 3D or any UI package. It never
creates an engine, advances time, moves an avatar, or submits floor input. The
existing product `GameSession` remains the sole clock and game authority; it
applies the returned standard `{ kind: "move", target, path, explanation }`
command through its existing avatar press/release loop. `path` contains the
deterministic waypoints selected by Duelo's ownership-aware A*: still-unclaimed
rival tiles have an added traversal cost because stepping on them helps that
opponent. The optional profile accepts an agent-runtime profile id or `mixed`;
changing it rebuilds controllers for the same seeded session.

For integrations that need the full team/debug result,
`createDueloAgentDirector({ game, playerCount, seed, profile })` owns one
agent-runtime controller per player and exact remaining-target reconciliation.
Call `director.step({ tick, atMillis, snapshot, agents })`; every returned
decision includes its standard action and intention, deterministic orthogonal
reference path, utility explanation, replan state, and runtime snapshot. The
game's `targetOwner(x, y)` and `targetClaimed(x, y)` hooks keep this semantic
view sourced from the real Duelo instance.

`createDueloAgentHarness(options)` is a headless test/reference adapter only.
It runs the real SDK `GameEngine` at 50 Hz and proves that readiness and avatar
steps enter through ordinary press/release calls. It is not a second product
runtime, renderer, replay format, or replacement for Jugar 3D. The broad CI
solver matrix is deliberately accelerated to 20 tiles/second. A separate
2–8-player product-reference parity smoke runs at Jugar 3D's `BOT_SPEED` of
4.8 tiles/second; speed-20 results must never be presented as product timing,
and harness parity must not be presented as Jugar product-session acceptance.

## Replay and synthetic demonstration tooling

Portable replay tooling is intentionally absent from the product root. Import
it only through the explicit game-owned subpaths:

```ts
import {
  recordDueloAgentReplay,
  verifyDueloAgentReplay,
  verifyDueloReplaySeek
} from "@motion-levels-games/duelo/replay";
import {
  CURATED_DUELO_GHOST,
  CURATED_DUELO_GOLDEN_REPLAY_CHECKSUM,
  createCuratedDueloDemonstrationReplay
} from "@motion-levels-games/duelo/demonstration";
```

`recordDueloAgentReplay` wraps the real Duelo semantic harness. Controllers
choose actions, every avatar step crosses the ordinary GameEngine
press/release boundary, and the recorder stores inputs, events, agent samples,
periodic integrity snapshots, per-frame tooling checksums, and game-only
authoritative checksums. `verifyDueloAgentReplay` reconstructs the real game
from the replay header and replays those inputs in their original order.

`verifyDueloReplaySeek` checks the nearest stored snapshot's checksum and the
authoritative checksum at the requested tick. Duelo does not expose safe full
GameEngine hydration, so authority is honestly replayed from tick zero; stored
snapshots are integrity/index anchors, not snapshot-assisted restore points.

The curated demonstration is generated solely by seeded synthetic agents and
exports metadata with `containsHumanData: false`. Its sparse `GhostTrack` is
an exact subset of the generated replay, pinned in tests by agent, tick,
position, facing, action, score, and intention. It is a non-authoritative
rendering handoff. A future Stage integration should accept that standard
track, interpolate the two samples surrounding the presentation tick, and
render a translucent/non-interactive character. It must never feed ghost
positions or actions back into `GameSession` or GameEngine.

## Development

```sh
npm run test --workspace @motion-levels-games/duelo
npm run typecheck --workspace @motion-levels-games/duelo
npm run dev --workspace @motion-levels-games/playground
```

Use either sequential mouse clicks on the interactive floor or the playground
API with physical floor coordinates to occupy every readiness zone, advance
the countdown, and claim deterministic targets. Native 1920×1080 display
captures are required for waiting, starting, running, and finished phases
before publishing material display changes.
