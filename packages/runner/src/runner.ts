import { createInterface } from "node:readline";
import { runnerProtocolVersion, type RunnerRequest, type RunnerResponse } from "./protocol.ts";
import { RunnerSession } from "./session.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;

const sourceRevision = typeof MOTION_LEVELS_GAMES_REVISION === "string"
  ? MOTION_LEVELS_GAMES_REVISION
  : "development";
const session = new RunnerSession();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  let id = "";
  try {
    const request = JSON.parse(line) as RunnerRequest;
    id = String(request.id || "");
    if (request.version !== runnerProtocolVersion) throw new Error(`unsupported protocol version: ${request.version}`);
    if (!id) throw new Error("request id is required");
    const response: RunnerResponse = {
      version: runnerProtocolVersion,
      id,
      ok: true,
      sourceRevision,
      state: session.handle(request)
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response: RunnerResponse = {
      version: runnerProtocolVersion,
      id,
      ok: false,
      sourceRevision,
      error: error instanceof Error ? error.message : String(error)
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});
