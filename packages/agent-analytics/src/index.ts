import { replayChecksum, stableStringify } from "@motion-levels-games/replay-runtime";

export const TRAJECTORY_SCHEMA_VERSION = 1;
export const ROUTE_CHOICE_MODEL_KIND = "route-choice-markov-v1";

export type TrajectoryPoint = {
  tick: number;
  position: { x: number; y: number };
  action: string;
  targetId?: string;
  inDanger?: boolean;
  collided?: boolean;
  replanned?: boolean;
  mistake?: boolean;
};

export type TrajectoryProvenance =
  | { kind: "bot"; brainVersion: string }
  | { kind: "authored"; authoringVersion: string }
  | { kind: "synthetic"; generatorVersion: string }
  | {
      kind: "anonymized-human";
      policyVersion: string;
      datasetId: string;
      retentionDeadline: string;
    };

export type AgentTrajectory = {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION;
  id: string;
  tickRate: number;
  completed: boolean;
  score: number;
  provenance: TrajectoryProvenance;
  points: TrajectoryPoint[];
};

export type TrajectoryMetrics = {
  durationTicks: number;
  distanceTiles: number;
  hesitationTicks: number;
  reactionDelayTicks: number;
  uniqueTiles: number;
  routeSignature: string;
  collisions: number;
  replans: number;
  dangerTicks: number;
  mistakes: number;
  meanStepDistance: number;
};

export type TrajectorySetMetrics = {
  trajectories: number;
  completionRate: number;
  meanDurationTicks: number;
  meanScore: number;
  meanHesitationTicks: number;
  meanReactionDelayTicks: number;
  meanCollisions: number;
  meanReplans: number;
  meanDangerTicks: number;
  meanMistakes: number;
  routeDiversity: number;
  spacingTiles?: number;
};

export type TrajectoryComparison = {
  baseline: TrajectorySetMetrics;
  candidate: TrajectorySetMetrics;
  deltas: Omit<TrajectorySetMetrics, "trajectories" | "spacingTiles"> & { spacingTiles?: number };
};

export function measureTrajectory(trajectory: AgentTrajectory): TrajectoryMetrics {
  assertTrajectory(trajectory);
  const points = trajectory.points;
  let distanceTiles = 0;
  let hesitationTicks = 0;
  let reactionDelayTicks = 0;
  let firstTargetTick: number | undefined = points[0]?.targetId ? points[0].tick : undefined;
  let firstMoveAfterTarget: number | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const distance = euclidean(previous.position, current.position);
    distanceTiles += distance;
    if (distance < 0.01) hesitationTicks += Math.max(0, current.tick - previous.tick);
    if (firstTargetTick === undefined && current.targetId) firstTargetTick = current.tick;
    if (firstTargetTick !== undefined && firstMoveAfterTarget === undefined && distance >= 0.01) {
      firstMoveAfterTarget = current.tick;
    }
  }
  if (firstTargetTick !== undefined) {
    reactionDelayTicks = Math.max(0, (firstMoveAfterTarget ?? points.at(-1)?.tick ?? firstTargetTick) - firstTargetTick);
  }
  const route = simplifyRoute(points.map((point) => point.position));
  return {
    durationTicks: points.length < 2 ? 0 : (points.at(-1)?.tick ?? 0) - (points[0]?.tick ?? 0),
    distanceTiles,
    hesitationTicks,
    reactionDelayTicks,
    uniqueTiles: new Set(points.map((point) => pointKey(point.position))).size,
    routeSignature: replayChecksum(route),
    collisions: points.filter((point) => point.collided).length,
    replans: points.filter((point) => point.replanned).length,
    dangerTicks: points.filter((point) => point.inDanger).length,
    mistakes: points.filter((point) => point.mistake).length,
    meanStepDistance: points.length < 2 ? 0 : distanceTiles / (points.length - 1)
  };
}

