import { FLOOR_COLS, FLOOR_ROWS, type GameDifficulty } from "@motion-levels-games/game-sdk";
import {
  createDueloAgentHarness,
  DUELO_AGENT_HARNESS_VERSION,
  type DueloAgentInput
} from "../games/duelo/src/agent-harness.ts";
import { CRUCE_AGENT_SIMULATION_VERSION } from "../games/cruce-galactico/src/agents.ts";
import {
  compareCruceSolverMetrics,
  regressionIdentity,
  runCruceHeadlessBatch,
  type CruceQualityFailure
} from "../games/cruce-galactico/src/headless.ts";
import { CRUCE_AGENT_BENCHMARK_BASELINE } from "./lib/cruce-agent-baseline.ts";
import {
  DUELO_AGENT_BENCHMARK_BASELINE,
  dueloBenchmarkKey
} from "./lib/duelo-agent-baseline.ts";

type DueloQualityFailure = Readonly<{
  game: "duelo";
  dimension?: "accelerated-solver" | "product-speed-parity";
  seed?: number;
  difficulty?: string;
  playerCount?: number;
  movementTilesPerSecond?: number;
  metric: string;
  expected: unknown;
  actual: unknown;
}>;

const duelo = runDueloProductGate();
const cruce = runCruceEngineeringRegression();
const report = Object.freeze({
  productGate: duelo.report,
  engineeringRegression: Object.freeze({ cruce: cruce.report })
});

console.log(JSON.stringify(report, null, 2));

if (duelo.failures.length > 0 || cruce.failures.length > 0) {
  throw new Error(`Agent quality gates failed\n${JSON.stringify({
    duelo: duelo.failures,
    cruce: cruce.failures
  }, null, 2)}`);
}

