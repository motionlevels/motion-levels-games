import {
  ReplayPlayer,
  createGhostTrack,
  replayChecksum,
  type GameReplay,
  type GhostTrack,
  type ReplayFrame
} from "@motion-levels-games/replay-runtime";
import { createGameEngine } from "@motion-levels-games/game-sdk";
import {
  CRUCE_AGENT_SIMULATION_VERSION,
  authoritativeGameState,
  normalizeHarnessOptions,
  type CruceHarnessOptions
} from "./agents.ts";
import { createGame } from "./game.ts";

export type CruceReplayMismatch = Readonly<{
  tick: number;
  expected?: string;
  actual?: string;
}>;

export type CruceReplayVerification = Readonly<{
  valid: boolean;
  expectedFrames: number;
  verifiedFrames: number;
  mismatches: readonly CruceReplayMismatch[];
  finalChecksum?: string;
}>;

export type CruceReplaySeekVerification = Readonly<{
  valid: boolean;
  requestedTick: number;
  resolvedTick: number;
  snapshotTick?: number;
  snapshotChecksumValid: boolean;
  expectedChecksum?: string;
  actualChecksum?: string;
  replayedFrames: number;
}>;

export function verifyCruceAgentReplay(replay: GameReplay): CruceReplayVerification {
  assertCruceReplay(replay);
  const actualByTick = replayAuthoritativeChecksums(replay);
  const mismatches = replay.frames.flatMap((frame): CruceReplayMismatch[] => {
    const expected = frame.authoritativeChecksum;
    const actualChecksum = actualByTick.get(frame.tick);
    return expected !== undefined && actualChecksum === expected
      ? []
      : [Object.freeze({ tick: frame.tick, expected, actual: actualChecksum })];
  });
  return Object.freeze({
    valid: mismatches.length === 0 && actualByTick.size === replay.frames.length,
    expectedFrames: replay.frames.length,
    verifiedFrames: replay.frames.length - mismatches.length,
    mismatches: Object.freeze(mismatches),
    finalChecksum: actualByTick.get(replay.frames.at(-1)?.tick ?? 0)
  });
}

export function verifyCruceReplaySeek(
  replay: GameReplay,
  requestedTick: number
): CruceReplaySeekVerification {
  assertCruceReplay(replay);
  const player = new ReplayPlayer(replay);
  const seek = player.seek(requestedTick);
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
    replayedFrames: actualByTick.size
  });
}

export function cruceReplayFinalChecksum(replay: GameReplay): string | undefined {
  assertCruceReplay(replay);
  return replay.frames.at(-1)?.checksum;
}

export function cruceGhostTrack(replay: GameReplay, agentId: string): GhostTrack {
  assertCruceReplay(replay);
  return createGhostTrack(replay, agentId);
}

export function replayHarnessOptions(replay: GameReplay): CruceHarnessOptions {
  assertCruceReplay(replay);
  const config = replay.header.config ?? {};
  const profileValue = config.profile;
  const profile = Array.isArray(profileValue)
    ? profileValue.map((entry) => String(entry))
    : typeof profileValue === "string" ? profileValue : "mixed";
  return normalizeHarnessOptions({
    seed: Number(replay.header.seed),
    agentCount: readNumber(config.agentCount, 3),
    profile,
    speed: readNumber(config.speed, 2),
    difficulty: typeof config.difficulty === "string" ? config.difficulty : "medium",
    durationMillis: readNumber(config.durationMillis, 75_000),
    playerCount: readNumber(config.playerCount, 0),
    replaySnapshotIntervalTicks: readNumber(config.replaySnapshotIntervalTicks, 50)
  });
}

function replayAuthoritativeChecksums(replay: GameReplay, throughTick = replay.frames.at(-1)?.tick ?? 0): Map<number, string> {
  const options = replayHarnessOptions(replay);
  const game = createGame({
    seed: options.seed,
    playerCount: options.playerCount,
    difficulty: options.difficulty,
    durationMillis: options.durationMillis,
    nowMillis: 0
  });
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, {
    fps: replay.header.tickRate,
    nowMillis: 0,
    initialEvents
  });
  const checksums = new Map<number, string>();
  for (const frame of replay.frames) {
    if (frame.tick > throughTick) break;
    const atMillis = Math.round(frame.tick * 1_000 / replay.header.tickRate);
    for (const input of frame.inputs) {
      if (input.kind === "press") engine.press(input.x, input.y, atMillis);
      else engine.release(input.x, input.y, atMillis);
    }
    const state = engine.tickTo(atMillis);
    checksums.set(frame.tick, replayChecksum(authoritativeGameState(state)));
  }
  return checksums;
}

function assertCruceReplay(replay: GameReplay): void {
  if (replay.header.gameId !== "cruce-galactico") {
    throw new Error(`Expected a Cruce Galáctico replay, received ${replay.header.gameId}`);
  }
  if (replay.header.simulationVersion !== CRUCE_AGENT_SIMULATION_VERSION) {
    throw new Error(`Unsupported Cruce simulation ${replay.header.simulationVersion}`);
  }
  if (replay.header.tickRate !== 50) {
    throw new Error("Cruce agent replays require a 50 Hz tick rate");
  }
}

function frameAtTick(frames: readonly ReplayFrame[], tick: number): ReplayFrame | undefined {
  return frames.find((frame) => frame.tick === tick);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
