import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { characterQualityProfiles } from "../packages/character-runtime/src/index.ts";
import {
  AGENT_LAB_VISUAL_THRESHOLDS,
  evaluateVisualRegression
} from "./lib/visual-regression.ts";

type BrowserPlaygroundCapture = {
  dataUrl: string;
  height: number;
  surface: string;
  width: number;
};

type BrowserPlaygroundState = {
  clockMillis: number;
  difficulty: "easy" | "medium" | "hard" | "expert";
  gameId: string;
  paused: boolean;
  playerCount: number;
  snapshot: {
    countdownMillis?: number;
    currentPlatform?: { x: number; y: number };
    activePiece?: { cells: Array<[number, number]>; color: string; rotation: number; x: number; y: number };
    board?: Array<Array<string | null>>;
    guideX?: number;
    guideY?: number;
    hazards?: Array<{ x: number; y: number; width: number; height: number }>;
    checkpoint?: number;
    lastEventCue?: string;
    accuracy?: number;
    combo?: number;
    energy?: number;
    blockedThreats?: number;
    activePlayerIndex?: number;
    completedTransfers?: number;
    challengeCount?: number;
    challengeIndex?: number;
    holdMillis?: number;
    holdTargetMillis?: number;
    hitZones?: number[];
    level?: number;
    lines?: number;
    lives?: number;
    maxLives?: number;
    memoryStage?: string;
    noteCount?: number;
    noteIndex?: number;
    noteKind?: "tap" | "chord" | "hold";
    noteProgress?: number;
    noteZones?: number[];
    paths?: Array<Array<{ x: number; y: number }>>;
    phase: string;
    pointFlashMillis?: number;
    readyPlayers?: number;
    remainingMillis?: number;
    result?: string;
    requiredPlayers?: number;
    playerProgress?: Array<{ status?: string; alive?: boolean; roundWins?: number }>;
    startPositions?: Array<{ x: number; y: number }>;
    roundWinnerIndex?: number;
    gameWinnerIndex?: number;
    success?: boolean;
    stability?: number;
    targetPlatform?: { x: number; y: number };
    turnDurationMillis?: number;
    turnRemainingMillis?: number;
    requiredTransfers?: number;
    targets?: Array<{ x: number; y: number }>;
    stageMillis?: number;
    totalTargets?: number;
    winnerIndex?: number;
    shieldLanes?: number[];
    threatCount?: number;
    threatIndex?: number;
    threats?: Array<{ lane: number; millisRemaining: number; progress: number }>;
  };
};

type BrowserPlaygroundMediaAsset = {
  dataUrl: string;
  height: number;
  width: number;
};