function runDueloProductGate(): Readonly<{
  report: Record<string, unknown>;
  failures: readonly DueloQualityFailure[];
}> {
  const baseline = DUELO_AGENT_BENCHMARK_BASELINE;
  if (baseline.version !== DUELO_AGENT_HARNESS_VERSION) {
    throw new Error(
      `Duelo baseline version mismatch: expected ${DUELO_AGENT_HARNESS_VERSION}, actual ${baseline.version}`
    );
  }

  const solver = baseline.acceleratedSolver;
  const failures: DueloQualityFailure[] = [];
  const runs: Record<string, unknown>[] = [];
  const winnersByPlayerCount = new Map<number, Set<number>>();
  let completed = 0;
  let equalAllocations = 0;
  let checksumMatches = 0;
  let playerZeroWins = 0;
  let boundaryViolations = 0;

  for (const seed of solver.dimensions.seeds) {
    for (const difficulty of solver.dimensions.difficulties) {
      for (const playerCount of solver.dimensions.playerCounts) {
        const harness = createDueloAgentHarness({
          seed,
          difficulty,
          playerCount,
          movementTilesPerSecond: solver.dimensions.movementTilesPerSecond
        });
        const initialPositions = new Map(harness.frame.agents.map((agent) => [agent.id, agent.position]));
        const frame = harness.run(solver.dimensions.maxTicks);
        const key = dueloBenchmarkKey(seed, difficulty, playerCount);
        const expectedChecksum = (solver.checksums as Readonly<Record<string, string>>)[key];
        const boundary = auditDueloBoundary(harness.inputHistory, initialPositions);
        const winEvents = harness.eventHistory.filter((event) => event.cue === "win").length;
        const winner = frame.metrics.winnerIndex;
        const winnerSet = winnersByPlayerCount.get(playerCount) ?? new Set<number>();
        if (winner >= 0) winnerSet.add(winner);
        winnersByPlayerCount.set(playerCount, winnerSet);
        completed += Number(frame.metrics.completed);
        equalAllocations += Number(frame.metrics.fairTargetAllocation);
        checksumMatches += Number(frame.checksum === expectedChecksum);
        playerZeroWins += Number(winner === 0);
        boundaryViolations += boundary.total;

        const identity = {
          dimension: "accelerated-solver" as const,
          seed,
          difficulty,
          playerCount,
          movementTilesPerSecond: solver.dimensions.movementTilesPerSecond
        };
        if (!frame.metrics.completed) {
          failures.push(failure(identity, "completion", true, false));
        }
        if (!frame.metrics.fairTargetAllocation || frame.metrics.targetSpread !== 0) {
          failures.push(failure(identity, "equal-target-allocation", 0, frame.metrics.targetSpread));
        }
        if (winner < 0 || winner >= playerCount || winEvents !== 1) {
          failures.push(failure(identity, "single-valid-winner", "one valid winner", { winner, winEvents }));
        }
        if (boundary.total !== 0) {
          failures.push(failure(identity, "press-release-boundary", 0, boundary));
        }
        if (expectedChecksum === undefined || frame.checksum !== expectedChecksum) {
          failures.push(failure(identity, "deterministic-checksum", expectedChecksum, frame.checksum));
        }
        runs.push({
          identity,
          checksum: frame.checksum,
          expectedChecksum,
          tick: frame.tick,
          durationMillis: frame.metrics.durationMillis,
          winnerIndex: winner,
          targetSpread: frame.metrics.targetSpread,
          boundary,
          actionsByAgent: frame.metrics.actionsByAgent,
          travelTilesByAgent: frame.metrics.travelTilesByAgent,
          rivalTargetsClaimedByAgent: frame.metrics.rivalTargetsClaimedByAgent
        });
      }
    }
  }

  for (const playerCount of solver.dimensions.playerCounts) {
    const winners = winnersByPlayerCount.get(playerCount) ?? new Set<number>();
    if (winners.size < 2) {
      failures.push(failure(
        {
          dimension: "accelerated-solver",
          playerCount,
          movementTilesPerSecond: solver.dimensions.movementTilesPerSecond
        },
        "winner-distribution",
        "at least two winner indices across seeds/difficulties",
        [...winners]
      ));
    }
  }
  const playerZeroWinRate = runs.length === 0 ? 1 : playerZeroWins / runs.length;
  if (playerZeroWinRate > 0.5) {
    failures.push(failure(
      {
        dimension: "accelerated-solver",
        movementTilesPerSecond: solver.dimensions.movementTilesPerSecond
      },
      "player-zero-win-rate",
      "<= 0.5",
      playerZeroWinRate
    ));
  }

  const acceleratedSolverPassed = failures.length === 0;
  const parity = baseline.productSpeedParity;
  const parityFailureStart = failures.length;
  const parityRuns: Record<string, unknown>[] = [];
  let parityCompleted = 0;
  let parityChecksumMatches = 0;
  let parityBoundaryViolations = 0;
  for (const playerCount of parity.dimensions.playerCounts) {
    const harness = createDueloAgentHarness({
      seed: parity.dimensions.seed,
      difficulty: parity.dimensions.difficulty,
      playerCount,
      movementTilesPerSecond: parity.dimensions.movementTilesPerSecond
    });
    const initialPositions = new Map(harness.frame.agents.map((agent) => [agent.id, agent.position]));
    const frame = harness.run(parity.dimensions.maxTicks);
    const key = dueloBenchmarkKey(parity.dimensions.seed, parity.dimensions.difficulty, playerCount);
    const expectedChecksum = (parity.checksums as Readonly<Record<string, string>>)[key];
    const boundary = auditDueloBoundary(harness.inputHistory, initialPositions);
    const identity = {
      dimension: "product-speed-parity" as const,
      seed: parity.dimensions.seed,
      difficulty: parity.dimensions.difficulty,
      playerCount,
      movementTilesPerSecond: parity.dimensions.movementTilesPerSecond
    };
    parityCompleted += Number(frame.metrics.completed);
    parityChecksumMatches += Number(frame.checksum === expectedChecksum);
    parityBoundaryViolations += boundary.total;
    if (!frame.metrics.completed) failures.push(failure(identity, "completion", true, false));
    if (!frame.metrics.fairTargetAllocation || frame.metrics.targetSpread !== 0) {
      failures.push(failure(identity, "equal-target-allocation", 0, frame.metrics.targetSpread));
    }
    if (boundary.total !== 0) failures.push(failure(identity, "press-release-boundary", 0, boundary));
    if (expectedChecksum === undefined || frame.checksum !== expectedChecksum) {
      failures.push(failure(identity, "deterministic-checksum", expectedChecksum, frame.checksum));
    }
    parityRuns.push({
      identity,
      checksum: frame.checksum,
      expectedChecksum,
      tick: frame.tick,
      durationMillis: frame.metrics.durationMillis,
      winnerIndex: frame.metrics.winnerIndex,
      targetSpread: frame.metrics.targetSpread,
      boundary,
      rivalTargetsClaimedByAgent: frame.metrics.rivalTargetsClaimedByAgent
    });
  }
  const productSpeedParityPassed = failures.length === parityFailureStart;

  return Object.freeze({
    report: {
      game: "duelo",
      role: "product-reference-semantic-solver-gate",
      referenceVersion: baseline.version,
      rationale: baseline.rationale,
      acceleratedSolver: {
        rationale: solver.rationale,
        dimensions: solver.dimensions,
        aggregate: {
          runs: runs.length,
          completionRate: runs.length === 0 ? 0 : completed / runs.length,
          equalTargetAllocationRate: runs.length === 0 ? 0 : equalAllocations / runs.length,
          deterministicChecksumRate: runs.length === 0 ? 0 : checksumMatches / runs.length,
          boundaryViolations,
          playerZeroWinRate,
          winnersByPlayerCount: Object.fromEntries([...winnersByPlayerCount].map(([count, winners]) =>
            [count, [...winners].sort((first, second) => first - second)]
          )),
          passed: acceleratedSolverPassed
        },
        runs
      },
      productSpeedParity: {
        rationale: parity.rationale,
        dimensions: parity.dimensions,
        aggregate: {
          runs: parityRuns.length,
          completionRate: parityRuns.length === 0 ? 0 : parityCompleted / parityRuns.length,
          deterministicChecksumRate:
            parityRuns.length === 0 ? 0 : parityChecksumMatches / parityRuns.length,
          boundaryViolations: parityBoundaryViolations,
          passed: productSpeedParityPassed
        },
        runs: parityRuns
      },
      passed: acceleratedSolverPassed && productSpeedParityPassed
    },
    failures: Object.freeze(failures)
  });
}

