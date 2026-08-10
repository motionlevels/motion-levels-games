import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  type AgentBrain,
  type AgentEntity,
  type AgentIntention,
  type AgentVector,
  type GridPoint
} from "./contracts.ts";
import { euclideanDistance, findPath, type AgentGrid } from "./grid.ts";

export type InterceptionBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

export type InterceptionPrediction = Readonly<{
  point: AgentVector;
  timeMillis: number;
  reachable: boolean;
}>;

export type ChaseWorld = Readonly<{
  grid?: AgentGrid;
  targetId?: string;
}>;

export type ChaseBrainState = Readonly<{
  targetId?: string;
  intercept?: GridPoint;
  plannedAtMillis: number;
}>;

export type ChaseControllerOptions = Readonly<{
  id?: string;
  targetKind?: string;
  speedTilesPerSecond?: number;
  captureDistance?: number;
  maxPredictionMillis?: number;
}>;

/** Closed-form constant-velocity interception, bounded for stable gameplay. */
export function predictInterceptPoint(
  chaser: AgentVector,
  target: AgentVector,
  targetVelocity: AgentVector,
  chaserSpeedPerSecond: number,
  maxPredictionMillis: number,
  predictionStrength = 1,
  bounds?: InterceptionBounds
): InterceptionPrediction {
  if (!Number.isFinite(chaserSpeedPerSecond) || chaserSpeedPerSecond <= 0) {
    throw new Error("Chaser speed must be positive");
  }
  const horizonSeconds = Math.max(0, maxPredictionMillis) / 1_000;
  const relativeX = target.x - chaser.x;
  const relativeY = target.y - chaser.y;
  const a = targetVelocity.x ** 2 + targetVelocity.y ** 2 - chaserSpeedPerSecond ** 2;
  const b = 2 * (relativeX * targetVelocity.x + relativeY * targetVelocity.y);
  const c = relativeX ** 2 + relativeY ** 2;
  const roots = solvePositiveTime(a, b, c);
  const unboundedTime = roots[0];
  const reachable = unboundedTime !== undefined && unboundedTime <= horizonSeconds;
  const time = Math.min(horizonSeconds, unboundedTime ?? horizonSeconds) * clamp01(predictionStrength);
  let point: AgentVector = {
    x: target.x + targetVelocity.x * time,
    y: target.y + targetVelocity.y * time
  };
  if (bounds !== undefined) {
    point = {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y))
    };
  }
  return Object.freeze({ point: Object.freeze(point), timeMillis: time * 1_000, reachable });
}

export function createChaseInterceptionController(
  options: ChaseControllerOptions = {}
): AgentBrain<ChaseWorld, ChaseBrainState> {
  const id = options.id ?? "chase-interception";
  const speed = options.speedTilesPerSecond ?? 5;
  const captureDistance = options.captureDistance ?? 0.75;
  const maxPredictionMillis = options.maxPredictionMillis ?? 1_500;
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id,
    initialState(): ChaseBrainState {
      return Object.freeze({ plannedAtMillis: 0 });
    },
    decide(context) {
      const { observation, definition, profile } = context;
      const target = chooseChaseTarget(
        observation.entities,
        observation.position,
        observation.world.targetId,
        options.targetKind
      );
      if (target === undefined) {
        return Object.freeze({
          state: Object.freeze({ targetId: undefined, intercept: undefined, plannedAtMillis: observation.nowMillis }),
          action: createAgentAction({
            actorId: definition.id,
            kind: "idle",
            atMillis: observation.nowMillis,
            explanation: "No chase target is visible"
          }),
          intention: undefined,
          explanation: "No chase target is visible"
        });
      }
      const distance = euclideanDistance(observation.position, target.position);
      const prediction = predictInterceptPoint(
        observation.position,
        target.position,
        target.velocity ?? { x: 0, y: 0 },
        speed,
        maxPredictionMillis,
        profile.parameters.prediction,
        observation.world.grid === undefined
          ? undefined
          : {
              minX: 0,
              maxX: observation.world.grid.width - 1,
              minY: 0,
              maxY: observation.world.grid.height - 1
            }
      );
      const intercept = Object.freeze({
        x: Math.round(prediction.point.x),
        y: Math.round(prediction.point.y)
      });
      const path = observation.world.grid === undefined
        ? undefined
        : findPath(observation.world.grid, observation.position, intercept);
      const nextTarget = path?.reached === true && path.path[1] !== undefined ? path.path[1] : intercept;
      const intention: AgentIntention = Object.freeze({
        id: `chase:${target.id}`,
        label: `Intercept ${target.id}`,
        selectedAtMillis: observation.nowMillis,
        targetId: target.id,
        target: intercept
      });
      const action = createAgentAction({
        actorId: definition.id,
        kind: distance <= captureDistance ? "interact" : "move",
        atMillis: observation.nowMillis,
        target: distance <= captureDistance ? target.position : nextTarget,
        targetId: target.id,
        payload: Object.freeze({ predictionMillis: prediction.timeMillis, predictionReachable: prediction.reachable }),
        explanation: distance <= captureDistance
          ? `Captured ${target.id}`
          : `Intercepting ${target.id} ${prediction.timeMillis.toFixed(0)}ms ahead`
      });
      return Object.freeze({
        state: Object.freeze({ targetId: target.id, intercept, plannedAtMillis: observation.nowMillis }),
        action,
        intention,
        explanation: action.explanation ?? `Intercepting ${target.id}`
      });
    }
  });
}

function chooseChaseTarget(
  entities: readonly AgentEntity[],
  position: GridPoint,
  requestedId: string | undefined,
  kind: string | undefined
): AgentEntity | undefined {
  const candidates = entities
    .filter((entity) => requestedId === undefined || entity.id === requestedId)
    .filter((entity) => kind === undefined || entity.kind === kind);
  return [...candidates].sort((first, second) =>
    euclideanDistance(position, first.position) - euclideanDistance(position, second.position)
      || first.id.localeCompare(second.id)
  )[0];
}

function solvePositiveTime(a: number, b: number, c: number): readonly number[] {
  const epsilon = 1e-9;
  if (Math.abs(a) < epsilon) {
    if (Math.abs(b) < epsilon) {
      return c <= epsilon ? Object.freeze([0]) : Object.freeze([]);
    }
    const root = -c / b;
    return root >= 0 ? Object.freeze([root]) : Object.freeze([]);
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return Object.freeze([]);
  }
  const squareRoot = Math.sqrt(discriminant);
  return Object.freeze(
    [(-b - squareRoot) / (2 * a), (-b + squareRoot) / (2 * a)]
      .filter((root) => root >= 0)
      .sort((first, second) => first - second)
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