export function measureTrajectorySet(trajectories: readonly AgentTrajectory[]): TrajectorySetMetrics {
  if (trajectories.length === 0) return emptySetMetrics();
  const metrics = trajectories.map(measureTrajectory);
  return {
    trajectories: trajectories.length,
    completionRate: average(trajectories.map((trajectory) => Number(trajectory.completed))),
    meanDurationTicks: average(metrics.map((metric) => metric.durationTicks)),
    meanScore: average(trajectories.map((trajectory) => trajectory.score)),
    meanHesitationTicks: average(metrics.map((metric) => metric.hesitationTicks)),
    meanReactionDelayTicks: average(metrics.map((metric) => metric.reactionDelayTicks)),
    meanCollisions: average(metrics.map((metric) => metric.collisions)),
    meanReplans: average(metrics.map((metric) => metric.replans)),
    meanDangerTicks: average(metrics.map((metric) => metric.dangerTicks)),
    meanMistakes: average(metrics.map((metric) => metric.mistakes)),
    routeDiversity: new Set(metrics.map((metric) => metric.routeSignature)).size / trajectories.length,
    ...(trajectories.length > 1 ? { spacingTiles: meanSpacing(trajectories) } : {})
  };
}

export function compareTrajectorySets(
  baselineTrajectories: readonly AgentTrajectory[],
  candidateTrajectories: readonly AgentTrajectory[]
): TrajectoryComparison {
  const baseline = measureTrajectorySet(baselineTrajectories);
  const candidate = measureTrajectorySet(candidateTrajectories);
  return {
    baseline,
    candidate,
    deltas: {
      completionRate: candidate.completionRate - baseline.completionRate,
      meanDurationTicks: candidate.meanDurationTicks - baseline.meanDurationTicks,
      meanScore: candidate.meanScore - baseline.meanScore,
      meanHesitationTicks: candidate.meanHesitationTicks - baseline.meanHesitationTicks,
      meanReactionDelayTicks: candidate.meanReactionDelayTicks - baseline.meanReactionDelayTicks,
      meanCollisions: candidate.meanCollisions - baseline.meanCollisions,
      meanReplans: candidate.meanReplans - baseline.meanReplans,
      meanDangerTicks: candidate.meanDangerTicks - baseline.meanDangerTicks,
      meanMistakes: candidate.meanMistakes - baseline.meanMistakes,
      routeDiversity: candidate.routeDiversity - baseline.routeDiversity,
      ...(baseline.spacingTiles !== undefined && candidate.spacingTiles !== undefined
        ? { spacingTiles: candidate.spacingTiles - baseline.spacingTiles }
        : {})
    }
  };
}

export type RouteDirection = "up" | "down" | "left" | "right" | "wait";

export type RouteChoiceExample = {
  context: string;
  direction: RouteDirection;
  weight?: number;
};

export type RouteChoiceModel = {
  kind: typeof ROUTE_CHOICE_MODEL_KIND;
  version: string;
  trainingPolicyVersions: string[];
  counts: Record<string, Partial<Record<RouteDirection, number>>>;
  fallback: Partial<Record<RouteDirection, number>>;
};

export type RouteChoiceTrainingOptions = {
  versionLabel: string;
  allowedHumanPolicyVersions?: readonly string[];
};

export function routeChoiceExamples(trajectory: AgentTrajectory): RouteChoiceExample[] {
  assertTrajectory(trajectory);
  return trajectory.points.slice(1).map((point, index) => {
    const previous = trajectory.points[index]!;
    return {
      context: routeContext(previous),
      direction: directionBetween(previous.position, point.position)
    };
  });
}

