import {
  createGameEngine,
  normalizeGameSeed,
  type GameConfig,
  type GameEngineState,
  type GameEvent,
  type GameInstance
} from "@motion-levels-games/game-sdk";

export const REPLAY_SCHEMA_VERSION = 1;
export const DEFAULT_REPLAY_SNAPSHOT_INTERVAL_TICKS = 250;

export type ReplayJsonPrimitive = boolean | number | string | null;
export type ReplayJsonValue = ReplayJsonPrimitive | ReplayJsonValue[] | ReplayJsonObject;
export type ReplayJsonObject = { [key: string]: ReplayJsonValue };

export type ReplayHeader = {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  gameId: string;
  gameVersion: string;
  simulationVersion: string;
  brainVersions: Record<string, string>;
  seed: string;
  tickRate: number;
  startedAt?: string;
  config?: ReplayJsonObject;
  initialState?: ReplayJsonValue;
};

export type ReplayInputAction = {
  kind: "press" | "release";
  x: number;
  y: number;
  sourceId?: string;
};

export type ReplayAgentActionRecord<TAction extends ReplayJsonValue = ReplayJsonValue> = {
  agentId: string;
  action: TAction;
};

export type ReplayAgentSample = {
  id: string;
  position: { x: number; y: number };
  facingRadians: number;
  action: string;
  score?: number;
  state?: ReplayJsonObject;
};

export type ReplayFrame<TAction extends ReplayJsonValue = ReplayJsonValue> = {
  tick: number;
  inputs: ReplayInputAction[];
  actions: ReplayAgentActionRecord<TAction>[];
  events: GameEvent[];
  agents?: ReplayAgentSample[];
  checksum?: string;
  /** Checksum of game-owned state only, excluding optional bot/runtime diagnostics. */
  authoritativeChecksum?: string;
};

export type ReplaySnapshot = {
  tick: number;
  state: ReplayJsonValue;
  checksum: string;
};

export type GameReplay<TAction extends ReplayJsonValue = ReplayJsonValue> = {
  header: ReplayHeader;
  frames: ReplayFrame<TAction>[];
  snapshots: ReplaySnapshot[];
};

export type ReplayRecordFrame<TAction extends ReplayJsonValue = ReplayJsonValue> = {
  tick: number;
  inputs?: readonly ReplayInputAction[];
  actions?: readonly ReplayAgentActionRecord<TAction>[];
  events?: readonly GameEvent[];
  agents?: readonly ReplayAgentSample[];
  state?: unknown;
  authoritativeState?: unknown;
};

export type ReplayRecorderOptions = {
  snapshotIntervalTicks?: number;
  checksumEveryFrame?: boolean;
};

export class ReplayRecorder<TAction extends ReplayJsonValue = ReplayJsonValue> {
  private readonly frames: ReplayFrame<TAction>[] = [];
  private readonly snapshots: ReplaySnapshot[] = [];
  private readonly snapshotIntervalTicks: number;
  private readonly checksumEveryFrame: boolean;
  private lastTick = -1;

  constructor(
    private readonly header: ReplayHeader,
    options: ReplayRecorderOptions = {}
  ) {
    assertReplayHeader(header);
    this.snapshotIntervalTicks = positiveInteger(
      options.snapshotIntervalTicks,
      DEFAULT_REPLAY_SNAPSHOT_INTERVAL_TICKS
    );
    this.checksumEveryFrame = options.checksumEveryFrame ?? true;
  }

  record(frame: ReplayRecordFrame<TAction>): ReplayFrame<TAction> {
    if (!Number.isInteger(frame.tick) || frame.tick < 0 || frame.tick <= this.lastTick) {
      throw new Error("Replay ticks must be non-negative, unique, and strictly increasing");
    }
    this.lastTick = frame.tick;

