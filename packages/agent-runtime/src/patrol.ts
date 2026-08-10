import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  createAgentDefinition,
  type AgentBrain,
  type AgentDefinition,
  type AgentIntention,
  type AgentObservation,
  type GridPoint
} from "./contracts.ts";
import { sameGridPoint } from "./grid.ts";

export type FixedPatrolConfig = Readonly<{
  spawn: GridPoint;
  path: readonly GridPoint[];
  speed: number;
  damage: number;
  loop: boolean;
}>;

export type LegacyFixedPatrol = Readonly<{
  id: string;
  spawn: GridPoint;
  path: readonly GridPoint[];
  speed: number;
  damage: number;
  loop?: boolean;
  profileId?: string;
  teamId?: string;
}>;

export type PatrolBrainState = Readonly<{
  waypointIndex: number;
  laps: number;
}>;

export type LegacyPatrolAdapter = Readonly<{
  definition: AgentDefinition;
  brain: PatrolBrain;
  spawn: GridPoint;
}>;

/**
 * Adapter for the pre-runtime fixed patrol shape. No interpolation or path
 * optimization is introduced: waypoints are visited in their declared order.
 */
export function adaptLegacyFixedPatrol(specification: LegacyFixedPatrol): LegacyPatrolAdapter {
  const config = normalizePatrolConfig(specification);
  const definition = createAgentDefinition({
    id: specification.id,
    brainId: "fixed-patrol",
    profileId: specification.profileId ?? "balanced",
    teamId: specification.teamId,
    config: Object.freeze({ patrol: config })
  });
  return Object.freeze({
    definition,
    brain: new PatrolBrain(),
    spawn: config.spawn
  });
}

export class PatrolBrain implements AgentBrain<unknown, PatrolBrainState> {
  public readonly version = AGENT_CONTRACT_VERSION;
  public readonly id = "fixed-patrol";

  public initialState(_definition: AgentDefinition, _observation: AgentObservation<unknown>): PatrolBrainState {
    return Object.freeze({ waypointIndex: 0, laps: 0 });
  }

  public decide(context: Parameters<AgentBrain<unknown, PatrolBrainState>["decide"]>[0]) {
    const config = readPatrolConfig(context.definition);
    if (config.path.length === 0) {
      return Object.freeze({
        state: context.state,
        action: createAgentAction({
          actorId: context.definition.id,
          kind: "idle",
          atMillis: context.observation.nowMillis,
          payload: patrolPayload(config),
          explanation: "Fixed patrol has no waypoints"
        }),
        intention: undefined,
        explanation: "Fixed patrol has no waypoints"
      });
    }

    let waypointIndex = Math.min(context.state.waypointIndex, config.path.length - 1);
    let laps = context.state.laps;
    const currentTarget = config.path[waypointIndex] as GridPoint;
    if (sameGridPoint(context.observation.position, currentTarget)) {
      if (waypointIndex + 1 < config.path.length) {
        waypointIndex += 1;
      } else if (config.loop) {
        waypointIndex = 0;
        laps += 1;
      }
    }
    const target = config.path[waypointIndex] as GridPoint;
    const intention: AgentIntention = Object.freeze({
      id: `patrol:${waypointIndex}`,
      label: `Patrol waypoint ${waypointIndex + 1}`,
      selectedAtMillis: context.observation.nowMillis,
      targetId: String(waypointIndex),
      target
    });
    const atFinalNonLoopingWaypoint = !config.loop
      && waypointIndex === config.path.length - 1
      && sameGridPoint(context.observation.position, target);
    const action = createAgentAction({
      actorId: context.definition.id,
      kind: atFinalNonLoopingWaypoint ? "idle" : "move",
      atMillis: context.observation.nowMillis,
      target,
      targetId: String(waypointIndex),
      payload: patrolPayload(config),
      explanation: atFinalNonLoopingWaypoint ? "Fixed patrol complete" : `Following fixed waypoint ${waypointIndex + 1}`
    });
    return Object.freeze({
      state: Object.freeze({ waypointIndex, laps }),
      action,
      intention,
      explanation: action.explanation ?? "Following fixed patrol"
    });
  }
}

export function readPatrolConfig(definition: AgentDefinition): FixedPatrolConfig {
  const value = definition.config?.patrol;
  if (!isRecord(value)) {
    throw new Error(`Agent ${definition.id} has no fixed patrol config`);
  }
  const spawn = readPoint(value.spawn, "spawn");
  if (!Array.isArray(value.path)) {
    throw new Error("Patrol path must be an array");
  }
  const path = Object.freeze(value.path.map((point, index) => readPoint(point, `path[${index}]`)));
  const speed = readFinite(value.speed, "speed", 0, false);
  const damage = readFinite(value.damage, "damage", 0, true);
  return Object.freeze({ spawn, path, speed, damage, loop: value.loop !== false });
}

function normalizePatrolConfig(specification: LegacyFixedPatrol): FixedPatrolConfig {
  if (specification.id.length === 0) {
    throw new Error("Legacy patrol id must not be empty");
  }
  const spawn = readPoint(specification.spawn, "spawn");
  const declaredPath = specification.path.map((point, index) => readPoint(point, `path[${index}]`));
  const path = declaredPath.length === 0 || !sameGridPoint(declaredPath[0] as GridPoint, spawn)
    ? [spawn, ...declaredPath]
    : declaredPath;
  return Object.freeze({
    spawn,
    path: Object.freeze(path),
    speed: readFinite(specification.speed, "speed", 0, false),
    damage: readFinite(specification.damage, "damage", 0, true),
    loop: specification.loop ?? true
  });
}

function patrolPayload(config: FixedPatrolConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    speed: config.speed,
    damage: config.damage,
    spawn: config.spawn
  });
}

function readPoint(value: unknown, label: string): GridPoint {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y)) {
    throw new Error(`Patrol ${label} must be an integer grid point`);
  }
  return Object.freeze({ x: value.x as number, y: value.y as number });
}

function readFinite(
  value: unknown,
  label: string,
  minimum: number,
  allowMinimum: boolean
): number {
  if (typeof value !== "number" || !Number.isFinite(value)
    || (allowMinimum ? value < minimum : value <= minimum)) {
    throw new Error(`Patrol ${label} must be ${allowMinimum ? "non-negative" : "positive"}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