type BrowserPlaygroundWindow = Window & {
  ml?: {
    agentLab?: {
      capture(options?: { width?: number; height?: number }): Promise<BrowserPlaygroundCapture>;
      exportReplay(): string;
      getState(): {
        active: boolean;
        agentCount: number;
        available: boolean;
        checksum: string;
        metrics?: Record<string, number | boolean>;
        paused: boolean;
        performance?: {
          p95FrameMillis: number;
          maxDrawCalls: number;
          maxTriangles: number;
          maxTextureMegabytes: number;
          withinBudget: boolean;
          violations: string[];
        };
        replayEndTick: number;
        replayMode: boolean;
        seed: number;
        tick: number;
      };
      pause(): void;
      play(): void;
      reset(options?: { newSeed?: boolean }): void;
      selectAgent(agentId?: string): void;
      setActive(active: boolean): void;
      setAgentCount(count: number): void;
      setDebug(options: { paths?: boolean; reservations?: boolean; targets?: boolean }): void;
      setProfile(profile: "mixed" | "cautious" | "balanced" | "bold" | "helper" | "explorer" | "expert"): void;
      setQualityTier(tier: "venue-high" | "desktop-medium" | "mobile-low" | "capture"): void;
      setSpeed(speed: number): void;
      startRecording(): void;
      step(ticks?: number): void;
      stopRecording(): void;
      replay: {
        enter(): void;
        exit(): void;
        pause(): void;
        play(): void;
        seek(tick: number): void;
        setSpeed(speed: number): void;
      };
    };
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
const focusedGame = process.env.MOTION_LEVELS_GAMES_PLAYTEST_GAME;
const updateAgentLabVisualBaselines = process.env.MOTION_LEVELS_GAMES_UPDATE_VISUAL_BASELINES === "1";
const agentLabVisualBaselineDirectory = path.join(repoRoot, "test", "visual-baselines", "agent-lab");
const agentLabVisualBaselineNames = new Set([
  "cruce-agent-lab-replay-countdown-tick-75",
  "cruce-agent-lab-replay-launch-tick-125",
  "cruce-agent-lab-replay-hazard-response-tick-217",
  "cruce-agent-lab-replay-checkpoint-one-tick-347",
  "cruce-agent-lab-replay-late-run-tick-920",
  "cruce-agent-lab-replay-victory-tick-1125",
  "cruce-agent-lab-damage",
  "cruce-agent-lab-ten-agent-stress"
]);
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

    if (focusedGame === "memory-challenge") {
      console.log(JSON.stringify({ memoryChallenge: await playtestMemoryChallenge(page) }, null, 2));
    } else if (focusedGame === "cruce-galactico") {
      console.log(JSON.stringify({
        cruceAgentLab: await playtestCruceAgentLab(page),
        cruceGalactico: await playtestCruceGalactico(page)
      }, null, 2));
    } else if (focusedGame === "equilibrio") {
      console.log(JSON.stringify({ equilibrio: await playtestEquilibrio(page) }, null, 2));
    } else if (focusedGame === "estela") {
      console.log(JSON.stringify({ estela: await playtestEstela(page) }, null, 2));
    } else if (focusedGame === "guardianes") {
      console.log(JSON.stringify({ guardianes: await playtestGuardianes(page) }, null, 2));
    } else if (focusedGame === "suelo-seguro") {
      console.log(JSON.stringify({ sueloSeguro: await playtestSueloSeguro(page) }, null, 2));
    } else if (focusedGame === "pulso") {
      console.log(JSON.stringify({ pulso: await playtestPulso(page) }, null, 2));
    } else if (focusedGame === "whack-a-mole") {
      console.log(JSON.stringify({ whackAMole: await playtestWhackAMole(page) }, null, 2));
    } else if (focusedGame === "tetris") {
      console.log(JSON.stringify({ tetris: await playtestTetris(page) }, null, 2));
    } else if (focusedGame) {
      throw new Error(`Unsupported focused browser playtest: ${focusedGame}`);
    } else {
      const pingPongResult = await playtestPingPong(page);
      const pingPongV2Result = await playtestPingPongV2(page);
      const dueloResult = await playtestDuelo(page);
      const memoryChallengeResult = await playtestMemoryChallenge(page);
      const whackAMoleResult = await playtestWhackAMole(page);
      const tetrisResult = await playtestTetris(page);
      const memoriaV2Result = await playtestMemoriaV2(page);
      const patronesResult = await playtestPatrones(page);
      const saltosResult = await playtestSaltos(page);
      const lavaResult = await playtestLava(page);
      const equilibrioResult = await playtestEquilibrio(page);
      const guardianesResult = await playtestGuardianes(page);
      const sueloSeguroResult = await playtestSueloSeguro(page);
      const cruceAgentLabResult = await playtestCruceAgentLab(page);

      console.log(JSON.stringify({ pingPong: pingPongResult, pingPongV2: pingPongV2Result, duelo: dueloResult, equilibrio: equilibrioResult, guardianes: guardianesResult, sueloSeguro: sueloSeguroResult, cruceAgentLab: cruceAgentLabResult, memoryChallenge: memoryChallengeResult, whackAMole: whackAMoleResult, tetris: tetrisResult, lava: lavaResult, memoriaV2: memoriaV2Result, patrones: patronesResult, saltos: saltosResult }, null, 2));
    }
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

async function playtestCruceGalactico(page: Page) {
  await page.locator(".control-game select").selectOption("cruce-galactico");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "cruce-galactico" && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "cruce-galactico-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="30"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await captureNativeDisplay(page, "cruce-galactico-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 30);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, "cruce-galactico-running");

  for (let expectedLives = 2; expectedLives >= 0; expectedLives -= 1) {
    await page.evaluate((lives) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      if (lives < 2) api.step(1_600);
      const hazard = api.getState().snapshot.hazards?.find(
        (candidate) => candidate.x >= 0 && candidate.x + candidate.width <= 16
      );
      if (!hazard) throw new Error("Cruce Galáctico has no visible hazard");
      const x = hazard.x + Math.floor(hazard.width / 2);
      const y = hazard.y + Math.floor(hazard.height / 2);
      api.press(x, y);
      api.step(20);
      api.release(x, y);
    }, expectedLives);
    await page.waitForFunction((lives) => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.lives === lives, expectedLives);
    if (expectedLives === 2) {
      await page.waitForTimeout(500);
      await captureNativeDisplay(page, "cruce-galactico-damaged");
    }
  }
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished");
  assert.equal((await browserState(page)).snapshot.success, false);
  await captureNativeDisplay(page, "cruce-galactico-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("cruce-galactico");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="30"]').click();
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (const y of [22, 15, 8, 1]) {
      api.press(8, y);
      api.release(8, y);
    }
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished");
  const won = await browserState(page);
  assert.equal(won.snapshot.success, true);
  assert.equal(won.snapshot.checkpoint, 4);
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    await api.capture(["display", "boardPhysical"]);
  });
  await captureNativeDisplay(page, "cruce-galactico-finished-win");
  return {
    captures: ["waiting", "starting", "running", "damaged", "finished-loss", "finished-win"],
    gameId: won.gameId,
    checkpoint: won.snapshot.checkpoint
  };
}

