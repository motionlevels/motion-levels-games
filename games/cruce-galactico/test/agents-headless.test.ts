import assert from "node:assert/strict";
import test from "node:test";
import {
  CRUCE_AGENT_TICK_RATE,
  CRUCE_AGENT_SIMULATION_VERSION,
  checkpointObjectives,
  createCruceAgentHarness,
  observationHazards,
  predictedHazardCost,
  routeDiversityFromSignatures,
  type CruceAgentEmotion,
  type CruceRenderableAgent,
} from "../src/agents.ts";
import {
  CURATED_CRUCE_GHOST,
  CURATED_CRUCE_GOLDEN_CHECKSUM,
  createCuratedCruceDemonstrationReplay
} from "../src/agent-fixtures.ts";
import {
  compareCruceSolverMetrics,
  regressionIdentity,
  runCruceHeadless,
  runCruceHeadlessBatch,
  type CruceRegressionIdentity,
  type CruceRunIdentity,
  type CruceSolverMetrics
} from "../src/headless.ts";
import { manifest } from "../src/manifest.ts";
import {
  cruceGhostTrack,
  cruceReplayFinalChecksum,
  verifyCruceAgentReplay,
  verifyCruceReplaySeek
} from "../src/replay.ts";

const deterministicOptions = {
  seed: 424_242,
  profile: "expert" as const,
  agentCount: 3,
  speed: 3,
  difficulty: "medium" as const
};

test("50 Hz harness wraps the real engine and exposes an onFrame-friendly contract", () => {
  const harness = createCruceAgentHarness(deterministicOptions);
  assert.equal(harness.engine.fps, CRUCE_AGENT_TICK_RATE);
  assert.equal(harness.engine.frameMillis, 20);
  assert.equal(harness.state.snapshot.currentGame, manifest.id);
  assert.equal(harness.frame.tick, 0);
  assert.equal(harness.frame.atMillis, 0);
  assert.equal(harness.frame.debug.paths.length, 3);
  assert.equal(harness.frame.metrics.completed, false);
  assert.equal(manifest.players.max, 4, "logical bot count must not alter the booking manifest");

  const frame = harness.step(2);
  assert.equal(frame.tick, 2);
  assert.equal(frame.atMillis, 40);
  assert.equal(frame.state, harness.state);
  assert.equal(frame.agents.length, 3);
  assert.equal(frame.replay.frame.tick, 2);
  assert.match(frame.replay.checksum, /^[0-9a-f]{8}$/);

  const initialChecksum = harness.replay.frames[0]?.checksum;
  harness.step(5);
  const restarted = harness.restart(deterministicOptions);
  assert.equal(restarted.tick, 0);
  assert.equal(restarted.replay.checksum, initialChecksum);
  assert.deepEqual(harness.reset(deterministicOptions), harness.frame);
  assert.throws(() => harness.step(0), /positive integer/);
});

test("renderer attachment and mutation of presentation copies cannot change authority", () => {
  let rendered = 0;
  const withoutRenderer = createCruceAgentHarness(deterministicOptions);
  const withRenderer = createCruceAgentHarness({
    ...deterministicOptions,
    onRender(frame) {
      rendered += 1;
      const first = frame.cells[0];
      if (first !== undefined) first.color = "#ff00ff";
    }
  });
  withoutRenderer.run(500);
  withRenderer.run(500);

  assert.ok(rendered > 1);
  assert.deepEqual(
    withRenderer.replay.frames.map((frame) => frame.checksum),
    withoutRenderer.replay.frames.map((frame) => frame.checksum)
  );
  assert.deepEqual(withRenderer.state.snapshot, withoutRenderer.state.snapshot);
});

test("same seed reproduces checksums and every bot move crosses press/release input boundaries", () => {
  const first = createCruceAgentHarness(deterministicOptions);
  const second = createCruceAgentHarness(deterministicOptions);
  first.run(500);
  second.run(500);
  const firstReplay = first.finishReplay();
  const secondReplay = second.finishReplay();
  assert.deepEqual(
    firstReplay.frames.map((frame) => frame.checksum),
    secondReplay.frames.map((frame) => frame.checksum)
  );

  const inputs = firstReplay.frames.flatMap((frame) => frame.inputs);
  assert.ok(inputs.some((input) => input.kind === "press"));
  assert.ok(inputs.some((input) => input.kind === "release"));
  assert.ok(inputs.every((input) => input.kind === "press" || input.kind === "release"));
  assert.ok(inputs.every((input) => input.sourceId?.startsWith("cruce-agent-") === true));
  assert.ok(firstReplay.frames.some((frame) => frame.actions.length > 0));
  assert.ok(firstReplay.frames.every((frame) => frame.agents?.length === deterministicOptions.agentCount));
});

