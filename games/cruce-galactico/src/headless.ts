import type { GameDifficulty } from "@motion-levels-games/game-sdk";
import type { GameReplay } from "@motion-levels-games/replay-runtime";
import {
  CRUCE_AGENT_FRAME_MILLIS,
  CRUCE_AGENT_SIMULATION_VERSION,
  createCruceAgentHarness,
  routeDiversityFromSignatures,
  type CruceHarnessFrame,
  type CruceHarnessOptions,
  type CruceProfileSelection,
  type NormalizedCruceHarnessOptions
} from "./agents.ts";

export type CruceSolverThresholds = Readonly<{
  minCompletionRate: number;
  maxDurationMillis: number;
  minScore: number;
  maxCollisions: number;
  maxDamage: number;
  maxDeadlocks: number;
  maxReplans: number;
  minRouteDiversity: number;
}>;

export const DEFAULT_CRUCE_SOLVER_THRESHOLDS: CruceSolverThresholds = Object.freeze({
  minCompletionRate: 0.9,
  maxDurationMillis: 75_000,
  minScore: 4,
  maxCollisions: 3,
  maxDamage: 3,
  maxDeadlocks: 0,
  maxReplans: 1_000,
  minRouteDiversity: 0.1
});

export type CruceAggregateThresholds = CruceSolverThresholds & Readonly<{
  minRouteSignatures: number;
}>;

export const DEFAULT_CRUCE_AGGREGATE_THRESHOLDS: CruceAggregateThresholds = Object.freeze({
  ...DEFAULT_CRUCE_SOLVER_THRESHOLDS,
  minRouteSignatures: 2
});

export type CruceSolverMetrics = Readonly<{
  completionRate: number;
  durationMillis: number;
  score: number;
  collisions: number;
  damage: number;
  deadlocks: number;
  replans: number;
  stuckReplans: number;
  routeDiversity: number;
}>;

export type CruceAggregateMetrics = CruceSolverMetrics & Readonly<{
  routeSignatureCount: number;
  routeSampleCount: number;
}>;

export type CruceRunIdentity = Readonly<{
  scope: "run";
  seed: number;
  profile: string;
  agentCount: number;
  speed: number;
  difficulty: GameDifficulty;
  version: string;
}>;

export type CruceAggregateIdentity = Readonly<{
  scope: "aggregate";
  seed: readonly number[];
  profile: readonly string[];
  agentCount: readonly number[];
  speed: readonly number[];
  difficulty: GameDifficulty;
  version: string;
}>;

export type CruceRegressionIdentity = Readonly<{
  scope: "regression";
  seed: readonly number[];
  profile: readonly string[];
  agentCount: readonly number[];
  speed: readonly number[];
  difficulty: GameDifficulty;
  version: string;
}>;

export type CruceQualityIdentity = CruceRunIdentity | CruceAggregateIdentity | CruceRegressionIdentity;
export type CruceQualityMetric = keyof CruceAggregateMetrics;
export type CruceQualityOperator = "at-least" | "at-most";
export type CruceToleranceKind = "absolute-drop" | "relative-increase" | "relative-drop" | "exact-increase";

type CruceQualityFailureBase = Readonly<{
  metric: CruceQualityMetric;
  operator: CruceQualityOperator;
  expected: number;
  actual: number;
  baseline?: number;
  tolerance?: number;
  toleranceKind?: CruceToleranceKind;
}>;

export type CruceQualityFailure =
  | Readonly<CruceQualityFailureBase & CruceRunIdentity>
  | Readonly<CruceQualityFailureBase & CruceAggregateIdentity>
  | Readonly<CruceQualityFailureBase & CruceRegressionIdentity>;

export type CruceThresholdEvaluation = Readonly<{
  passed: boolean;
  failures: readonly CruceQualityFailure[];
  thresholds: CruceSolverThresholds;
  identity: CruceRunIdentity | CruceAggregateIdentity;
}>;