async function playtestCruceAgentLab(page: Page) {
  await page.locator(".control-game select").selectOption("cruce-galactico");
  await page.waitForFunction(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    return api?.getState().gameId === "cruce-galactico" && api.agentLab?.getState().available === true;
  });
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.setActive(true);
  });
  await page.locator(".agent-lab-canvas").waitFor({ state: "visible" });

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.pause();
    lab.setAgentCount(3);
    lab.setProfile("expert");
    lab.setQualityTier("capture");
    lab.setSpeed(1);
    lab.setDebug({ paths: true, reservations: true, targets: true });
    lab.reset();
    for (let batch = 0; batch < 40 && lab.getState().metrics?.completed !== true; batch += 1) {
      lab.step(50);
    }
    lab.selectAgent("cruce-agent-01");
  });
  const liveState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.ok(liveState, "Agent Lab state must be available");
  assert.equal(liveState.agentCount, 3);
  assert.equal(liveState.metrics?.completed, true);
  assert.ok(liveState.tick > 0 && liveState.tick <= 2_000);
  assert.match(liveState.checksum, /^[0-9a-f]{8}$/);
  assert.equal(liveState.paused, true);
  const liveCapture = await captureAgentLab(page, "cruce-agent-lab-live-victory");

  const replayExport = await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.stopRecording();
    const serialized = lab.exportReplay();
    lab.replay.enter();
    lab.replay.seek(75);
    return serialized;
  });
  const parsedReplay = JSON.parse(replayExport) as { frames?: unknown[]; header?: { gameId?: string; tickRate?: number } };
  assert.equal(parsedReplay.header?.gameId, "cruce-galactico");
  assert.equal(parsedReplay.header?.tickRate, 50);
  assert.ok((parsedReplay.frames?.length ?? 0) > 1_125);

  const replayCaptures: BrowserPlaygroundCapture[] = [];
  for (const [tick, label] of [
    [75, "countdown"],
    [125, "launch"],
    [217, "hazard-response"],
    [347, "checkpoint-one"],
    [920, "late-run"],
    [1_125, "victory"]
  ] as const) {
    await page.evaluate((replayTick) => {
      const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
      if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
      lab.replay.seek(replayTick);
    }, tick);
    const replayStateAtTick = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
    assert.equal(replayStateAtTick?.tick, tick);
    replayCaptures.push(await captureAgentLab(page, `cruce-agent-lab-replay-${label}-tick-${tick}`));
  }
  const replayCapture = replayCaptures[0];
  assert.ok(replayCapture, "the fixed replay must produce its idle capture");
  const repeatCapture = await page.evaluate(async () => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.replay.seek(75);
    return lab.capture();
  });
  assert.equal(repeatCapture.dataUrl, replayCapture.dataUrl, "fixed replay seek must render an identical PNG");
  const replayState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.equal(replayState?.replayMode, true);
  assert.equal(replayState?.tick, 75);

  await page.locator(".control-difficulty select").selectOption("expert");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().difficulty === "expert");
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.replay.exit();
    lab.setAgentCount(10);
    lab.setProfile("helper");
    lab.setQualityTier("capture");
    lab.reset();
    lab.pause();
    for (let batch = 0; batch < 80 && Number(lab.getState().metrics?.damage ?? 0) === 0; batch += 1) {
      lab.step(25);
    }
  });
  const damageState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.equal(damageState?.agentCount, 10);
  assert.ok(Number(damageState?.metrics?.damage ?? 0) > 0, "expert/helper fixture must reach a real damage state");
  const damageCapture = await captureAgentLab(page, "cruce-agent-lab-damage");

  await page.locator(".control-difficulty select").selectOption("medium");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().difficulty === "medium");
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.setAgentCount(10);
    lab.setProfile("expert");
    lab.setQualityTier("desktop-medium");
    lab.reset();
    lab.pause();
    for (let batch = 0; batch < 40 && lab.getState().metrics?.completed !== true; batch += 1) {
      lab.step(50);
    }
  });
  const stressState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.equal(stressState?.agentCount, 10);
  assert.ok((stressState?.tick ?? 0) > 0 && (stressState?.tick ?? 0) <= 2_000);
  assert.equal(stressState?.metrics?.completed, true);
  assert.equal(stressState?.metrics?.deadlocks, 0);
  assert.ok(
    Number(stressState?.metrics?.routeDiversity ?? 0) >= 0.8,
    `ten-agent route diversity is too low: ${String(stressState?.metrics?.routeDiversity)}`
  );
  assert.ok(stressState?.performance, "10-agent stress run must report renderer performance");
  const performance = stressState.performance;
  const desktopBudget = characterQualityProfiles["desktop-medium"];
  assert.ok(performance.maxDrawCalls <= (
    desktopBudget.maxDrawCallsPerCharacter * stressState.agentCount
    + desktopBudget.fixedSceneDrawCallAllowance
  ), `draw calls exceed desktop budget: ${performance.maxDrawCalls}`);
  assert.ok(
    performance.maxTriangles <= desktopBudget.maxTrianglesPerCharacter * stressState.agentCount,
    `triangles exceed desktop budget: ${performance.maxTriangles}`
  );
  assert.ok(
    performance.maxTextureMegabytes <= desktopBudget.maxTextureMegabytes,
    `textures exceed desktop budget: ${performance.maxTextureMegabytes} MB`
  );
  assert.deepEqual(
    performance.violations.filter((violation) => violation !== "frame-time"),
    [],
    `structural renderer budget violations: ${performance.violations.join(", ")}`
  );
  const stressCapture = await captureAgentLab(page, "cruce-agent-lab-ten-agent-stress");

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    lab.setActive(false);
  });
  await page.locator(".ml-floor-interactive").waitFor({ state: "visible" });

  return {
    captures: [
      liveCapture.surface,
      ...replayCaptures.map((capture) => capture.surface),
      damageCapture.surface,
      stressCapture.surface
    ],
    deterministicReplayPng: true,
    liveChecksum: liveState.checksum,
    replayTick: replayState?.tick,
    stress: stressState?.metrics,
    performance: stressState?.performance
  };
}

async function playtestEstela(page: Page) {
  await page.locator(".control-game select").selectOption("estela");
  await page.locator(".control-players select").selectOption("2");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "estela" && state.playerCount === 2 && state.snapshot.phase === "waiting";
  });
  await page.waitForTimeout(350);
  await captureStableNativeDisplay(page, "estela-waiting");
  await clickFloorZones(page, [[2, 2], [13, 29]]);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.waitForTimeout(350);
  await captureStableNativeDisplay(page, "estela-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await page.waitForTimeout(350);
  await captureStableNativeDisplay(page, "estela-running");

  await eliminateEstelaPlayerZero(page);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "round-win");
  const firstRound = await browserState(page);
  assert.equal(firstRound.snapshot.roundWinnerIndex, 1);
  await page.waitForTimeout(400);
  await captureStableNativeDisplay(page, "estela-round-win");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(1_850));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await eliminateEstelaPlayerZero(page);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "round-win");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(1_850));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished");
  const finished = await browserState(page);
  assert.equal(finished.snapshot.gameWinnerIndex, 1);
  assert.equal(finished.snapshot.playerProgress?.[1]?.roundWins, 2);
  await page.waitForTimeout(500);
  await captureStableNativeDisplay(page, "estela-finished");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("estela");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "estela" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  const maxState = await browserState(page);
  const maxZones = maxState.snapshot.startPositions?.map(({ x, y }) => [x, y] as [number, number]);
  assert.equal(maxZones?.length, 8);
  await clickFloorZones(page, maxZones ?? []);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  assert.equal((await browserState(page)).snapshot.readyPlayers, 8);
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await page.waitForTimeout(400);
  await captureStableNativeDisplay(page, "estela-running-8");
  return {
    captures: ["waiting", "starting", "running", "round-win", "finished", "running-8"],
    gameId: finished.gameId,
    maxPlayersReady: 8,
    winnerIndex: finished.snapshot.gameWinnerIndex
  };
}