test("render snapshots are directly character-renderer compatible", () => {
  const harness = createCruceAgentHarness({ ...deterministicOptions, agentCount: 1 });
  let moving: CruceRenderableAgent | undefined;
  for (let tick = 0; tick < 200 && moving === undefined; tick += 1) {
    const frame = harness.step();
    moving = frame.agents.find((agent) => agent.velocity.x !== 0 || agent.velocity.y !== 0);
  }
  assert.ok(moving !== undefined);
  assert.equal(moving.tick, harness.frame.tick);
  assert.equal(moving.atMillis, harness.frame.atMillis);
  assert.equal(moving.grounded, true);
  assert.equal(moving.variant, "runner");
  assert.notEqual(moving.intention, "");
  assert.ok(["neutral", "happy", "afraid", "frustrated", "excited"].includes(moving.emotion));
  assert.ok(Math.abs(Math.hypot(moving.velocity.x, moving.velocity.y) - deterministicOptions.speed) < 1e-10);
  if (moving.velocity.y < 0 && moving.velocity.x === 0) {
    assert.ok(Math.abs(Math.abs(moving.facingRadians) - Math.PI) < 1e-12);
  }
  assert.ok(moving.debug.path.length > 0);
  assert.ok(moving.debug.explanation.length > 0);
  assert.equal(typeof moving.debug.replans, "number");
  const emotion: CruceAgentEmotion = moving.emotion;
  assert.equal(typeof emotion, "string");
});

test("configured tiles-per-second is monotonic and presentation velocity matches displacement", () => {
  const speeds = [0.5, 1, 2, 4] as const;
  const firstArrivalTicks: number[] = [];

  for (const speed of speeds) {
    const harness = createCruceAgentHarness({
      ...deterministicOptions,
      agentCount: 1,
      speed
    });
    let previous = harness.frame.agents[0]!.position;
    let travelled = 0;
    let firstArrivalTick: number | undefined;
    const movementInputs: string[] = [];

    for (let tick = 0; tick < 400 && firstArrivalTick === undefined; tick += 1) {
      const frame = harness.step();
      const agent = frame.agents[0]!;
      const delta = {
        x: agent.position.x - previous.x,
        y: agent.position.y - previous.y
      };
      const displacement = Math.hypot(delta.x, delta.y);
      travelled += displacement;
      assert.ok(displacement <= speed / CRUCE_AGENT_TICK_RATE + 1e-12, `speed ${speed} exceeded its per-tick distance`);
      assert.ok(Math.abs(agent.velocity.x - delta.x * CRUCE_AGENT_TICK_RATE) < 1e-10);
      assert.ok(Math.abs(agent.velocity.y - delta.y * CRUCE_AGENT_TICK_RATE) < 1e-10);
      movementInputs.push(...frame.replay.frame.inputs
        .filter((input) => input.sourceId === agent.id)
        .map((input) => input.kind));
      if (frame.replay.frame.inputs.some((input) => input.sourceId === agent.id && input.kind === "press")) {
        assert.deepEqual(movementInputs, ["release", "press"],
          "a move must leave and enter tiles through the same ordered boundaries as a human");
        firstArrivalTick = frame.tick;
      }
      previous = agent.position;
    }

    assert.ok(firstArrivalTick !== undefined, `speed ${speed} must reach its first tile`);
    assert.ok(Math.abs(travelled - 1) < 1e-10, `speed ${speed} must interpolate exactly one tile before arrival`);
    firstArrivalTicks.push(firstArrivalTick);
  }

  assert.ok(firstArrivalTicks.every((tick, index) => index === 0 || tick < firstArrivalTicks[index - 1]!),
    `higher configured speeds must arrive sooner: ${firstArrivalTicks.join(", ")}`);
});

