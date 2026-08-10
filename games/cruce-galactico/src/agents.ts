import {
  AGENT_CONTRACT_VERSION,
  createAgentDefinition,
  createAgentObservation,
  createAgentRuntime,
  createGrid,
  createObjectiveHazardBrain,
  createReservationBook,
  createSeededRandom,
  defineAgentProfile,
  getAgentProfile,
  gridPointKey,
  manhattanDistance,
  type AgentAction,
  type AgentHazard,
  type AgentIntention,
  type AgentProfile,
  type AgentProfileId,
  type AgentReplanReason,
  type AgentRuntime,
  type AgentSnapshot,
  type GridPoint,
  type ObjectiveHazardBrainState,
  type ObjectiveHazardWorld,
  type ReservationBook
} from "@motion-levels-games/agent-runtime";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createGameEngine,
  type Frame,
  type GameDifficulty,
  type GameEngine,
  type GameEngineState,
  type GameEvent,
  type HexColor
} from "@motion-levels-games/game-sdk";
import {
  REPLAY_SCHEMA_VERSION,
  ReplayRecorder,
  toReplayJson,
  type GameReplay,
  type ReplayAgentActionRecord,
  type ReplayAgentSample,
  type ReplayFrame,
  type ReplayInputAction,
  type ReplayJsonObject,
  type ReplayJsonValue
} from "@motion-levels-games/replay-runtime";
import {
  createGame,
  type GalacticCrossingSnapshot,
  type GalacticHazard
} from "./game.ts";

export const CRUCE_AGENT_TICK_RATE = 50;
export const CRUCE_AGENT_FRAME_MILLIS = 1_000 / CRUCE_AGENT_TICK_RATE;
export const CRUCE_AGENT_SIMULATION_VERSION = "cruce-agent-harness-2";
export const MIN_CRUCE_AGENTS = 1;
export const MAX_CRUCE_AGENTS = 10;

const DEFAULT_AGENT_SEED = 137;
const DEFAULT_AGENT_COUNT = 3;
const DEFAULT_AGENT_SPEED = 2;
const DEFAULT_PROFILE_POOL = ["cautious", "balanced", "helper", "explorer", "expert"] as const;
const CHECKPOINT_BANDS = [
  { minY: 22, maxY: 23 },
  { minY: 15, maxY: 16 },
  { minY: 8, maxY: 9 },
  { minY: 0, maxY: 2 }
] as const;
const DIFFICULTY_STEP_MILLIS: Readonly<Record<string, number>> = Object.freeze({
  easy: 620,
  medium: 480,
  hard: 360,
  expert: 270
});
const AGENT_COLORS = [
  "#26d9ff", "#66ff9a", "#ffe176", "#ff6ba8", "#a98bff",
  "#ff8a4c", "#44f1d3", "#f4f7ff", "#5ea2ff", "#fb5d5d"
] as const satisfies readonly HexColor[];

export type CruceProfileSelection = AgentProfileId | "mixed" | readonly AgentProfileId[];

export type CruceHarnessOptions = Readonly<{
  seed?: number;
  profile?: CruceProfileSelection;
  agentCount?: number;
  speed?: number;
  difficulty?: GameDifficulty;
  durationMillis?: number;
  playerCount?: number;
  replaySnapshotIntervalTicks?: number;
  onRender?: (frame: Frame, snapshot: GalacticCrossingSnapshot, agents: readonly CruceRenderableAgent[]) => void;
}>;

export type NormalizedCruceHarnessOptions = Readonly<{
  seed: number;
  profile: CruceProfileSelection;
  agentCount: number;
  speed: number;
  difficulty: GameDifficulty;
  durationMillis: number;
  playerCount: number;
  replaySnapshotIntervalTicks: number;
  onRender?: CruceHarnessOptions["onRender"];
}>;

export type CruceAgentEmotion = "neutral" | "happy" | "afraid" | "frustrated" | "excited";
export type CruceAgentFacing = "up" | "right" | "down" | "left";
export type CruceAgentVariant = "explorer" | "runner" | "trickster" | "guardian";
export type CruceAgentPosition = Readonly<{ x: number; y: number }>;

export type CruceAgentReservationDebug = Readonly<{
  id: string;
  ownerId: string;
  kind: "objective" | "destination" | "corridor";
  expiresAtMillis: number;
  objectiveId?: string;
  point?: GridPoint;
  points?: readonly GridPoint[];
}>;

export type CruceAgentDebugSnapshot = Readonly<{
  path: readonly GridPoint[];
  reservations: readonly CruceAgentReservationDebug[];
  utility?: number;
  explanation: string;
  replanReason?: AgentReplanReason;
  replans: number;
  stuckReplans: number;
  pendingUntilMillis?: number;
  contractVersion: typeof AGENT_CONTRACT_VERSION;
}>;

export type CruceRenderableAgent = Readonly<{
  id: string;
  tick: number;
  atMillis: number;
  color: HexColor;
  profileId: string;
  variant?: CruceAgentVariant;
  position: CruceAgentPosition;
  velocity: Readonly<{ x: number; y: number }>;
  facing: CruceAgentFacing;
  facingRadians: number;
  grounded: boolean;
  action: string;
  intention: string;
  target?: GridPoint;
  targetId?: string;
  emotion: CruceAgentEmotion;
  debug: CruceAgentDebugSnapshot;
}>;

