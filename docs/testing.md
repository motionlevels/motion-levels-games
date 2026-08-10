# Testing And CI

The repository uses several small verification layers instead of one opaque
job. Keep each layer focused so failures point to the relevant contract.

## Local Commands

- `npm run check:fast`: lint and strict TypeScript checks for the edit loop.
- `npm test`: workspace unit and behavioral tests.
- `npm run test:contracts`: dynamically discovers every game and verifies its
  exports, manifest-derived configurations, deterministic init/tick/reset,
  16x32 frame integrity, snapshot/event invariants, display rendering, and
  shared paused-TV behavior. It also checks package boundaries, the floor
  visual-state invariant, and the CI workflow topology.
- `npm run test:coverage`: runs separate thresholded coverage suites for the
  game SDK, display kit, and all game packages. Thresholds stay package-scoped
  so a well-tested game cannot hide a weak shared library.
- `npm run test:all`: workspace tests, repository contracts, and the generated
  game scaffold smoke test.
- `npm run playtest:browser`: exercises the built playground with a real
  browser, including Ping Pong initialization through the interactive floor's
  tile seams and Duelo initialization at four and eight players through
  sequential single-mouse floor clicks. The Duelo Jugar 3D portion additionally
  verifies the product controller in the shared `GameSession`, exact retained
  replay seek/restore, and representative native 1920×1080 frames against the
  checked-in visual baselines. It also waits for and enforces the shared
  desktop-medium and capture performance budgets: structural renderer totals
  always hard-fail, while SwiftShader uses its separately published timing
  ceiling and emits the non-certification caveat. Run `npm run build` first.
- `npm run check`: the complete local gate: quality checks, all tests, build,
  and deterministic playtests.

Do not replace behavioral tests with source-text assertions when the behavior
can be exercised through an exported function or rendered component. Source
contracts remain appropriate for CSS rules and workflow wiring that do not
have a runtime API in this repository.

Package-boundary tests enforce dependency direction, not implementation size:
the SDK stays framework-agnostic, the display kit may depend only on the SDK,
games may depend only on shared packages, and the playground discovers games
without importing individual game packages. Avoid line-count gates and broad
snapshots; extract cohesive ownership and test its public behavior instead.

## Jugar 3D visual baselines

`test/visual-baselines/jugar-3d` owns reviewed Duelo opening-replay and terminal
victory captures from the canonical shared Stage. The browser gate requires a
real 1920×1080 drawing buffer, decodes both images, downsizes them to 240×135,
and compares RGB values with the reviewed tolerance in
`scripts/lib/visual-regression.ts`. Downsampling and a small channel threshold
absorb GPU edge-rasterisation differences; missing characters, a black floor,
wrong cameras, large pose changes, and layout regressions still fail CI with
the expected and actual ratios.

Update baselines only after opening and reviewing every native capture:

```sh
npm run build
MOTION_LEVELS_GAMES_PLAYTEST_GAME=duelo \
MOTION_LEVELS_GAMES_UPDATE_VISUAL_BASELINES=1 \
npm run playtest:browser
```

Never update baselines merely to make a failure green. An intentional visual
change must include the new PNGs and a short rationale in the implementation
note or pull request. `test/visual-regression.test.ts` proves both the accepted
rasterisation-drift path and the structural-failure alert path.

## Coverage Floors

Coverage is a regression floor, not a target to game. Current minimums are:

| Surface | Lines | Functions | Branches |
| --- | ---: | ---: | ---: |
| Game SDK | 90% | 90% | 80% |
| Display kit | 75% | 60% | 70% |
| Games | 85% | 80% | 80% |

Raise a floor when durable behavioral tests increase the baseline. Do not lower
one to land an unrelated change without documenting the uncovered behavior.

## GitHub Actions

`ci.yml` and `dev-games.yml` call the same reusable `checks.yml` workflow. This
prevents the main and authoring branches from drifting apart. The reusable
workflow runs four independent jobs:

1. lint, manifest validation, and TypeScript;
2. the full test set on Node 22 for compatibility;
3. repository contracts and thresholded coverage on Node 24;
4. the production build, deterministic engine playtests, and a real-browser
   playground interaction playtest on Node 24, with the playground build
   uploaded for inspection.

Caller workflows use concurrency cancellation so obsolete commits stop
consuming CI time. Every job has a timeout and read-only repository permission.
The `dev` caller retains its additional ancestry check before shared CI runs.