function runCruceEngineeringRegression(): Readonly<{
  report: Record<string, unknown>;
  failures: readonly CruceQualityFailure[];
}> {
  const baseline = CRUCE_AGENT_BENCHMARK_BASELINE;
  if (String(baseline.version) !== CRUCE_AGENT_SIMULATION_VERSION) {
    throw new Error(
      `Cruce baseline version mismatch: expected ${CRUCE_AGENT_SIMULATION_VERSION}, actual ${baseline.version}`
    );
  }

  const difficulties = ["easy", "medium", "hard", "expert"] as const satisfies readonly GameDifficulty[];
  const cruceReport: Record<string, unknown> = {
    game: "cruce-galactico",
    role: "engineering-regression",
    referenceVersion: baseline.version,
    rationale: baseline.rationale,
    dimensions: baseline.dimensions,
    tolerance: baseline.tolerance,
    difficulties: {}
  };
  const failures: CruceQualityFailure[] = [];

  for (const difficulty of difficulties) {
    const reference = baseline.metrics[difficulty];
    const batch = runCruceHeadlessBatch({
      seeds: baseline.dimensions.seeds,
      profiles: baseline.dimensions.profiles,
      agentCounts: baseline.dimensions.agentCounts,
      speeds: baseline.dimensions.speeds,
      difficulty,
      durationMillis: baseline.dimensions.durationMillis,
      maxTicks: baseline.dimensions.maxTicks
    });
    const regression = compareCruceSolverMetrics(
      reference,
      batch.metrics,
      regressionIdentity(batch.identity),
      baseline.tolerance
    );
    failures.push(...batch.quality.failures, ...regression.failures);
    (cruceReport.difficulties as Record<string, unknown>)[difficulty] = {
      identity: batch.identity,
      runs: batch.runs.map((run) => ({
        identity: run.identity,
        metrics: run.metrics,
        thresholds: run.thresholds
      })),
      metrics: batch.metrics,
      thresholds: batch.thresholds,
      quality: batch.quality,
      regression
    };
  }

  return Object.freeze({ report: cruceReport, failures: Object.freeze(failures) });
}

function auditDueloBoundary(
  inputs: readonly DueloAgentInput[],
  initialPositions: ReadonlyMap<string, Readonly<{ x: number; y: number }>>
): Readonly<{
  teleports: number;
  outOfBounds: number;
  releaseMismatches: number;
  pressWhileHeld: number;
  total: number;
}> {
  const positions = new Map(initialPositions);
  const held = new Map<string, Readonly<{ x: number; y: number }>>();
  let teleports = 0;
  let outOfBounds = 0;
  let releaseMismatches = 0;
  let pressWhileHeld = 0;
  for (const input of inputs) {
    const point = Object.freeze({ x: input.x, y: input.y });
    if (point.x < 0 || point.x >= FLOOR_COLS || point.y < 0 || point.y >= FLOOR_ROWS) outOfBounds += 1;
    if (input.purpose === "readiness") {
      if (input.kind === "press") held.set(input.agentId, point);
      else held.delete(input.agentId);
      continue;
    }
    if (input.kind === "release") {
      const current = held.get(input.agentId);
      if (current?.x !== point.x || current.y !== point.y) releaseMismatches += 1;
      held.delete(input.agentId);
      continue;
    }
    const previous = positions.get(input.agentId);
    if (previous === undefined
      || Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) > 1) teleports += 1;
    if (held.has(input.agentId)) pressWhileHeld += 1;
    positions.set(input.agentId, point);
    held.set(input.agentId, point);
  }
  return Object.freeze({
    teleports,
    outOfBounds,
    releaseMismatches,
    pressWhileHeld,
    total: teleports + outOfBounds + releaseMismatches + pressWhileHeld
  });
}

function failure(
  identity: Readonly<{
    dimension?: DueloQualityFailure["dimension"];
    seed?: number;
    difficulty?: string;
    playerCount?: number;
    movementTilesPerSecond?: number;
  }>,
  metric: string,
  expected: unknown,
  actual: unknown
): DueloQualityFailure {
  return Object.freeze({ game: "duelo", ...identity, metric, expected, actual });
}