export function trainRouteChoiceModel(
  trajectories: readonly AgentTrajectory[],
  options: RouteChoiceTrainingOptions
): RouteChoiceModel {
  if (!options.versionLabel.trim()) throw new Error("Route-choice training requires a version label");
  const allowedHumanPolicies = new Set(options.allowedHumanPolicyVersions ?? []);
  const humanPolicies = new Set<string>();
  for (const trajectory of trajectories) {
    assertTrajectory(trajectory);
    if (trajectory.provenance.kind === "anonymized-human") {
      if (!allowedHumanPolicies.has(trajectory.provenance.policyVersion)) {
        throw new Error(`Human trajectory policy ${trajectory.provenance.policyVersion} is not approved for training`);
      }
      humanPolicies.add(trajectory.provenance.policyVersion);
    }
  }
  const counts: RouteChoiceModel["counts"] = {};
  const fallback: RouteChoiceModel["fallback"] = {};
  for (const example of trajectories.flatMap(routeChoiceExamples)) {
    const weight = finitePositive(example.weight, 1);
    const context = counts[example.context] ?? {};
    context[example.direction] = (context[example.direction] ?? 0) + weight;
    counts[example.context] = context;
    fallback[example.direction] = (fallback[example.direction] ?? 0) + weight;
  }
  const fingerprint = replayChecksum({ counts, fallback, label: options.versionLabel });
  return {
    kind: ROUTE_CHOICE_MODEL_KIND,
    version: `${options.versionLabel}-${fingerprint}`,
    trainingPolicyVersions: [...humanPolicies].sort(),
    counts,
    fallback
  };
}

export type RouteChoicePrediction = {
  direction: RouteDirection;
  probabilities: Record<RouteDirection, number>;
  modelVersion: string;
};

export function predictRouteChoice(
  model: RouteChoiceModel,
  context: string,
  allowed: readonly RouteDirection[] = routeDirections
): RouteChoicePrediction {
  assertModel(model);
  if (allowed.length === 0) throw new Error("Route choice requires at least one allowed direction");
  const uniqueAllowed = routeDirections.filter((direction) => allowed.includes(direction));
  const counts = model.counts[context] ?? model.fallback;
  const scored = uniqueAllowed.map((direction) => ({
    direction,
    score: (counts[direction] ?? 0) + 1
  }));
  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  const probabilities = Object.fromEntries(routeDirections.map((direction) => [
    direction,
    scored.find((entry) => entry.direction === direction)?.score ?? 0
  ]).map(([direction, score]) => [direction, Number(score) / total])) as Record<RouteDirection, number>;
  const direction = [...scored].sort((left, right) =>
    right.score - left.score || routeDirections.indexOf(left.direction) - routeDirections.indexOf(right.direction)
  )[0]?.direction ?? uniqueAllowed[0]!;
  return { direction, probabilities, modelVersion: model.version };
}

export type RouteChoiceEvaluation = {
  examples: number;
  accuracy: number;
  meanNegativeLogLikelihood: number;
  baselineAccuracy: number;
  improvesOnBaseline: boolean;
};

export function evaluateRouteChoiceModel(
  model: RouteChoiceModel,
  trajectories: readonly AgentTrajectory[],
  baseline: (context: string) => RouteDirection = () => "up"
): RouteChoiceEvaluation {
  const examples = trajectories.flatMap(routeChoiceExamples);
  if (examples.length === 0) {
    return { examples: 0, accuracy: 0, meanNegativeLogLikelihood: 0, baselineAccuracy: 0, improvesOnBaseline: false };
  }
  let correct = 0;
  let baselineCorrect = 0;
  let negativeLogLikelihood = 0;
  for (const example of examples) {
    const prediction = predictRouteChoice(model, example.context);
    if (prediction.direction === example.direction) correct += 1;
    if (baseline(example.context) === example.direction) baselineCorrect += 1;
    negativeLogLikelihood -= Math.log(Math.max(1e-9, prediction.probabilities[example.direction]));
  }
  const accuracy = correct / examples.length;
  const baselineAccuracy = baselineCorrect / examples.length;
  return {
    examples: examples.length,
    accuracy,
    meanNegativeLogLikelihood: negativeLogLikelihood / examples.length,
    baselineAccuracy,
    improvesOnBaseline: accuracy > baselineAccuracy
  };
}

export function guardLearnedDirection(
  learned: RouteDirection,
  validatedActions: readonly RouteDirection[],
  deterministicFallback: RouteDirection
): RouteDirection {
  if (validatedActions.includes(learned)) return learned;
  if (!validatedActions.includes(deterministicFallback)) {
    throw new Error("Deterministic fallback must be a validated action");
  }
  return deterministicFallback;
}

