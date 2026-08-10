import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  createAgentDefinition,
  createAgentObservation,
  createAgentRuntime,
  createGrid,
  defineAgentProfile,
  findPath,
  getAgentProfile,
  manhattanDistance,
  selectIntention,
  type AgentAction,
  type AgentBrain,
  type AgentDefinition,
  type AgentIntention,
  type AgentObservation,
  type AgentProfile,
  type AgentProfileId,
  type AgentReplanReason,
  type AgentRuntime,
  type AgentSnapshot,
  type AgentStepResult,
  type GridPoint
} from "@motion-levels-games/agent-runtime";
import { FLOOR_COLS, FLOOR_ROWS } from "@motion-levels-games/game-sdk";
import type { DueloGameInstance, DueloSnapshot } from "./game.ts";

export const DUELO_AGENT_BRAIN_ID = "duelo-semantic-targets";
export const DUELO_AGENT_CONTRACT_VERSION = 2 as const;
export const DUELO_RIVAL_TILE_PATH_COST = 8;

/**
 * A zero-mistake reference profile for parity and fairness tests. Production
 * callers can select any reusable agent-runtime profile instead.
 */
export const DUELO_REFERENCE_AGENT_PROFILE = defineAgentProfile(
  "duelo-reference",
  "Duelo reference",
  {
    reactionDelayMillis: 60,
    mistakeRate: 0,
    mistakeSeverity: 0,
    targetStickiness: 0,
    caution: 0.55,
    exploration: 0.45,
    teamwork: 0.5,
    prediction: 0.6,
    memoryDecayPerSecond: 0,
    replanIntervalMillis: 80,
    stuckWindowMillis: 1_000,
    stuckDistance: 0,
    reservationHorizonMillis: 1_000
  }
);

export type DueloProfileId = AgentProfileId | "duelo-reference";

export type DueloBoardTarget = Readonly<{
  id: string;
  owner: number;
  position: GridPoint;
}>;

export type DueloSemanticBoard = Readonly<{
  signature: string;
  targets: readonly DueloBoardTarget[];
  targetsByPlayer: readonly (readonly DueloBoardTarget[])[];
}>;

export type DueloPathOptions = Readonly<{
  playerIndex?: number;
  remainingTargets?: readonly DueloBoardTarget[];
  rivalTileCost?: number;
}>;

export type DueloSemanticWorld = Readonly<{
  boardSignature: string;
  phase: DueloSnapshot["phase"];
  playerIndex: number;
  progress: readonly Readonly<{
    playerIndex: number;
    claimed: number;
    remaining: number;
    target: number;
  }>[];
  remainingTargetCount: number;
  totalTargetCount: number;
}>;

export type DueloBrainState = Readonly<{
  decisions: number;
  lastExplanation: string;
  lastTargetId?: string;
  lastUtility?: number;
}>;

export type DueloSemanticAgent = Readonly<{
  id: string;
  playerIndex: number;
  position: GridPoint;
}>;

export type CreateDueloObservationOptions = Readonly<{
  agentId: string;
  playerIndex: number;
  tick: number;
  atMillis: number;
  position: GridPoint;
  agents: readonly DueloSemanticAgent[];
  remainingTargets: readonly DueloBoardTarget[];
  snapshot: DueloSnapshot;
  boardSignature: string;
}>;

export type DueloAgentControllerOptions = Readonly<{
  playerIndex: number;
  seed: number;
  profile?: DueloProfileId | AgentProfile;
  id?: string;
}>;

export type DueloDirectorProfileSelection =
  | DueloProfileId
  | AgentProfile
  | readonly (DueloProfileId | AgentProfile)[];

export type DueloAgentDirectorOptions = Readonly<{
  game: DueloGameInstance;
  playerCount: number;
  seed: number;
  profile?: DueloDirectorProfileSelection;
}>;

export type DueloAgentDirectorAgent = DueloSemanticAgent & Readonly<{
  /** False while an external avatar is already following its current route. */
  requestDecision?: boolean;
  /** The target currently followed by the external avatar, if any. */
  targetId?: string;
}>;

