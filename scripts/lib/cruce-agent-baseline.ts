import type { GameDifficulty } from "@motion-levels-games/game-sdk";
import type {
  CruceAggregateMetrics,
  CruceRegressionTolerance
} from "../../games/cruce-galactico/src/headless.ts";

export type CruceAgentBenchmarkBaseline = Readonly<{
  version: string;
  rationale: string;
  dimensions: Readonly<{
    seeds: readonly number[];
    profiles: readonly string[];
    agentCounts: readonly number[];
    speeds: readonly number[];
    durationMillis: number;
    maxTicks: number;
  }>;
  tolerance: CruceRegressionTolerance;
  metrics: Readonly<Record<GameDifficulty, CruceAggregateMetrics>>;
}>;

/**
 * Re-recorded after v2 made configured tiles-per-second authoritative and
 * adopted speed-aware hazard prediction/staging. Keep the version literal:
 * the benchmark intentionally rejects stale numbers after a version bump.
 */
export const CRUCE_AGENT_BENCHMARK_BASELINE = Object.freeze({
  version: "cruce-agent-harness-2",
  rationale: "Authoritative speed, speed-aware hazards, and cross-run route signatures",
  dimensions: Object.freeze({
    seeds: Object.freeze([137, 271, 619]),
    profiles: Object.freeze(["expert"]),
    agentCounts: Object.freeze([1, 4, 10]),
    speeds: Object.freeze([2]),
    durationMillis: 75_000,
    maxTicks: 3_900
  }),
  tolerance: Object.freeze({
    completionRateDropPoints: 0.05,
    durationIncreaseRatio: 0.2,
    collisionIncreaseRatio: 0.2,
    routeDiversityDropRatio: 0.25
  }),
  metrics: Object.freeze({
    easy: Object.freeze({
      completionRate: 1,
      durationMillis: 20_502.222222222223,
      score: 4,
      collisions: 0,
      damage: 0,
      deadlocks: 0,
      replans: 158.77777777777777,
      stuckReplans: 2.7777777777777777,
      routeDiversity: 0.5777777777777777,
      routeSignatureCount: 26,
      routeSampleCount: 45
    }),
    medium: Object.freeze({
      completionRate: 1,
      durationMillis: 20_862.222222222223,
      score: 4,
      collisions: 0.1111111111111111,
      damage: 0.1111111111111111,
      deadlocks: 0,
      replans: 172.88888888888889,
      stuckReplans: 2.7777777777777777,
      routeDiversity: 0.7111111111111111,
      routeSignatureCount: 32,
      routeSampleCount: 45
    }),
    hard: Object.freeze({
      completionRate: 1,
      durationMillis: 21_720,
      score: 4,
      collisions: 0,
      damage: 0,
      deadlocks: 0,
      replans: 166.77777777777777,
      stuckReplans: 2.7777777777777777,
      routeDiversity: 0.6666666666666666,
      routeSignatureCount: 30,
      routeSampleCount: 45
    }),
    expert: Object.freeze({
      completionRate: 1,
      durationMillis: 21_057.777777777777,
      score: 4,
      collisions: 0,
      damage: 0,
      deadlocks: 0,
      replans: 170.55555555555554,
      stuckReplans: 2.111111111111111,
      routeDiversity: 0.6,
      routeSignatureCount: 27,
      routeSampleCount: 45
    })
  })
} satisfies CruceAgentBenchmarkBaseline);