export type CruceHarnessDebug = Readonly<{
  tick: number;
  checkpoint: number;
  collisions: number;
  damage: number;
  deadlocks: number;
  replans: number;
  stuckReplans: number;
  lastProgressTick: number;
  routeDiversity: number;
  paths: readonly Readonly<{ id: string; points: readonly GridPoint[]; color?: HexColor }>[];
  reservations: readonly Readonly<{
    id: string;
    ownerId: string;
    points: readonly GridPoint[];
    color?: HexColor;
  }>[];
  targets: readonly Readonly<{ id: string; position: GridPoint; radiusTiles?: number; color?: HexColor }>[];
}>;

export type CruceLiveMetrics = Readonly<{
  completed: boolean;
  elapsedMillis: number;
  score: number;
  collisions: number;
  damage: number;
  deadlocks: number;
  replans: number;
  stuckReplans: number;
  routeDiversity: number;
}>;

export type CruceHarnessFrame = Readonly<{
  tick: number;
  atMillis: number;
  state: GameEngineState;
  agents: readonly CruceRenderableAgent[];
  replay: Readonly<{
    frame: ReplayFrame;
    checksum: string;
  }>;
  debug: CruceHarnessDebug;
  metrics: CruceLiveMetrics;
}>;

type InternalAgent = {
  readonly id: string;
  readonly color: HexColor;
  readonly baseProfileId: string;
  readonly runtime: AgentRuntime<ObjectiveHazardWorld, ObjectiveHazardBrainState>;
  position: GridPoint;
  presentationPosition: CruceAgentPosition;
  velocity: { x: number; y: number };
  movement?: Readonly<{
    from: GridPoint;
    to: GridPoint;
    startedAtMillis: number;
    arrivesAtMillis: number;
  }>;
  facing: CruceAgentFacing;
  facingRadians: number;
  lastAction?: AgentAction;
  lastIntention?: AgentIntention;
  lastExplanation: string;
  lastReplanReason?: AgentReplanReason;
  pendingUntilMillis?: number;
  replans: number;
  stuckReplans: number;
  hurtUntilMillis: number;
  visited: Set<string>;
  checkpointXs: number[];
};

export class CruceAgentHarness {
  #options: NormalizedCruceHarnessOptions;
  #engine!: GameEngine;
  #agents: InternalAgent[] = [];
  #reservations: ReservationBook = createReservationBook();
  readonly #grid = createGrid({ width: FLOOR_COLS, height: FLOOR_ROWS });
  #recorder!: ReplayRecorder;
  #tick = 0;
  #collisions = 0;
  #damage = 0;
  #deadlocks = 0;
  #lastProgressTick = 0;
  #lastMovementTick = 0;
  #lastDeadlockTick = 0;
  #lastFrame!: CruceHarnessFrame;

  public constructor(options: CruceHarnessOptions = {}) {
    this.#options = normalizeHarnessOptions(options);
    this.restart();
  }

  public get engine(): GameEngine {
    return this.#engine;
  }

  public get state(): GameEngineState {
    return this.#engine.state;
  }

  public get options(): NormalizedCruceHarnessOptions {
    return this.#options;
  }

  public get agents(): readonly CruceRenderableAgent[] {
    return this.#renderableAgents();
  }

  /** Stable behaviour-only signatures; deliberately excluded from replay authority. */
  public get routeSignatures(): readonly string[] {
    return routeSignatures(this.#agents);
  }

  public get replay(): GameReplay {
    return this.#recorder.finish();
  }

  public finishReplay(): GameReplay {
    return this.#recorder.finish();
  }

  public get frame(): CruceHarnessFrame {
    return this.#lastFrame;
  }

  public restart(overrides: CruceHarnessOptions = {}): CruceHarnessFrame {
    this.#options = normalizeHarnessOptions({ ...this.#options, ...overrides });
    const game = createGame({
      seed: this.#options.seed,
      playerCount: this.#options.playerCount,
      difficulty: this.#options.difficulty,
      durationMillis: this.#options.durationMillis,
      nowMillis: 0
    });
    const initialEvents = game.init(0);
    this.#engine = createGameEngine(game, {
      fps: CRUCE_AGENT_TICK_RATE,
      nowMillis: 0,
      initialEvents
    });
    this.#tick = 0;
    this.#collisions = 0;
    this.#damage = 0;
    this.#deadlocks = 0;
    this.#lastProgressTick = 0;
    this.#lastMovementTick = 0;
    this.#lastDeadlockTick = 0;
    this.#reservations = createReservationBook();
    this.#agents = this.#createAgents();
    this.#recorder = new ReplayRecorder({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      gameId: "cruce-galactico",
      gameVersion: "0.1.0",
      simulationVersion: CRUCE_AGENT_SIMULATION_VERSION,
      brainVersions: { "cruce-objective-hazard": String(AGENT_CONTRACT_VERSION) },
      seed: String(this.#options.seed),
      tickRate: CRUCE_AGENT_TICK_RATE,
      config: harnessReplayConfig(this.#options)
    }, {
      snapshotIntervalTicks: this.#options.replaySnapshotIntervalTicks,
      checksumEveryFrame: true
    });

