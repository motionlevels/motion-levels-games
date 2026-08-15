# Replay and agent trajectory data policy

Status: required before retaining any real-player trajectory.

## Default

Do not persist real-player trajectories by default. Fixed replays used in the
repository and CI are authored, synthetic, or explicitly curated fixtures.
They must not be described as human data.

The access-controlled operational session replay
`motion-levels-run-replay-v1` is a separate product record governed by the
venue/platform session retention policy. It contains exact floor RGB and
pressure observations and operational timestamps so authorized staff can play
back a visit. It is not an anonymized trajectory, training export, public
ghost, or repository fixture. Before any such artifact leaves that operational
boundary, this document's collection gate and privacy transformation apply.

## Collection gate

Before enabling real-session retention, document all of the following in the
product/privacy surface that owns collection:

- purpose (debugging, tutorial ghost, aggregate balancing, or approved model
  fitting);
- venue/operator notice and lawful basis;
- retention duration and deletion process;
- access controls and approved export destinations;
- whether a session may appear publicly as a ghost;
- a stable schema/brain/game version and consent-policy version.

Do not record video, audio, names, account identifiers, free-form text,
precise wall-clock time, or raw device identifiers in the replay format.

## Required privacy transformation

Before a replay leaves its short-lived operational boundary:

1. replace source and agent IDs with salted, dataset-local aliases;
2. drop `startedAt` unless incident reproduction has an approved need;
3. retain only allow-listed agent-state fields;
4. quantize to logical tile/tick state—never camera-derived body tracking;
5. remove small cohorts and rare metadata that could re-identify a session;
6. rotate salts between exports so aliases cannot be joined across datasets;
7. store the policy version and destructive retention deadline beside the
   dataset, outside the public replay itself.

Despite its compatibility name, `anonymizeReplay()` performs deterministic
dataset-local **pseudonymisation**, not complete anonymisation: its aliases are
stable within one salt and are not a cryptographic identity boundary. It
enforces only items 1–3 for a deliberately destructive trajectory export. It
removes periodic snapshots, state-derived checksums, header initial state,
arbitrary frame action payloads, and event messages; header configuration is
dropped except for explicitly reviewed scalar keys. Agent sample actions and
allow-listed state values remain game-defined data and require schema review.

The helper's output is not independently suitable for release or human-data
analysis. The owning service must still apply items 4–7, review every retained
field, enforce small-cohort protections and retention, and complete the
collection gate above. The result is intentionally not a playable replay.

## Allowed repository fixtures

- deterministic bot runs;
- manually authored action streams;
- synthetic human-like trajectories labelled `synthetic`;
- real trajectories only after the collection gate, with a provenance record
  that contains no player identity.

## Learned policies

Training/fitting is offline. A learned route-choice policy may rank validated
abstract actions, but it cannot own collision, score, damage, completion, or
safety. Every policy artifact has a version, source-dataset policy version,
evaluation report against deterministic rule-based baselines, and an immediate
fallback to the rule-based brain.
