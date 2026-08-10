import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  type AgentBrain,
  type AgentIntention,
  type GridPoint
} from "./contracts.ts";
import { findPath, manhattanDistance, sameGridPoint, type AgentGrid } from "./grid.ts";
import type { AgentProfile } from "./profiles.ts";
import { createReservationCostProvider, type ReservationBook } from "./reservations.ts";
import { selectIntention, type UtilitySelection } from "./utility.ts";

export type SafeZone = Readonly<{
  id: string;
  center: GridPoint;
  radius?: number;
  capacity?: number;
  occupants?: number;
  safeUntilMillis?: number;
  safety?: number;
}>;

export type LavaSafeZoneWorld = Readonly<{
  grid: AgentGrid;
  safeZones: readonly SafeZone[];
  lavaCostAt(point: GridPoint, atMillis: number): number;
  reservations?: ReservationBook;
}>;

export type SafeZoneSelectionContext = Readonly<{
  agentId: string;
  position: GridPoint;
  nowMillis: number;
  world: LavaSafeZoneWorld;
  profile: AgentProfile;
  currentZoneId?: string;
}>;

export type LavaSafeZoneState = Readonly<{
  zoneId?: string;
  path: readonly GridPoint[];
  plannedAtMillis: number;
}>;

export function selectSafestZone(
  context: SafeZoneSelectionContext
): UtilitySelection<SafeZoneSelectionContext> {
  const maxDistance = Math.max(1, context.world.grid.width + context.world.grid.height - 2);
  return selectIntention(context.world.safeZones.map((zone) => ({
    id: `safe-zone:${zone.id}`,
    label: `Reach safe zone ${zone.id}`,
    targetId: zone.id,
    target: zone.center,
    available: ({ nowMillis }) => (zone.safeUntilMillis ?? Number.POSITIVE_INFINITY) > nowMillis
      && (zone.occupants ?? 0) < (zone.capacity ?? Number.POSITIVE_INFINITY),
    considerations: [
      {
        id: "zone-safety",
        label: "Zone safety",
        weight: 1.5 + context.profile.parameters.caution,
        evaluate: () => clamp01(zone.safety ?? 1)
      },
      {
        id: "lava-exposure",
        label: "Lava exposure",
        weight: 1 + context.profile.parameters.caution * 2,
        curve: "inverse" as const,
        evaluate: ({ world, nowMillis }) => clamp01(world.lavaCostAt(zone.center, nowMillis) / 20)
      },
      {
        id: "travel-distance",
        label: "Travel distance",
        weight: 1.2,
        evaluate: ({ position }) => 1 - manhattanDistance(position, zone.center) / maxDistance
      },
      {
        id: "free-capacity",
        label: "Free capacity",
        weight: 0.5 + context.profile.parameters.teamwork,
        evaluate: () => zone.capacity === undefined
          ? 1
          : 1 - (zone.occupants ?? 0) / Math.max(1, zone.capacity)
      }
    ]
  })), context, {
    currentIntentionId: context.currentZoneId === undefined ? undefined : `safe-zone:${context.currentZoneId}`,
    stickiness: context.profile.parameters.targetStickiness
  });
}

export function createLavaSafeZoneController(
  id = "lava-safe-zone"
): AgentBrain<LavaSafeZoneWorld, LavaSafeZoneState> {
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id,
    initialState(): LavaSafeZoneState {
      return Object.freeze({ path: Object.freeze([]), plannedAtMillis: 0 });
    },
    decide(context) {
      const { observation, definition, profile } = context;
      const selection = selectSafestZone({
        agentId: definition.id,
        position: observation.position,
        nowMillis: observation.nowMillis,
        world: observation.world,
        profile,
        currentZoneId: context.state.zoneId
      });
      const zoneId = selection.selected?.targetId;
      const zone = observation.world.safeZones.find((candidate) => candidate.id === zoneId);
      if (zone === undefined) {
        return Object.freeze({
          state: Object.freeze({ zoneId: undefined, path: Object.freeze([]), plannedAtMillis: observation.nowMillis }),
          action: createAgentAction({
            actorId: definition.id,
            kind: "idle",
            atMillis: observation.nowMillis,
            explanation: "No safe zone is available"
          }),
          intention: undefined,
          explanation: selection.explanation
        });
      }
      const reservationCost = observation.world.reservations === undefined
        ? undefined
        : createReservationCostProvider(observation.world.reservations, { ownerId: definition.id, cost: 15 });
      const path = findPath(observation.world.grid, observation.position, zone.center, {
        atMillis: observation.nowMillis,
        stepMillis: 100,
        timeCost: ({ point, atMillis }) =>
          Math.max(0, observation.world.lavaCostAt(point, atMillis)) * (0.5 + profile.parameters.caution),
        reservationCost
      });
      const ttl = Math.max(100, Math.min(
        profile.parameters.reservationHorizonMillis,
        (zone.safeUntilMillis ?? Number.POSITIVE_INFINITY) - observation.nowMillis
      ));
      if (path.reached && observation.world.reservations !== undefined) {
        observation.world.reservations.reserveDestination(definition.id, zone.center, observation.nowMillis, ttl);
        if (path.path.length > 1) {
          observation.world.reservations.reserveCorridor(
            definition.id,
            path.path.slice(1),
            observation.nowMillis,
            ttl,
            { stepMillis: 100 }
          );
        }
      }
      const intention: AgentIntention = Object.freeze({
        id: `safe-zone:${zone.id}`,
        label: `Reach safe zone ${zone.id}`,
        selectedAtMillis: observation.nowMillis,
        targetId: zone.id,
        target: zone.center,
        expiresAtMillis: zone.safeUntilMillis,
        utility: selection.selectedScore
      });
      const action = !path.reached
        ? createAgentAction({
            actorId: definition.id,
            kind: "idle",
            atMillis: observation.nowMillis,
            targetId: zone.id,
            explanation: "Safe zone is unreachable"
          })
        : sameGridPoint(observation.position, zone.center)
          ? createAgentAction({
              actorId: definition.id,
              kind: "idle",
              atMillis: observation.nowMillis,
              target: zone.center,
              targetId: zone.id,
              explanation: "Holding the safest available zone"
            })
          : createAgentAction({
              actorId: definition.id,
              kind: "move",
              atMillis: observation.nowMillis,
              target: path.path[1] as GridPoint,
              targetId: zone.id,
              explanation: selection.explanation
            });
      return Object.freeze({
        state: Object.freeze({ zoneId: zone.id, path: path.path, plannedAtMillis: observation.nowMillis }),
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