    const inputs: ReplayInputAction[] = [];
    const events = [...initialEvents];
    for (const agent of this.#agents) {
      const input = pressInput(agent.id, agent.position);
      inputs.push(input);
      events.push(...this.#engine.press(input.x, input.y, 0).events);
    }
    events.push(...this.#engine.tickTo(0).events);
    this.#lastFrame = this.#recordFrame(inputs, [], events);
    this.#notifyRenderer();
    return this.#lastFrame;
  }

  public reset(overrides: CruceHarnessOptions = {}): CruceHarnessFrame {
    return this.restart(overrides);
  }

  /** Advances one or more authoritative 20 ms simulation ticks. */
  public step(ticks = 1): CruceHarnessFrame {
    if (!Number.isInteger(ticks) || ticks <= 0) {
      throw new Error("step ticks must be a positive integer");
    }
    for (let index = 0; index < ticks; index += 1) {
      this.#stepOnce();
    }
    return this.#lastFrame;
  }

  #stepOnce(): void {
    this.#tick += 1;
    const nowMillis = this.#tick * CRUCE_AGENT_FRAME_MILLIS;
    const inputs: ReplayInputAction[] = [];
    const actionRecords: ReplayAgentActionRecord[] = [];
    const events: GameEvent[] = [];
    const beforeTick = this.#snapshot();
    const checkpointAtStart = beforeTick.checkpoint;
    const livesAtStart = beforeTick.lives;

    for (const agent of this.#agents) {
      const previousPresentationPosition = agent.presentationPosition;
      agent.velocity = { x: 0, y: 0 };
      if (this.#snapshot().phase === "running" && agent.movement !== undefined) {
        const movement = this.#advanceMovement(agent, nowMillis);
        inputs.push(...movement.inputs);
        events.push(...movement.events);
      }
      agent.velocity = {
        x: (agent.presentationPosition.x - previousPresentationPosition.x) * CRUCE_AGENT_TICK_RATE,
        y: (agent.presentationPosition.y - previousPresentationPosition.y) * CRUCE_AGENT_TICK_RATE
      };

      if (this.#snapshot().phase === "running" && agent.movement === undefined) {
        const observation = this.#observationFor(agent, nowMillis);
        const result = agent.runtime.step(observation);
        agent.lastExplanation = result.explanation;
        agent.lastReplanReason = result.replanReason;
        agent.pendingUntilMillis = result.pendingUntilMillis;
        if (result.planned && result.replanReason !== "initial") {
          agent.replans += 1;
        }
        if (result.replanReason === "stuck") {
          agent.stuckReplans += 1;
        }
        if (result.action !== undefined) {
          agent.lastAction = result.action;
          agent.lastIntention = result.snapshot.intention;
          actionRecords.push({ agentId: agent.id, action: toReplayJson(result.action) });
          if (result.action.kind === "move" && result.action.target !== undefined) {
            const destination = this.#movementDestination(agent, result.action.target);
            if (!samePoint(destination, agent.position)) {
              const movement = this.#startMovement(agent, destination, nowMillis);
              inputs.push(...movement.inputs);
              events.push(...movement.events);
            }
          }
        }
      }

      const checkpointNow = this.#snapshot().checkpoint;
      if (checkpointNow !== checkpointAtStart && checkpointNow > checkpointAtStart) {
        agent.checkpointXs.push(agent.position.x);
        this.#checkpointAdvanced(checkpointNow);
      }
      if (this.#snapshot().phase === "finished") {
        break;
      }
    }

    events.push(...this.#engine.tickTo(nowMillis).events);
    const afterTick = this.#snapshot();
    const damage = Math.max(0, livesAtStart - afterTick.lives);
    if (damage > 0) {
      this.#collisions += damage;
      this.#damage += damage;
      for (const agent of this.#agents) {
        if (touchesAnyHazard(agent.position, beforeTick.hazards)) {
          agent.hurtUntilMillis = nowMillis + 500;
        }
      }
    }
    if (afterTick.checkpoint > checkpointAtStart) {
      this.#checkpointAdvanced(afterTick.checkpoint);
    }
    this.#updateDeadlocks(afterTick);
    this.#lastFrame = this.#recordFrame(inputs, actionRecords, events);
    this.#notifyRenderer();
  }

  public run(
    maxTicks = Math.ceil((this.#options.durationMillis + 3_000) / CRUCE_AGENT_FRAME_MILLIS),
    stopWhenFinished = true
  ): CruceHarnessFrame {
    if (!Number.isInteger(maxTicks) || maxTicks < 0) {
      throw new Error("maxTicks must be a non-negative integer");
    }
    for (let index = 0; index < maxTicks; index += 1) {
      if (stopWhenFinished && this.#snapshot().phase === "finished") {
        break;
      }
      this.#stepOnce();
    }
    return this.#lastFrame;
  }

  #createAgents(): InternalAgent[] {
    const selectionRandom = createSeededRandom(this.#options.seed ^ 0x4352_5543);
    const spawnCells = seededSpawnCells(selectionRandom);
    const profilePool = normalizeProfilePool(this.#options.profile);
    const brain = createObjectiveHazardBrain({
      id: "cruce-objective-hazard",
      maxObjectiveValue: 100,
      hazardCost: 80,
      crowdingCost: 5,
      reservationCost: 30,
      stepMillis: Math.round(1_000 / this.#options.speed)
    });
    return Array.from({ length: this.#options.agentCount }, (_, index): InternalAgent => {
      const baseProfileId = profilePool.length === 1
        ? profilePool[0] as string
        : profilePool[selectionRandom.int(profilePool.length)] as string;
      const profile = speedAdjustedProfile(getAgentProfile(baseProfileId), this.#options.speed, index);
      const id = `cruce-agent-${String(index + 1).padStart(2, "0")}`;
      const position = spawnCells[index] as GridPoint;
      const definition = createAgentDefinition({
        id,
        brainId: brain.id,
        profileId: profile.id,
        role: index === 0 ? "pathfinder" : "runner",
        tags: ["cruce-galactico", baseProfileId],
        config: Object.freeze({ speed: this.#options.speed, slot: index })
      });
      return {
        id,
        color: AGENT_COLORS[index] as HexColor,
        baseProfileId,
        runtime: createAgentRuntime({
          definition,
          profile,
          brain,
          seed: (this.#options.seed + Math.imul(index + 1, 0x9e37_79b9)) >>> 0,
          gridBounds: { width: FLOOR_COLS, height: FLOOR_ROWS }
        }),
        position,
        presentationPosition: position,
        velocity: { x: 0, y: 0 },
        facing: "up",
        facingRadians: Math.PI,
        lastExplanation: "Waiting for launch countdown",
        replans: 0,
        stuckReplans: 0,
        hurtUntilMillis: 0,
        visited: new Set([gridPointKey(position)]),
        checkpointXs: []
      };
    });
  }

  #observationFor(agent: InternalAgent, nowMillis: number) {
    const snapshot = this.#snapshot();
    const hazards = observationHazards(snapshot.hazards, this.#options.difficulty, nowMillis);
    const currentRectangles = snapshot.hazards.map((hazard) => ({ ...hazard }));
    const crowding = new Map<string, number>();
    for (const other of this.#agents) {
      if (other.id !== agent.id) {
        const key = gridPointKey(other.position);
        crowding.set(key, (crowding.get(key) ?? 0) + 1);
      }
    }
    const world: ObjectiveHazardWorld = Object.freeze({
      grid: this.#grid,
      reservations: this.#reservations,
      crowding,
      dynamicCost: ({ point, atMillis }) => predictedHazardCost(
        point,
        atMillis,
        nowMillis,
        currentRectangles,
        this.#options.difficulty
      )
    });
    return createAgentObservation({
      agentId: agent.id,
      tick: this.#tick,
      nowMillis,
      position: agent.position,
      velocity: agent.velocity,
      entities: this.#agents
        .filter((other) => other.id !== agent.id)
        .map((other) => Object.freeze({
          id: other.id,
          kind: "teammate",
          position: other.position,
          velocity: other.velocity,
          teamId: "pilots"
        })),
      objectives: checkpointObjectives(snapshot.checkpoint),
      hazards,
      world
    });
  }

  #movementDestination(agent: InternalAgent, requested: GridPoint): GridPoint {
    const deltaX = requested.x - agent.position.x;
    const deltaY = requested.y - agent.position.y;
    const occupied = new Set(this.#agents
      .filter((other) => other.id !== agent.id)
      .map((other) => gridPointKey(other.movement?.to ?? other.position)));
    const target = agent.lastIntention?.target;
    if (target !== undefined && target.y < agent.position.y && deltaY >= 0) {
      const forward = Object.freeze({ x: agent.position.x, y: agent.position.y - 1 });
      return !occupied.has(gridPointKey(forward)) ? forward : agent.position;
    }
    let destination = {
      x: agent.position.x,
      y: agent.position.y
    };
    if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) {
      destination.y += Math.sign(deltaY);
    } else if (deltaX !== 0) {
      destination.x += Math.sign(deltaX);
    }
    destination = {
      x: clamp(Math.round(destination.x), 0, FLOOR_COLS - 1),
      y: clamp(Math.round(destination.y), 0, FLOOR_ROWS - 1)
    };
    if (!occupied.has(gridPointKey(destination))) {
      return Object.freeze(destination);
    }
    const alternatives = [
      { x: agent.position.x - 1, y: agent.position.y },
      { x: agent.position.x + 1, y: agent.position.y },
      { x: agent.position.x, y: agent.position.y - 1 },
      { x: agent.position.x, y: agent.position.y + 1 }
    ].filter((point) =>
      point.x >= 0 && point.x < FLOOR_COLS && point.y >= 0 && point.y < FLOOR_ROWS
        && !occupied.has(gridPointKey(point))
    ).sort((first, second) =>
      manhattanDistance(first, requested) - manhattanDistance(second, requested)
        || first.y - second.y
        || first.x - second.x
    );
    return Object.freeze(alternatives[0] ?? agent.position);
  }

  #startMovement(
    agent: InternalAgent,
    destination: GridPoint,
    nowMillis: number
  ): Readonly<{ inputs: ReplayInputAction[]; events: GameEvent[] }> {
    agent.movement = Object.freeze({
      from: agent.position,
      to: destination,
      startedAtMillis: nowMillis,
      arrivesAtMillis: nowMillis + 1_000 / this.#options.speed
    });
    const deltaX = destination.x - agent.position.x;
    const deltaY = destination.y - agent.position.y;
    agent.facingRadians = Math.atan2(deltaX, deltaY);
    agent.facing = facingFromDelta(deltaX, deltaY);
    return Object.freeze({
      inputs: [releaseInput(agent.id, agent.position)],
      events: this.#engine.release(agent.position.x, agent.position.y, nowMillis).events
    });
  }

  #advanceMovement(
    agent: InternalAgent,
    nowMillis: number
  ): Readonly<{ inputs: ReplayInputAction[]; events: GameEvent[] }> {
    const movement = agent.movement;
    if (movement === undefined) {
      return Object.freeze({ inputs: [], events: [] });
    }
    const progress = clamp(
      (nowMillis - movement.startedAtMillis) / (movement.arrivesAtMillis - movement.startedAtMillis),
      0,
      1
    );
    agent.presentationPosition = Object.freeze({
      x: movement.from.x + (movement.to.x - movement.from.x) * progress,
      y: movement.from.y + (movement.to.y - movement.from.y) * progress
    });
    if (progress < 1) {
      return Object.freeze({ inputs: [], events: [] });
    }
    if (currentOrNextHazardContains(
      movement.to,
      this.#snapshot().hazards
    )) {
      return Object.freeze({ inputs: [], events: [] });
    }

    const inputs = [pressInput(agent.id, movement.to)];
    const events: GameEvent[] = [];
    events.push(...this.#engine.press(movement.to.x, movement.to.y, nowMillis).events);
    agent.position = movement.to;
    agent.presentationPosition = movement.to;
    agent.movement = undefined;
    this.#lastMovementTick = this.#tick;
    agent.visited.add(gridPointKey(agent.position));
    return Object.freeze({ inputs, events });
  }

  #checkpointAdvanced(checkpoint: number): void {
    if (checkpoint <= this.#snapshot().checkpoint && this.#lastProgressTick === this.#tick) {
      return;
    }
    this.#lastProgressTick = this.#tick;
    for (const agent of this.#agents) {
      this.#reservations.releaseOwner(agent.id);
      agent.runtime.forceReplan();
    }
  }

  #updateDeadlocks(snapshot: GalacticCrossingSnapshot): void {
    if (snapshot.phase !== "running") {
      return;
    }
    const deadlockWindow = Math.ceil(CRUCE_AGENT_TICK_RATE * Math.max(5, 30 / this.#options.speed));
    const lastUsefulMovement = Math.max(this.#lastProgressTick, this.#lastMovementTick);
    if (this.#tick - lastUsefulMovement >= deadlockWindow
      && this.#tick - this.#lastDeadlockTick >= deadlockWindow) {
      this.#deadlocks += 1;
      this.#lastDeadlockTick = this.#tick;
      for (const agent of this.#agents) {
        agent.runtime.forceReplan();
      }
    }
  }

  #recordFrame(
    inputs: readonly ReplayInputAction[],
    actions: readonly ReplayAgentActionRecord[],
    events: readonly GameEvent[]
  ): CruceHarnessFrame {
    const agents = this.#renderableAgents();
    const debug = this.#debugSnapshot();
    const metrics = liveMetrics(this.#snapshot(), debug);
    const state = authoritativeHarnessState(this.#engine.state, agents, debug);
    const replayFrame = this.#recorder.record({
      tick: this.#tick,
      inputs,
      actions,
      events,
      agents: agents.map(replayAgentSample),
      state,
      authoritativeState: authoritativeGameState(this.#engine.state)
    });
    const checksum = replayFrame.checksum;
    if (checksum === undefined) {
      throw new Error("Cruce agent frames require an authoritative checksum");
    }
    return Object.freeze({
      tick: this.#tick,
      atMillis: this.#engine.clockMillis,
      state: this.#engine.state,
      agents,
      replay: Object.freeze({ frame: replayFrame, checksum }),
      debug,
      metrics
    });
  }

  #renderableAgents(): readonly CruceRenderableAgent[] {
    const nowMillis = this.#engine.clockMillis;
    const snapshot = this.#snapshot();
    return Object.freeze(this.#agents.map((agent): CruceRenderableAgent => {
      const runtimeSnapshot = safeRuntimeSnapshot(agent.runtime);
      const path = runtimeSnapshot?.brainState.path ?? [];
      const reservations = this.#reservations.reservations(nowMillis)
        .filter((reservation) => reservation.ownerId === agent.id)
        .map((reservation): CruceAgentReservationDebug => Object.freeze({
          id: reservation.id,
          ownerId: reservation.ownerId,
          kind: reservation.kind,
          expiresAtMillis: reservation.expiresAtMillis,
          objectiveId: reservation.kind === "objective" ? reservation.objectiveId : undefined,
          point: reservation.kind === "destination" ? reservation.point : undefined,
          points: reservation.kind === "corridor" ? reservation.points : undefined
        }));
      return Object.freeze({
        id: agent.id,
        tick: this.#tick,
        atMillis: nowMillis,
        color: agent.color,
        profileId: agent.baseProfileId,
        variant: variantForProfile(agent.baseProfileId),
        position: Object.freeze({ ...agent.presentationPosition }),
        velocity: Object.freeze({ ...agent.velocity }),
        facing: agent.facing,
        facingRadians: agent.facingRadians,
        grounded: true,
        action: renderAction(agent, snapshot, nowMillis),
        intention: agent.lastIntention?.label ?? "wait",
        target: agent.lastIntention?.target,
        targetId: agent.lastIntention?.targetId,
        emotion: agentEmotion(agent, snapshot, nowMillis),
        debug: Object.freeze({
          path: Object.freeze(path.map((point) => Object.freeze({ ...point }))),
          reservations: Object.freeze(reservations),
          utility: agent.lastIntention?.utility,
          explanation: agent.lastExplanation,
          replanReason: agent.lastReplanReason,
          replans: agent.replans,
          stuckReplans: agent.stuckReplans,
          pendingUntilMillis: agent.pendingUntilMillis,
          contractVersion: AGENT_CONTRACT_VERSION
        })
      });
    }));
  }

  #debugSnapshot(): CruceHarnessDebug {
    const renderable = this.#renderableAgents();
    const reservations = renderable.flatMap((agent) => agent.debug.reservations.map((reservation) => ({
      id: reservation.id,
      ownerId: reservation.ownerId,
      points: reservation.kind === "corridor"
        ? reservation.points ?? []
        : reservation.kind === "destination" && reservation.point !== undefined
          ? [reservation.point]
          : [],
      color: agent.color
    })));
    return Object.freeze({
      tick: this.#tick,
      checkpoint: this.#snapshot().checkpoint,
      collisions: this.#collisions,
      damage: this.#damage,
      deadlocks: this.#deadlocks,
      replans: this.#agents.reduce((total, agent) => total + agent.replans, 0),
      stuckReplans: this.#agents.reduce((total, agent) => total + agent.stuckReplans, 0),
      lastProgressTick: this.#lastProgressTick,
      routeDiversity: routeDiversity(this.#agents),
      paths: Object.freeze(renderable.map((agent) => Object.freeze({
        id: agent.id,
        points: agent.debug.path,
        color: agent.color
      }))),
      reservations: Object.freeze(reservations),
      targets: Object.freeze(renderable.flatMap((agent) => agent.target === undefined ? [] : [Object.freeze({
        id: agent.id,
        position: agent.target,
        radiusTiles: 0.4,
        color: agent.color
      })]))
    });
  }

  #snapshot(): GalacticCrossingSnapshot {
    return this.#engine.state.snapshot as GalacticCrossingSnapshot;
  }

  #notifyRenderer(): void {
    this.#options.onRender?.(
      cloneFrame(this.#engine.state.frame),
      structuredClone(this.#snapshot()),
      this.#renderableAgents()
    );
  }
}

export function createCruceAgentHarness(options: CruceHarnessOptions = {}): CruceAgentHarness {
  return new CruceAgentHarness(options);
}

export function normalizeHarnessOptions(options: CruceHarnessOptions): NormalizedCruceHarnessOptions {
  const agentCount = options.agentCount ?? DEFAULT_AGENT_COUNT;
  if (!Number.isInteger(agentCount) || agentCount < MIN_CRUCE_AGENTS || agentCount > MAX_CRUCE_AGENTS) {
    throw new Error(`Cruce agentCount must be between ${MIN_CRUCE_AGENTS} and ${MAX_CRUCE_AGENTS}`);
  }
  const speed = options.speed ?? DEFAULT_AGENT_SPEED;
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("Cruce agent speed must be between 0.25 and 4");
  }
  const playerCount = options.playerCount ?? 0;
  if (!Number.isInteger(playerCount) || playerCount < 0 || playerCount > 4) {
    throw new Error("Cruce configured playerCount must remain between 0 and 4");
  }
  const durationMillis = options.durationMillis ?? 75_000;
  if (!Number.isFinite(durationMillis) || durationMillis <= 0) {
    throw new Error("Cruce durationMillis must be positive");
  }
  const replaySnapshotIntervalTicks = options.replaySnapshotIntervalTicks ?? CRUCE_AGENT_TICK_RATE;
  if (!Number.isInteger(replaySnapshotIntervalTicks) || replaySnapshotIntervalTicks <= 0) {
    throw new Error("Cruce replay snapshot interval must be a positive integer");
  }
  const profile = options.profile ?? "mixed";
  normalizeProfilePool(profile);
  return Object.freeze({
    seed: normalizeSeed(options.seed),
    profile,
    agentCount,
    speed,
    difficulty: options.difficulty ?? "medium",
    durationMillis,
    playerCount,
    replaySnapshotIntervalTicks,
    onRender: options.onRender
  });
}

export function harnessReplayConfig(options: NormalizedCruceHarnessOptions): ReplayJsonObject {
  return toReplayJson({
    agentCount: options.agentCount,
    profile: options.profile,
    speed: options.speed,
    difficulty: options.difficulty,
    durationMillis: options.durationMillis,
    playerCount: options.playerCount,
    replaySnapshotIntervalTicks: options.replaySnapshotIntervalTicks
  }) as ReplayJsonObject;
}

export function checkpointObjectives(checkpoint: number) {
  const band = CHECKPOINT_BANDS[checkpoint];
  if (band === undefined) {
    return Object.freeze([]);
  }
  return Object.freeze(Array.from({ length: FLOOR_COLS }, (_, x) => Object.freeze({
    id: `checkpoint:${checkpoint}:slot:${x}`,
    kind: "checkpoint",
    position: Object.freeze({ x, y: band.maxY }),
    value: 100 - Math.abs(x - (FLOOR_COLS - 1) / 2) * 0.15,
    attributes: Object.freeze({ checkpoint, bandMinY: band.minY, bandMaxY: band.maxY })
  })));
}

export function observationHazards(
  rectangles: readonly GalacticHazard[],
  difficulty: GameDifficulty,
  observedAtMillis = 0
): readonly AgentHazard[] {
  const stepMillis = DIFFICULTY_STEP_MILLIS[difficulty] ?? DIFFICULTY_STEP_MILLIS.medium as number;
  return Object.freeze(rectangles.map((rectangle, index): AgentHazard => {
    const direction = hazardDirection(rectangle.y);
    return Object.freeze({
      id: `traffic:${index}:${rectangle.x}:${rectangle.y}`,
      position: Object.freeze({
        x: Math.round(rectangle.x + (rectangle.width - 1) / 2),
        y: Math.round(rectangle.y + (rectangle.height - 1) / 2)
      }),
      positionAtMillis: observedAtMillis,
      radius: Math.max(rectangle.width, rectangle.height) / 2,
      severity: 1,
      velocity: Object.freeze({ x: direction * 1_000 / stepMillis, y: 0 })
    });
  }));
}

export function predictedHazardCost(
  point: GridPoint,
  atMillis: number,
  observedAtMillis: number,
  rectangles: readonly GalacticHazard[],
  difficulty: GameDifficulty
): number {
  const stepMillis = DIFFICULTY_STEP_MILLIS[difficulty] ?? DIFFICULTY_STEP_MILLIS.medium as number;
  const steps = Math.floor(Math.max(0, atMillis - observedAtMillis) / stepMillis);
  return rectangles.some((rectangle) => {
    const x = wrapHazardX(rectangle.x + steps * hazardDirection(rectangle.y));
    return point.x >= x && point.x < x + rectangle.width
      && point.y >= rectangle.y && point.y < rectangle.y + rectangle.height;
  }) ? 250 : 0;
}

export type CruceRouteTrace = Readonly<{
  visited: ReadonlySet<string>;
  checkpointXs: readonly number[];
}>;

export function routeSignature(agent: CruceRouteTrace): string {
  const checkpoints = agent.checkpointXs.length === 0 ? "none" : agent.checkpointXs.join(",");
  const lateralPositions = [...agent.visited].map((key) => Number(key.split(",")[0] ?? 0));
  const lateralRange = lateralPositions.length === 0
    ? "none"
    : `${Math.min(...lateralPositions)}-${Math.max(...lateralPositions)}`;
  return `${checkpoints}:${lateralRange}`;
}

export function routeSignatures(agents: readonly CruceRouteTrace[]): readonly string[] {
  return Object.freeze(agents.map(routeSignature));
}

export function routeDiversityFromSignatures(signatures: readonly string[]): number {
  if (signatures.length === 0) {
    return 0;
  }
  return new Set(signatures).size / signatures.length;
}

export function routeDiversity(agents: readonly CruceRouteTrace[]): number {
  return routeDiversityFromSignatures(routeSignatures(agents));
}

function liveMetrics(snapshot: GalacticCrossingSnapshot, debug: CruceHarnessDebug): CruceLiveMetrics {
  return Object.freeze({
    completed: snapshot.phase === "finished" && snapshot.success,
    elapsedMillis: snapshot.elapsedMillis,
    score: snapshot.score,
    collisions: debug.collisions,
    damage: debug.damage,
    deadlocks: debug.deadlocks,
    replans: debug.replans,
    stuckReplans: debug.stuckReplans,
    routeDiversity: debug.routeDiversity
  });
}

function speedAdjustedProfile(base: AgentProfile, speed: number, index: number): AgentProfile {
  return defineAgentProfile(`${base.id}:cruce:${speed}:${index}`, `${base.label} Cruce`, {
    ...base.parameters,
    reactionDelayMillis: base.parameters.reactionDelayMillis / speed,
    replanIntervalMillis: base.parameters.replanIntervalMillis / speed,
    reservationHorizonMillis: base.parameters.reservationHorizonMillis / Math.max(0.5, speed),
    mistakeRate: base.parameters.mistakeRate * 0.35,
    mistakeSeverity: base.parameters.mistakeSeverity * 0.5
  });
}

function normalizeProfilePool(selection: CruceProfileSelection): readonly string[] {
  const pool = selection === "mixed"
    ? DEFAULT_PROFILE_POOL
    : Array.isArray(selection) ? selection : [selection];
  if (pool.length === 0) {
    throw new Error("Cruce profile pool must not be empty");
  }
  for (const id of pool) {
    getAgentProfile(id);
  }
  return Object.freeze([...pool]);
}

function seededSpawnCells(random: ReturnType<typeof createSeededRandom>): readonly GridPoint[] {
  const cells = [29, 30, 31].flatMap((y) =>
    Array.from({ length: 8 }, (_, index) => Object.freeze({ x: 4 + index, y }))
  );
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = random.int(index + 1);
    const current = cells[index] as GridPoint;
    cells[index] = cells[swap] as GridPoint;
    cells[swap] = current;
  }
  return Object.freeze(cells);
}

function safeRuntimeSnapshot(
  runtime: AgentRuntime<ObjectiveHazardWorld, ObjectiveHazardBrainState>
): AgentSnapshot<ObjectiveHazardBrainState> | undefined {
  try {
    return runtime.snapshot();
  } catch {
    return undefined;
  }
}

function authoritativeHarnessState(
  state: GameEngineState,
  agents: readonly CruceRenderableAgent[],
  debug: CruceHarnessDebug
): ReplayJsonValue {
  return toReplayJson({
    clockMillis: state.clockMillis,
    snapshot: state.snapshot,
    frame: state.frame,
    agents: agents.map((agent) => ({
      id: agent.id,
      position: agent.position,
      velocity: agent.velocity,
      facing: agent.facing,
      action: agent.action,
      intention: agent.intention,
      target: agent.target,
      targetId: agent.targetId,
      emotion: agent.emotion,
      path: agent.debug.path,
      utility: agent.debug.utility,
      replanReason: agent.debug.replanReason,
      replans: agent.debug.replans,
      stuckReplans: agent.debug.stuckReplans
    })),
    debug
  });
}

export function authoritativeGameState(state: GameEngineState): ReplayJsonValue {
  return toReplayJson({
    clockMillis: state.clockMillis,
    snapshot: state.snapshot,
    frame: state.frame
  });
}

function replayAgentSample(agent: CruceRenderableAgent): ReplayAgentSample {
  return {
    id: agent.id,
    position: agent.position,
    facingRadians: agent.facingRadians,
    action: agent.action,
    score: agent.debug.utility,
    state: toReplayJson({
      profileId: agent.profileId,
      intention: agent.intention,
      targetId: agent.targetId,
      target: agent.target,
      emotion: agent.emotion,
      path: agent.debug.path,
      replans: agent.debug.replans,
      stuckReplans: agent.debug.stuckReplans
    }) as ReplayJsonObject
  };
}

function agentEmotion(
  agent: InternalAgent,
  snapshot: GalacticCrossingSnapshot,
  nowMillis: number
): CruceAgentEmotion {
  if (snapshot.phase === "finished" && snapshot.success) {
    return "excited";
  }
  if (agent.hurtUntilMillis > nowMillis) {
    return "afraid";
  }
  if (agent.lastReplanReason === "stuck") {
    return "frustrated";
  }
  if (snapshot.hazards.some((hazard) => pointNearHazard(agent.position, hazard, 1))) {
    return "afraid";
  }
  return agent.lastAction?.kind === "interact" ? "happy" : "neutral";
}

function renderAction(agent: InternalAgent, snapshot: GalacticCrossingSnapshot, nowMillis: number): string {
  if (snapshot.phase === "finished") {
    return snapshot.success ? "celebrate-large" : "fall";
  }
  if (agent.hurtUntilMillis > nowMillis) {
    return "hit";
  }
  if (agent.lastReplanReason === "stuck") {
    return "dodge";
  }
  if (agent.lastAction?.kind === "interact") {
    return "collect";
  }
  return "none";
}

function variantForProfile(profileId: string): CruceAgentVariant {
  if (profileId === "cautious" || profileId === "helper") return "guardian";
  if (profileId === "explorer") return "explorer";
  if (profileId === "chaotic") return "trickster";
  return "runner";
}

function facingFromDelta(deltaX: number, deltaY: number): CruceAgentFacing {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX > 0 ? "right" : "left";
  }
  return deltaY > 0 ? "down" : "up";
}