    const state = frame.state === undefined ? undefined : toReplayJson(frame.state);
    const authoritativeState = frame.authoritativeState === undefined
      ? undefined
      : toReplayJson(frame.authoritativeState);
    const checksum = state === undefined || !this.checksumEveryFrame
      ? undefined
      : replayChecksum(state);
    const authoritativeChecksum = authoritativeState === undefined || !this.checksumEveryFrame
      ? undefined
      : replayChecksum(authoritativeState);
    const recorded: ReplayFrame<TAction> = {
      tick: frame.tick,
      inputs: frame.inputs?.map(copyInput) ?? [],
      actions: frame.actions?.map((record) => ({
        agentId: record.agentId,
        action: toReplayJson(record.action) as TAction
      })) ?? [],
      events: frame.events?.map((event) => ({ ...event })) ?? [],
      ...(frame.agents ? { agents: frame.agents.map(copyAgentSample) } : {}),
      ...(checksum ? { checksum } : {}),
      ...(authoritativeChecksum ? { authoritativeChecksum } : {})
    };
    this.frames.push(recorded);

    if (state !== undefined && (frame.tick === 0 || frame.tick % this.snapshotIntervalTicks === 0)) {
      this.snapshots.push({
        tick: frame.tick,
        state,
        checksum: replayChecksum(state)
      });
    }
    return copyFrame(recorded);
  }

  finish(): GameReplay<TAction> {
    return {
      header: copyHeader(this.header),
      frames: this.frames.map(copyFrame),
      snapshots: this.snapshots.map((snapshot) => ({
        tick: snapshot.tick,
        state: cloneReplayJson(snapshot.state),
        checksum: snapshot.checksum
      }))
    };
  }
}

export type ReplaySeekResult<TAction extends ReplayJsonValue = ReplayJsonValue> = {
  tick: number;
  snapshot?: ReplaySnapshot;
  frames: ReplayFrame<TAction>[];
};

export class ReplayPlayer<TAction extends ReplayJsonValue = ReplayJsonValue> {
  private currentTick = 0;
  private progressTick = 0;
  private paused = true;
  private speed = 1;

  constructor(private readonly replay: GameReplay<TAction>) {
    assertReplay(replay);
  }

  get state(): { tick: number; paused: boolean; speed: number; endTick: number } {
    return {
      tick: this.currentTick,
      paused: this.paused,
      speed: this.speed,
      endTick: this.endTick()
    };
  }

  play(): void {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0 || speed > 16) {
      throw new Error("Replay speed must be greater than zero and at most 16");
    }
    this.speed = speed;
  }

  seek(tick: number): ReplaySeekResult<TAction> {
    this.currentTick = clampTick(tick, this.endTick());
    this.progressTick = this.currentTick;
    const snapshot = [...this.replay.snapshots]
      .reverse()
      .find((candidate) => candidate.tick <= this.currentTick);
    return {
      tick: this.currentTick,
      ...(snapshot ? {
        snapshot: {
          tick: snapshot.tick,
          state: cloneReplayJson(snapshot.state),
          checksum: snapshot.checksum
        }
      } : {}),
      frames: this.replay.frames
        // Snapshot state is captured after its tick has been applied. Returning
        // that same frame would make hydration consumers apply it twice.
        .filter((frame) => (
          frame.tick > (snapshot?.tick ?? -1) && frame.tick <= this.currentTick
        ))
        .map(copyFrame)
    };
  }

  advance(renderDeltaTicks: number): ReplayFrame<TAction>[] {
    if (this.paused || !Number.isFinite(renderDeltaTicks) || renderDeltaTicks <= 0) {
      return [];
    }
    const previousTick = this.currentTick;
    this.progressTick = Math.min(
      this.endTick(),
      this.progressTick + renderDeltaTicks * this.speed
    );
    this.currentTick = clampTick(Math.floor(this.progressTick), this.endTick());
    if (this.currentTick >= this.endTick()) this.paused = true;
    return this.replay.frames
      .filter((frame) => frame.tick > previousTick && frame.tick <= this.currentTick)
      .map(copyFrame);
  }

  private endTick(): number {
    return this.replay.frames.at(-1)?.tick ?? 0;
  }
}

export type GhostTrack = {
  agentId: string;
  samples: Array<ReplayAgentSample & { tick: number }>;
};