export type DueloAgentDirectorInput = Readonly<{
  tick: number;
  atMillis: number;
  agents: readonly DueloAgentDirectorAgent[];
  snapshot: DueloSnapshot;
}>;

export type DueloDirectedAgentDecision = Readonly<{
  id: string;
  playerIndex: number;
  action?: AgentAction;
  intendedAction?: AgentAction;
  intention?: AgentIntention;
  path: readonly GridPoint[];
  explanation: string;
  planned: boolean;
  mistakeApplied: boolean;
  targetInvalidated: boolean;
  replanReason?: AgentReplanReason;
  pendingUntilMillis?: number;
  runtime?: AgentSnapshot<DueloBrainState>;
}>;

export type DueloAgentDirectorFrame = Readonly<{
  tick: number;
  atMillis: number;
  boardSignature: string;
  remainingTargets: readonly DueloBoardTarget[];
  decisions: readonly DueloDirectedAgentDecision[];
}>;

const FLOOR_GRID = createGrid({ width: FLOOR_COLS, height: FLOOR_ROWS });
const MAX_MANHATTAN_DISTANCE = FLOOR_COLS + FLOOR_ROWS - 2;

/** Pure deterministic target-selection brain; it owns no game or wall clock. */
export function createDueloAgentBrain(): AgentBrain<DueloSemanticWorld, DueloBrainState> {
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id: DUELO_AGENT_BRAIN_ID,
    initialState: () => Object.freeze({
      decisions: 0,
      lastExplanation: "Awaiting the first semantic Duelo observation"
    }),
    decide(context) {
      const { observation, profile, previousIntention, random } = context;
      if (observation.world.phase !== "running") {
        return Object.freeze({
          state: Object.freeze({
            ...context.state,
            lastExplanation: `Waiting while Duelo is ${observation.world.phase}`
          }),
          explanation: `Player ${observation.world.playerIndex + 1} waits for the running phase`,
          reconsiderAtMillis: observation.nowMillis + 20
        });
      }

      const objectives = [...observation.objectives].sort((first, second) =>
        first.id.localeCompare(second.id)
      );
      if (objectives.length === 0) {
        const explanation = `Player ${observation.world.playerIndex + 1} has no owned targets left`;
        return Object.freeze({
          state: Object.freeze({
            decisions: context.state.decisions + 1,
            lastExplanation: explanation,
            lastTargetId: undefined,
            lastUtility: 1
          }),
          intention: Object.freeze({
            id: `duelo-complete:${observation.world.playerIndex}`,
            label: "owned targets complete",
            selectedAtMillis: observation.nowMillis,
            utility: 1
          }),
          explanation,
          reconsiderAtMillis: observation.nowMillis + profile.parameters.replanIntervalMillis
        });
      }

      const intentions = objectives.map((objective) => {
        const distance = manhattanDistance(observation.position, objective.position);
        const nearbyTargets = objectives.filter((other) =>
          other.id !== objective.id && manhattanDistance(objective.position, other.position) <= 2
        ).length;
        const proximity = 1 - distance / MAX_MANHATTAN_DISTANCE;
        const clusterDensity = Math.min(1, nearbyTargets / 6);
        const seededExploration = random.next() * profile.parameters.exploration;
        return Object.freeze({
          id: `claim:${objective.id}`,
          label: `claim ${objective.id}`,
          targetId: objective.id,
          target: objective.position,
          baseUtility: seededExploration * 0.08,
          considerations: Object.freeze([
            Object.freeze({
              id: "proximity",
              label: "short travel",
              weight: 1.1 + profile.parameters.caution * 0.7,
              evaluate: () => proximity
            }),
            Object.freeze({
              id: "cluster",
              label: "nearby owned targets",
              weight: 0.25 + profile.parameters.exploration * 0.4,
              evaluate: () => clusterDensity
            })
          ])
        });
      });
      const selection = selectIntention(intentions, observation, {
        currentIntentionId: previousIntention?.id,
        stickiness: profile.parameters.targetStickiness,
        stickinessScale: 0.12
      });
      const selected = selection.selected;
      if (selected?.target === undefined || selected.targetId === undefined) {
        const explanation = "No remaining Duelo target was available";
        return Object.freeze({
          state: Object.freeze({
            decisions: context.state.decisions + 1,
            lastExplanation: explanation
          }),
          explanation,
          reconsiderAtMillis: observation.nowMillis + 20
        });
      }

      const expiresAtMillis = observation.nowMillis + profile.parameters.reactionDelayMillis + 20;
      const explanation = `Player ${observation.world.playerIndex + 1}: ${selection.explanation}`;
      return Object.freeze({
        state: Object.freeze({
          decisions: context.state.decisions + 1,
          lastExplanation: explanation,
          lastTargetId: selected.targetId,
          lastUtility: selection.selectedScore
        }),
        action: createAgentAction({
          actorId: observation.agentId,
          kind: "move",
          atMillis: observation.nowMillis,
          target: selected.target,
          targetId: selected.targetId,
          explanation
        }),
        intention: Object.freeze({
          id: selected.id,
          label: selected.label,
          selectedAtMillis: observation.nowMillis,
          targetId: selected.targetId,
          target: selected.target,
          expiresAtMillis,
          utility: selection.selectedScore
        }),
        explanation,
        reconsiderAtMillis: expiresAtMillis
      });
    }
  });
}

