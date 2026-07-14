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
    currentPlatform?: { x: number; y: number };
    level?: number;
    lives?: number;
    memoryStage?: string;
    phase: string;
    pointFlashMillis?: number;
    readyPlayers?: number;
    remainingMillis?: number;
    requiredPlayers?: number;
    success?: boolean;
    targetPlatform?: { x: number; y: number };
    targets?: Array<{ x: number; y: number }>;
    stageMillis?: number;
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
    const pingPongV2Result = await playtestPingPongV2(page);
    const dueloResult = await playtestDuelo(page);
    const memoriaV2Result = await playtestMemoriaV2(page);
    const patronesResult = await playtestPatrones(page);
    const saltosResult = await playtestSaltos(page);
    const lavaResult = await playtestLava(page);

    console.log(JSON.stringify({ pingPong: pingPongResult, pingPongV2: pingPongV2Result, duelo: dueloResult, lava: lavaResult, memoriaV2: memoriaV2Result, patrones: patronesResult, saltos: saltosResult }, null, 2));
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

async function playtestPingPongV2(page: Page) {
  await page.locator(".control-game select").selectOption("ping-pong-v2");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "ping-pong-v2" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "ping-pong-v2-waiting");
  await clickFloorZones(page, [[7, 3], [7, 28]]);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.waitForTimeout(350);
  await captureNativeDisplay(page, "ping-pong-v2-starting");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(2_100));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, "ping-pong-v2-running");
  const runningState = await browserState(page);
  assert.equal(runningState.snapshot.readyPlayers, 2);
  assert.equal(runningState.snapshot.requiredPlayers, 2);

  let capturedRoundWin = false;
  let finishedState: BrowserPlaygroundState | undefined;
  for (let attempt = 0; attempt < 400 && !finishedState; attempt += 1) {
    await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(250));
    const state = await browserState(page);
    if (!capturedRoundWin && (state.snapshot.pointFlashMillis ?? 0) > 0) {
      capturedRoundWin = true;
      await page.waitForTimeout(350);
      await captureNativeDisplay(page, "ping-pong-v2-round-win");
    }
    if (state.snapshot.phase === "finished") {
      finishedState = state;
      await captureNativeDisplay(page, "ping-pong-v2-finished");
    }
  }

  assert.equal(capturedRoundWin, true, "Ping Pong v2 must expose its round-win feedback");
  assert.ok(finishedState, "Ping Pong v2 must finish within the browser playtest guard");
  return {
    captures: ["waiting", "starting", "running", "round-win", "finished"],
    gameId: finishedState.gameId,
    phase: finishedState.snapshot.phase
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

  await clickFloorZones(page, dueloFourPlayerZones);
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
  await clickFloorZones(page, dueloFourPlayerZones, 0);

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

async function playtestSaltos(page: Page) {
  await page.locator(".control-game select").selectOption("saltos");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "saltos" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "saltos-waiting");

  const startTile = page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="4"]');
  await startTile.click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await captureNativeDisplay(page, "saltos-starting");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  const runningState = await browserState(page);
  assert.ok(runningState.snapshot.targetPlatform);
  await captureNativeDisplay(page, "saltos-running");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.remainingMillis ?? 0) + 100);
  });
  const wonState = await browserState(page);
  assert.equal(wonState.snapshot.phase, "finished");
  assert.equal(wonState.snapshot.success, true);
  await captureNativeDisplay(page, "saltos-finished-win");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.reset();
    api.resume();
    api.press(8, 4);
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 4);
    const snapshot = api.getState().snapshot;
    const platforms = [snapshot.currentPlatform, snapshot.targetPlatform].filter(Boolean) as Array<{ x: number; y: number }>;
    for (let y = 31; y >= 0; y -= 1) {
      for (let x = 15; x >= 0; x -= 1) {
        if (platforms.every((platform) => x < platform.x || x >= platform.x + 3 || y < platform.y || y >= platform.y + 3)) {
          api.press(x, y);
          api.release(x, y);
          return;
        }
      }
    }
    throw new Error("Saltos must expose at least one lava tile");
  });
  const lostState = await browserState(page);
  assert.equal(lostState.snapshot.phase, "finished");
  assert.equal(lostState.snapshot.success, false);
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(450));
  await captureNativeDisplay(page, "saltos-finished-loss");

  return {
    captures: ["waiting", "starting", "running", "finished-loss", "finished-win"],
    gameId: wonState.gameId,
    result: "win-and-loss"
  };
}