export function createGhostTrack(replay: GameReplay, agentId: string): GhostTrack {
  return {
    agentId,
    samples: replay.frames.flatMap((frame) => {
      const sample = frame.agents?.find((candidate) => candidate.id === agentId);
      return sample ? [{ ...copyAgentSample(sample), tick: frame.tick }] : [];
    })
  };
}

export type ReplayAnonymizeOptions = {
  salt: string;
  retainStartedAt?: boolean;
  retainAgentStateKeys?: readonly string[];
  /** Header config is removed by default; explicitly retain reviewed scalar keys only. */
  retainConfigKeys?: readonly string[];
};

export function anonymizeReplay<TAction extends ReplayJsonValue>(
  replay: GameReplay<TAction>,
  options: ReplayAnonymizeOptions
): GameReplay<TAction> {
  if (!options.salt) throw new Error("Replay anonymization requires a non-empty salt");
  const aliases = new Map<string, string>();
  const alias = (id: string): string => {
    const existing = aliases.get(id);
    if (existing) return existing;
    const next = `agent-${replayChecksum(`${options.salt}:${id}`)}`;
    aliases.set(id, next);
    return next;
  };
  const retainedState = new Set(options.retainAgentStateKeys ?? []);
  const retainedConfig = new Set(options.retainConfigKeys ?? []);
  const safeConfig = replay.header.config === undefined
    ? undefined
    : Object.fromEntries(Object.entries(replay.header.config).filter(([key, value]) => (
      retainedConfig.has(key) && isReplayJsonPrimitive(value)
    ))) as ReplayJsonObject;
  const anonymized: GameReplay<TAction> = {
    header: {
      schemaVersion: replay.header.schemaVersion,
      gameId: replay.header.gameId,
      gameVersion: replay.header.gameVersion,
      simulationVersion: replay.header.simulationVersion,
      brainVersions: { ...replay.header.brainVersions },
      seed: replay.header.seed,
      tickRate: replay.header.tickRate,
      ...(options.retainStartedAt && replay.header.startedAt !== undefined
        ? { startedAt: replay.header.startedAt }
        : {}),
      ...(safeConfig !== undefined && Object.keys(safeConfig).length > 0 ? { config: safeConfig } : {})
    },
    frames: replay.frames.map((frame) => ({
      tick: frame.tick,
      inputs: frame.inputs.map((input) => ({
        ...copyInput(input),
        ...(input.sourceId ? { sourceId: alias(input.sourceId) } : {})
      })),
      // Arbitrary action payloads and event messages are deliberately dropped:
      // their game-defined schemas may contain identifiers or free-form text.
      actions: [],
      events: [],
      ...(frame.agents ? {
        agents: frame.agents.map((sample) => ({
          ...copyAgentSample(sample),
          id: alias(sample.id),
          ...(sample.state ? {
            state: Object.fromEntries(
              Object.entries(sample.state).filter(([key]) => retainedState.has(key))
            ) as ReplayJsonObject
          } : {})
        }))
      } : {})
    })),
    // Snapshots and checksums can contain or fingerprint arbitrary private
    // game/runtime state. A trajectory export is intentionally not replayable.
    snapshots: []
  };
  return anonymized;
}

export type ScheduledReplayInput = ReplayInputAction & { tick: number };

export type HeadlessReplayOptions = {
  createGame: (config: GameConfig) => GameInstance;
  config: GameConfig;
  header: Omit<ReplayHeader, "schemaVersion" | "tickRate" | "seed" | "config"> & {
    schemaVersion?: typeof REPLAY_SCHEMA_VERSION;
  };
  tickRate?: number;
  ticks: number;
  inputs?: readonly ScheduledReplayInput[];
  snapshotIntervalTicks?: number;
};

export type HeadlessReplayResult = {
  replay: GameReplay;
  state: GameEngineState;
  durationMillis: number;
};