/**
 * Stateful adapter around the pure brain. Callers supply every observation
 * timestamp, so an existing GameSession remains the sole production clock.
 */
export class DueloAgentController {
  public readonly id: string;
  public readonly playerIndex: number;
  public readonly profile: AgentProfile;
  public readonly definition: AgentDefinition;
  readonly #runtime: AgentRuntime<DueloSemanticWorld, DueloBrainState>;

  public constructor(options: DueloAgentControllerOptions) {
    validatePlayerIndex(options.playerIndex);
    this.playerIndex = options.playerIndex;
    this.id = options.id ?? `duelo-player-${options.playerIndex + 1}`;
    this.profile = resolveDueloProfile(options.profile ?? DUELO_REFERENCE_AGENT_PROFILE);
    this.definition = createAgentDefinition({
      id: this.id,
      brainId: DUELO_AGENT_BRAIN_ID,
      profileId: this.profile.id,
      role: "duelo-player",
      tags: Object.freeze(["duelo", "semantic", "player"]),
      config: Object.freeze({ playerIndex: options.playerIndex })
    });
    this.#runtime = createAgentRuntime({
      definition: this.definition,
      profile: this.profile,
      brain: createDueloAgentBrain(),
      seed: options.seed,
      gridBounds: Object.freeze({ width: FLOOR_COLS, height: FLOOR_ROWS })
    });
  }

  public step(
    observation: AgentObservation<DueloSemanticWorld>
  ): AgentStepResult<DueloBrainState> {
    return this.#runtime.step(observation);
  }

  public forceReplan(): void {
    this.#runtime.forceReplan();
  }

  public snapshot(): AgentSnapshot<DueloBrainState> {
    return this.#runtime.snapshot();
  }
}

export function createDueloAgentController(options: DueloAgentControllerOptions): DueloAgentController {
  return new DueloAgentController(options);
}

/**
 * Renderer-neutral team adapter for an existing GameSession. The director owns
 * target reconciliation and per-player runtime state; the caller remains in
 * charge of time, movement, and applying actions through its GameEngine.
 */
export class DueloAgentDirector {
  #game!: DueloGameInstance;
  #playerCount = 0;
  #seed = 0;
  #profiles: readonly AgentProfile[] = [];
  #board!: DueloSemanticBoard;
  #remainingTargets = new Map<string, DueloBoardTarget>();
  #controllers = new Map<string, DueloAgentController>();
  #lastDecisions = new Map<string, DueloDirectedAgentDecision>();
  #lastClaimedTargets = 0;
  #lastTick = -1;
  #lastAtMillis = Number.NEGATIVE_INFINITY;

  public constructor(options: DueloAgentDirectorOptions) {
    this.reset(options);
  }

