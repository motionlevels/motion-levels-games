import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium, type Page } from "playwright";

type BrowserPlaygroundCapture = {
  dataUrl: string;
  height: number;
  surface: string;
  width: number;
};

type BrowserPlaygroundState = {
  clockMillis: number;
  gameId: string;
  paused: boolean;
  snapshot: {
    countdownMillis?: number;
    phase: string;
    readyPlayers?: number;
    remainingMillis?: number;
    requiredPlayers?: number;
    success?: boolean;
    totalTargets?: number;
    winnerIndex?: number;
  };
};

type BrowserPlaygroundMediaAsset = {
  dataUrl: string;
  height: number;
  width: number;
};

type BrowserPlaygroundWindow = Window & {
  ml?: {
    capture(surfaces: string[]): Promise<Record<string, BrowserPlaygroundCapture>>;
    getState(): BrowserPlaygroundState;
    media(gameId: string, options: {
      playerCount: number;
      players: Array<{ color: string; name: string }>;
    }): Promise<{ assets: { playerDisplay: BrowserPlaygroundMediaAsset } }>;
    pause(): void;
    press(x: number, y: number): void;
    release(x: number, y: number): void;
    reset(): void;
    resume(): void;
    step(deltaMillis: number): void;
  };
};

const repoRoot = process.cwd();
const port = Number(process.env.MOTION_LEVELS_GAMES_PLAYTEST_PORT || 4174);
const baseURL = `http://127.0.0.1:${port}`;
const captureDirectory = process.env.MOTION_LEVELS_GAMES_CAPTURE_DIR;
const dueloFourPlayerZones: Array<[number, number]> = [[0, 0], [12, 28], [0, 28], [12, 0]];
const dueloEightPlayerZones: Array<[number, number]> = [
  ...dueloFourPlayerZones,
  [0, 14], [12, 14], [6, 0], [6, 28]
];
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

    const pingPongResult = await playtestPingPong(page);
    const dueloResult = await playtestDuelo(page);

    console.log(JSON.stringify({ pingPong: pingPongResult, duelo: dueloResult }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function playtestPingPong(page: Page) {
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
  const startingState = await browserState(page);
  assert.equal(startingState.paused, false);
  assert.equal(startingState.snapshot.readyPlayers, 2);
  assert.equal(startingState.snapshot.requiredPlayers, 2);

  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(2_000));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  const runningState = await browserState(page);
  assert.equal(runningState.snapshot.phase, "running");

  return {
    gameId: runningState.gameId,
    phase: runningState.snapshot.phase,
    readyPlayers: runningState.snapshot.readyPlayers,
    seamX
  };
}

async function playtestDuelo(page: Page) {
  await page.locator(".control-game select").selectOption("duelo");
  await page.locator(".control-players select").selectOption("4");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "duelo" && state.snapshot.phase === "waiting";
  });

  const waitingState = await browserState(page);
  assert.equal(waitingState.snapshot.readyPlayers, 0);
  assert.equal(waitingState.snapshot.requiredPlayers, 4);
  assert.ok((waitingState.snapshot.totalTargets ?? 0) > 0);
  await captureNativeDisplay(page, "duelo-waiting");

  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.resume();
    for (const [x, y] of zones) {
      api.press(x, y);
    }
  }, dueloFourPlayerZones);
  const startingState = await browserState(page);
  assert.equal(startingState.snapshot.phase, "starting");
  assert.equal(startingState.snapshot.readyPlayers, 4);
  await captureNativeDisplay(page, "duelo-starting");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running"
  ));
  const runningState = await browserState(page);
  assert.equal(runningState.snapshot.phase, "running");
  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (const [x, y] of zones) api.release(x, y);
  }, dueloFourPlayerZones);

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    let attempts = 0;
    for (let y = 0; y < 32 && attempts < 30; y += 1) {
      for (let x = 0; x < 16 && attempts < 30; x += 1) {
        api.press(x, y);
        api.release(x, y);
        attempts += 1;
      }
    }
  });
  assert.equal((await browserState(page)).snapshot.phase, "running");
  await captureNativeDisplay(page, "duelo-running");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        api.press(x, y);
        api.release(x, y);
      }
    }
  });
  const finishedState = await browserState(page);
  assert.equal(finishedState.snapshot.phase, "finished");
  assert.equal(finishedState.snapshot.success, true);
  assert.ok((finishedState.snapshot.winnerIndex ?? -1) >= 0);
  await captureNativeDisplay(page, "duelo-finished-early");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(450));
  await captureNativeDisplay(page, "duelo-finished");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.remainingMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "waiting"
  ));
  const restartedState = await browserState(page);
  assert.equal(restartedState.snapshot.phase, "waiting");
  assert.equal(restartedState.snapshot.readyPlayers, 0);

  await playtestCrowdedDueloDisplay(page);

  return {
    captures: ["waiting", "starting", "running", "finished-early", "finished", "crowded-running"],
    gameId: restartedState.gameId,
    restartPhase: restartedState.snapshot.phase,
    winnerIndex: finishedState.snapshot.winnerIndex
  };
}