async function eliminateEstelaPlayerZero(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.press(3, 2);
    api.release(3, 2);
    api.press(2, 2);
    api.release(2, 2);
  });
}

async function playtestEquilibrio(page: Page) {
  await page.locator(".control-game select").selectOption("equilibrio");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "equilibrio" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await page.waitForTimeout(300);
  await captureStableNativeDisplay(page, "equilibrio-waiting");
  await clickFloorZones(page, [[4, 16], [11, 16]]);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  const starting = await browserState(page);
  assert.equal(starting.snapshot.readyPlayers, 2);
  assert.equal(starting.snapshot.requiredPlayers, 2);
  await captureStableNativeDisplay(page, "equilibrio-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(4, 16);
    api.release(11, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureStableNativeDisplay(page, "equilibrio-running");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.remainingMillis ?? 70_000) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished");
  const failed = await browserState(page);
  assert.equal(failed.snapshot.phase, "finished");
  assert.equal(failed.snapshot.success, false);
  assert.equal(failed.snapshot.remainingMillis, 0);
  await captureStableNativeDisplay(page, "equilibrio-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("equilibrio");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "equilibrio" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await clickFloorZones(page, [[4, 16], [11, 16]]);
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(4, 16);
    api.release(11, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");

  const pads: Array<[[number, number], [number, number]]> = [
    [[3, 6], [12, 6]],
    [[4, 14], [10, 14]],
    [[3, 24], [12, 24]],
    [[5, 7], [9, 24]],
    [[2, 29], [13, 2]]
  ];
  let capturedHolding = false;
  let capturedRoundWin = false;
  for (let guard = 0; guard < 12; guard += 1) {
    const before = await browserState(page);
    if (before.snapshot.phase === "finished") break;
    const [left, right] = pads[before.snapshot.challengeIndex ?? 0]!;
    await page.evaluate(([leftPad, rightPad]) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      api.release(...leftPad);
      api.release(...rightPad);
      api.press(...leftPad);
      api.press(...rightPad);
      api.step(Math.round((api.getState().snapshot.holdTargetMillis ?? 1_600) / 2));
    }, [left, right] as const);
    if (!capturedHolding) {
      capturedHolding = true;
      await captureStableNativeDisplay(page, "equilibrio-holding");
    }
    await page.evaluate(() => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      api.step((api.getState().snapshot.holdTargetMillis ?? 1_600) + 100);
    });
    const state = await browserState(page);
    if (state.snapshot.phase === "round-win") {
      if (!capturedRoundWin) {
        capturedRoundWin = true;
        await page.waitForTimeout(250);
        await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.pause());
        await page.waitForTimeout(100);
        await captureStableNativeDisplay(page, "equilibrio-round-win");
        await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.resume());
      }
      await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(3_020));
    }
  }
  const won = await browserState(page);
  assert.equal(capturedHolding, true);
  assert.equal(capturedRoundWin, true);
  assert.equal(won.snapshot.phase, "finished", JSON.stringify(won.snapshot));
  assert.equal(won.snapshot.success, true);
  assert.equal(won.snapshot.challengeIndex, 4);
  await captureStableNativeDisplay(page, "equilibrio-finished-win");
  return {
    captures: ["waiting", "starting", "running", "holding", "round-win", "finished-loss", "finished-win"],
    challengesCompleted: 5,
    gameId: won.gameId,
    maxPlayersConfigured: 8
  };
}

async function playtestGuardianes(page: Page) {
  await page.locator(".control-game select").selectOption("guardianes");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "guardianes" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await page.waitForTimeout(300);
  await captureStableNativeDisplay(page, "guardianes-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  const starting = await browserState(page);
  assert.equal(starting.snapshot.readyPlayers, 1);
  assert.equal(starting.snapshot.requiredPlayers, 1);
  await captureStableNativeDisplay(page, "guardianes-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureStableNativeDisplay(page, "guardianes-running");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.pause());
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().paused === true);
  // Advance to the first resolved threat rather than assuming that the
  // ready-to-running transition consumed an exact number of browser frames.
  // Yielding between steps lets React publish each engine snapshot, while the
  // paused real-time loop keeps the result independent of CI runner speed.
  for (let guard = 0; guard < 30 && (await browserState(page)).snapshot.lives === 4; guard += 1) {
    await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(250));
  }
  const damaged = await browserState(page);
  assert.equal(damaged.snapshot.lives, 3);
  await captureStableNativeDisplay(page, "guardianes-damaged");
  for (let guard = 0; guard < 5 && (await browserState(page)).snapshot.phase !== "finished"; guard += 1) {
    await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(1_750));
  }
  const failed = await browserState(page);
  assert.equal(failed.snapshot.phase, "finished");
  assert.equal(failed.snapshot.lives, 0);
  assert.equal(failed.snapshot.success, false);
  await captureStableNativeDisplay(page, "guardianes-finished-loss");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.resume());

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("guardianes");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "guardianes" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");

  const shieldCenters: Array<[number, number]> = [[1, 28], [5, 28], [9, 28], [13, 28]];
  let capturedShield = false;
  for (let guard = 0; guard < 20; guard += 1) {
    const current = await browserState(page);
    if (current.snapshot.phase === "finished") break;
    for (let wait = 0; wait < 50 && ((await browserState(page)).snapshot.threats?.length ?? 0) === 0; wait += 1) {
      await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(100));
    }
    const threat = (await browserState(page)).snapshot.threats?.[0];
    assert.ok(threat, "Guardianes must expose the next visible threat");
    const center = shieldCenters[threat.lane]!;
    await page.evaluate(([x, y]) => (window as BrowserPlaygroundWindow).ml?.press(x, y), center);
    if (!capturedShield) {
      capturedShield = true;
      await captureStableNativeDisplay(page, "guardianes-shield-active");
    }
    await page.evaluate((millis) => (window as BrowserPlaygroundWindow).ml?.step(millis), threat.millisRemaining);
    await page.evaluate(([x, y]) => (window as BrowserPlaygroundWindow).ml?.release(x, y), center);
  }
  const won = await browserState(page);
  assert.equal(capturedShield, true);
  assert.equal(won.snapshot.phase, "finished", JSON.stringify(won.snapshot));
  assert.equal(won.snapshot.success, true);
  assert.equal(won.snapshot.blockedThreats, won.snapshot.threatCount);
  assert.equal(won.snapshot.lives, 4);
  await captureStableNativeDisplay(page, "guardianes-finished-win");
  return {
    blockedThreats: won.snapshot.blockedThreats,
    captures: ["waiting", "starting", "running", "damaged", "shield-active", "finished-loss", "finished-win"],
    gameId: won.gameId,
    maxPlayersConfigured: 8
  };
}

