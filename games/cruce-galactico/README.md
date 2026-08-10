# Cruce Galáctico

Cross the 16×32 floor from the blue launch platform to the portal at the far end. Four bands of deterministic horizontal traffic separate the checkpoints. Reaching a green checkpoint advances the mission; touching a red obstacle costs one of three lives.

The game supports `0 / Any` and one to four configured players because group size does not alter the board, readiness zone, shared progress, or rules. Difficulty changes traffic speed. The run ends after four checkpoints, zero lives, or 75 seconds.

## Deterministic agents and headless simulation

`createCruceAgentHarness` wraps the real `createGame` instance and shared
`GameEngine` at 50 Hz. Logical agent count is independent of the manifest's
one-to-four configured-player limit.

```ts
import { createCruceAgentHarness } from "@motion-levels-games/cruce-galactico/agents";

const harness = createCruceAgentHarness({
  seed: 424242,
  profile: "expert", // preset, "mixed", or a preset array
  agentCount: 10,    // 1..10
  speed: 3,          // 0.25..4 tiles/second
  difficulty: "medium"
});

const frame = harness.step(5);
frame.state;              // authoritative GameEngineState
frame.agents;             // character-renderer-compatible snapshots
frame.debug.paths;        // renderer debug paths
frame.debug.reservations; // renderer debug reservations
frame.debug.targets;      // renderer debug targets
frame.metrics;            // live score, damage, deadlocks, replans, diversity

harness.run();
const replay = harness.finishReplay();
harness.restart({ seed: 7 });
```

Every movement releases the old tile on departure and presses the new tile on
arrival, exactly like human floor input. Between those
authoritative tile boundaries the presentation position advances linearly at
the configured tiles-per-second rate; its velocity is derived from actual
fixed-tick displacement so locomotion cadence cannot drift into foot sliding.
Ordered checkpoint slots and the current traffic rectangles are versioned
observations; the shared objective/hazard brain uses expiring reservations and
time-aware A* costs.

`runCruceHeadless` returns a completed frame, replay, solver metrics, and a
threshold evaluation. `runCruceHeadlessBatch` evaluates seed/profile/count/
speed matrices. `compareCruceSolverMetrics` reports regressions across
completion rate, duration, score, collisions, damage, deadlocks, replans, and
route diversity.

The curated replay fixture is produced by
`createCuratedCruceDemonstrationReplay`; `CURATED_CRUCE_GHOST` is its small
authored preview alternative, and `CURATED_CRUCE_GOLDEN_CHECKSUM` protects the
accepted authoritative result. `verifyCruceAgentReplay` and
`verifyCruceReplaySeek` replay the recorded floor inputs through a fresh game,
compare game-owned frame/snapshot checksums, and separately validate periodic
snapshot integrity; they do not ask the current brain to recreate old inputs.

```sh
npm run test --workspace @motion-levels-games/cruce-galactico
npm run typecheck --workspace @motion-levels-games/cruce-galactico
```