export type CruceAggregateThresholdEvaluation = Readonly<{
  passed: boolean;
  failures: readonly CruceQualityFailure[];
  thresholds: CruceAggregateThresholds;
  identity: CruceAggregateIdentity;
}>;

export type CruceHeadlessOptions = CruceHarnessOptions & Readonly<{
  maxTicks?: number;
  thresholds?: Partial<CruceSolverThresholds>;
}>;

export type CruceHeadlessResult = Readonly<{
  frame: CruceHarnessFrame;
  replay: GameReplay;
  metrics: CruceSolverMetrics;
  thresholds: CruceThresholdEvaluation;
  identity: CruceRunIdentity;
  routeSignatures: readonly string[];
}>;

export type CruceBatchOptions = Readonly<{
  seeds?: readonly number[];
  profiles?: readonly CruceProfileSelection[];
  agentCounts?: readonly number[];
  speeds?: readonly number[];
  difficulty?: CruceHarnessOptions["difficulty"];
  durationMillis?: number;
  maxTicks?: number;
  thresholds?: Partial<CruceSolverThresholds>;
  aggregateThresholds?: Partial<CruceAggregateThresholds>;
}>;

export type CruceBatchQuality = Readonly<{
  passed: boolean;
  runsPassed: boolean;
  aggregatePassed: boolean;
  failures: readonly CruceQualityFailure[];
}>;

export type CruceBatchResult = Readonly<{
  runs: readonly CruceHeadlessResult[];
  metrics: CruceAggregateMetrics;
  thresholds: CruceAggregateThresholdEvaluation;
  identity: CruceAggregateIdentity;
  routeSignatures: readonly string[];
  quality: CruceBatchQuality;
}>;

export type CruceRegressionTolerance = Readonly<{
  completionRateDropPoints: number;
  durationIncreaseRatio: number;
  collisionIncreaseRatio: number;
  routeDiversityDropRatio: number;
}>;

export const DEFAULT_CRUCE_REGRESSION_TOLERANCE: CruceRegressionTolerance = Object.freeze({
  completionRateDropPoints: 0.05,
  durationIncreaseRatio: 0.2,
  collisionIncreaseRatio: 0.2,
  routeDiversityDropRatio: 0.25
});

export type CruceRegressionComparison = Readonly<{
  regressed: boolean;
  failures: readonly CruceQualityFailure[];
  deltas: Readonly<Record<keyof CruceSolverMetrics, number>>;
  tolerance: CruceRegressionTolerance;
  identity: CruceRegressionIdentity;
}>;

export function runCruceHeadless(options: CruceHeadlessOptions = {}): CruceHeadlessResult {
  const harness = createCruceAgentHarness(options);
  const maxTicks = options.maxTicks
    ?? Math.ceil((harness.options.durationMillis + 3_000) / CRUCE_AGENT_FRAME_MILLIS);
  const frame = harness.run(maxTicks);
  const metrics = solverMetricsFromFrame(frame);
  const identity = runIdentity(harness.options);
  const routeSignatures = harness.routeSignatures;
  return Object.freeze({
    frame,
    replay: harness.finishReplay(),
    metrics,
    thresholds: evaluateCruceThresholds(metrics, identity, options.thresholds),
    identity,
    routeSignatures
  });
}

