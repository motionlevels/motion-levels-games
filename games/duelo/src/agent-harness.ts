import {
  createSeededRandom,
  type AgentProfile,
  type AgentSnapshot,
  type GridPoint
} from "@motion-levels-games/agent-runtime";
import {
  createGameEngine,
  type GameConfigOptions,
  type GameConfigPlayer,
  type GameEngine,
  type GameEngineState,
  type GameEvent
} from "@motion-levels-games/game-sdk";
import {
  checksumDueloSemanticValue,
  createDueloAgentDirector,
  DUELO_REFERENCE_AGENT_PROFILE,
  resolveDueloProfile,
  type DueloAgentDirector,
  type DueloBoardTarget,
  type DueloBrainState,
  type DueloProfileId,
  type DueloSemanticBoard
} from "./agents.ts";
import { createGame, dueloReadyZones, type DueloGameInstance, type DueloSnapshot } from "./game.ts";

export const DUELO_AGENT_HARNESS_VERSION = "duelo-semantic-harness-2";
export const DUELO_AGENT_TICK_RATE = 50;
export const DUELO_AGENT_FRAME_MILLIS = 1_000 / DUELO_AGENT_TICK_RATE;
export const MIN_DUELO_AGENT_SPEED = 1;
export const MAX_DUELO_AGENT_SPEED = 20;

export type DueloHarnessProfileSelection =
  | DueloProfileId
  | AgentProfile
  | readonly (DueloProfileId | AgentProfile)[];

export type DueloAgentHarnessOptions = Readonly<{
  seed?: number;
  playerCount?: number;
  difficulty?: "medium" | "hard";
  profile?: DueloHarnessProfileSelection;
  movementTilesPerSecond?: number;
  players?: readonly GameConfigPlayer[];
  gameOptions?: Readonly<GameConfigOptions>;
  autoReady?: boolean;
}>;

export type NormalizedDueloAgentHarnessOptions = Readonly<{
  seed: number;
  playerCount: number;
  difficulty: "medium" | "hard";
  profiles: readonly AgentProfile[];
  movementTilesPerSecond: number;
  players: readonly Readonly<GameConfigPlayer>[];
  gameOptions: Readonly<GameConfigOptions>;
  autoReady: boolean;
}>;

export type DueloAgentInput = Readonly<{
  agentId: string;
  playerIndex: number;
  kind: "press" | "release";
  purpose: "readiness" | "movement";
  x: number;
  y: number;
  atMillis: number;
}>;

export type DueloAgentStatus = "waiting" | "planning" | "moving" | "complete";

export type DueloAgentSnapshot = Readonly<{
  id: string;
  playerIndex: number;
  profileId: string;
  position: GridPoint;
  heldPosition?: GridPoint;
  status: DueloAgentStatus;
  intention: string;
  explanation: string;
  targetId?: string;
  target?: GridPoint;
  path: readonly GridPoint[];
  claimed: number;
  remaining: number;
  targetCount: number;
  actions: number;
  mistakes: number;
  travelTiles: number;
  rivalTargetsClaimed: number;
  runtime?: AgentSnapshot<DueloBrainState>;
}>;

export type DueloAgentMetrics = Readonly<{
  phase: DueloSnapshot["phase"];
  completed: boolean;
  winnerIndex: number;
  durationMillis: number;
  totalClaims: number;
  remainingTargets: number;
  initialTargetsByPlayer: readonly number[];
  claimsByPlayer: readonly number[];
  actionsByAgent: readonly number[];
  mistakesByAgent: readonly number[];
  travelTilesByAgent: readonly number[];
  rivalTargetsClaimedByAgent: readonly number[];
  targetSpread: number;
  actionSpread: number;
  travelSpread: number;
  fairTargetAllocation: boolean;
}>;

export type DueloAgentHarnessFrame = Readonly<{
  tick: number;
  atMillis: number;
  state: GameEngineState;
  agents: readonly DueloAgentSnapshot[];
  inputs: readonly DueloAgentInput[];
  events: readonly GameEvent[];
  metrics: DueloAgentMetrics;
  boardSignature: string;
  checksum: string;
}>;

export type DueloAgentEngineView = Pick<
  GameEngine,
  "clockMillis" | "fps" | "frameMillis" | "state"
