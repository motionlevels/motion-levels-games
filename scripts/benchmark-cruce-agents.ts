import type { GameDifficulty } from "@motion-levels-games/game-sdk";
import { CRUCE_AGENT_SIMULATION_VERSION } from "../games/cruce-galactico/src/agents.ts";
import {
  compareCruceSolverMetrics,
  regressionIdentity,
  runCruceHeadlessBatch,
  type CruceQualityFailure
} from "../games/cruce-galactico/src/headless.ts";
import { CRUCE_AGENT_BENCHMARK_BASELINE } from "./lib/cruce-agent-baseline.ts";

const baseline = CRUCE_AGENT_BENCHMARK_BASELINE;
if (String(baseline.version) !== CRUCE_AGENT_SIMULATION_VERSION) {
  throw new Error(
    `Cruce baseline version mismatch: expected ${CRUCE_AGENT_SIMULATION_VERSION}, actual ${baseline.version}`
  );
}

const difficulties = ["easy", "medium", "hard", "expert"] as const satisfies readonly GameDifficulty[];
const report: Record<string, unknown> = {
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
  (report.difficulties as Record<string, unknown>)[difficulty] = {
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

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  throw new Error(`Cruce agent quality gates failed\n${JSON.stringify(failures, null, 2)}`);
}