export function runCruceHeadlessBatch(options: CruceBatchOptions = {}): CruceBatchResult {
  const seeds = nonEmpty(options.seeds, [137]);
  const profiles = nonEmpty<CruceProfileSelection>(options.profiles, ["expert"]);
  const agentCounts = nonEmpty(options.agentCounts, [3]);
  const speeds = nonEmpty(options.speeds, [2]);
  const runs: CruceHeadlessResult[] = [];
  for (const seed of seeds) {
    for (const profile of profiles) {
      for (const agentCount of agentCounts) {
        for (const speed of speeds) {
          runs.push(runCruceHeadless({
            seed,
            profile,
            agentCount,
            speed,
            difficulty: options.difficulty,
            durationMillis: options.durationMillis,
            maxTicks: options.maxTicks,
            thresholds: options.thresholds
          }));
        }
      }
    }
  }
  const frozenRuns = Object.freeze(runs);
  const routeSignatures = Object.freeze(runs.flatMap((run) => run.routeSignatures));
  const metrics = aggregateMetrics(runs.map((run) => run.metrics), routeSignatures);
  const identity = aggregateIdentity(frozenRuns);
  const thresholds = evaluateCruceAggregateThresholds(
    metrics,
    identity,
    { ...options.thresholds, ...options.aggregateThresholds }
  );
  const runFailures = runs.flatMap((run) => run.thresholds.failures);
  const failures = Object.freeze([...runFailures, ...thresholds.failures]);
  return Object.freeze({
    runs: frozenRuns,
    metrics,
    thresholds,
    identity,
    routeSignatures,
    quality: Object.freeze({
      passed: failures.length === 0,
      runsPassed: runFailures.length === 0,
      aggregatePassed: thresholds.passed,
      failures
    })
  });
}

export function evaluateCruceThresholds(
  metrics: CruceSolverMetrics,
  identity: CruceRunIdentity | CruceAggregateIdentity,
  overrides: Partial<CruceSolverThresholds> = {}
): CruceThresholdEvaluation {
  const thresholds = Object.freeze({ ...DEFAULT_CRUCE_SOLVER_THRESHOLDS, ...overrides });
  const failures = evaluateSolverThresholdFailures(metrics, thresholds, identity);
  return Object.freeze({
    passed: failures.length === 0,
    failures,
    thresholds,
    identity
  });
}

export function evaluateCruceAggregateThresholds(
  metrics: CruceAggregateMetrics,
  identity: CruceAggregateIdentity,
  overrides: Partial<CruceAggregateThresholds> = {}
): CruceAggregateThresholdEvaluation {
  const thresholds = Object.freeze({ ...DEFAULT_CRUCE_AGGREGATE_THRESHOLDS, ...overrides });
  const failures = [...evaluateSolverThresholdFailures(metrics, thresholds, identity)];
  if (metrics.routeSignatureCount < thresholds.minRouteSignatures) {
    failures.push(qualityFailure(identity, "routeSignatureCount", "at-least", thresholds.minRouteSignatures, metrics.routeSignatureCount));
  }
  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    thresholds,
    identity
  });
}