export function serializeRouteChoiceModel(model: RouteChoiceModel): string {
  assertModel(model);
  return stableStringify(model);
}

export function parseRouteChoiceModel(serialized: string): RouteChoiceModel {
  const parsed: unknown = JSON.parse(serialized);
  assertModel(parsed);
  return parsed;
}

export function assertTrajectory(trajectory: AgentTrajectory): void {
  if (trajectory.schemaVersion !== TRAJECTORY_SCHEMA_VERSION) throw new Error("Unsupported trajectory schema");
  if (!trajectory.id || !Number.isInteger(trajectory.tickRate) || trajectory.tickRate <= 0) {
    throw new Error("Trajectory requires an id and positive integer tick rate");
  }
  let previousTick = -1;
  for (const point of trajectory.points) {
    if (!Number.isInteger(point.tick) || point.tick <= previousTick) {
      throw new Error("Trajectory ticks must be strictly increasing non-negative integers");
    }
    if (![point.position.x, point.position.y].every(Number.isFinite)) {
      throw new Error("Trajectory positions must be finite");
    }
    previousTick = point.tick;
  }
  if (trajectory.provenance.kind === "anonymized-human") {
    if (!trajectory.provenance.policyVersion || !trajectory.provenance.datasetId || !trajectory.provenance.retentionDeadline) {
      throw new Error("Anonymized human trajectories require policy, dataset, and retention metadata");
    }
  }
}

function assertModel(value: unknown): asserts value is RouteChoiceModel {
  if (!value || typeof value !== "object" || (value as { kind?: string }).kind !== ROUTE_CHOICE_MODEL_KIND) {
    throw new Error("Unsupported route-choice model");
  }
  const model = value as RouteChoiceModel;
  if (!model.version || !model.counts || !model.fallback) throw new Error("Incomplete route-choice model");
}

function emptySetMetrics(): TrajectorySetMetrics {
  return {
    trajectories: 0,
    completionRate: 0,
    meanDurationTicks: 0,
    meanScore: 0,
    meanHesitationTicks: 0,
    meanReactionDelayTicks: 0,
    meanCollisions: 0,
    meanReplans: 0,
    meanDangerTicks: 0,
    meanMistakes: 0,
    routeDiversity: 0
  };
}

function meanSpacing(trajectories: readonly AgentTrajectory[]): number {
  const byTick = new Map<number, Array<{ x: number; y: number }>>();
  for (const trajectory of trajectories) {
    for (const point of trajectory.points) {
      const positions = byTick.get(point.tick) ?? [];
      positions.push(point.position);
      byTick.set(point.tick, positions);
    }
  }
  const distances = [...byTick.values()].flatMap((positions) => pairDistances(positions));
  return average(distances);
}

function pairDistances(points: readonly { x: number; y: number }[]): number[] {
  const distances: number[] = [];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      distances.push(euclidean(points[left]!, points[right]!));
    }
  }
  return distances;
}

function simplifyRoute(points: readonly { x: number; y: number }[]): string[] {
  const route: string[] = [];
  let previousDirection: RouteDirection | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const direction = directionBetween(points[index - 1]!, points[index]!);
    if (direction !== previousDirection) route.push(direction);
    previousDirection = direction;
  }
  return route;
}

function routeContext(point: TrajectoryPoint): string {
  return [
    point.targetId ?? "none",
    point.inDanger ? "danger" : "safe",
    point.action || "none"
  ].join("|");
}

const routeDirections = ["up", "down", "left", "right", "wait"] as const satisfies readonly RouteDirection[];

function directionBetween(
  from: { x: number; y: number },
  to: { x: number; y: number }
): RouteDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return "wait";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function pointKey(point: { x: number; y: number }): string {
  return `${Math.round(point.x * 1000) / 1000},${Math.round(point.y * 1000) / 1000}`;
}

function euclidean(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
