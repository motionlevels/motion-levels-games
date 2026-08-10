import {
  REPLAY_SCHEMA_VERSION,
  ReplayPlayer,
  ReplayRecorder,
  createGhostTrack,
  replayChecksum,
  toReplayJson,
  type GameReplay,
  type GhostTrack,
  type ReplayAgentSample,
  type ReplayFrame,
  type ReplayJsonObject,
  type ReplayJsonValue
} from "@motion-levels-games/replay-runtime";
import {
  createGameEngine,
  type GameConfigOptions,
  type GameConfigPlayer,
  type GameEngineState
} from "@motion-levels-games/game-sdk";
import {
  DUELO_AGENT_FRAME_MILLIS,
  DUELO_AGENT_HARNESS_VERSION,
  DUELO_AGENT_TICK_RATE,
  createDueloAgentHarness,
  normalizeDueloAgentHarnessOptions,
  type DueloAgentHarnessFrame,
  type DueloAgentHarnessOptions
} from "./agent-harness.ts";
import {
  DUELO_AGENT_BRAIN_ID,
  DUELO_AGENT_CONTRACT_VERSION
} from "./agents.ts";
import { createGame } from "./game.ts";

export const DUELO_REPLAY_GAME_VERSION = "0.1.0";
export const DUELO_REPLAY_SIMULATION_VERSION = "duelo-replay-1";
export const DEFAULT_DUELO_REPLAY_SNAPSHOT_INTERVAL_TICKS = 100;

export type DueloReplayRecordOptions = DueloAgentHarnessOptions & Readonly<{
  maxTicks?: number;
  requireCompletion?: boolean;
  snapshotIntervalTicks?: number;
}>;

export type DueloReplayMismatch = Readonly<{
  tick: number;
  expected?: string;
  actual?: string;
}>;

export type DueloReplayVerification = Readonly<{
  valid: boolean;
  expectedFrames: number;
  verifiedFrames: number;
  mismatches: readonly DueloReplayMismatch[];
  finalChecksum?: string;
}>;

export type DueloReplaySeekVerification = Readonly<{
  valid: boolean;
  requestedTick: number;
  resolvedTick: number;
  snapshotTick?: number;
  snapshotChecksumValid: boolean;
  expectedChecksum?: string;
  actualChecksum?: string;
  authorityReplayOriginTick: 0;
  replayedFrames: number;
}>;

/**
 * Records the real Duelo harness: semantic controllers decide, the harness
 * moves through ordinary press/release calls, and GameEngine remains authority.
 */
export function recordDueloAgentReplay(
  options: DueloReplayRecordOptions = {}
): GameReplay {
  const normalized = normalizeDueloAgentHarnessOptions(options);
  const maxTicks = positiveInteger(options.maxTicks, 10_000, "Duelo replay maxTicks");
  const snapshotIntervalTicks = positiveInteger(
    options.snapshotIntervalTicks,
    DEFAULT_DUELO_REPLAY_SNAPSHOT_INTERVAL_TICKS,
    "Duelo replay snapshot interval"
  );
  const harness = createDueloAgentHarness(options);
  const recorder = new ReplayRecorder({
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameId: "duelo",
    gameVersion: DUELO_REPLAY_GAME_VERSION,
    simulationVersion: DUELO_REPLAY_SIMULATION_VERSION,
    brainVersions: { [DUELO_AGENT_BRAIN_ID]: String(DUELO_AGENT_CONTRACT_VERSION) },
    seed: String(normalized.seed),
    tickRate: DUELO_AGENT_TICK_RATE,
    config: replayConfig(normalized)
  }, {
    snapshotIntervalTicks,
    checksumEveryFrame: true
  });
  const previousPositions = new Map<string, Readonly<{ x: number; y: number }>>();
  const facings = new Map<string, number>();

  recordHarnessFrame(recorder, harness.frame, previousPositions, facings);
  for (let index = 0; index < maxTicks && !harness.frame.metrics.completed; index += 1) {
    recordHarnessFrame(recorder, harness.step(), previousPositions, facings);
  }
  if ((options.requireCompletion ?? true) && !harness.frame.metrics.completed) {
    throw new Error(`Duelo replay did not complete within ${maxTicks} ticks`);
  }
  return recorder.finish();
}