async function playtestSueloSeguro(page: Page) {
  const maxPlayerZones: Array<[number, number]> = [
    [1, 1], [7, 1], [13, 1], [13, 10], [13, 29], [7, 29], [1, 29], [1, 20]
  ];

  await page.locator(".control-game select").selectOption("suelo-seguro");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "suelo-seguro" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await captureStableNativeDisplay(page, "suelo-seguro-waiting");
  await clickFloorZones(page, maxPlayerZones);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  const starting = await browserState(page);
  assert.equal(starting.snapshot.readyPlayers, 8);
  assert.equal(starting.snapshot.requiredPlayers, 8);
  await captureStableNativeDisplay(page, "suelo-seguro-starting");
  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (const [x, y] of zones) api.release(x, y);
  }, maxPlayerZones);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureStableNativeDisplay(page, "suelo-seguro-running-full-lives");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    const target = api.getState().snapshot.targetPlatform;
    if (!target) throw new Error("Suelo Seguro has no target platform");
    api.press(target.x, target.y);
    api.release(target.x, target.y);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "round-win");
  await captureStableNativeDisplay(page, "suelo-seguro-round-win");
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(1_420));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.turnRemainingMillis ?? 4_800) + 20);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "turn-fail");
  const damaged = await browserState(page);
  assert.equal(damaged.snapshot.lives, 3);
  await captureStableNativeDisplay(page, "suelo-seguro-damaged");

  for (let guard = 0; guard < 8 && (await browserState(page)).snapshot.phase !== "finished"; guard += 1) {
    const state = await browserState(page);
    await page.evaluate((phase) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      if (phase === "turn-fail") api.step(1_220);
      else api.step((api.getState().snapshot.turnRemainingMillis ?? 4_800) + 20);
    }, state.snapshot.phase);
  }
  const lost = await browserState(page);
  assert.equal(lost.snapshot.phase, "finished");
  assert.equal(lost.snapshot.lives, 0);
  assert.equal(lost.snapshot.success, false);
  await captureStableNativeDisplay(page, "suelo-seguro-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("suelo-seguro");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "suelo-seguro" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await clickFloorZones(page, maxPlayerZones);
  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (const [x, y] of zones) api.release(x, y);
  }, maxPlayerZones);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    (window as BrowserPlaygroundWindow).ml?.resume();
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().paused === false);

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (let guard = 0; guard < 40 && api.getState().snapshot.phase !== "finished"; guard += 1) {
      const current = api.getState().snapshot;
      if (current.phase === "round-win") {
        api.step(1_420);
        continue;
      }
      const target = current.targetPlatform;
      if (!target) throw new Error(`Suelo Seguro has no relay target in ${current.phase}`);
      api.press(target.x, target.y);
      api.release(target.x, target.y);
    }
  });
  const won = await browserState(page);
  assert.equal(won.snapshot.phase, "finished", JSON.stringify(won.snapshot));
  assert.equal(won.snapshot.success, true);
  assert.equal(won.snapshot.completedTransfers, won.snapshot.requiredTransfers);
  await captureStableNativeDisplay(page, "suelo-seguro-finished-win");
  return {
    captures: ["waiting", "starting", "running-full-lives", "round-win", "damaged", "finished-loss", "finished-win"],
    completedTransfers: won.snapshot.completedTransfers,
    gameId: won.gameId,
    maxPlayersConfigured: 8
  };
}