test("checkpoint observations are ordered and current hazard rectangles become predictive costs", () => {
  const first = checkpointObjectives(0);
  const second = checkpointObjectives(1);
  assert.equal(first.length, 16);
  assert.equal(first[0]?.position.y, 23);
  assert.equal(second[0]?.position.y, 16);
  assert.match(first[0]?.id ?? "", /^checkpoint:0:/);
  assert.match(second[0]?.id ?? "", /^checkpoint:1:/);
  assert.deepEqual(checkpointObjectives(4), []);

  const rectangles = [{ x: 2, y: 24, width: 3, height: 3 }];
  const hazards = observationHazards(rectangles, "medium", 1_234);
  assert.equal(hazards.length, 1);
  assert.equal(hazards[0]?.positionAtMillis, 1_234);
  assert.ok((hazards[0]?.velocity?.x ?? 0) > 0);
  assert.equal(predictedHazardCost({ x: 2, y: 24 }, 0, 0, rectangles, "medium"), 250);
  assert.equal(predictedHazardCost({ x: 3, y: 24 }, 480, 0, rectangles, "medium"), 250);
  assert.equal(predictedHazardCost({ x: 10, y: 24 }, 0, 0, rectangles, "medium"), 0);
});

test("curated golden replay verifies checksums, seek, samples, and ghost extraction", () => {
  const replay = createCuratedCruceDemonstrationReplay();
  assert.equal(replay.header.simulationVersion, CRUCE_AGENT_SIMULATION_VERSION);
  assert.equal(cruceReplayFinalChecksum(replay), CURATED_CRUCE_GOLDEN_CHECKSUM);
  const verification = verifyCruceAgentReplay(replay);
  assert.equal(verification.valid, true);
  assert.equal(verification.verifiedFrames, replay.frames.length);
  const seek = verifyCruceReplaySeek(replay, 125);
  assert.equal(seek.valid, true);
  assert.equal(seek.resolvedTick, 125);
  assert.equal(seek.snapshotChecksumValid, true);
  assert.ok((seek.snapshotTick ?? 126) <= 125);

  const agentId = replay.frames[0]?.agents?.[0]?.id;
  assert.ok(agentId !== undefined);
  assert.equal(cruceGhostTrack(replay, agentId).samples.length, replay.frames.length);
  assert.equal(CURATED_CRUCE_GHOST.agentId, "curated-pilot");
  assert.ok(CURATED_CRUCE_GHOST.samples.length >= 4);
});

test("headless solver reports thresholds and ten-agent stress stays distributed and bounded", () => {
  const result = runCruceHeadless({
    seed: 2_026,
    profile: "expert",
    agentCount: 10,
    speed: 3,
    maxTicks: 1_500
  });
  assert.equal(result.metrics.completionRate, 1);
  assert.equal(result.metrics.score, 4);
  assert.ok(result.metrics.durationMillis > 0);
  assert.ok(result.metrics.collisions >= 0);
  assert.equal(result.metrics.damage, result.metrics.collisions);
  assert.equal(result.metrics.deadlocks, 0);
  assert.ok(result.metrics.replans > 0);
  assert.ok(result.metrics.routeDiversity >= 0.5);
  assert.equal(result.thresholds.passed, true);
  assert.equal(result.frame.agents.length, 10);
  assert.equal(new Set(result.frame.agents.map((agent) => `${agent.position.x},${agent.position.y}`)).size, 10);
  for (const agent of result.frame.agents) {
    assert.ok(agent.position.x >= 0 && agent.position.x < 16);
    assert.ok(agent.position.y >= 0 && agent.position.y < 32);
  }
  assert.equal(result.frame.debug.paths.length, 10);
  assert.ok(result.frame.debug.targets.length > 0);
});

test("batch metrics and explicit regression comparison identify degradations", () => {
  const batch = runCruceHeadlessBatch({
    seeds: [11, 12],
    profiles: ["expert"],
    agentCounts: [1],
    speeds: [3],
    maxTicks: 1_500
  });
  assert.equal(batch.runs.length, 2);
  assert.equal(batch.metrics.completionRate, 1);
  assert.equal(batch.thresholds.passed, true);
  assert.equal(batch.quality.passed, true);
  assert.equal(batch.metrics.routeSampleCount, 2);
  assert.equal(
    batch.metrics.routeDiversity,
    routeDiversityFromSignatures(batch.routeSignatures)
  );
  assert.equal(compareCruceSolverMetrics(
    batch.metrics,
    batch.metrics,
    regressionIdentity(batch.identity)
  ).regressed, false);
  const degraded = {
    ...batch.metrics,
    completionRate: 0,
    durationMillis: batch.metrics.durationMillis + 5_000,
    score: 0,
    deadlocks: batch.metrics.deadlocks + 2
  };
  const comparison = compareCruceSolverMetrics(
    batch.metrics,
    degraded,
    regressionIdentity(batch.identity)
  );
  assert.equal(comparison.regressed, true);
  assert.ok(comparison.failures.some((failure) => failure.metric === "completionRate"));
  assert.ok(comparison.failures.some((failure) => failure.metric === "deadlocks"));
});

