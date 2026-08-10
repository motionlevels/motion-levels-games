import type { GridPoint } from "./contracts.ts";
import { manhattanDistance } from "./grid.ts";
import type { AgentProfile } from "./profiles.ts";
import type { ReservationBook } from "./reservations.ts";

export type TeamAgent = Readonly<{
  id: string;
  position: GridPoint;
  role?: string;
  traits?: Readonly<Record<string, number>>;
}>;

export type TeamObjective = Readonly<{
  id: string;
  position: GridPoint;
  value: number;
  preferredRole?: string;
  capacity?: number;
  expiresAtMillis?: number;
}>;

export type TeamAssignment = Readonly<{
  agentId: string;
  objectiveId: string;
  score: number;
  explanation: string;
}>;

export type TeamAssignmentOptions = Readonly<{
  nowMillis?: number;
  distanceWeight?: number;
  roleBonus?: number;
  reservations?: ReservationBook;
  profiles?: ReadonlyMap<string, AgentProfile>;
}>;

export type ArenaRole = Readonly<{
  id: string;
  anchor: GridPoint;
  priority?: number;
  desiredTraits?: Readonly<Record<string, number>>;
}>;

export type ArenaRoleAssignment = Readonly<{
  agentId: string;
  roleId: string;
  anchor: GridPoint;
  score: number;
}>;

export type TeamArenaPlan = Readonly<{
  objectiveAssignments: readonly TeamAssignment[];
  roleAssignments: readonly ArenaRoleAssignment[];
  generatedAtMillis: number;
}>;

/** Stable global pair ranking with per-objective capacities. */
export function assignTeamObjectives(
  agents: readonly TeamAgent[],
  objectives: readonly TeamObjective[],
  options: TeamAssignmentOptions = {}
): readonly TeamAssignment[] {
  const nowMillis = options.nowMillis ?? 0;
  const distanceWeight = options.distanceWeight ?? 1;
  const roleBonus = options.roleBonus ?? 4;
  const pairs = agents.flatMap((agent) => objectives
    .filter((objective) => objective.expiresAtMillis === undefined || objective.expiresAtMillis > nowMillis)
    .filter((objective) => {
      const owner = options.reservations?.objectiveOwner(objective.id, nowMillis);
      return owner === undefined || owner === agent.id;
    })
    .map((objective) => {
      const profile = options.profiles?.get(agent.id);
      const teamwork = profile?.parameters.teamwork ?? 0.5;
      const distance = manhattanDistance(agent.position, objective.position);
      const roleMatch = objective.preferredRole !== undefined && objective.preferredRole === agent.role;
      const score = objective.value * (0.75 + teamwork * 0.5)
        - distance * distanceWeight
        + (roleMatch ? roleBonus : 0);
      return Object.freeze({ agent, objective, score, distance, roleMatch });
    }));
  pairs.sort((first, second) =>
    second.score - first.score
      || first.distance - second.distance
      || first.agent.id.localeCompare(second.agent.id)
      || first.objective.id.localeCompare(second.objective.id)
  );

  const assignedAgents = new Set<string>();
  const objectiveCounts = new Map<string, number>();
  const assignments: TeamAssignment[] = [];
  for (const pair of pairs) {
    const count = objectiveCounts.get(pair.objective.id) ?? 0;
    if (assignedAgents.has(pair.agent.id) || count >= (pair.objective.capacity ?? 1)) {
      continue;
    }
    assignedAgents.add(pair.agent.id);
    objectiveCounts.set(pair.objective.id, count + 1);
    assignments.push(Object.freeze({
      agentId: pair.agent.id,
      objectiveId: pair.objective.id,
      score: pair.score,
      explanation: pair.roleMatch
        ? `Role match; distance ${pair.distance}`
        : `Best available team utility; distance ${pair.distance}`
    }));
  }
  return Object.freeze(assignments.sort((first, second) => first.agentId.localeCompare(second.agentId)));
}

export function assignArenaRoles(
  agents: readonly TeamAgent[],
  roles: readonly ArenaRole[]
): readonly ArenaRoleAssignment[] {
  const pairs = agents.flatMap((agent) => roles.map((role) => {
    const distance = manhattanDistance(agent.position, role.anchor);
    const traitScore = Object.entries(role.desiredTraits ?? {}).reduce(
      (score, [trait, weight]) => score + (agent.traits?.[trait] ?? 0) * weight,
      0
    );
    return Object.freeze({ agent, role, score: (role.priority ?? 0) + traitScore - distance, distance });
  }));
  pairs.sort((first, second) =>
    second.score - first.score
      || first.distance - second.distance
      || first.role.id.localeCompare(second.role.id)
      || first.agent.id.localeCompare(second.agent.id)
  );
  const usedAgents = new Set<string>();
  const usedRoles = new Set<string>();
  const result: ArenaRoleAssignment[] = [];
  for (const pair of pairs) {
    if (usedAgents.has(pair.agent.id) || usedRoles.has(pair.role.id)) {
      continue;
    }
    usedAgents.add(pair.agent.id);
    usedRoles.add(pair.role.id);
    result.push(Object.freeze({
      agentId: pair.agent.id,
      roleId: pair.role.id,
      anchor: pair.role.anchor,
      score: pair.score
    }));
  }
  return Object.freeze(result.sort((first, second) => first.roleId.localeCompare(second.roleId)));
}

export class TeamArenaCoordinator {
  readonly #reservations?: ReservationBook;

  public constructor(reservations?: ReservationBook) {
    this.#reservations = reservations;
  }

  public plan(
    agents: readonly TeamAgent[],
    objectives: readonly TeamObjective[],
    roles: readonly ArenaRole[],
    nowMillis: number,
    profiles?: ReadonlyMap<string, AgentProfile>
  ): TeamArenaPlan {
    const objectiveAssignments = assignTeamObjectives(agents, objectives, {
      nowMillis,
      reservations: this.#reservations,
      profiles
    });
    for (const assignment of objectiveAssignments) {
      const objective = objectives.find((candidate) => candidate.id === assignment.objectiveId);
      const profile = profiles?.get(assignment.agentId);
      if (objective !== undefined && this.#reservations !== undefined) {
        const ttl = Math.max(100, Math.min(
          profile?.parameters.reservationHorizonMillis ?? 2_000,
          (objective.expiresAtMillis ?? Number.POSITIVE_INFINITY) - nowMillis
        ));
        this.#reservations.reserveObjective(assignment.agentId, objective.id, nowMillis, ttl);
        this.#reservations.reserveDestination(assignment.agentId, objective.position, nowMillis, ttl);
      }
    }
    return Object.freeze({
      objectiveAssignments,
      roleAssignments: assignArenaRoles(agents, roles),
      generatedAtMillis: nowMillis
    });
  }
}

export function createTeamArenaCoordinator(reservations?: ReservationBook): TeamArenaCoordinator {
  return new TeamArenaCoordinator(reservations);
}
