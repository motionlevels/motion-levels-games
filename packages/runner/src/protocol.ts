import type { Frame, GameConfig, GameEvent, GameSnapshot } from "@motion-levels-games/game-sdk";

export const runnerProtocolVersion = 1 as const;

export type RunnerMethod = "init" | "input" | "control" | "tick" | "status";

export type RunnerRequest = {
  version: typeof runnerProtocolVersion;
  id: string;
  method: RunnerMethod;
  params?: Record<string, unknown>;
};

export type RunnerFrame = {
  width: number;
  height: number;
  colors: string[];
};

export type RunnerState = {
  clockMillis: number;
  paused: boolean;
  frame: RunnerFrame;
  snapshot: GameSnapshot;
  events: GameEvent[];
};

/**
 * Bounded, process-local telemetry exported with every runner response.
 * Hosts may publish these values through their own observability endpoint;
 * the runner never opens a network listener itself.
 */
export type RunnerTelemetry = {
  uptimeMillis: number;
  requestsTotal: number;
  errorsTotal: number;
  initTotal: number;
  inputTotal: number;
  controlTotal: number;
  tickTotal: number;
  statusTotal: number;
  lastMethod: RunnerMethod | "invalid";
  lastRequestDurationMicros: number;
  rssBytes: number;
  heapUsedBytes: number;
};

export type RunnerResponse = {
  version: typeof runnerProtocolVersion;
  id: string;
  ok: boolean;
  sourceRevision: string;
  telemetry: RunnerTelemetry;
  state?: RunnerState;
  error?: string;
};

export type InitParams = GameConfig & {
  gameId: string;
  development?: boolean;
};

export function packFrame(frame: Frame): RunnerFrame {
  return {
    width: frame.width,
    height: frame.height,
    colors: frame.cells.map((cell) => cell.color)
  };
}