  public get board(): DueloSemanticBoard {
    return this.#board;
  }

  public get remainingTargets(): readonly DueloBoardTarget[] {
    return Object.freeze([...this.#remainingTargets.values()].sort(compareTargets));
  }

  public reset(options: DueloAgentDirectorOptions): void {
    if (!Number.isInteger(options.playerCount) || options.playerCount < 2 || options.playerCount > 8) {
      throw new Error("Duelo directors require an integer player count from 2 through 8");
    }
    this.#game = options.game;
    this.#playerCount = options.playerCount;
    this.#seed = normalizeSeed(options.seed);
    this.#profiles = resolveDirectorProfiles(options.profile, options.playerCount);
    this.#board = inspectDueloSemanticBoard(options.game, options.playerCount);
    this.#remainingTargets = new Map(this.#board.targets.map((target) => [target.id, target]));
    this.#controllers.clear();
    this.#lastDecisions.clear();
    this.#lastClaimedTargets = 0;
    this.#lastTick = -1;
    this.#lastAtMillis = Number.NEGATIVE_INFINITY;
  }

  public step(input: DueloAgentDirectorInput): DueloAgentDirectorFrame {
    if (!Number.isInteger(input.tick) || input.tick <= this.#lastTick) {
      throw new Error("Duelo director ticks must be strictly increasing integers");
    }
    if (!Number.isFinite(input.atMillis) || input.atMillis < this.#lastAtMillis) {
      throw new Error("Duelo director time must be finite and monotonic");
    }
    validateDirectorAgents(input.agents, this.#playerCount);
    this.#reconcileTargets(input.snapshot);
    const semanticAgents = input.agents.map((agent) => Object.freeze({
      id: agent.id,
      playerIndex: agent.playerIndex,
      position: agent.position
    }));
    const remainingTargets = this.remainingTargets;
    const decisions = [...input.agents]
      .sort((first, second) => first.playerIndex - second.playerIndex || first.id.localeCompare(second.id))
      .map((agent): DueloDirectedAgentDecision => {
        const controller = this.#controllerFor(agent);
        const targetInvalidated = agent.targetId !== undefined && !this.#remainingTargets.has(agent.targetId);
        if (targetInvalidated) controller.forceReplan();
        const shouldDecide = (agent.requestDecision ?? true) || targetInvalidated;
        if (!shouldDecide) {
          const previous = this.#lastDecisions.get(agent.id);
          const activeTarget = agent.targetId === undefined ? undefined : this.#remainingTargets.get(agent.targetId);
          return Object.freeze({
            id: agent.id,
            playerIndex: agent.playerIndex,
            action: undefined,
            intendedAction: undefined,
            intention: previous?.intention,
            path: activeTarget === undefined
              ? Object.freeze([])
              : planDueloAgentPath(agent.position, activeTarget.position, {
                  playerIndex: agent.playerIndex,
                  remainingTargets
                }),
            explanation: "External avatar is following its current Duelo route",
            planned: false,
            mistakeApplied: false,
            targetInvalidated,
            replanReason: undefined,
            pendingUntilMillis: previous?.pendingUntilMillis,
            runtime: previous?.runtime
          });
        }

        const observation = createDueloSemanticObservation({
          agentId: agent.id,
          playerIndex: agent.playerIndex,
          tick: input.tick,
          atMillis: input.atMillis,
          position: agent.position,
          agents: semanticAgents,
          remainingTargets,
          snapshot: input.snapshot,
          boardSignature: this.#board.signature
        });
        const result = controller.step(observation);
        const path = result.action?.target === undefined
          ? Object.freeze([])
          : planDueloAgentPath(agent.position, result.action.target, {
              playerIndex: agent.playerIndex,
              remainingTargets
            });
        const explanation = result.action?.explanation ?? result.explanation;
        const directed = Object.freeze({
          id: agent.id,
          playerIndex: agent.playerIndex,
          action: result.action,
          intendedAction: result.intendedAction,
          intention: result.snapshot.intention,
          path,
          explanation,
          planned: result.planned,
          mistakeApplied: result.mistakeApplied,
          targetInvalidated,
          replanReason: result.replanReason,
          pendingUntilMillis: result.pendingUntilMillis,
          runtime: result.snapshot
        });
        this.#lastDecisions.set(agent.id, directed);
        return directed;
      });
    this.#lastTick = input.tick;
    this.#lastAtMillis = input.atMillis;
    return Object.freeze({
      tick: input.tick,
      atMillis: input.atMillis,
      boardSignature: this.#board.signature,
      remainingTargets,
      decisions: Object.freeze(decisions)
    });
  }

  #controllerFor(agent: DueloAgentDirectorAgent): DueloAgentController {
    const existing = this.#controllers.get(agent.id);
    if (existing !== undefined) {
      if (existing.playerIndex !== agent.playerIndex) {
        throw new Error(`Duelo agent ${agent.id} changed playerIndex`);
      }
      return existing;
    }
    const controller = createDueloAgentController({
      id: agent.id,
      playerIndex: agent.playerIndex,
      profile: this.#profiles[agent.playerIndex] as AgentProfile,
      seed: mixDirectorSeed(this.#seed, agent.playerIndex)
    });
    this.#controllers.set(agent.id, controller);
    return controller;
  }

  #reconcileTargets(snapshot: DueloSnapshot): void {
    const recent = snapshot.recentClaim;
    if (recent !== null) {
      const id = dueloTargetId(recent.playerIndex, Object.freeze({ x: recent.x, y: recent.y }));
      this.#remainingTargets.delete(id);
    }
    if (snapshot.claimedTargets !== this.#lastClaimedTargets) {
      for (const target of this.#board.targets) {
        if (this.#game.targetClaimed(target.position.x, target.position.y)) {
          this.#remainingTargets.delete(target.id);
        } else {
          this.#remainingTargets.set(target.id, target);
        }
      }
      this.#lastClaimedTargets = snapshot.claimedTargets;
    }
  }
}

export function createDueloAgentDirector(options: DueloAgentDirectorOptions): DueloAgentDirector {
  return new DueloAgentDirector(options);
}

export function createDueloSemanticObservation(
  options: CreateDueloObservationOptions
): AgentObservation<DueloSemanticWorld> {
  validatePlayerIndex(options.playerIndex);
  const ownedTargets = options.remainingTargets
    .filter((target) => target.owner === options.playerIndex)
    .sort(compareTargets);
  return createAgentObservation({
    agentId: options.agentId,
    tick: options.tick,
    nowMillis: options.atMillis,
    position: options.position,
    entities: options.agents
      .filter((agent) => agent.id !== options.agentId)
      .sort((first, second) => first.playerIndex - second.playerIndex)
      .map((agent) => Object.freeze({
        id: agent.id,
        kind: "duelo-player",
        position: agent.position,
        attributes: Object.freeze({ playerIndex: agent.playerIndex })
      })),
    objectives: ownedTargets.map((target) => Object.freeze({
      id: target.id,
      kind: "owned-color-tile",
      position: target.position,
      value: 1,
      attributes: Object.freeze({ owner: target.owner })
    })),
    hazards: Object.freeze([]),
    world: Object.freeze({
      boardSignature: options.boardSignature,
      phase: options.snapshot.phase,
      playerIndex: options.playerIndex,
      progress: Object.freeze(options.snapshot.playerProgress.map((entry) => Object.freeze({
        playerIndex: entry.index,
        claimed: entry.claimed,
        remaining: entry.remaining,
        target: entry.target
      }))),
      remainingTargetCount: options.snapshot.remainingTargets,
      totalTargetCount: options.snapshot.totalTargets
    })
  });
}

export function inspectDueloSemanticBoard(game: DueloGameInstance, playerCount: number): DueloSemanticBoard {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error("Duelo semantic boards require an integer player count from 2 through 8");
  }
  const targets: DueloBoardTarget[] = [];
  const ownerCells: number[] = [];
  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      const owner = game.targetOwner(x, y);
      ownerCells.push(owner);
      if (owner < 0) continue;
      const position = Object.freeze({ x, y });
      targets.push(Object.freeze({
        id: dueloTargetId(owner, position),
        owner,
        position
      }));
    }
  }
  const sortedTargets = Object.freeze(targets.sort(compareTargets));
  const targetsByPlayer = Object.freeze(Array.from({ length: playerCount }, (_, playerIndex) =>
    Object.freeze(sortedTargets.filter((target) => target.owner === playerIndex))
  ));
  return Object.freeze({
    signature: checksumText(ownerCells.join(",")),
    targets: sortedTargets,
    targetsByPlayer
  });
}