async function playtestPatrones(page: Page) {
  await page.locator(".control-game select").selectOption("patrones");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "patrones" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "patrones-waiting");

  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await captureNativeDisplay(page, "patrones-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, "patrones-running");

  const mediumPattern: Array<[number, number]> = [
    [7, 8], [8, 8], [6, 10], [9, 10], [5, 12], [10, 12],
    [6, 14], [9, 14], [7, 16], [8, 16], [7, 18], [8, 18]
  ];
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.resume();
    for (let x = 0; x < 16; x += 1) {
      api.press(x, 31);
      api.release(x, 31);
    }
    api.step(450);
  });
  const lostState = await browserState(page);
  assert.equal(lostState.snapshot.phase, "finished");
  assert.equal(lostState.snapshot.success, false);
  await captureNativeDisplay(page, "patrones-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("patrones");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "patrones" && state.snapshot.phase === "waiting";
  });
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await page.evaluate((targets) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.resume();
    for (let attempt = 0; attempt < 20 && api.getState().snapshot.phase === "running"; attempt += 1) {
      for (const [x, y] of targets) {
        api.press(x, y);
        api.release(x, y);
      }
      api.step(20);
    }
    api.step(450);
  }, mediumPattern);
  const wonState = await browserState(page);
  assert.equal(wonState.snapshot.phase, "finished", JSON.stringify(wonState.snapshot));
  assert.equal(wonState.snapshot.success, true);
  await captureNativeDisplay(page, "patrones-finished-win");

  return {
    captures: ["waiting", "starting", "running", "finished-win", "finished-loss"],
    gameId: lostState.gameId,
    result: "win-and-loss"
  };
}

async function playtestMemoriaV2(page: Page) {
  await page.locator(".control-game select").selectOption("memoria-v2");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "memoria-v2" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "memoria-v2-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await captureNativeDisplay(page, "memoria-v2-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await captureNativeDisplay(page, "memoria-v2-memorize");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step(api.getState().snapshot.stageMillis ?? 0);
  });
  assert.equal((await browserState(page)).snapshot.memoryStage, "recall");
  await captureNativeDisplay(page, "memoria-v2-recall");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    const targets = api.getState().snapshot.targets ?? [];
    const targetKeys = new Set(targets.map((target) => `${target.x},${target.y}`));
    const misses: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < 32 && misses.length < 3; y += 1) {
      for (let x = 0; x < 16 && misses.length < 3; x += 1) {
        if (!targetKeys.has(`${x},${y}`)) misses.push({ x, y });
      }
    }
    for (const miss of misses) {
      api.press(miss.x, miss.y);
      api.release(miss.x, miss.y);
    }
    api.step(450);
  });
  const lostState = await browserState(page);
  assert.equal(lostState.snapshot.phase, "finished");
  assert.equal(lostState.snapshot.lives, 0);
  await captureNativeDisplay(page, "memoria-v2-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("memoria-v2");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "memoria-v2" && state.snapshot.phase === "waiting";
  });
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.pause();
  });
  let finalState: BrowserPlaygroundState | undefined;
  let capturedRoundWin = false;
  for (let attempt = 0; attempt < 60 && !finalState; attempt += 1) {
    const result: { captures?: Record<string, BrowserPlaygroundCapture>; state: BrowserPlaygroundState } = await page.evaluate(async (captureRoundWin) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      let state = api.getState();
      if (state.snapshot.memoryStage === "round-win") {
        api.step(state.snapshot.stageMillis ?? 0);
        state = api.getState();
      }
      if (state.snapshot.memoryStage === "memorize") {
        api.step(state.snapshot.stageMillis ?? 0);
        state = api.getState();
      }
      if (state.snapshot.memoryStage === "recall") {
        api.resume();
        for (const target of state.snapshot.targets ?? []) {
          api.press(target.x, target.y);
          api.release(target.x, target.y);
        }
        api.pause();
      }
      state = api.getState();
      const shouldCapture = state.snapshot.phase === "finished" || (captureRoundWin && state.snapshot.memoryStage === "round-win");
      if (shouldCapture) api.resume();
      const captures = shouldCapture ? await api.capture(["display", "boardPhysical"]) : undefined;
      if (shouldCapture) api.pause();
      return {
        captures,
        state
      };
    }, !capturedRoundWin);
    if (!capturedRoundWin && result.state.snapshot.memoryStage === "round-win") {
      capturedRoundWin = true;
      if (result.captures) await saveBrowserCaptures(result.captures, "memoria-v2-round-win");
    }
    if (result.state.snapshot.phase === "finished") {
      finalState = result.state;
      assert.equal(finalState.snapshot.phase, "finished", JSON.stringify(finalState.snapshot));
      assert.equal(finalState.snapshot.success, true);
      if (result.captures) await saveBrowserCaptures(result.captures, "memoria-v2-finished-win");
    }
  }
  if (!finalState) throw new Error("Memoria v2 did not complete within the browser playtest guard");
  assert.equal(capturedRoundWin, true);
  assert.equal(finalState.snapshot.level, 20);
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.resume());

  return {
    captures: ["waiting", "starting", "memorize", "recall", "round-win", "finished-loss", "finished-win"],
    gameId: finalState.gameId,
    levelsCompleted: finalState.snapshot.level
  };
}

