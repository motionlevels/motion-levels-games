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