>;

type InternalAgent = {
  id: string;
  playerIndex: number;
  profile: AgentProfile;
  position: GridPoint;
  heldPosition?: GridPoint;
  status: DueloAgentStatus;
  intention: string;
  explanation: string;
  targetId?: string;
  target?: GridPoint;
  path: GridPoint[];
  nextMoveAtMillis: number;
  actions: number;
  mistakes: number;
  travelTiles: number;
  rivalTargetsClaimed: number;
  runtimeSnapshot?: AgentSnapshot<DueloBrainState>;
};

type MovementProposal = Readonly<{
  agent: InternalAgent;
  destination: GridPoint;
}>;

/**
 * Deterministic headless reference around the real Duelo GameEngine. It is a
 * test/integration adapter, not a renderer or a production game session.
 */
export class DueloAgentHarness {
  #options!: NormalizedDueloAgentHarnessOptions;
  #game!: DueloGameInstance;
  #engine!: GameEngine;
  #director!: DueloAgentDirector;
  #board!: DueloSemanticBoard;
  #agents: InternalAgent[] = [];
  #initiative: number[] = [];
  #movementRound = 0;
  #tick = 0;
  #readyHeld = false;
  #frame!: DueloAgentHarnessFrame;
  #inputHistory: DueloAgentInput[] = [];
  #eventHistory: GameEvent[] = [];
  #checksumHistory: string[] = [];

  public constructor(options: DueloAgentHarnessOptions = {}) {
    this.#start(normalizeDueloAgentHarnessOptions(options));
  }

  /** Read-only view. All authoritative writes remain inside step/restart. */
  public get engine(): DueloAgentEngineView {
    return this.#engine;
  }

  public get state(): GameEngineState {
    return this.#engine.state;
  }

  public get options(): NormalizedDueloAgentHarnessOptions {
    return this.#options;
  }

  public get frame(): DueloAgentHarnessFrame {
    return this.#frame;
  }

  public get agents(): readonly DueloAgentSnapshot[] {
    return this.#frame.agents;
  }

