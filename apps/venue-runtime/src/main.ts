import { execFileSync } from "node:child_process";
import { createVenueHttpServer } from "./httpServer.ts";
import { VenueRuntime } from "./venueRuntime.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;

const runtime = new VenueRuntime({
  sourceRevision: sourceRevision(),
  controllerAddress: process.env.MOTION_LEVELS_CONTROLLER_ADDR?.trim() || "127.0.0.1:4201",
  platformUrl: process.env.MOTION_LEVELS_PLATFORM_URL,
  platformToken: process.env.MOTION_LEVELS_PLATFORM_TOKEN,
  controllerId: process.env.MOTION_LEVELS_CONTROLLER_ID,
  liveFloorFps: parseNonNegative(process.env.MOTION_LEVELS_LIVE_PUSH_FPS, 5),
  liveFloorTimeoutMillis: parseDurationMillis(process.env.MOTION_LEVELS_LIVE_PUSH_TIMEOUT, 2_000),
  brightness: parseBrightness(process.env.MOTION_LEVELS_ENGINE_BRIGHTNESS),
  log: (message, error) => console.error(`[venue-runtime] ${message}`, error ?? "")
});

function sourceRevision(): string {
  const environment = process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION?.trim();
  if (environment) return environment;
  if (typeof MOTION_LEVELS_GAMES_REVISION === "string") return MOTION_LEVELS_GAMES_REVISION;
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const address = parseHttpAddress(process.env.MOTION_LEVELS_ENGINE_HTTP?.trim() || "127.0.0.1:4102");
const engineToken = process.env.MOTION_LEVELS_ENGINE_TOKEN?.trim() || "";
if (!isLoopbackHost(address.host) && !engineToken) {
  throw new Error("MOTION_LEVELS_ENGINE_TOKEN is required for a non-loopback HTTP bind");
}
const server = createVenueHttpServer(runtime, engineToken);
server.listen(address.port, address.host, () => {
  runtime.start();
  console.log(`[venue-runtime] API listening at http://${address.host}:${address.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  });
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

function parseNonNegative(value: string | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parseDurationMillis(value: string | undefined, fallback: number): number {
  const candidate = String(value ?? "").trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/u.exec(candidate);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.round(amount * (match[2] === "s" ? 1000 : 1));
}
