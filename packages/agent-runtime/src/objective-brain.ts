import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  type AgentBrain,
  type AgentHazard,
  type AgentIntention,
  type AgentObjective,
  type GridPoint
} from "./contracts.ts";
import {
  findPath,
  manhattanDistance,
  sameGridPoint,
  type AgentGrid,
  type GridCostProvider
} from "./grid.ts";
import type { ReservationBook } from "./reservations.ts";
import { createReservationCostProvider } from "./reservations.ts";
import { selectIntention, type UtilityIntention } from "./utility.ts";

export type ObjectiveHazardWorld = Readonly<{
  grid: AgentGrid;
  reservations?: ReservationBook;
  crowding?: ReadonlyMap<string, number>;
  dynamicCost?: GridCostProvider;
}>;

export type ObjectiveHazardBrainState = Readonly<{
  targetObjectiveId?: string;
  path: readonly GridPoint[];
  plannedAtMillis: number;
  completedObjectives: readonly string[];
}>;

export type ObjectiveHazardBrainOptions = Readonly<{
  id?: string;
  objectiveKind?: string;
  maxObjectiveValue?: number;
  hazardCost?: number;
  crowdingCost?: number;
  reservationCost?: number;
  stepMillis?: number;
  objectiveFilter?: (objective: AgentObjective) => boolean;
}>;

type ObjectiveContext = Readonly<{
  position: GridPoint;
  nowMillis: number;
  hazards: readonly AgentHazard[];
  maxDistance: number;
  maxObjectiveValue: number;
}>;

/** Risk is normalized to [0, 1] and accounts for moving, expiring hazards. */
export function hazardRiskAt(
  point: GridPoint,
  hazards: readonly AgentHazard[],
  atMillis: number
): number {
  let survival = 1;
  for (const hazard of hazards) {
    if ((hazard.activeFromMillis ?? Number.NEGATIVE_INFINITY) > atMillis
      || (hazard.activeUntilMillis ?? Number.POSITIVE_INFINITY) <= atMillis) {
      continue;
    }
    const positionAtMillis = hazard.positionAtMillis ?? hazard.activeFromMillis ?? 0;
    const elapsedSeconds = Math.max(0, atMillis - positionAtMillis) / 1_000;
    const center = hazard.velocity === undefined
      ? hazard.position
      : {
          x: hazard.position.x + hazard.velocity.x * elapsedSeconds,
          y: hazard.position.y + hazard.velocity.y * elapsedSeconds
        };
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    const radius = Math.max(0, hazard.radius);
    if (distance > radius) {
      continue;
    }
    const severity = clamp01(hazard.severity);
    const localRisk = severity * (radius === 0 ? 1 : 1 - distance / radius);
    survival *= 1 - clamp01(localRisk);
  }
  return clamp01(1 - survival);
}

