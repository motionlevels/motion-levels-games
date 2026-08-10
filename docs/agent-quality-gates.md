# Deterministic agent quality gates

Status: enforced `cruce-agent-harness-2` reference baseline, 2026-08-10.

These gates turn agent behaviour into a versioned build contract without
making bots authoritative. Cruce Galáctico is the first reference game. Every
simulation runs the real game at 50 fixed ticks per second and submits only
timestamped floor press/release inputs.

## Published-level thresholds

The reference deterministic batch must satisfy all of the following before a
brain, profile, game, or replay version is accepted:

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

Thresholds are code-owned next to the Cruce harness so a pull request changing
them produces a reviewable diff. Every matrix run is evaluated before the
aggregate, preventing a good mean from hiding a bad seed. A failed threshold
is structured data containing the seed, profile, agent count, speed,
difficulty, simulation version, metric, expected bound, and actual value.
Route diversity is aggregated from trajectory signatures across all runs, so
one-agent runs contribute meaningful cross-seed evidence instead of an
automatic diversity score of one.

## Version comparison and alerts

A regression comparison uses the same ordered seed set, game configuration,
profile sequence, tick rate, maximum ticks, and action validator for baseline
and candidate. It reports completion, duration, score, collisions, deadlocks,
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

Fast pull-request checks run the golden seed, renderer parity, replay seek, and
one ten-agent stress scenario. The full workspace test suite runs the
representative seed batch. Browser verification replays the same golden run at
a fixed camera and captures 1920×1080 idle, locomotion/pivot, checkpoint,
hazard-hit, victory/failure, crowding, and ten-character scenes.

The batch and analytics artifacts contain authored, synthetic, or bot
trajectories only. Real player comparisons remain blocked by
`docs/replay-and-agent-data-policy.md` until an approved anonymised dataset is
provided; CI must never silently substitute synthetic fixtures and label them
as human data.