export function runHeadlessReplay(options: HeadlessReplayOptions): HeadlessReplayResult {
  const tickRate = positiveInteger(options.tickRate, 50);
  const ticks = nonNegativeInteger(options.ticks, "Headless replay ticks");
  const configJson = toReplayJson(options.config);
  if (!isReplayJsonObject(configJson)) throw new Error("Replay game config must encode as an object");
  const seed = normalizeSeed(options.config.seed);
  const game = options.createGame({ ...options.config, seed, nowMillis: 0 });
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, { fps: tickRate, initialEvents, nowMillis: 0 });
  const recorder = new ReplayRecorder({
    ...options.header,
    schemaVersion: REPLAY_SCHEMA_VERSION,
    seed: String(seed),
    tickRate,
    config: configJson
  }, { snapshotIntervalTicks: options.snapshotIntervalTicks });
  const byTick = groupInputs(options.inputs ?? []);
  let state = engine.state;

  for (let tick = 0; tick <= ticks; tick += 1) {
    const atMillis = tickMillis(tick, tickRate);
    const inputs = byTick.get(tick) ?? [];
    const events: GameEvent[] = [];
    for (const input of inputs) {
      state = input.kind === "press"
        ? engine.press(input.x, input.y, atMillis)
        : engine.release(input.x, input.y, atMillis);
      events.push(...state.events);
    }
    state = engine.tickTo(atMillis);
    events.push(...state.events);
    recorder.record({
      tick,
      inputs,
      events,
      state: replayEngineState(state),
      authoritativeState: replayEngineState(state)
    });
  }

  return {
    replay: recorder.finish(),
    state,
    durationMillis: tickMillis(ticks, tickRate)
  };
}

export type ReplayVerification = {
  valid: boolean;
  expectedFrames: number;
  verifiedFrames: number;
  mismatches: Array<{ tick: number; expected?: string; actual: string }>;
  finalState: GameEngineState;
};

export function verifyHeadlessReplay(
  replay: GameReplay,
  createGame: (config: GameConfig) => GameInstance,
  configOverride: GameConfig = {}
): ReplayVerification {
  assertReplay(replay);
  const replayConfig = replay.header.config ? replayJsonToGameConfig(replay.header.config) : {};
  const inputs = replay.frames.flatMap((frame) => frame.inputs.map((input) => ({ ...input, tick: frame.tick })));
  const rerun = runHeadlessReplay({
    createGame,
    config: { ...replayConfig, ...configOverride, seed: Number(replay.header.seed) },
    header: {
      gameId: replay.header.gameId,
      gameVersion: replay.header.gameVersion,
      simulationVersion: replay.header.simulationVersion,
      brainVersions: { ...replay.header.brainVersions }
    },
    tickRate: replay.header.tickRate,
    ticks: replay.frames.at(-1)?.tick ?? 0,
    inputs
  });
  const actualByTick = new Map(rerun.replay.frames.map((frame) => [frame.tick, frame.checksum]));
  const mismatches = replay.frames.flatMap((frame) => {
    if (!frame.checksum) return [];
    const actual = actualByTick.get(frame.tick) ?? "missing";
    return actual === frame.checksum
      ? []
      : [{ tick: frame.tick, expected: frame.checksum, actual }];
  });
  return {
    valid: mismatches.length === 0,
    expectedFrames: replay.frames.length,
    verifiedFrames: replay.frames.length - mismatches.length,
    mismatches,
    finalState: rerun.state
  };
}

export function encodeReplay(replay: GameReplay): string {
  assertReplay(replay);
  return stableStringify(replay);
}

export function decodeReplay(serialized: string): GameReplay {
  const parsed: unknown = JSON.parse(serialized);
  assertReplay(parsed);
  return parsed;
}

export function replayChecksum(value: unknown): string {
  const bytes = new TextEncoder().encode(stableStringify(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(toReplayJson(value));
}

export function toReplayJson(value: unknown): ReplayJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Replay data cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : toReplayJson(entry));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, toReplayJson(entry)] as const);
    return Object.fromEntries(entries);
  }
  throw new Error(`Replay data cannot encode ${typeof value}`);
}

function replayEngineState(state: GameEngineState): ReplayJsonObject {
  return toReplayJson({
    clockMillis: state.clockMillis,
    frame: state.frame,
    snapshot: state.snapshot
  }) as ReplayJsonObject;
}