export function compareCruceSolverMetrics(
  baseline: CruceSolverMetrics,
  current: CruceSolverMetrics,
  identity: CruceRegressionIdentity,
  overrides: Partial<CruceRegressionTolerance> = {}
): CruceRegressionComparison {
  const tolerance = Object.freeze({ ...DEFAULT_CRUCE_REGRESSION_TOLERANCE, ...overrides });
  assertRegressionTolerance(tolerance);
  const deltas = Object.freeze({
    completionRate: current.completionRate - baseline.completionRate,
    durationMillis: current.durationMillis - baseline.durationMillis,
    score: current.score - baseline.score,
    collisions: current.collisions - baseline.collisions,
    damage: current.damage - baseline.damage,
    deadlocks: current.deadlocks - baseline.deadlocks,
    replans: current.replans - baseline.replans,
    stuckReplans: current.stuckReplans - baseline.stuckReplans,
    routeDiversity: current.routeDiversity - baseline.routeDiversity
  });
  const failures: CruceQualityFailure[] = [];

  const minimumCompletionRate = Math.max(0, baseline.completionRate - tolerance.completionRateDropPoints);
  if (current.completionRate < minimumCompletionRate) {
    failures.push(regressionFailure(
      identity,
      "completionRate",
      "at-least",
      minimumCompletionRate,
      current.completionRate,
      baseline.completionRate,
      tolerance.completionRateDropPoints,
      "absolute-drop"
    ));
  }

  const maximumDurationMillis = baseline.durationMillis * (1 + tolerance.durationIncreaseRatio);
  if (current.durationMillis > maximumDurationMillis) {
    failures.push(regressionFailure(
      identity,
      "durationMillis",
      "at-most",
      maximumDurationMillis,
      current.durationMillis,
      baseline.durationMillis,
      tolerance.durationIncreaseRatio,
      "relative-increase"
    ));
  }

  const maximumCollisions = baseline.collisions * (1 + tolerance.collisionIncreaseRatio);
  if (current.collisions > maximumCollisions) {
    failures.push(regressionFailure(
      identity,
      "collisions",
      "at-most",
      maximumCollisions,
      current.collisions,
      baseline.collisions,
      tolerance.collisionIncreaseRatio,
      "relative-increase"
    ));
  }

  if (current.deadlocks > baseline.deadlocks) {
    failures.push(regressionFailure(
      identity,
      "deadlocks",
      "at-most",
      baseline.deadlocks,
      current.deadlocks,
      baseline.deadlocks,
      0,
      "exact-increase"
    ));
  }

  const minimumRouteDiversity = Math.max(0, baseline.routeDiversity * (1 - tolerance.routeDiversityDropRatio));
  if (current.routeDiversity < minimumRouteDiversity) {
    failures.push(regressionFailure(
      identity,
      "routeDiversity",
      "at-least",
      minimumRouteDiversity,
      current.routeDiversity,
      baseline.routeDiversity,
      tolerance.routeDiversityDropRatio,
      "relative-drop"
    ));
  }

  return Object.freeze({
    regressed: failures.length > 0,
    failures: Object.freeze(failures),
    deltas,
    tolerance,
    identity
  });
}

export function regressionIdentity(identity: CruceAggregateIdentity): CruceRegressionIdentity {
  return Object.freeze({ ...identity, scope: "regression" });
}

function evaluateSolverThresholdFailures(
  metrics: CruceSolverMetrics,
  thresholds: CruceSolverThresholds,
  identity: CruceRunIdentity | CruceAggregateIdentity
): readonly CruceQualityFailure[] {
  const failures: CruceQualityFailure[] = [];
  if (metrics.completionRate < thresholds.minCompletionRate) {
    failures.push(qualityFailure(identity, "completionRate", "at-least", thresholds.minCompletionRate, metrics.completionRate));
  }
  if (metrics.durationMillis > thresholds.maxDurationMillis) {
    failures.push(qualityFailure(identity, "durationMillis", "at-most", thresholds.maxDurationMillis, metrics.durationMillis));
  }
  if (metrics.score < thresholds.minScore) {
    failures.push(qualityFailure(identity, "score", "at-least", thresholds.minScore, metrics.score));
  }
  if (metrics.collisions > thresholds.maxCollisions) {
    failures.push(qualityFailure(identity, "collisions", "at-most", thresholds.maxCollisions, metrics.collisions));
  }
  if (metrics.damage > thresholds.maxDamage) {
    failures.push(qualityFailure(identity, "damage", "at-most", thresholds.maxDamage, metrics.damage));
  }
  if (metrics.deadlocks > thresholds.maxDeadlocks) {
    failures.push(qualityFailure(identity, "deadlocks", "at-most", thresholds.maxDeadlocks, metrics.deadlocks));
  }
  if (metrics.replans > thresholds.maxReplans) {
    failures.push(qualityFailure(identity, "replans", "at-most", thresholds.maxReplans, metrics.replans));
  }
  if (metrics.routeDiversity < thresholds.minRouteDiversity) {
    failures.push(qualityFailure(identity, "routeDiversity", "at-least", thresholds.minRouteDiversity, metrics.routeDiversity));
  }
  return Object.freeze(failures);
}

function qualityFailure(
  identity: CruceRunIdentity | CruceAggregateIdentity,
  metric: CruceQualityMetric,
  operator: CruceQualityOperator,
  expected: number,
  actual: number
): CruceQualityFailure {
  return Object.freeze({ ...identity, metric, operator, expected, actual }) as CruceQualityFailure;
}

