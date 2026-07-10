import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

type BrowserPlaygroundState = {
  gameId: string;
  paused: boolean;
  snapshot: {
    phase: string;
    readyPlayers?: number;
    requiredPlayers?: number;
  };
};

type BrowserPlaygroundWindow = Window & {
  ml?: {
    getState(): BrowserPlaygroundState;
    step(deltaMillis: number): BrowserPlaygroundState;
  };
};

const repoRoot = process.cwd();
const port = Number(process.env.MOTION_LEVELS_GAMES_PLAYTEST_PORT || 4174);
const baseURL = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    path.join(repoRoot, "node_modules/vite/bin/vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort"
  ],
  {
    cwd: path.join(repoRoot, "apps/playground"),
    stdio: ["ignore", "pipe", "pipe"]
  }
);

server.stdout.on("data", (chunk) => process.stderr.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(baseURL);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.motionLevelsPlaygroundApi === "ready");

    await page.locator(".control-game select").selectOption("ping-pong");
    await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "ping-pong");

    const floor = page.locator(".ml-floor-interactive");
    const topTile = floor.locator('[data-tile-x="7"][data-tile-y="3"]');
    const bottomTile = floor.locator('[data-tile-x="7"][data-tile-y="28"]');
    const [topBox, bottomBox] = await Promise.all([topTile.boundingBox(), bottomTile.boundingBox()]);
    assert.ok(topBox && bottomBox, "Ping Pong floor tiles must be visible");

    // Deliberately drag through the visual gap between two columns. The gap is
    // part of the floor control and must map to physical tiles just like a tile
    // pixel does.
    const seamX = topBox.x + topBox.width + 1;
    await page.mouse.move(seamX, topBox.y + topBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(seamX, bottomBox.y + bottomBox.height / 2);
    await page.mouse.up();

    await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
    const startingState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.getState());
    assert.equal(startingState?.paused, false);
    assert.equal(startingState?.snapshot.readyPlayers, 2);
    assert.equal(startingState?.snapshot.requiredPlayers, 2);

    await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(2_000));
    await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
    const runningState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.getState());
    assert.ok(runningState, "playground API must expose the running state");
    assert.equal(runningState?.snapshot.phase, "running");

    console.log(JSON.stringify({
      gameId: runningState.gameId,
      phase: runningState.snapshot.phase,
      readyPlayers: runningState.snapshot.readyPlayers,
      seamX
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`playground preview exited with ${server.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while Vite starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}
