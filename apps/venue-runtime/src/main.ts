import { execFileSync } from "node:child_process";
import { engineTokenFromEnvironment } from "./engineToken.ts";
import { recordingClientFromEnvironment } from "./httpRecordingClient.ts";
import { closeVenueHttpSse, createVenueHttpServer } from "./httpServer.ts";
import { VenueRuntime } from "./venueRuntime.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;

const recordingClient = recordingClientFromEnvironment();

const runtime = new VenueRuntime({
  sourceRevision: sourceRevision(),
  controllerAddress: process.env.MOTION_LEVELS_CONTROLLER_ADDR?.trim() || "127.0.0.1:4201",
  platformUrl: process.env.MOTION_LEVELS_PLATFORM_URL,
  platformToken: process.env.MOTION_LEVELS_PLATFORM_TOKEN,
  controllerId: process.env.MOTION_LEVELS_CONTROLLER_ID,
  liveFloorFps: parseNonNegative(process.env.MOTION_LEVELS_LIVE_PUSH_FPS, 5),
  liveFloorTimeoutMillis: parseDurationMillis(process.env.MOTION_LEVELS_LIVE_PUSH_TIMEOUT, 2_000),
  localLiveFloorFps: parsePositive(process.env.MOTION_LEVELS_LOCAL_LIVE_FLOOR_FPS, 20),
  remoteFloorInputLeaseMillis: parseDurationMillis(process.env.MOTION_LEVELS_REMOTE_FLOOR_INPUT_LEASE, 5_000),
  brightness: parseBrightness(process.env.MOTION_LEVELS_ENGINE_BRIGHTNESS),
  audioEnabled: parseBoolean(process.env.MOTION_LEVELS_AUDIO_ENABLED, false),
  sessionHistoryDir: process.env.MOTION_LEVELS_SESSION_HISTORY_DIR?.trim() || "/var/lib/motion-levels/session-history",
  replayMaxLocalBytes: parsePositive(process.env.MOTION_LEVELS_REPLAY_MAX_LOCAL_BYTES, 512 * 1024 * 1024),
  ...(recordingClient ? { recordingClient } : {}),
  log: (message, error) => console.error(`[venue-runtime] ${message}`, error ?? "")
});

function sourceRevision(): string {
  const environment = process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION?.trim();
  if (environment) return environment;
  if (typeof MOTION_LEVELS_GAMES_REVISION === "string") return MOTION_LEVELS_GAMES_REVISION;
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const address = parseHttpAddress(process.env.MOTION_LEVELS_ENGINE_HTTP?.trim() || "127.0.0.1:4102");
const engineToken = engineTokenFromEnvironment();
if (!isLoopbackHost(address.host) && !engineToken) {
  throw new Error("MOTION_LEVELS_ENGINE_TOKEN is required for a non-loopback HTTP bind");
}
const server = createVenueHttpServer(runtime, engineToken);
server.listen(address.port, address.host, () => {
  runtime.start();
  console.log(`[venue-runtime] API listening at http://${address.host}:${address.port}`);
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[venue-runtime] ${signal} received; draining session history and camera recording`);
  const forcedExit = setTimeout(() => {
    console.error("[venue-runtime] shutdown drain exceeded 30 seconds");
    process.exit(1);
  }, 30_000);
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  closeVenueHttpSse(server);
  try {
    // Wait for ordinary in-flight commands after ending only long-lived SSE.
    // runtime.stop() is last so no request can enqueue history/camera work
    // after its drain has completed.
    await serverClosed;
    await runtime.stop();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    clearTimeout(forcedExit);
    console.error("[venue-runtime] shutdown failed", error);
    process.exit(1);
  }
}

function parseHttpAddress(value: string): { host: string; port: number } {
  const candidate = value.replace(/^http:\/\//u, "");
  const match = candidate.match(/^\[([^\]]+)\]:(\d+)$/u) ?? candidate.match(/^([^:]+):(\d+)$/u);
  if (!match) throw new Error(`invalid MOTION_LEVELS_ENGINE_HTTP: ${value}`);
  const host = match[1] ?? "";
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid HTTP port: ${match[2]}`);
  return { host, port };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parseBrightness(value: string | undefined): number {
  const number = Number(value ?? 100);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNonNegative(value: string | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parsePositive(value: string | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseDurationMillis(value: string | undefined, fallback: number): number {
  const candidate = String(value ?? "").trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/u.exec(candidate);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.round(amount * (match[2] === "s" ? 1000 : 1));
}