  public get inputHistory(): readonly DueloAgentInput[] {
    return Object.freeze([...this.#inputHistory]);
  }

  public get eventHistory(): readonly GameEvent[] {
    return Object.freeze([...this.#eventHistory]);
  }

  public get checksumHistory(): readonly string[] {
    return Object.freeze([...this.#checksumHistory]);
  }

  public restart(overrides: DueloAgentHarnessOptions = {}): DueloAgentHarnessFrame {
    const profile = overrides.profile ?? this.#options.profiles;
    this.#start(normalizeDueloAgentHarnessOptions({
      seed: overrides.seed ?? this.#options.seed,
      playerCount: overrides.playerCount ?? this.#options.playerCount,
      difficulty: overrides.difficulty ?? this.#options.difficulty,
      profile,
      movementTilesPerSecond:
        overrides.movementTilesPerSecond ?? this.#options.movementTilesPerSecond,
      players: overrides.players ?? this.#options.players,
      gameOptions: overrides.gameOptions ?? this.#options.gameOptions,
      autoReady: overrides.autoReady ?? this.#options.autoReady
    }));
    return this.#frame;
  }

  public reset(overrides: DueloAgentHarnessOptions = {}): DueloAgentHarnessFrame {
    return this.restart(overrides);
  }

  public step(ticks = 1): DueloAgentHarnessFrame {
    if (!Number.isInteger(ticks) || ticks <= 0) {
      throw new Error("Duelo harness step ticks must be a positive integer");
    }
    for (let index = 0; index < ticks; index += 1) this.#stepOnce();
    return this.#frame;
  }

  public run(maxTicks = 10_000): DueloAgentHarnessFrame {
    if (!Number.isInteger(maxTicks) || maxTicks <= 0) {
      throw new Error("Duelo harness maxTicks must be a positive integer");
    }
    for (let index = 0; index < maxTicks; index += 1) {
      if (dueloSnapshot(this.#engine.state).phase === "finished") break;
      this.#stepOnce();
    }
    return this.#frame;
  }

  #start(options: NormalizedDueloAgentHarnessOptions): void {
    this.#options = options;
    this.#tick = 0;
    this.#movementRound = 0;
    this.#inputHistory = [];
    this.#eventHistory = [];
    this.#checksumHistory = [];
    this.#game = createGame({
      seed: options.seed,
      playerCount: options.playerCount,
      difficulty: options.difficulty,
      players: options.players.map((player) => ({ ...player })),
      options: { ...options.gameOptions },
      nowMillis: 0
    });
    const events = [...this.#game.init(0)];
    this.#engine = createGameEngine(this.#game, {
      fps: DUELO_AGENT_TICK_RATE,
      nowMillis: 0,
      initialEvents: events
    });
    this.#rebuildSemanticMatch();

    const inputs: DueloAgentInput[] = [];
    if (options.autoReady) {
      for (const agent of this.#agents) {
        this.#applyInput(agent, "press", agent.position, "readiness", 0, inputs, events);
        agent.heldPosition = agent.position;
      }
      this.#readyHeld = true;
    } else {
      this.#readyHeld = false;
    }
    this.#engine.refresh(events);
    this.#recordFrame(inputs, events);
  }

  #rebuildSemanticMatch(): void {
    this.#director = createDueloAgentDirector({
      game: this.#game,
      playerCount: this.#options.playerCount,
      seed: this.#options.seed,
      profile: this.#options.profiles
    });
    this.#board = this.#director.board;
    this.#agents = this.#createAgents();
    this.#initiative = seededInitiative(this.#options.seed, this.#options.playerCount);
    this.#movementRound = 0;
  }

  #createAgents(): InternalAgent[] {
    const zones = dueloReadyZones(this.#options.playerCount);
    return this.#options.profiles.map((profile, playerIndex): InternalAgent => {
      const zone = zones[playerIndex];
      if (zone === undefined) throw new Error(`Missing Duelo ready zone ${playerIndex}`);
      const position = Object.freeze({
        x: Math.floor((zone.minX + zone.maxX) / 2),
        y: Math.floor((zone.minY + zone.maxY) / 2)
      });
      const id = `duelo-player-${playerIndex + 1}`;
      return {
        id,
        playerIndex,
        profile,
        position,
        heldPosition: undefined,
        status: "waiting",
        intention: "wait for Duelo",
        explanation: "Waiting for every player readiness zone",
        targetId: undefined,
        target: undefined,
        path: [],
        nextMoveAtMillis: Number.POSITIVE_INFINITY,
        actions: 0,
        mistakes: 0,
        travelTiles: 0,
        rivalTargetsClaimed: 0,
        runtimeSnapshot: undefined
      };
    });
  }

  #stepOnce(): void {
    const previousPhase = dueloSnapshot(this.#engine.state).phase;
    this.#tick += 1;
    const atMillis = this.#tick * DUELO_AGENT_FRAME_MILLIS;
    const tickState = this.#engine.tickTo(atMillis);
    const inputs: DueloAgentInput[] = [];
    const events: GameEvent[] = [...tickState.events];
    let snapshot = dueloSnapshot(tickState);

    if (snapshot.phase === "running") {
      if (this.#readyHeld) {
        for (const agent of this.#agents) {
          if (agent.heldPosition !== undefined) {
            this.#applyInput(agent, "release", agent.heldPosition, "readiness", atMillis, inputs, events);
            agent.heldPosition = undefined;
          }
        }
        this.#readyHeld = false;
      }
      this.#planIdleAgents(atMillis);
      this.#executeMovement(atMillis, inputs, events);
      snapshot = dueloSnapshot(this.#engine.state);
      if (snapshot.phase === "finished") {
        for (const agent of this.#agents) {
          agent.status = "complete";
          agent.intention = snapshot.winnerIndex === agent.playerIndex ? "won Duelo" : "match complete";
        }
      }
    } else if (snapshot.phase === "finished") {
      for (const agent of this.#agents) {
        agent.status = "complete";
        agent.intention = snapshot.winnerIndex === agent.playerIndex ? "won Duelo" : "match complete";
      }
    } else {
      for (const agent of this.#agents) {
        agent.status = "waiting";
        agent.intention = snapshot.phase === "starting" ? "hold readiness" : "wait for Duelo";
      }
    }

    if (previousPhase === "finished" && snapshot.phase === "waiting") {
      this.#readyHeld = false;
      this.#rebuildSemanticMatch();
    }
    this.#engine.refresh(events);
    this.#recordFrame(inputs, events);
  }

  #planIdleAgents(atMillis: number): void {
    const snapshot = dueloSnapshot(this.#engine.state);
    const directed = this.#director.step({
      tick: this.#tick,
      atMillis,
      snapshot,
      agents: this.#agents.map((agent) => Object.freeze({
        id: agent.id,
        playerIndex: agent.playerIndex,
        position: agent.position,
        requestDecision: agent.path.length === 0 && agent.status !== "complete",
        targetId: agent.targetId
      }))
    });
    for (const decision of directed.decisions) {
      const agent = this.#agents.find((candidate) => candidate.id === decision.id);
      if (agent === undefined) continue;
      if (decision.targetInvalidated) {
        agent.path = [];
        agent.targetId = undefined;
        agent.target = undefined;
        agent.status = "planning";
      }
      agent.runtimeSnapshot = decision.runtime;
      agent.explanation = decision.explanation;
      agent.intention = decision.intention?.label ?? agent.intention;
      if (decision.mistakeApplied) agent.mistakes += 1;
      const action = decision.action;
      if (action?.kind !== "move" || action.target === undefined) {
        if (agent.path.length === 0) {
          agent.status = directed.remainingTargets.some((target) => target.owner === agent.playerIndex)
            ? "planning"
            : "complete";
        }
        continue;
      }

      const planned = decision.path;
      const path = planned.length <= 1 ? [action.target] : [...planned.slice(1)];
      agent.path = path.map((point) => Object.freeze({ ...point }));
      agent.targetId = action.targetId;
      agent.target = Object.freeze({ ...action.target });
      agent.status = "moving";
      agent.actions += 1;
      agent.nextMoveAtMillis = atMillis + this.#movementStepMillis();
    }
  }

  #executeMovement(
    atMillis: number,
    inputs: DueloAgentInput[],
    events: GameEvent[]
  ): void {
    const proposals = this.#agents.flatMap((agent): MovementProposal[] => {
      const destination = agent.path[0];
      return destination !== undefined && agent.nextMoveAtMillis <= atMillis
        ? [Object.freeze({ agent, destination })]
        : [];
    });
    if (proposals.length === 0) return;

    const order = rotatedInitiative(this.#initiative, this.#movementRound);
    const rank = new Map(order.map((playerIndex, index) => [playerIndex, index]));
    proposals.sort((first, second) =>
      (rank.get(first.agent.playerIndex) ?? Number.MAX_SAFE_INTEGER)
        - (rank.get(second.agent.playerIndex) ?? Number.MAX_SAFE_INTEGER)
    );
    this.#movementRound += 1;

    for (const proposal of proposals) {
      if (dueloSnapshot(this.#engine.state).phase !== "running") break;
      const { agent, destination } = proposal;
      if (agent.heldPosition !== undefined) {
        this.#applyInput(agent, "release", agent.heldPosition, "movement", atMillis, inputs, events);
      }
      const targetAtDestination = this.#game.targetClaimed(destination.x, destination.y)
        ? undefined
        : targetAt(this.#board.targets, destination);
      const pressState = this.#applyInput(agent, "press", destination, "movement", atMillis, inputs, events);
      agent.heldPosition = destination;
      if (destination.x !== agent.position.x || destination.y !== agent.position.y) {
        agent.travelTiles += 1;
      }
      agent.position = destination;
      agent.path.shift();
      agent.nextMoveAtMillis += this.#movementStepMillis();

      if (targetAtDestination !== undefined
        && pressState.events.some((event) => event.cue === "tile-claim" || event.cue === "win")) {
        if (targetAtDestination.owner !== agent.playerIndex) agent.rivalTargetsClaimed += 1;
      }
      if (agent.path.length === 0) {
        agent.targetId = undefined;
        agent.target = undefined;
        agent.status = "planning";
        agent.intention = "select next owned target";
      }
    }
  }

  #applyInput(
    agent: InternalAgent,
    kind: DueloAgentInput["kind"],
    point: GridPoint,
    purpose: DueloAgentInput["purpose"],
    atMillis: number,
    inputs: DueloAgentInput[],
    events: GameEvent[]
  ): GameEngineState {
    const input = Object.freeze({
      agentId: agent.id,
      playerIndex: agent.playerIndex,
      kind,
      purpose,
      x: point.x,
      y: point.y,
      atMillis
    });
    inputs.push(input);
    this.#inputHistory.push(input);
    const state = kind === "press"
      ? this.#engine.press(point.x, point.y, atMillis)
      : this.#engine.release(point.x, point.y, atMillis);
    events.push(...state.events);
    return state;
  }

  #movementStepMillis(): number {
    return 1_000 / this.#options.movementTilesPerSecond;
  }

  #recordFrame(inputs: readonly DueloAgentInput[], events: readonly GameEvent[]): void {
    const state = this.#engine.state;
    const snapshot = dueloSnapshot(state);
    const agents = this.#agentSnapshots(snapshot);
    const metrics = metricsFrom(snapshot, agents, this.#board);
    const checksum = checksumDueloSemanticValue({
      version: DUELO_AGENT_HARNESS_VERSION,
      tick: this.#tick,
      atMillis: state.clockMillis,
      boardSignature: this.#board.signature,
      snapshot: {
        phase: snapshot.phase,
        claimedTargets: snapshot.claimedTargets,
        remainingTargets: snapshot.remainingTargets,
        leaderIndex: snapshot.leaderIndex,
        winnerIndex: snapshot.winnerIndex,
        playerProgress: snapshot.playerProgress.map((entry) => ({
          index: entry.index,
          claimed: entry.claimed,
          remaining: entry.remaining,
          target: entry.target
        }))
      },
      agents: agents.map((agent) => ({
        id: agent.id,
        position: agent.position,
        heldPosition: agent.heldPosition,
        status: agent.status,
        targetId: agent.targetId,
        path: agent.path,
        actions: agent.actions,
        mistakes: agent.mistakes,
        travelTiles: agent.travelTiles
      })),
      inputs
    });
    this.#eventHistory.push(...events);
    this.#checksumHistory.push(checksum);
    this.#frame = Object.freeze({
      tick: this.#tick,
      atMillis: state.clockMillis,
      state,
      agents,
      inputs: Object.freeze([...inputs]),
      events: Object.freeze([...events]),
      metrics,
      boardSignature: this.#board.signature,
      checksum
    });
  }

  #agentSnapshots(snapshot: DueloSnapshot): readonly DueloAgentSnapshot[] {
    return Object.freeze(this.#agents.map((agent): DueloAgentSnapshot => {
      const progress = snapshot.playerProgress[agent.playerIndex];
      return Object.freeze({
        id: agent.id,
        playerIndex: agent.playerIndex,
        profileId: agent.profile.id,
        position: agent.position,
        heldPosition: agent.heldPosition,
        status: agent.status,
        intention: agent.intention,
        explanation: agent.explanation,
        targetId: agent.targetId,
        target: agent.target,
        path: Object.freeze([...agent.path]),
        claimed: progress?.claimed ?? 0,
        remaining: progress?.remaining ?? 0,
        targetCount: progress?.target ?? 0,
        actions: agent.actions,
        mistakes: agent.mistakes,
        travelTiles: agent.travelTiles,
        rivalTargetsClaimed: agent.rivalTargetsClaimed,
        runtime: agent.runtimeSnapshot
      });
    }));
  }
}