export function verifyDueloAgentReplay(replay: GameReplay): DueloReplayVerification {
  assertDueloReplay(replay);
  const actualByTick = replayAuthoritativeChecksums(replay);
  const mismatches = replay.frames.flatMap((frame): DueloReplayMismatch[] => {
    const expected = frame.authoritativeChecksum;
    const actual = actualByTick.get(frame.tick);
    return expected !== undefined && expected === actual
      ? []
      : [Object.freeze({ tick: frame.tick, expected, actual })];
  });
  return Object.freeze({
    valid: mismatches.length === 0 && actualByTick.size === replay.frames.length,
    expectedFrames: replay.frames.length,
    verifiedFrames: replay.frames.length - mismatches.length,
    mismatches: Object.freeze(mismatches),
    finalChecksum: actualByTick.get(replay.frames.at(-1)?.tick ?? 0)
  });
}

export function verifyDueloReplaySeek(
  replay: GameReplay,
  requestedTick: number
): DueloReplaySeekVerification {
  assertDueloReplay(replay);
  const seek = new ReplayPlayer(replay).seek(requestedTick);
  const expectedChecksum = frameAtTick(replay.frames, seek.tick)?.authoritativeChecksum;
  const actualByTick = replayAuthoritativeChecksums(replay, seek.tick);
  const actualChecksum = actualByTick.get(seek.tick);
  const snapshotChecksumValid = seek.snapshot === undefined
    || replayChecksum(seek.snapshot.state) === seek.snapshot.checksum;
  return Object.freeze({
    valid: snapshotChecksumValid && expectedChecksum !== undefined && expectedChecksum === actualChecksum,
    requestedTick,
    resolvedTick: seek.tick,
    snapshotTick: seek.snapshot?.tick,
    snapshotChecksumValid,
    expectedChecksum,
    actualChecksum,
    authorityReplayOriginTick: 0,
    replayedFrames: actualByTick.size
  });
}

export function dueloReplayFinalChecksum(replay: GameReplay): string | undefined {
  assertDueloReplay(replay);
  return replay.frames.at(-1)?.authoritativeChecksum;
}

export function dueloReplayArtifactChecksum(replay: GameReplay): string {
  assertDueloReplay(replay);
  return replayChecksum(replay);
}

export function dueloGhostTrack(replay: GameReplay, agentId: string): GhostTrack {
  assertDueloReplay(replay);
  return createGhostTrack(replay, agentId);
}

export function dueloReplayAuthoritativeState(state: GameEngineState): ReplayJsonObject {
  return toReplayJson({
    clockMillis: state.clockMillis,
    frame: state.frame,
    snapshot: state.snapshot
  }) as ReplayJsonObject;
}

function recordHarnessFrame(
  recorder: ReplayRecorder,
  frame: DueloAgentHarnessFrame,
  previousPositions: Map<string, Readonly<{ x: number; y: number }>>,
  facings: Map<string, number>
): void {
  const authoritativeState = dueloReplayAuthoritativeState(frame.state);
  recorder.record({
    tick: frame.tick,
    inputs: frame.inputs.map((input) => ({
      kind: input.kind,
      x: input.x,
      y: input.y,
      sourceId: input.agentId
    })),
    actions: frame.inputs.map((input) => ({
      agentId: input.agentId,
      action: toReplayJson({
        kind: input.kind,
        playerIndex: input.playerIndex,
        purpose: input.purpose,
        position: { x: input.x, y: input.y }
      })
    })),
    events: frame.events,
    agents: frame.agents.map((agent): ReplayAgentSample => {
      const previous = previousPositions.get(agent.id);
      const deltaX = previous === undefined ? 0 : agent.position.x - previous.x;
      const deltaY = previous === undefined ? 0 : agent.position.y - previous.y;
      const facing = deltaX === 0 && deltaY === 0
        ? (facings.get(agent.id) ?? 0)
        : Math.atan2(deltaX, -deltaY);
      previousPositions.set(agent.id, Object.freeze({ ...agent.position }));
      facings.set(agent.id, facing);
      return {
        id: agent.id,
        position: { ...agent.position },
        facingRadians: facing,
        action: agent.status,
        score: agent.claimed,
        state: toReplayJson({
          playerIndex: agent.playerIndex,
          profileId: agent.profileId,
          intention: agent.intention,
          explanation: agent.explanation,
          targetId: agent.targetId,
          target: agent.target,
          path: agent.path,
          remaining: agent.remaining,
          targetCount: agent.targetCount,
          rivalTargetsClaimed: agent.rivalTargetsClaimed
        }) as ReplayJsonObject
      };
    }),
    state: {
      authority: authoritativeState,
      boardSignature: frame.boardSignature,
      metrics: toReplayJson(frame.metrics),
      harnessChecksum: frame.checksum
    },
    authoritativeState
  });
}