function pointNearHazard(point: GridPoint, hazard: GalacticHazard, margin: number): boolean {
  return point.x >= hazard.x - margin
    && point.x < hazard.x + hazard.width + margin
    && point.y >= hazard.y - margin
    && point.y < hazard.y + hazard.height + margin;
}

function touchesAnyHazard(point: GridPoint, hazards: readonly GalacticHazard[]): boolean {
  return hazards.some((hazard) => pointNearHazard(point, hazard, 0));
}

function currentOrNextHazardContains(point: GridPoint, hazards: readonly GalacticHazard[]): boolean {
  return hazards.some((hazard) => [0, 1].some((step) => {
    const x = wrapHazardX(hazard.x + step * hazardDirection(hazard.y));
    return point.x >= x && point.x < x + hazard.width
      && point.y >= hazard.y && point.y < hazard.y + hazard.height;
  }));
}

function hazardDirection(y: number): number {
  if (y >= 24) return 1;
  if (y >= 17) return -1;
  if (y >= 10) return 1;
  return -1;
}

function wrapHazardX(x: number): number {
  return ((x + 3) % 20 + 20) % 20 - 3;
}

function pressInput(sourceId: string, point: GridPoint): ReplayInputAction {
  return Object.freeze({ kind: "press", x: point.x, y: point.y, sourceId });
}

function releaseInput(sourceId: string, point: GridPoint): ReplayInputAction {
  return Object.freeze({ kind: "release", x: point.x, y: point.y, sourceId });
}

function samePoint(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function normalizeSeed(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_SEED;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) >>> 0 : DEFAULT_AGENT_SEED;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function cloneFrame(frame: Frame): Frame {
  return {
    width: frame.width,
    height: frame.height,
    cells: frame.cells.map((cell) => ({ ...cell }))
  };
}