async function playtestCrowdedDueloDisplay(page: Page): Promise<void> {
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "duelo" && state.snapshot.phase === "waiting";
  });
  assert.equal((await browserState(page)).snapshot.requiredPlayers, 8);

  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.resume();
    for (const [x, y] of zones) api.press(x, y);
  }, dueloEightPlayerZones);
  assert.equal((await browserState(page)).snapshot.phase, "starting");

  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (const [x, y] of zones) api.release(x, y);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        api.press(x, y);
        api.release(x, y);
      }
    }
  }, dueloEightPlayerZones);
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running"
  ));
  await captureNativeDisplay(page, "duelo-crowded-running");
  if (captureDirectory) await captureLongNameDueloMedia(page);
}

async function captureLongNameDueloMedia(page: Page): Promise<void> {
  const playerDisplay = await page.evaluate(async () => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    const media = await api.media("duelo", {
      playerCount: 8,
      players: [
        { name: "Alejandra del Equipo Relámpago", color: "#ff3048" },
        { name: "Bruno de la Torre Norte", color: "#24d9ff" },
        { name: "Carolina", color: "#42e879" },
        { name: "Diego", color: "#ff4fd8" },
        { name: "Elena", color: "#376bff" },
        { name: "Fernando", color: "#ffd84d" },
        { name: "Gabriela", color: "#a66cff" },
        { name: "Hugo", color: "#ff8a3d" }
      ]
    });
    return media.assets.playerDisplay;
  });
  assert.equal(playerDisplay.width, 1280);
  assert.equal(playerDisplay.height, 720);
  assert.match(playerDisplay.dataUrl, /^data:image\/webp;base64,/);
  const bytes = Buffer.from(playerDisplay.dataUrl.replace(/^data:image\/webp;base64,/, ""), "base64");
  await writeFile(path.join(captureDirectory!, "duelo-crowded-long-names.webp"), bytes);
}

async function browserState(page: Page): Promise<BrowserPlaygroundState> {
  const state = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.getState());
  assert.ok(state, "playground API must expose state");
  return state;
}

async function captureNativeDisplay(page: Page, name: string): Promise<void> {
  const captures = await page.evaluate(async () => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    return api.capture(["display", "boardPhysical"]);
  });
  const capture = captures.display;
  const board = captures.boardPhysical;
  assert.ok(capture, "playground API must return a display capture");
  assert.ok(board, "playground API must return a physical board capture");
  assert.equal(capture.surface, "display");
  assert.equal(capture.width, 1920);
  assert.equal(capture.height, 1080);
  assert.match(capture.dataUrl, /^data:image\/png;base64,/);
  assert.equal(board.surface, "boardPhysical");
  assert.equal(board.width, 512);
  assert.equal(board.height, 1024);
  assert.match(board.dataUrl, /^data:image\/png;base64,/);

  if (!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  const bytes = Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  await writeFile(path.join(captureDirectory, `${name}.png`), bytes);
  const boardBytes = Buffer.from(board.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  await writeFile(path.join(captureDirectory, `${name}-board.png`), boardBytes);
  await page.locator(".display-preview-native").screenshot({
    animations: "disabled",
    path: path.join(captureDirectory, `${name}-preview.png`)
  });
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