async function playtestPulso(page: Page) {
  await page.locator(".control-game select").selectOption("pulso");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "pulso" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await page.waitForTimeout(300);
  await captureStableNativeDisplay(page, "pulso-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  const starting = await browserState(page);
  assert.equal(starting.snapshot.readyPlayers, 1);
  assert.equal(starting.snapshot.requiredPlayers, 1);
  await captureStableNativeDisplay(page, "pulso-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureStableNativeDisplay(page, "pulso-running");

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step(2_000);
    api.step(2_000);
  });
  const damaged = await browserState(page);
  assert.ok((damaged.snapshot.energy ?? 100) < 64);
  assert.equal(damaged.snapshot.phase, "running");
  await captureStableNativeDisplay(page, "pulso-missed");
  for (let attempt = 0; attempt < 8 && (await browserState(page)).snapshot.phase !== "finished"; attempt += 1) {
    await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(2_000));
  }
  const failed = await browserState(page);
  assert.equal(failed.snapshot.phase, "finished");
  assert.equal(failed.snapshot.success, false);
  assert.equal(failed.snapshot.energy, 0);
  await captureStableNativeDisplay(page, "pulso-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("pulso");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "pulso" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="16"]').click();
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.release(8, 16);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");

  const padCenters: Array<[number, number]> = [[3, 7], [12, 7], [3, 23], [12, 23]];
  let capturedHold = false;
  for (let guard = 0; guard < 30; guard += 1) {
    const state = await browserState(page);
    if (state.snapshot.phase === "finished") break;
    for (let wait = 0; wait < 40 && ((await browserState(page)).snapshot.noteProgress ?? 0) < 0.99; wait += 1) {
      await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(50));
    }
    const note = await browserState(page);
    const zones = note.snapshot.noteZones ?? [];
    assert.ok(zones.length > 0, `Pulso note ${note.snapshot.noteIndex} must expose its floor zones`);
    await page.evaluate(({ centers, activeZones }) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      for (const zone of activeZones) {
        const [x, y] = centers[zone]!;
        api.press(x, y);
      }
    }, { activeZones: zones, centers: padCenters });
    if (note.snapshot.noteKind === "hold") {
      if (!capturedHold) {
        capturedHold = true;
        await captureStableNativeDisplay(page, "pulso-hold");
      }
      const afterHoldCapture = await browserState(page);
      if (afterHoldCapture.snapshot.noteIndex === note.snapshot.noteIndex) {
        await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(1_000));
      }
    }
    await page.evaluate(({ centers, activeZones }) => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      for (const zone of activeZones) {
        const [x, y] = centers[zone]!;
        api.release(x, y);
      }
    }, { activeZones: zones, centers: padCenters });
  }
  const won = await browserState(page);
  assert.equal(capturedHold, true, "Pulso must browser-play a hold note");
  assert.equal(won.snapshot.phase, "finished", JSON.stringify(won.snapshot));
  assert.equal(won.snapshot.success, true);
  assert.equal(won.snapshot.noteIndex, won.snapshot.noteCount);
  assert.ok((won.snapshot.accuracy ?? 0) >= 90, "Pulso browser run must finish with at least 90% accuracy");
  await captureStableNativeDisplay(page, "pulso-finished-win");
  return {
    accuracy: won.snapshot.accuracy,
    captures: ["waiting", "starting", "running", "missed", "finished-loss", "hold", "finished-win"],
    gameId: won.gameId,
    maxPlayersConfigured: 8,
    notesCompleted: won.snapshot.noteIndex
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
  const finishedState = await browserState(page);
  assert.equal(finishedState.snapshot.phase, "finished", JSON.stringify(finishedState.snapshot));
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

async function playtestMemoryChallenge(page: Page) {
  await page.locator(".control-game select").selectOption("memory-challenge");
  await page.locator(".control-players select").selectOption("4");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "memory-challenge" && state.playerCount === 4 && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "memory-challenge-waiting");
  await clickFloorZones(page, [[0, 0], [4, 0], [8, 0], [12, 0]]);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.waitForTimeout(250);
  await captureNativeDisplay(page, "memory-challenge-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.memoryStage === "memorize");
  await captureNativeDisplay(page, "memory-challenge-memorize");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.stageMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.memoryStage === "recall");
  await captureNativeDisplay(page, "memory-challenge-recall");
  await preparePlaygroundInput(page);

  const failedState = await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    const playerPath = api.getState().snapshot.paths?.[0] ?? [];
    const keys = new Set(playerPath.map((point) => `${point.x},${point.y}`));
    let miss = { x: 0, y: 31 };
    for (let y = 2; y < 32; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (!keys.has(`${x},${y}`)) { miss = { x, y }; y = 32; break; }
      }
    }
    api.press(miss.x, miss.y);
    api.release(miss.x, miss.y);
    return api.getState();
  });
  assert.equal(failedState.snapshot.playerProgress?.[0]?.status, "failed", JSON.stringify(failedState));
  assert.equal(failedState.snapshot.lastEventCue, "damage");
  await captureNativeDisplay(page, "memory-challenge-failed");
  await preparePlaygroundInput(page);

  const finishedState = await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (let attempt = 0; attempt < 3 && api.getState().snapshot.phase !== "finished"; attempt += 1) {
      if (api.getState().snapshot.playerProgress?.[1]?.status === "failed") {
        api.press(4, 0);
        api.release(4, 0);
      }
      for (const point of api.getState().snapshot.paths?.[1] ?? []) {
        api.press(point.x, point.y);
        api.release(point.x, point.y);
      }
    }
    return api.getState();
  });
  assert.equal(finishedState.snapshot.phase, "finished", JSON.stringify(finishedState.snapshot));
  assert.equal(finishedState.snapshot.success, true);
  await captureNativeDisplay(page, "memory-challenge-finished");
  return {
    captures: ["waiting", "starting", "memorize", "recall", "failed", "finished"],
    gameId: finishedState.gameId,
    playerCount: finishedState.playerCount,
    result: "player-two-win"
  };
}

async function playtestWhackAMole(page: Page) {
  await page.locator(".control-game select").selectOption("whack-a-mole");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "whack-a-mole" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "whack-a-mole-waiting");
  await clickFloorZones(page, dueloEightPlayerZones);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.waitForTimeout(250);
  await captureNativeDisplay(page, "whack-a-mole-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  const running = await browserState(page);
  assert.equal(running.snapshot.targets?.length, 8);
  await captureNativeDisplay(page, "whack-a-mole-running");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (const target of (api.getState().snapshot.targets ?? []).slice(0, 4)) {
      api.press(target.x, target.y);
      api.release(target.x, target.y);
    }
  });
  await captureNativeDisplay(page, "whack-a-mole-hit");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.remainingMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
  const finished = await browserState(page);
  assert.equal(finished.snapshot.phase, "finished");
  await captureNativeDisplay(page, "whack-a-mole-finished");
  return { captures: ["waiting", "starting", "running", "hit", "finished"], gameId: finished.gameId, playerCount: finished.playerCount, result: "timed-winner" };
}