function replayJsonToGameConfig(value: ReplayJsonObject): GameConfig {
  return value as unknown as GameConfig;
}

function groupInputs(inputs: readonly ScheduledReplayInput[]): Map<number, ReplayInputAction[]> {
  const result = new Map<number, ReplayInputAction[]>();
  for (const input of inputs) {
    const tick = nonNegativeInteger(input.tick, "Replay input tick");
    const entries = result.get(tick) ?? [];
    entries.push(copyInput(input));
    result.set(tick, entries);
  }
  return result;
}

function copyInput(input: ReplayInputAction): ReplayInputAction {
  return {
    kind: input.kind,
    x: input.x,
    y: input.y,
    ...(input.sourceId ? { sourceId: input.sourceId } : {})
  };
}

function copyAgentSample(sample: ReplayAgentSample): ReplayAgentSample {
  return {
    id: sample.id,
    position: { ...sample.position },
    facingRadians: sample.facingRadians,
    action: sample.action,
    ...(sample.score === undefined ? {} : { score: sample.score }),
    ...(sample.state ? { state: cloneReplayJson(sample.state) as ReplayJsonObject } : {})
  };
}

function copyFrame<TAction extends ReplayJsonValue>(frame: ReplayFrame<TAction>): ReplayFrame<TAction> {
  return {
    tick: frame.tick,
    inputs: frame.inputs.map(copyInput),
    actions: frame.actions.map((record) => ({
      agentId: record.agentId,
      action: cloneReplayJson(record.action) as TAction
    })),
    events: frame.events.map((event) => ({ ...event })),
    ...(frame.agents ? { agents: frame.agents.map(copyAgentSample) } : {}),
    ...(frame.checksum ? { checksum: frame.checksum } : {}),
    ...(frame.authoritativeChecksum ? { authoritativeChecksum: frame.authoritativeChecksum } : {})
  };
}

function copyHeader(header: ReplayHeader): ReplayHeader {
  return {
    ...header,
    brainVersions: { ...header.brainVersions },
    ...(header.config ? { config: cloneReplayJson(header.config) as ReplayJsonObject } : {}),
    ...(header.initialState === undefined ? {} : { initialState: cloneReplayJson(header.initialState) })
  };
}

function cloneReplayJson<T extends ReplayJsonValue>(value: T): T {
  return toReplayJson(value) as T;
}

function assertReplayHeader(header: ReplayHeader): void {
  if (header.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    throw new Error(`Unsupported replay schema ${String(header.schemaVersion)}; expected ${REPLAY_SCHEMA_VERSION}`);
  }
  if (!header.gameId || !header.gameVersion || !header.simulationVersion) {
    throw new Error("Replay header requires game, game version, and simulation version");
  }
  positiveInteger(header.tickRate, 0);
  if (!header.seed) throw new Error("Replay header requires an explicit seed");
}

function assertReplay(value: unknown): asserts value is GameReplay {
  if (!value || typeof value !== "object") throw new Error("Replay must be an object");
  const replay = value as Partial<GameReplay>;
  if (!replay.header) throw new Error("Replay header is missing");
  assertReplayHeader(replay.header);
  if (!Array.isArray(replay.frames) || !Array.isArray(replay.snapshots)) {
    throw new Error("Replay frames and snapshots must be arrays");
  }
  let previousTick = -1;
  for (const frame of replay.frames) {
    if (!Number.isInteger(frame.tick) || frame.tick <= previousTick) {
      throw new Error("Replay frame ticks must be strictly increasing");
    }
    previousTick = frame.tick;
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0) throw new Error("Expected a positive integer");
  return candidate;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function clampTick(value: number, endTick: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(endTick, Math.floor(value)));
}

function tickMillis(tick: number, tickRate: number): number {
  return Math.round((tick * 1000) / tickRate);
}

function normalizeSeed(seed: number | undefined): number {
  return normalizeGameSeed(seed);
}

function isReplayJsonObject(value: ReplayJsonValue): value is ReplayJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReplayJsonPrimitive(value: ReplayJsonValue): value is ReplayJsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
