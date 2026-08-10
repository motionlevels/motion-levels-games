# Deterministic agent quality gates

Status: enforced Duelo product-reference semantic solver gate
(`duelo-semantic-harness-2`) plus Cruce engineering regression
(`cruce-agent-harness-2`), 2026-08-10.

These gates turn agent behaviour into a versioned build contract without
making bots authoritative. Duelo is the named product reference because it is
a tested production game consumed by the existing Jugar 3D `GameSession`.
Every simulation runs the real game at 50 fixed ticks per second and submits
only timestamped floor press/release inputs. Cruce Galáctico remains a useful
headless/replay engineering regression, but it is not a parallel product
runtime or the Jugar 3D reference. The Duelo harness is likewise a semantic
solver/brain quality adapter around the real `GameEngine`, not a product
session. Actual product-session acceptance belongs to
`@motion-levels-games/jugar-3d` tests and browser verification.

## Published-level thresholds

Duelo has two explicitly different dimensions. The accelerated CI solver runs
at 20 tiles/second and covers every 2–8 player count, Medium and Hard, and
three ordered seeds. It provides broad behavioural coverage, not product
motion timing. A separate product-reference parity smoke runs every 2–8 player
count at Jugar 3D's `BOT_SPEED` of 4.8 tiles/second with a longer tick budget.
Together they must satisfy all of the following before a brain, game, or
adapter version is accepted:

- every match completes through the real Duelo win state;
- every player starts with exactly the same target count;
- each run emits exactly one valid winner and every player-count batch has at
  least two winner indices, preventing fixed player-zero arbitration;
- player zero wins no more than half of the complete reference matrix;
- every avatar transition is in bounds, moves no more than one tile per floor
  press, and releases its prior tile before pressing another;
- every final checksum matches the pinned deterministic seed/config baseline;
- ownership-aware paths materially reduce accidental claims of rival targets
  compared with the recorded unweighted-path reference.

The retained Cruce engineering regression must satisfy:

- completion rate at least 90% for the expert solver batch;
- median completion within the game's configured duration;
- no out-of-bounds positions or invalid game inputs;
- zero permanent deadlocks and no agent stuck for more than two replan windows;
- deterministic mismatch count of zero across two identical seeded runs;
- at least two route signatures across the representative multi-seed batch;
- no more than three damaging collisions in the reference demonstration;
- final game snapshot and checksum identical with the renderer attached or
  omitted;
- ten-agent headless stress completes without WebGL and within the CI timeout.

The Duelo checksum matrix is pinned in
`scripts/lib/duelo-agent-baseline.ts`; the Cruce performance baseline remains
in `scripts/lib/cruce-agent-baseline.ts`. Every matrix run is evaluated before
the aggregate, preventing a good mean from hiding a bad seed. Failures are
structured with their game, seed/config identity, metric, expected bound, and
actual value. Cruce route diversity remains aggregated from trajectory
signatures across all runs.

## Version comparison and alerts

Duelo compares every final semantic checksum against the same ordered seed,
difficulty, player-count, speed, tick, real-game, and action-boundary baseline.
An intentional authoritative change must bump the Duelo harness version and
re-record all checksums with a reviewable rationale.

Cruce's regression comparison uses the same ordered seed set, game
configuration, profile sequence, tick rate, maximum ticks, and action
validator. It reports completion, duration, score, collisions, deadlocks,
replans, and route diversity.

The candidate fails when it introduces a deterministic mismatch or permanent
deadlock, drops completion by more than five percentage points, increases mean
completion time or collisions by more than 20%, or collapses route diversity
by more than 25%. An intentional threshold or behaviour change must update the
version label, golden replay, and rationale together.

The pinned v2 baseline lives in `scripts/lib/cruce-agent-baseline.ts` with its
ordered matrix, rationale, and literal simulation version. CI rejects a stale
baseline version rather than silently pairing old values with a new harness.
Relative tolerances are stored as ratios (`0.20` for 20%); completion uses an
absolute `0.05` percentage-point drop.

## CI matrix

`npm run benchmark:agents` first reports Duelo's accelerated solver matrix (42
real matches: 3 seeds × 2 difficulties × 7 player counts), then its seven-run
4.8 tiles/second product-reference parity smoke, and finally Cruce under
`engineeringRegression`. Fast package tests cover the Duelo controller,
external-clock Jugar 3D factory seam, rival-aware waypoints, real input
boundary, product-reference speed determinism, and winner reset. Actual
product-session gates run in `@motion-levels-games/jugar-3d` and the browser.
Browser verification remains owned by Jugar 3D and uses the same game session;
the benchmark creates no renderer or second production clock.

The batch and analytics artifacts contain authored, synthetic, or bot
trajectories only. Real player comparisons remain blocked by
`docs/replay-and-agent-data-policy.md` until an approved privacy-reviewed,
pseudonymised dataset is provided; the replay helper alone is not that
approval. CI must never silently substitute synthetic fixtures and label them
as human data.