async function playtestLava(page: Page) {
  await page.locator(".control-game select").selectOption("lava");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "lava" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "lava-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await captureNativeDisplay(page, "lava-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 2_000);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, "lava-running");

  for (let expectedLives = 2; expectedLives >= 0; expectedLives -= 1) {
    await page.evaluate(() => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      api.resume();
      api.step(1_001);
      for (let x = 0; x < 16; x += 1) {
        api.press(x, 31);
        api.release(x, 31);
      }
    });
    await page.waitForFunction((lives) => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.lives === lives, expectedLives);
    if (expectedLives === 2) await captureNativeDisplay(page, "lava-damaged");
  }
  const lostState = await browserState(page);
  assert.equal(lostState.snapshot.phase, "finished");
  assert.equal(lostState.snapshot.success, false);
  await captureNativeDisplay(page, "lava-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("lava");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "lava" && state.snapshot.phase === "waiting";
  });
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.step((api.getState().snapshot.remainingMillis ?? 0) + 100);
  });
  const wonState = await browserState(page);
  assert.equal(wonState.snapshot.phase, "finished");
  assert.equal(wonState.snapshot.success, true);
  await captureNativeDisplay(page, "lava-finished-win");

  return {
    captures: ["waiting", "starting", "running", "damaged", "finished-loss", "finished-win"],
    gameId: wonState.gameId,
    result: "win-and-loss"
  };
}

async function playtestCrowdedDueloDisplay(page: Page): Promise<void> {
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "duelo" && state.snapshot.phase === "waiting";
  });
  assert.equal((await browserState(page)).snapshot.requiredPlayers, 8);

  await clickFloorZones(page, dueloEightPlayerZones);
  assert.equal((await browserState(page)).snapshot.phase, "starting");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        api.press(x, y);
        api.release(x, y);
      }
    }
  });
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running"
  ));
  await clickFloorZones(page, dueloEightPlayerZones, 0);
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

async function clickFloorZones(page: Page, zones: Array<[number, number]>, delayMillis = 180): Promise<void> {
  const floor = page.locator(".ml-floor-interactive");
  for (const [x, y] of zones) {
    const tile = floor.locator(`[data-tile-x="${x}"][data-tile-y="${y}"]`);
    await tile.click();
    assert.equal(await tile.getAttribute("aria-pressed"), delayMillis > 0 ? "true" : "false");
    if (delayMillis > 0) await page.waitForTimeout(delayMillis);
  }
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

  await saveBrowserCaptures(captures, name);
  if (!captureDirectory) return;
  await page.locator(".display-preview-native").screenshot({
    animations: "disabled",
    path: path.join(captureDirectory, `${name}-preview.png`)
  });
}

async function saveBrowserCaptures(captures: Record<string, BrowserPlaygroundCapture>, name: string): Promise<void> {
  if (!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  const capture = captures.display;
  const board = captures.boardPhysical;
  assert.ok(capture && board, "display and physical board captures are required");
  const bytes = Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  await writeFile(path.join(captureDirectory, `${name}.png`), bytes);
  const boardBytes = Buffer.from(board.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  await writeFile(path.join(captureDirectory, `${name}-board.png`), boardBytes);
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