async function playtestTetris(page: Page) {
  await page.locator(".control-game select").selectOption("tetris");
  await page.locator(".control-players select").selectOption("4");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "tetris" && state.playerCount === 4 && state.snapshot.phase === "waiting";
  });
  await captureNativeDisplay(page, "tetris-waiting");
  await page.locator('.ml-floor-interactive [data-tile-x="8"][data-tile-y="29"]').click();
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  await page.waitForTimeout(250);
  await captureNativeDisplay(page, "tetris-starting");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    api.pause();
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, "tetris-running");

  let capturedLineClear = false;
  let finalState: BrowserPlaygroundState | undefined;
  for (let piece = 0; piece < 300 && !finalState; piece += 1) {
    const move = await page.evaluate(() => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      api.resume();
      type Candidate = { rotation: number; score: number; x: number };
      const candidates: Candidate[] = [];
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const snapshot = api.getState().snapshot;
        const active = snapshot.activePiece;
        const board = snapshot.board;
        if (!active || !board) throw new Error("Tetris browser snapshot is incomplete");
        const width = Math.max(...active.cells.map(([x]) => x)) + 1;
        for (let x = 0; x <= 10 - width; x += 1) {
          let y = Math.max(0, active.y);
          if (active.cells.some(([dx, dy]) => y + dy >= board.length || x + dx < 0 || x + dx >= 10 || board[y + dy]?.[x + dx] !== null)) continue;
          while (!active.cells.some(([dx, dy]) => y + 1 + dy >= board.length || x + dx < 0 || x + dx >= 10 || board[y + 1 + dy]?.[x + dx] !== null)) y += 1;
          const simulated = board.map((row) => [...row]);
          for (const [dx, dy] of active.cells) simulated[y + dy]![x + dx] = active.color;
          const cleared = simulated.filter((row) => row.every(Boolean)).length;
          const remaining = simulated.filter((row) => !row.every(Boolean));
          while (remaining.length < simulated.length) remaining.unshift(Array(10).fill(null));
          const heights: number[] = [];
          let holes = 0;
          for (let column = 0; column < 10; column += 1) {
            const first = remaining.findIndex((row) => row[column] !== null);
            heights[column] = first < 0 ? 0 : remaining.length - first;
            if (first >= 0) for (let row = first + 1; row < remaining.length; row += 1) if (remaining[row]![column] === null) holes += 1;
          }
          const bumpiness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]!), 0);
          const aggregate = heights.reduce((sum, height) => sum + height, 0);
          candidates.push({ rotation, x, score: cleared * 10_000 - holes * 600 - aggregate * 6 - bumpiness * 10 - Math.max(...heights) * 15 });
        }
        api.step(200);
        const guide = api.getState().snapshot;
        api.press((guide.guideX ?? 8) + 1, (guide.guideY ?? 31) - 1);
        api.release((guide.guideX ?? 8) + 1, (guide.guideY ?? 31) - 1);
      }
      const best = candidates.sort((a, b) => b.score - a.score)[0];
      if (!best) throw new Error("Tetris browser autoplayer found no placement");
      for (let turn = 0; turn < best.rotation; turn += 1) {
        api.step(200);
        const guide = api.getState().snapshot;
        api.press((guide.guideX ?? 8) + 1, (guide.guideY ?? 31) - 1);
        api.release((guide.guideX ?? 8) + 1, (guide.guideY ?? 31) - 1);
      }
      const active = api.getState().snapshot.activePiece;
      if (!active) throw new Error("Tetris active piece disappeared");
      const width = Math.max(...active.cells.map(([x]) => x)) + 1;
      api.step(200);
      api.press(3 + best.x + Math.floor(width / 2), 31);
      api.release(3 + best.x + Math.floor(width / 2), 31);
      api.pause();
      return api.getState();
    });
    const state = move;
    if (!capturedLineClear && state.snapshot.result === "line-clear") {
      capturedLineClear = true;
      await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.resume());
      await captureNativeDisplay(page, "tetris-line-clear");
      await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.pause());
    }
    if (state.snapshot.phase === "finished") finalState = state;
  }
  if (!finalState) throw new Error("Tetris did not complete within the browser playtest guard");
  assert.equal(finalState.snapshot.result, "game-win", JSON.stringify(finalState.snapshot));
  assert.equal(finalState.snapshot.success, true);
  assert.ok((finalState.snapshot.lines ?? 0) >= 10, "Tetris must meet or exceed its ten-line win target");
  assert.equal(capturedLineClear, true);
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.resume());
  await captureNativeDisplay(page, "tetris-finished-win");
  return { captures: ["waiting", "starting", "running", "line-clear", "finished-win"], gameId: finalState.gameId, lines: finalState.snapshot.lines, result: "game-win" };
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
    api.step((api.getState().snapshot.stageMillis ?? 0) + 100);
  });
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.memoryStage === "recall"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished"
  ));
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

async function preparePlaygroundInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().paused === false);
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

async function captureAgentLab(page: Page, name: string): Promise<BrowserPlaygroundCapture> {
  const capture = await page.evaluate(async () => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Cruce Agent Lab API is unavailable");
    return lab.capture({ width: 1_920, height: 1_080 });
  });
  assert.equal(capture.surface, "agents3d");
  assert.equal(capture.width, 1_920);
  assert.equal(capture.height, 1_080);
  assert.match(capture.dataUrl, /^data:image\/png;base64,/);
  if (captureDirectory) {
    await mkdir(captureDirectory, { recursive: true });
    const bytes = Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
    await writeFile(path.join(captureDirectory, `${name}.png`), bytes);
  }
  await verifyAgentLabVisualBaseline(page, capture, name);
  return capture;
}