export function planDueloAgentPath(
  start: GridPoint,
  target: GridPoint,
  options: DueloPathOptions = {}
): readonly GridPoint[] {
  const rivalTileCost = options.rivalTileCost ?? DUELO_RIVAL_TILE_PATH_COST;
  if (!Number.isFinite(rivalTileCost) || rivalTileCost < 0) {
    throw new Error("Duelo rival tile path cost must be finite and non-negative");
  }
  const playerIndex = options.playerIndex;
  const remainingByPoint = new Map((options.remainingTargets ?? []).map((entry) => [
    pointKey(entry.position),
    entry
  ]));
  return findPath(FLOOR_GRID, start, target, {
    allowDiagonal: false,
    additionalCosts: playerIndex === undefined || remainingByPoint.size === 0
      ? undefined
      : [({ point }) => {
          const remaining = remainingByPoint.get(pointKey(point));
          return remaining !== undefined && remaining.owner !== playerIndex ? rivalTileCost : 0;
        }]
  }).path;
}

export function dueloTargetId(owner: number, point: GridPoint): string {
  return `duelo-target:${owner}:${point.x},${point.y}`;
}

export function resolveDueloProfile(profile: DueloProfileId | AgentProfile): AgentProfile {
  if (typeof profile !== "string") return profile;
  return profile === DUELO_REFERENCE_AGENT_PROFILE.id
    ? DUELO_REFERENCE_AGENT_PROFILE
    : getAgentProfile(profile);
}

