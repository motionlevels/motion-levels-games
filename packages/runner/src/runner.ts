import { createInterface } from "node:readline";
import { runnerProtocolVersion, type RunnerRequest, type RunnerResponse } from "./protocol.ts";
import { RunnerSession } from "./session.ts";
import { RunnerTelemetryCollector } from "./telemetry.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;

const sourceRevision = typeof MOTION_LEVELS_GAMES_REVISION === "string"
  ? MOTION_LEVELS_GAMES_REVISION
  : "development";
const session = new RunnerSession();
const telemetry = new RunnerTelemetryCollector();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  let id = "";
  let method: RunnerRequest["method"] | "invalid" = "invalid";
  const startedAt = performance.now();
  try {
    const request = JSON.parse(line) as RunnerRequest;
    id = String(request.id || "");
    if (!isRunnerMethod(request.method)) throw new Error(`unsupported runner method: ${String(request.method)}`);
    method = request.method;
    if (request.version !== runnerProtocolVersion) throw new Error(`unsupported protocol version: ${request.version}`);
    if (!id) throw new Error("request id is required");
    const state = session.handle(request);
    const response: RunnerResponse = {
      version: runnerProtocolVersion,
      id,
      ok: true,
      sourceRevision,
      telemetry: telemetry.observe(method, startedAt),
      state
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response: RunnerResponse = {
      version: runnerProtocolVersion,
      id,
      ok: false,
      sourceRevision,
      telemetry: telemetry.observe(method, startedAt, true),
      error: error instanceof Error ? error.message : String(error)
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});

function isRunnerMethod(value: unknown): value is RunnerRequest["method"] {
  return value === "init" || value === "input" || value === "control" || value === "tick" || value === "status";
}