export function createDueloAgentHarness(options: DueloAgentHarnessOptions = {}): DueloAgentHarness {
  return new DueloAgentHarness(options);
}

export function runDueloAgentMatch(
  options: DueloAgentHarnessOptions = {},
  maxTicks = 10_000
): DueloAgentHarnessFrame {
  return createDueloAgentHarness(options).run(maxTicks);
}

export function normalizeDueloAgentHarnessOptions(
  options: DueloAgentHarnessOptions
): NormalizedDueloAgentHarnessOptions {
  const playerCount = options.playerCount ?? 4;
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error("Duelo agent playerCount must be an integer from 2 through 8");
  }
  const difficulty = options.difficulty ?? "medium";
  if (difficulty !== "medium" && difficulty !== "hard") {
    throw new Error("Duelo agents support the game's medium and hard difficulties");
  }
  const movementTilesPerSecond = options.movementTilesPerSecond ?? 8;
  if (!Number.isFinite(movementTilesPerSecond)
    || movementTilesPerSecond < MIN_DUELO_AGENT_SPEED
    || movementTilesPerSecond > MAX_DUELO_AGENT_SPEED) {
    throw new Error(
      `Duelo agent movement speed must be ${MIN_DUELO_AGENT_SPEED}–${MAX_DUELO_AGENT_SPEED} tiles/second`
    );
  }
  const profileSelection = options.profile ?? DUELO_REFERENCE_AGENT_PROFILE;
  const selectedProfiles = Array.isArray(profileSelection) ? profileSelection : [profileSelection];
  if (selectedProfiles.length === 0) {
    throw new Error("Duelo agent profile selection must not be empty");
  }
  const profiles = Object.freeze(Array.from({ length: playerCount }, (_, index) =>
    resolveDueloProfile(selectedProfiles[index % selectedProfiles.length] as DueloProfileId | AgentProfile)
  ));
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) >>> 0 : 137;
  return Object.freeze({
    seed,
    playerCount,
    difficulty,
    profiles,
    movementTilesPerSecond,
    players: Object.freeze((options.players ?? []).slice(0, playerCount).map((player) => Object.freeze({ ...player }))),
    gameOptions: Object.freeze({ ...(options.gameOptions ?? {}) }),
    autoReady: options.autoReady ?? true
  });
}