function replayAuthoritativeChecksums(
  replay: GameReplay,
  throughTick = replay.frames.at(-1)?.tick ?? 0
): Map<number, string> {
  const config = replayGameConfig(replay);
  const game = createGame({
    seed: Number(replay.header.seed),
    playerCount: config.playerCount,
    difficulty: config.difficulty,
    players: config.players.map((player) => ({ ...player })),
    options: config.gameOptions,
    nowMillis: 0
  });
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, {
    fps: replay.header.tickRate,
    initialEvents,
    nowMillis: 0
  });
  const checksums = new Map<number, string>();
  for (const frame of replay.frames) {
    if (frame.tick > throughTick) break;
    const atMillis = Math.round(frame.tick * DUELO_AGENT_FRAME_MILLIS);
    let state = engine.tickTo(atMillis);
    for (const input of frame.inputs) {
      state = input.kind === "press"
        ? engine.press(input.x, input.y, atMillis)
        : engine.release(input.x, input.y, atMillis);
    }
    checksums.set(frame.tick, replayChecksum(dueloReplayAuthoritativeState(state)));
  }
  return checksums;
}

function assertDueloReplay(replay: GameReplay): void {
  if (replay.header.gameId !== "duelo") {
    throw new Error(`Expected a Duelo replay, received ${replay.header.gameId}`);
  }
  if (replay.header.gameVersion !== DUELO_REPLAY_GAME_VERSION) {
    throw new Error(`Unsupported Duelo game version ${replay.header.gameVersion}`);
  }
  if (replay.header.simulationVersion !== DUELO_REPLAY_SIMULATION_VERSION) {
    throw new Error(`Unsupported Duelo replay simulation ${replay.header.simulationVersion}`);
  }
  if (replay.header.tickRate !== DUELO_AGENT_TICK_RATE) {
    throw new Error(`Duelo replays require ${DUELO_AGENT_TICK_RATE} Hz`);
  }
  if (replay.header.brainVersions[DUELO_AGENT_BRAIN_ID] !== String(DUELO_AGENT_CONTRACT_VERSION)) {
    throw new Error("Unsupported Duelo agent brain version");
  }
  replayGameConfig(replay);
}

function replayConfig(
  options: ReturnType<typeof normalizeDueloAgentHarnessOptions>
): ReplayJsonObject {
  return toReplayJson({
    harnessVersion: DUELO_AGENT_HARNESS_VERSION,
    playerCount: options.playerCount,
    difficulty: options.difficulty,
    profiles: options.profiles.map((profile) => profile.id),
    movementTilesPerSecond: options.movementTilesPerSecond,
    players: options.players,
    gameOptions: options.gameOptions,
    autoReady: options.autoReady
  }) as ReplayJsonObject;
}

function replayGameConfig(replay: GameReplay): Readonly<{
  playerCount: number;
  difficulty: "medium" | "hard";
  players: readonly GameConfigPlayer[];
  gameOptions: Readonly<GameConfigOptions>;
}> {
  const config = replay.header.config;
  if (config === undefined) throw new Error("Duelo replay config is missing");
  if (config.harnessVersion !== DUELO_AGENT_HARNESS_VERSION) {
    throw new Error(`Unsupported Duelo harness ${String(config.harnessVersion)}`);
  }
  const playerCount = config.playerCount;
  if (!Number.isInteger(playerCount) || typeof playerCount !== "number"
    || playerCount < 2 || playerCount > 8) {
    throw new Error("Duelo replay playerCount must be an integer from 2 through 8");
  }
  const difficulty = config.difficulty;
  if (difficulty !== "medium" && difficulty !== "hard") {
    throw new Error("Duelo replay difficulty must be medium or hard");
  }
  const players = Array.isArray(config.players)
    ? config.players.filter(isReplayObject).map((player): GameConfigPlayer => ({
        ...(typeof player.index === "number" ? { index: player.index } : {}),
        ...(typeof player.id === "string" ? { id: player.id } : {}),
        ...(typeof player.label === "string" ? { label: player.label } : {}),
        ...(typeof player.name === "string" ? { name: player.name } : {}),
        ...(typeof player.color === "string" ? { color: player.color as `#${string}` } : {})
      }))
    : [];
  const gameOptions = isReplayObject(config.gameOptions)
    ? config.gameOptions as unknown as GameConfigOptions
    : {};
  return Object.freeze({
    playerCount,
    difficulty,
    players: Object.freeze(players),
    gameOptions: Object.freeze({ ...gameOptions })
  });
}

function frameAtTick(frames: readonly ReplayFrame[], tick: number): ReplayFrame | undefined {
  return frames.find((frame) => frame.tick === tick);
}

function isReplayObject(value: ReplayJsonValue | undefined): value is ReplayJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return candidate;
}