function regressionFailure(
  identity: CruceRegressionIdentity,
  metric: CruceQualityMetric,
  operator: CruceQualityOperator,
  expected: number,
  actual: number,
  baseline: number,
  tolerance: number,
  toleranceKind: CruceToleranceKind
): CruceQualityFailure {
  return Object.freeze({
    ...identity,
    metric,
    operator,
    expected,
    actual,
    baseline,
    tolerance,
    toleranceKind
  });
}

function solverMetricsFromFrame(frame: CruceHarnessFrame): CruceSolverMetrics {
  return Object.freeze({
    completionRate: frame.metrics.completed ? 1 : 0,
    durationMillis: frame.metrics.elapsedMillis,
    score: frame.metrics.score,
    collisions: frame.metrics.collisions,
    damage: frame.metrics.damage,
    deadlocks: frame.metrics.deadlocks,
    replans: frame.metrics.replans,
    stuckReplans: frame.metrics.stuckReplans,
    routeDiversity: frame.metrics.routeDiversity
  });
}

function aggregateMetrics(
  metrics: readonly CruceSolverMetrics[],
  routeSignatures: readonly string[]
): CruceAggregateMetrics {
  const averaged = averageMetrics(metrics);
  return Object.freeze({
    ...averaged,
    routeDiversity: routeDiversityFromSignatures(routeSignatures),
    routeSignatureCount: new Set(routeSignatures).size,
    routeSampleCount: routeSignatures.length
  });
}

function averageMetrics(metrics: readonly CruceSolverMetrics[]): CruceSolverMetrics {
  if (metrics.length === 0) {
    throw new Error("Cruce batch requires at least one run");
  }
  const average = (read: (metric: CruceSolverMetrics) => number): number =>
    metrics.reduce((total, metric) => total + read(metric), 0) / metrics.length;
  return Object.freeze({
    completionRate: average((metric) => metric.completionRate),
    durationMillis: average((metric) => metric.durationMillis),
    score: average((metric) => metric.score),
    collisions: average((metric) => metric.collisions),
    damage: average((metric) => metric.damage),
    deadlocks: average((metric) => metric.deadlocks),
    replans: average((metric) => metric.replans),
    stuckReplans: average((metric) => metric.stuckReplans),
    routeDiversity: average((metric) => metric.routeDiversity)
  });
}

function runIdentity(options: NormalizedCruceHarnessOptions): CruceRunIdentity {
  return Object.freeze({
    scope: "run",
    seed: options.seed,
    profile: profileLabel(options.profile),
    agentCount: options.agentCount,
    speed: options.speed,
    difficulty: options.difficulty,
    version: CRUCE_AGENT_SIMULATION_VERSION
  });
}

function aggregateIdentity(runs: readonly CruceHeadlessResult[]): CruceAggregateIdentity {
  const first = runs[0];
  if (first === undefined) {
    throw new Error("Cruce batch requires at least one run identity");
  }
  return Object.freeze({
    scope: "aggregate",
    seed: unique(runs.map((run) => run.identity.seed)),
    profile: unique(runs.map((run) => run.identity.profile)),
    agentCount: unique(runs.map((run) => run.identity.agentCount)),
    speed: unique(runs.map((run) => run.identity.speed)),
    difficulty: first.identity.difficulty,
    version: CRUCE_AGENT_SIMULATION_VERSION
  });
}

function profileLabel(profile: CruceProfileSelection): string {
  return typeof profile === "string" ? profile : profile.join("+");
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function assertRegressionTolerance(tolerance: CruceRegressionTolerance): void {
  for (const [name, value] of Object.entries(tolerance)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Cruce regression ${name} must be a ratio from zero through one`);
    }
  }
}

function nonEmpty<T>(values: readonly T[] | undefined, fallback: readonly T[]): readonly T[] {
  if (values === undefined) return fallback;
  if (values.length === 0) throw new Error("Cruce batch dimensions must not be empty");
  return values;
}
