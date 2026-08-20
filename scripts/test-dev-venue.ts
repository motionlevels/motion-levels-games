import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = process.cwd();
const playgroundPort = Number(process.env.MOTION_LEVELS_DEV_VENUE_PORT || 4104);
const apiPort = Number(process.env.MOTION_LEVELS_DEV_VENUE_API_PORT || 4102);
const playgroundURL = `http://127.0.0.1:${playgroundPort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const output: string[] = [];
const devVenue = spawn(npmCommand, ["run", "dev:venue:no-controller"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MOTION_LEVELS_PLAYGROUND_PORT: String(playgroundPort),
    MOTION_LEVELS_ENGINE_HTTP: `127.0.0.1:${apiPort}`
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});

devVenue.stdout?.on("data", (chunk) => {
  const text = String(chunk);
  output.push(text);
  process.stderr.write(text);
});
devVenue.stderr?.on("data", (chunk) => {
  const text = String(chunk);
  output.push(text);
  process.stderr.write(text);
});

try {
  await waitFor(async () => {
    const response = await fetch(playgroundURL);
    if (!response.ok) return false;
    const body = await response.text();
    assert.match(body, /Motion Levels Games Playground/u);
    assert.doesNotMatch(body, /(?:^|>)Not Found(?:<|$)/u);
    return true;
  }, devVenue, "the playground root");

  const health = await fetch(`${playgroundURL}/api/health`);
  assert.equal(health.status, 200, "the playground must proxy the venue health endpoint");
  const healthPayload = await health.json() as { status?: string; controllerConnected?: boolean };
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.controllerConnected, true, "no-controller mode must provide the mock controller");

  const playerMenu = await fetch(`${playgroundURL}/player-menu/`);
  assert.equal(playerMenu.status, 200, "the player-menu entry point must be served by the same dev command");
  assert.match(await playerMenu.text(), /Motion Levels Player Menu/u);

  const directAPI = await fetch(`${apiURL}/api/health`);
  assert.equal(directAPI.status, 200, "the venue API must remain available beside the playground");
  console.log(`Dev venue smoke passed: ${playgroundURL}/ and ${apiURL}/api/health`);
} finally {
  await stop(devVenue);
}

async function waitFor(check: () => Promise<boolean>, process: ChildProcess, description: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`dev venue exited with ${process.exitCode} while waiting for ${description}\n${output.join("")}`);
    }
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}\n${output.join("")}`);
}

async function stop(child: ChildProcess): Promise<void> {
  signalProcessTree(child, "SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(10_000)
  ]);
  signalProcessTree(child, "SIGKILL");
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (globalThis.process.platform !== "win32") {
      globalThis.process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    // The process may have exited between the readiness check and cleanup.
  }
}