test("quality failures carry reproducible run identity and numeric bounds", () => {
  const identity: CruceRunIdentity = Object.freeze({
    scope: "run",
    seed: 17,
    profile: "expert",
    agentCount: 1,
    speed: 2,
    difficulty: "hard",
    version: CRUCE_AGENT_SIMULATION_VERSION
  });
  const result = runCruceHeadless({
    seed: identity.seed,
    profile: "expert",
    agentCount: identity.agentCount,
    speed: identity.speed,
    difficulty: identity.difficulty,
    maxTicks: 1
  });
  const failure = result.thresholds.failures.find((candidate) => candidate.metric === "completionRate");
  assert.ok(failure !== undefined);
  assert.deepEqual({
    seed: failure.seed,
    profile: failure.profile,
    agentCount: failure.agentCount,
    speed: failure.speed,
    difficulty: failure.difficulty,
    version: failure.version,
    expected: failure.expected,
    actual: failure.actual,
    operator: failure.operator
  }, {
    seed: 17,
    profile: "expert",
    agentCount: 1,
    speed: 2,
    difficulty: "hard",
    version: CRUCE_AGENT_SIMULATION_VERSION,
    expected: 0.9,
    actual: 0,
    operator: "at-least"
  });
});

test("documented regression percentages use calculated candidate bounds", () => {
  const baseline = solverMetrics({
    completionRate: 1,
    durationMillis: 1_000,
    collisions: 5,
    damage: 5,
    routeDiversity: 1
  });
  const identity: CruceRegressionIdentity = Object.freeze({
    scope: "regression",
    seed: Object.freeze([137, 271, 619]),
    profile: Object.freeze(["expert"]),
    agentCount: Object.freeze([1, 4, 10]),
    speed: Object.freeze([2]),
    difficulty: "medium",
    version: CRUCE_AGENT_SIMULATION_VERSION
  });
  const atBounds = compareCruceSolverMetrics(
    baseline,
    solverMetrics({
      completionRate: 0.95,
      durationMillis: 1_200,
      collisions: 6,
      damage: 6,
      routeDiversity: 0.75
    }),
    identity
  );
  assert.equal(atBounds.regressed, false);

  const overBounds = compareCruceSolverMetrics(
    baseline,
    solverMetrics({
      completionRate: 0.949,
      durationMillis: 1_201,
      collisions: 6.01,
      damage: 6.01,
      deadlocks: 1,
      routeDiversity: 0.749
    }),
    identity
  );
  assert.deepEqual(
    overBounds.failures.map((failure) => failure.metric),
    ["completionRate", "durationMillis", "collisions", "deadlocks", "routeDiversity"]
  );
  assert.ok(overBounds.failures.every((failure) =>
    failure.scope === "regression"
      && failure.seed.length === 3
      && failure.profile[0] === "expert"
      && failure.agentCount.length === 3
      && failure.speed[0] === 2
      && failure.version === CRUCE_AGENT_SIMULATION_VERSION
      && Number.isFinite(failure.expected)
      && Number.isFinite(failure.actual)
  ));

  const zeroBaseline = solverMetrics({ collisions: 0, damage: 0 });
  assert.equal(compareCruceSolverMetrics(zeroBaseline, zeroBaseline, identity).regressed, false);
  const introducedCollision = compareCruceSolverMetrics(
    zeroBaseline,
    solverMetrics({ collisions: Number.EPSILON, damage: Number.EPSILON }),
    identity
  );
  assert.equal(introducedCollision.failures.some((failure) => failure.metric === "collisions"), true);
});

test("route diversity aggregates signatures across one-agent runs", () => {
  assert.equal(routeDiversityFromSignatures(["a", "b", "a"]), 2 / 3);
  assert.equal(routeDiversityFromSignatures(["only"]), 1);
  assert.equal(routeDiversityFromSignatures([]), 0);
});

function solverMetrics(overrides: Partial<CruceSolverMetrics> = {}): CruceSolverMetrics {
  return Object.freeze({
    completionRate: 1,
    durationMillis: 1_000,
    score: 4,
    collisions: 0,
    damage: 0,
    deadlocks: 0,
    replans: 10,
    stuckReplans: 0,
    routeDiversity: 1,
    ...overrides
  });
}