export function createObjectiveHazardBrain(
  options: ObjectiveHazardBrainOptions = {}
): AgentBrain<ObjectiveHazardWorld, ObjectiveHazardBrainState> {
  const brainId = options.id ?? "objective-hazard";
  const stepMillis = options.stepMillis ?? 120;
  const maxObjectiveValue = Math.max(1, options.maxObjectiveValue ?? 100);
  const hazardCost = Math.max(0, options.hazardCost ?? 20);
  const crowdingCost = Math.max(0, options.crowdingCost ?? 2);
  const reservationCost = Math.max(0, options.reservationCost ?? 12);

  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id: brainId,
    initialState(): ObjectiveHazardBrainState {
      return Object.freeze({ path: Object.freeze([]), plannedAtMillis: 0, completedObjectives: Object.freeze([]) });
    },
    decide(context) {
      const { observation, profile, definition } = context;
      const { grid, reservations } = observation.world;
      const objectives = observation.objectives
        .filter((objective) => objective.expiresAtMillis === undefined || objective.expiresAtMillis > observation.nowMillis)
        .filter((objective) => options.objectiveKind === undefined || objective.kind === options.objectiveKind)
        .filter((objective) => options.objectiveFilter?.(objective) ?? true)
        .filter((objective) => objective.claimedBy === undefined || objective.claimedBy === definition.id)
        .filter((objective) => {
          const owner = reservations?.objectiveOwner(objective.id, observation.nowMillis);
          return owner === undefined || owner === definition.id;
        });
      const maxDistance = Math.max(1, grid.width + grid.height - 2);
      const intentions: UtilityIntention<ObjectiveContext>[] = objectives.map((objective) => ({
        id: `objective:${objective.id}`,
        label: `Pursue objective ${objective.id}`,
        targetId: objective.id,
        target: objective.position,
        considerations: [
          {
            id: "objective-value",
            label: "Objective value",
            weight: 1.4 + profile.parameters.exploration * 0.4,
            evaluate: ({ maxObjectiveValue: maximum }) => objective.value / maximum
          },
          {
            id: "travel-distance",
            label: "Travel distance",
            weight: 1.1,
            evaluate: ({ position, maxDistance: maximum }) =>
              1 - manhattanDistance(position, objective.position) / maximum
          },
          {
            id: "hazard-safety",
            label: "Hazard safety",
            weight: 0.5 + profile.parameters.caution * 2,
            evaluate: ({ hazards, nowMillis }) =>
              1 - hazardRiskAt(objective.position, hazards, nowMillis)
          },
          {
            id: "expiry-margin",
            label: "Expiry margin",
            weight: 0.4,
            evaluate: ({ nowMillis }) => objective.expiresAtMillis === undefined
              ? 1
              : Math.min(1, (objective.expiresAtMillis - nowMillis) / 5_000),
            vetoBelow: 0
          }
        ]
      }));
      const selection = selectIntention(
        intentions,
        {
          position: observation.position,
          nowMillis: observation.nowMillis,
          hazards: observation.hazards,
          maxDistance,
          maxObjectiveValue
        },
        {
          currentIntentionId: context.previousIntention?.id,
          stickiness: profile.parameters.targetStickiness,
          stickinessScale: 0.8
        }
      );
      const selectedId = selection.selected?.targetId;
      const objective = selectedId === undefined
        ? undefined
        : objectives.find((candidate) => candidate.id === selectedId);
      if (objective === undefined) {
        return Object.freeze({
          state: Object.freeze({
            ...context.state,
            targetObjectiveId: undefined,
            path: Object.freeze([]),
            plannedAtMillis: observation.nowMillis
          }),
          action: createAgentAction({
            actorId: definition.id,
            kind: "idle",
            atMillis: observation.nowMillis,
            explanation: "No available objective"
          }),
          intention: undefined,
          explanation: "No available objective",
          reconsiderAtMillis: observation.nowMillis + profile.parameters.replanIntervalMillis
        });
      }

      const costProviders: GridCostProvider[] = [
        ({ point, atMillis }) => hazardRiskAt(point, observation.hazards, atMillis) * hazardCost * profile.parameters.caution
      ];
      if (observation.world.dynamicCost !== undefined) {
        costProviders.push(observation.world.dynamicCost);
      }
      if (observation.world.crowding !== undefined) {
        costProviders.push(({ point }) =>
          (observation.world.crowding?.get(`${point.x},${point.y}`) ?? 0) * crowdingCost
        );
      }
      if (reservations !== undefined) {
        costProviders.push(createReservationCostProvider(reservations, {
          ownerId: definition.id,
          cost: reservationCost
        }));
      }
      const path = findPath(grid, observation.position, objective.position, {
        atMillis: observation.nowMillis,
        stepMillis,
        additionalCosts: costProviders
      });
      const ttl = Math.max(
        100,
        Math.min(
          profile.parameters.reservationHorizonMillis,
          (objective.expiresAtMillis ?? Number.POSITIVE_INFINITY) - observation.nowMillis
        )
      );
      if (path.reached && reservations !== undefined) {
        reservations.reserveObjective(definition.id, objective.id, observation.nowMillis, ttl);
        reservations.reserveDestination(definition.id, objective.position, observation.nowMillis, ttl);
        if (path.path.length > 1) {
          reservations.reserveCorridor(definition.id, path.path.slice(1), observation.nowMillis, ttl, { stepMillis });
        }
      }

      const intention: AgentIntention = Object.freeze({
        id: `objective:${objective.id}`,
        label: `Pursue objective ${objective.id}`,
        selectedAtMillis: observation.nowMillis,
        targetId: objective.id,
        target: objective.position,
        expiresAtMillis: objective.expiresAtMillis,
        utility: selection.selectedScore
      });
      const action = !path.reached
        ? createAgentAction({
            actorId: definition.id,
            kind: "idle",
            atMillis: observation.nowMillis,
            targetId: objective.id,
            explanation: "Objective is unreachable"
          })
        : sameGridPoint(observation.position, objective.position)
          ? createAgentAction({
              actorId: definition.id,
              kind: "interact",
              atMillis: observation.nowMillis,
              target: objective.position,
              targetId: objective.id,
              explanation: selection.explanation
            })
          : createAgentAction({
              actorId: definition.id,
              kind: "move",
              atMillis: observation.nowMillis,
              target: path.path[1] as GridPoint,
              targetId: objective.id,
              explanation: `${selection.explanation}; path cost ${path.cost.toFixed(2)}`
            });
      return Object.freeze({
        state: Object.freeze({
          ...context.state,
          targetObjectiveId: objective.id,
          path: path.path,
          plannedAtMillis: observation.nowMillis
        }),
        action,
        intention,
        explanation: action.explanation ?? selection.explanation,
        reconsiderAtMillis: observation.nowMillis + profile.parameters.replanIntervalMillis
      });
    }
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