function dueloSnapshot(state: GameEngineState): DueloSnapshot {
  return state.snapshot as DueloSnapshot;
}

function targetAt(
  targets: readonly DueloBoardTarget[],
  point: GridPoint
): DueloBoardTarget | undefined {
  for (const target of targets) {
    if (target.position.x === point.x && target.position.y === point.y) return target;
  }
  return undefined;
}

function metricsFrom(
  snapshot: DueloSnapshot,
  agents: readonly DueloAgentSnapshot[],
  board: DueloSemanticBoard
): DueloAgentMetrics {
  const initialTargetsByPlayer = board.targetsByPlayer.map((targets) => targets.length);
  const claimsByPlayer = snapshot.playerProgress.map((entry) => entry.claimed);
  const actionsByAgent = agents.map((agent) => agent.actions);
  const mistakesByAgent = agents.map((agent) => agent.mistakes);
  const travelTilesByAgent = agents.map((agent) => agent.travelTiles);
  const rivalTargetsClaimedByAgent = agents.map((agent) => agent.rivalTargetsClaimed);
  const targetSpread = spread(initialTargetsByPlayer);
  return Object.freeze({
    phase: snapshot.phase,
    completed: snapshot.phase === "finished",
    winnerIndex: snapshot.winnerIndex,
    durationMillis: snapshot.elapsedMillis,
    totalClaims: snapshot.claimedTargets,
    remainingTargets: snapshot.remainingTargets,
    initialTargetsByPlayer: Object.freeze(initialTargetsByPlayer),
    claimsByPlayer: Object.freeze(claimsByPlayer),
    actionsByAgent: Object.freeze(actionsByAgent),
    mistakesByAgent: Object.freeze(mistakesByAgent),
    travelTilesByAgent: Object.freeze(travelTilesByAgent),
    rivalTargetsClaimedByAgent: Object.freeze(rivalTargetsClaimedByAgent),
    targetSpread,
    actionSpread: spread(actionsByAgent),
    travelSpread: spread(travelTilesByAgent),
    fairTargetAllocation: targetSpread === 0
  });
}

function spread(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

function seededInitiative(seed: number, playerCount: number): number[] {
  const result = Array.from({ length: playerCount }, (_, index) => index);
  const random = createSeededRandom(seed ^ 0xd0e1_0001);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = random.int(index + 1);
    [result[index], result[other]] = [result[other] as number, result[index] as number];
  }
  return result;
}

function rotatedInitiative(initiative: readonly number[], round: number): readonly number[] {
  if (initiative.length === 0) return Object.freeze([]);
  const offset = round % initiative.length;
  return Object.freeze([...initiative.slice(offset), ...initiative.slice(0, offset)]);
}