export function checksumDueloSemanticValue(value: unknown): string {
  return checksumText(stableJson(value));
}

function compareTargets(first: DueloBoardTarget, second: DueloBoardTarget): number {
  return first.owner - second.owner
    || first.position.y - second.position.y
    || first.position.x - second.position.x;
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function resolveDirectorProfiles(
  selection: DueloDirectorProfileSelection | undefined,
  playerCount: number
): readonly AgentProfile[] {
  const selected = selection ?? DUELO_REFERENCE_AGENT_PROFILE;
  const values = Array.isArray(selected) ? selected : [selected];
  if (values.length === 0) throw new Error("Duelo director profile selection must not be empty");
  return Object.freeze(Array.from({ length: playerCount }, (_, playerIndex) =>
    resolveDueloProfile(values[playerIndex % values.length] as DueloProfileId | AgentProfile)
  ));
}

function validateDirectorAgents(agents: readonly DueloAgentDirectorAgent[], playerCount: number): void {
  const ids = new Set<string>();
  const playerIndices = new Set<number>();
  for (const agent of agents) {
    if (agent.id.length === 0 || ids.has(agent.id)) throw new Error("Duelo director agent ids must be unique");
    if (!Number.isInteger(agent.playerIndex) || agent.playerIndex < 0 || agent.playerIndex >= playerCount
      || playerIndices.has(agent.playerIndex)) {
      throw new Error("Duelo director player indices must be unique and in the configured range");
    }
    ids.add(agent.id);
    playerIndices.add(agent.playerIndex);
  }
}

function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 137;
}

function mixDirectorSeed(seed: number, playerIndex: number): number {
  let value = (seed ^ Math.imul(playerIndex + 1, 0x9e37_79b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85eb_ca6b) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}

function validatePlayerIndex(playerIndex: number): void {
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= 8) {
    throw new Error("Duelo playerIndex must be an integer from 0 through 7");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(",")}}`;
}

function checksumText(value: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