async function verifyAgentLabVisualBaseline(
  page: Page,
  capture: BrowserPlaygroundCapture,
  name: string
): Promise<void> {
  if (!agentLabVisualBaselineNames.has(name)) return;
  const currentBytes = Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const baselinePath = path.join(agentLabVisualBaselineDirectory, `${name}.png`);
  if (updateAgentLabVisualBaselines) {
    await mkdir(agentLabVisualBaselineDirectory, { recursive: true });
    await writeFile(baselinePath, currentBytes);
    return;
  }

  let baselineBytes: Buffer;
  try {
    baselineBytes = await readFile(baselinePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing Agent Lab visual baseline ${baselinePath}: ${reason}`, { cause: error });
  }
  const baselineDataUrl = `data:image/png;base64,${baselineBytes.toString("base64")}`;
  const stats = await page.evaluate(async ({ baseline, current }) => {
    const baselineImage = new Image();
    const currentImage = new Image();
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        baselineImage.addEventListener("load", () => resolve(), { once: true });
        baselineImage.addEventListener(
          "error",
          () => reject(new Error("Could not decode visual-regression baseline PNG")),
          { once: true }
        );
        baselineImage.src = baseline;
      }),
      new Promise<void>((resolve, reject) => {
        currentImage.addEventListener("load", () => resolve(), { once: true });
        currentImage.addEventListener(
          "error",
          () => reject(new Error("Could not decode visual-regression capture PNG")),
          { once: true }
        );
        currentImage.src = current;
      })
    ]);
    const sampleWidth = 240;
    const sampleHeight = 135;
    const baselineCanvas = document.createElement("canvas");
    baselineCanvas.width = sampleWidth;
    baselineCanvas.height = sampleHeight;
    const baselineContext = baselineCanvas.getContext("2d", { willReadFrequently: true });
    if (!baselineContext) throw new Error("Visual-regression baseline canvas is unavailable");
    baselineContext.imageSmoothingEnabled = true;
    baselineContext.imageSmoothingQuality = "high";
    baselineContext.drawImage(baselineImage, 0, 0, sampleWidth, sampleHeight);
    const baselinePixels = baselineContext.getImageData(0, 0, sampleWidth, sampleHeight).data;

    const currentCanvas = document.createElement("canvas");
    currentCanvas.width = sampleWidth;
    currentCanvas.height = sampleHeight;
    const currentContext = currentCanvas.getContext("2d", { willReadFrequently: true });
    if (!currentContext) throw new Error("Visual-regression capture canvas is unavailable");
    currentContext.imageSmoothingEnabled = true;
    currentContext.imageSmoothingQuality = "high";
    currentContext.drawImage(currentImage, 0, 0, sampleWidth, sampleHeight);
    const currentPixels = currentContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let differentPixels = 0;
    let totalChannelDelta = 0;
    for (let offset = 0; offset < baselinePixels.length; offset += 4) {
      const red = Math.abs((baselinePixels[offset] ?? 0) - (currentPixels[offset] ?? 0));
      const green = Math.abs((baselinePixels[offset + 1] ?? 0) - (currentPixels[offset + 1] ?? 0));
      const blue = Math.abs((baselinePixels[offset + 2] ?? 0) - (currentPixels[offset + 2] ?? 0));
      totalChannelDelta += red + green + blue;
      if (Math.max(red, green, blue) > 28) differentPixels += 1;
    }
    const totalPixels = sampleWidth * sampleHeight;
    return {
      baselineWidth: baselineImage.naturalWidth,
      baselineHeight: baselineImage.naturalHeight,
      currentWidth: currentImage.naturalWidth,
      currentHeight: currentImage.naturalHeight,
      differentPixels,
      totalPixels,
      meanChannelDelta: totalChannelDelta / (totalPixels * 3)
    };
  }, { baseline: baselineDataUrl, current: capture.dataUrl });

  assert.equal(stats.baselineWidth, 1_920, `${name} baseline width`);
  assert.equal(stats.baselineHeight, 1_080, `${name} baseline height`);
  assert.equal(stats.currentWidth, stats.baselineWidth, `${name} capture width must match baseline`);
  assert.equal(stats.currentHeight, stats.baselineHeight, `${name} capture height must match baseline`);
  const evaluation = evaluateVisualRegression(stats, AGENT_LAB_VISUAL_THRESHOLDS);
  assert.equal(
    evaluation.passed,
    true,
    `${name} visual regression: ${evaluation.failures.join("; ")}`
  );
}

async function captureStableNativeDisplay(page: Page, name: string): Promise<void> {
  if (captureDirectory) {
    const nativeDisplay = page.locator(".display-preview-native");
    const previousStyle = await nativeDisplay.getAttribute("style");
    await nativeDisplay.evaluate((element) => {
      Object.assign((element as HTMLElement).style, {
        left: "0",
        position: "fixed",
        top: "0",
        transform: "none",
        zIndex: "2147483647"
      });
    });
    try {
      const box = await nativeDisplay.boundingBox();
      assert.equal(Math.round(box?.width ?? 0), 1_920);
      assert.equal(Math.round(box?.height ?? 0), 1_080);
      await nativeDisplay.screenshot({
        animations: "disabled",
        path: path.join(captureDirectory, `${name}-visual.png`)
      });
    } finally {
      await nativeDisplay.evaluate((element, style) => {
        if (style === null) element.removeAttribute("style");
        else element.setAttribute("style", style);
      }, previousStyle);
    }
  }
  await page.evaluate(async () => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    await api.capture(["display", "boardPhysical"]);
  });
  await captureNativeDisplay(page, name);
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
