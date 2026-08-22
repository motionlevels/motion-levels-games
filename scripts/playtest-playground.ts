import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  JUGAR_3D_VISUAL_THRESHOLDS,
  evaluateVisualRegression
} from "./lib/visual-regression.ts";

type BrowserPlaygroundCapture = {
  dataUrl: string;
  height: number;
  surface: string;
  width: number;
};

type BrowserJugarPerformance = {
  schemaVersion: 1;
  qualityTier: "venue-high" | "desktop-medium" | "mobile-low" | "capture";
  samples: number;
  latest: {
    frameMillis: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    framebufferMemoryProxyMegabytes: number;
    gpuMemoryProxyMegabytes: number;
  };
  p95FrameMillis: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxGeometries: number;
  maxTextures: number;
  maxPrograms: number;
  maxGpuMemoryProxyMegabytes: number;
  budget: {
    minimumSamples: number;
    maxP95FrameMillis: number;
    maxSoftwareP95FrameMillis: number;
    maxDrawCalls: number;
    maxTriangles: number;
    maxGeometries: number;
    maxTextures: number;
    maxPrograms: number;
    maxGpuMemoryProxyMegabytes: number;
  };
  budgetReady: boolean;
  structuralWithinBudget: boolean;
  timingWithinBudget: boolean;
  softwareTimingWithinBudget: boolean;
  timingBudgetWaived: boolean;
  withinBudget: boolean;
  violations: string[];
  environment?: { vendor: string; renderer: string; softwareRenderer: boolean };
  caveats: string[];
};

type BrowserPlaygroundState = {
  clockMillis: number;
  difficulty: "easy" | "medium" | "hard" | "expert";
  gameId: string;
  paused: boolean;
  playerCount: number;
  frame: {
    cells: Array<{ x: number; y: number; color: string }>;
  };
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
    level?: number | string;
    levelSlug?: string;
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
        performance?: BrowserJugarPerformance;
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
const updateJugarVisualBaselines = process.env.MOTION_LEVELS_GAMES_UPDATE_VISUAL_BASELINES === "1";
// Capture permits 1,300 ms software-WebGL frames and needs 45 retained samples
// after the 15-frame Stage warmup. That is a 78-second theoretical sampling
// horizon, so the gate allows 120 seconds for report cadence and catalog GC.
const jugarPerformanceReadinessTimeoutMillis = 120_000;
const jugarVisualBaselineDirectory = path.join(repoRoot, "test", "visual-baselines", "jugar-3d");
const jugarVisualBaselineNames = new Set([
  "duelo-jugar-live-victory",
  "duelo-jugar-replay-opening-tick-100",
  "parkour-jugar-live-victory",
  "temporada1-jugar-live-victory"
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
    page.on("pageerror", (error) => process.stderr.write(`[browser page error] ${error.stack ?? error.message}\n`));
    page.on("console", (message) => {
      if (message.type() === "error") process.stderr.write(`[browser console error] ${message.text()}\n`);
    });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.motionLevelsPlaygroundApi === "ready");
    await assertMomentaryFloorInput(page);
    await assertStablePhaseHeader(page);

    if (focusedGame === "memory-challenge") {
      console.log(JSON.stringify({ memoryChallenge: await playtestMemoryChallenge(page) }, null, 2));
    } else if (focusedGame === "cruce-galactico") {
      console.log(JSON.stringify({ cruceGalactico: await playtestCruceGalactico(page) }, null, 2));
    } else if (focusedGame === "duelo") {
      console.log(JSON.stringify({
        duelo: await playtestDuelo(page),
        dueloJugar3d: await playtestDueloJugar3d(page)
      }, null, 2));
    } else if (focusedGame === "duelo-jugar-3d") {
      console.log(JSON.stringify({ dueloJugar3d: await playtestDueloJugar3d(page) }, null, 2));
    } else if (focusedGame === "parkour") {
      console.log(JSON.stringify({ parkour: await playtestPublishedLevels(page, "parkour") }, null, 2));
    } else if (focusedGame === "temporada1-niveles") {
      console.log(JSON.stringify({ temporada1: await playtestPublishedLevels(page, "temporada1-niveles") }, null, 2));
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
      const dueloJugar3dResult = await playtestDueloJugar3d(page);
      const parkourResult = await playtestPublishedLevels(page, "parkour");
      const temporada1Result = await playtestPublishedLevels(page, "temporada1-niveles");

      console.log(JSON.stringify({ pingPong: pingPongResult, pingPongV2: pingPongV2Result, duelo: dueloResult, dueloJugar3d: dueloJugar3dResult, parkour: parkourResult, temporada1: temporada1Result, equilibrio: equilibrioResult, guardianes: guardianesResult, sueloSeguro: sueloSeguroResult, memoryChallenge: memoryChallengeResult, whackAMole: whackAMoleResult, tetris: tetrisResult, lava: lavaResult, memoriaV2: memoriaV2Result, patrones: patronesResult, saltos: saltosResult }, null, 2));
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function playtestPingPong(page: Page) {
  await page.locator(".control-game select").selectOption("ping-pong-v2");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "ping-pong-v2");

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
  await page.waitForFunction(() => (
    document.querySelectorAll('.ml-floor-interactive [data-input-pressed="true"]').length === 0
  ));

  // The browser floor is momentary, so use the public API for deterministic
  // multi-player readiness instead of relying on sticky sequential clicks.
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.press(7, 3);
    api.press(7, 28);
  });

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
  await pressFloorZone(page, 8, 30);
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
  await pressFloorZone(page, 8, 30);
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

async function playtestDueloJugar3d(page: Page) {
  await page.setViewportSize({ width: 1_920, height: 1_080 });
  await page.locator(".control-game select").selectOption("duelo");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    return api?.getState().gameId === "duelo"
      && api.getState().playerCount === 8
      && api.agentLab?.getState().available === true;
  });
  const agentSurfaceButton = page.getByRole("button", { name: "Agents 3D" });
  await agentSurfaceButton.waitFor({ state: "visible" });
  assert.equal(await agentSurfaceButton.isEnabled(), true, "Duelo must expose its product Jugar controller");
  await agentSurfaceButton.click();
  await page.locator(".jugar-agent-surface canvas").waitFor({ state: "visible" });
  const desktopPerformance = await assertJugarPerformanceBudget(page, "desktop-medium");
  const mobileTvCompositing = await assertStableMobileTvCompositing(page);

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.pause();
    lab.setProfile("mixed");
    lab.setSpeed(1);
    lab.setDebug({ paths: true, targets: true });
    lab.reset();
    lab.startRecording();
    lab.step(5);
  });
  const steppedState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.equal(steppedState?.paused, true, "explicit steps must preserve pause");
  assert.equal(steppedState?.tick, 5, "five fixed Jugar ticks must advance exactly five frames");

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    for (let batch = 0; batch < 70 && lab.getState().metrics?.completed !== true; batch += 1) {
      lab.step(50);
    }
    lab.selectAgent("0");
  });
  const liveState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.ok(liveState, "Jugar 3D agent state must be available");
  assert.equal(liveState.agentCount, 8);
  assert.equal(liveState.metrics?.completed, true);
  assert.ok(liveState.tick > 0 && liveState.tick <= 3_505);
  assert.match(liveState.checksum, /^[0-9a-f]{8}$/);
  assert.equal(liveState.paused, true);
  await prepareNativeJugarCapture(page);
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    // Start capture-tier sampling only after the intentionally synchronous
    // developer fast-forward and native resize. Neither blocking operation is
    // representative of a rendered frame.
    lab.setQualityTier("capture");
  });
  const capturePerformance = await assertJugarPerformanceBudget(page, "capture", true);
  const liveCapture = await captureJugar3d(page, "duelo-jugar-live-victory");

  const replayExport = await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.stopRecording();
    const serialized = lab.exportReplay();
    lab.replay.enter();
    lab.replay.seek(100);
    return serialized;
  });
  const parsedReplay = JSON.parse(replayExport) as { frames?: unknown[]; header?: { gameId?: string; tickRate?: number } };
  assert.equal(parsedReplay.header?.gameId, "duelo");
  assert.equal(parsedReplay.header?.tickRate, 50);
  assert.ok((parsedReplay.frames?.length ?? 0) > 100);

  const replayStateAtOpening = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.equal(replayStateAtOpening?.tick, 100);
  await waitForJugarFrame(page);
  const replayCapture = await captureJugar3d(page, "duelo-jugar-replay-opening-tick-100");
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.replay.seek(100);
  });
  await waitForJugarFrame(page);
  const repeatCapture = await page.evaluate(async () => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    return lab.capture({ width: 1_920, height: 1_080 });
  });
  assert.equal(repeatCapture.dataUrl, replayCapture.dataUrl, "fixed replay seek must render an identical PNG");
  const steppedReplayTick = await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.step(5);
    const steppedTick = lab.getState().tick;
    lab.replay.setSpeed(2);
    lab.replay.play();
    return steppedTick;
  });
  await page.waitForFunction(
    (tick) => {
      const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
      return (lab?.getState().tick ?? 0) > tick;
    },
    steppedReplayTick,
    { timeout: 10_000 }
  );
  const playedReplayTick = await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.replay.pause();
    return lab.getState().tick;
  });
  assert.equal(steppedReplayTick, 105, "replay single-step must consume retained frames");
  assert.ok(playedReplayTick > steppedReplayTick, "replay play must advance its retained-frame cursor");

  const restored = await page.evaluate((terminalTick) => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
    lab.replay.seek(terminalTick);
    lab.replay.exit();
    return lab.getState();
  }, liveState.tick);
  assert.equal(restored.replayMode, false);
  assert.equal(restored.tick, liveState.tick, "replay exit must restore the parked live Jugar session");
  assert.equal(restored.checksum, liveState.checksum);

  await restoreJugarCaptureLayout(page);
  await page.getByRole("button", { name: "Floor", exact: true }).click();
  await page.locator(".ml-floor-interactive").waitFor({ state: "visible" });

  return {
    captures: [liveCapture.surface, replayCapture.surface],
    deterministicReplayPng: true,
    liveChecksum: liveState.checksum,
    replayTick: replayStateAtOpening?.tick,
    terminalTick: liveState.tick,
    winner: liveState.metrics?.score,
    performance: {
      desktop: performanceSummary(desktopPerformance),
      capture: performanceSummary(capturePerformance)
    },
    mobileTvCompositing
  };
}

async function assertStableMobileTvCompositing(page: Page) {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Jugar 3D API is unavailable");
    lab.setQualityTier("mobile-low");
  });

  const surface = page.locator('[data-compositing="stable-2d"]');
  await surface.waitFor({ state: "visible" });
  // Wait for actual rendered frames rather than wall time. SwiftShader can
  // take substantially longer than one second to process the resize and
  // camera-fit frames on a busy CI runner; sampling between those frames
  // mistakes expected resize convergence for live projection drift.
  let settlingGeometry = "";
  let stableRenderedFrames = 0;
  for (let attempt = 0; attempt < 40 && stableRenderedFrames < 3; attempt += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    }));
    const nextGeometry = await surface.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        key: [rect.left, rect.top, rect.width, rect.height]
          .map((value) => value.toFixed(2))
          .join(":"),
        visible: rect.width > 40 && rect.height > 20
      };
    });
    stableRenderedFrames = nextGeometry.visible && nextGeometry.key === settlingGeometry
      ? stableRenderedFrames + 1
      : 0;
    settlingGeometry = nextGeometry.key;
  }
  assert.equal(
    stableRenderedFrames,
    3,
    `mobile TV projection did not settle: ${settlingGeometry}`
  );

  const samples: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (let sample = 0; sample < 12; sample += 1) {
    const state = await surface.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const canvas = element.closest(".agent-lab-viewport")?.querySelector("canvas");
      const canvasRect = canvas?.getBoundingClientRect();
      let current: Element | null = element;
      let usesPreserve3d = false;
      let usesPerspective = false;
      while (current && current !== canvas?.parentElement) {
        const style = getComputedStyle(current);
        usesPreserve3d ||= style.transformStyle === "preserve-3d";
        usesPerspective ||= style.perspective !== "none";
        current = current.parentElement;
      }
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        canvas: canvasRect
          ? { left: canvasRect.left, top: canvasRect.top, right: canvasRect.right, bottom: canvasRect.bottom }
          : null,
        usesPerspective,
        usesPreserve3d
      };
    });
    assert.equal(state.usesPerspective, false, "mobile TV must not inherit CSS perspective");
    assert.equal(state.usesPreserve3d, false, "mobile TV must not inherit preserve-3d");
    assert.ok(state.canvas, "mobile TV must remain attached to the Jugar canvas");
    assert.ok(state.rect.width > 40 && state.rect.height > 20, "mobile TV must have a visible projected surface");
    const geometry = JSON.stringify({ rect: state.rect, canvas: state.canvas });
    assert.ok(
      state.rect.left >= state.canvas.left - 1 && state.rect.top >= state.canvas.top - 1,
      `mobile TV starts outside the canvas: ${geometry}`
    );
    assert.ok(
      state.rect.left + state.rect.width <= state.canvas.right + 1,
      `mobile TV exceeds the canvas width: ${geometry}`
    );
    assert.ok(
      state.rect.top + state.rect.height <= state.canvas.bottom + 1,
      `mobile TV exceeds the canvas height: ${geometry}`
    );
    samples.push(state.rect);
    await page.waitForTimeout(100);
  }

  const first = samples[0]!;
  const maxLayoutDrift = Math.max(...samples.flatMap((sample) => [
    Math.abs(sample.left - first.left),
    Math.abs(sample.top - first.top),
    Math.abs(sample.width - first.width),
    Math.abs(sample.height - first.height)
  ]));
  assert.ok(maxLayoutDrift <= 0.25, `mobile TV projection drifted ${maxLayoutDrift.toFixed(2)}px`);

  if (captureDirectory) {
    await mkdir(captureDirectory, { recursive: true });
    await page.locator(".jugar-agent-surface").screenshot({
      animations: "disabled",
      path: path.join(captureDirectory, "jugar-mobile-tv-stable.png")
    });
  }

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Jugar 3D API is unavailable");
    lab.setQualityTier("desktop-medium");
  });
  await page.setViewportSize({ width: 1_920, height: 1_080 });
  await page.locator(".mlg-tv-screen--perspective").waitFor({ state: "attached" });
  return {
    samples: samples.length,
    maxLayoutDrift,
    projectedWidth: first.width,
    projectedHeight: first.height,
    css3d: false
  };
}

type PublishedLevelPlaytestGame = "parkour" | "temporada1-niveles";

async function playtestPublishedLevels(page: Page, product: PublishedLevelPlaytestGame) {
  const definition = product === "parkour"
    ? {
        canonicalId: "c1daea4f-e586-4116-8cbe-871cde887a81",
        label: "Parkour",
        players: 1,
        baseline: "parkour-jugar-live-victory"
      }
    : {
        canonicalId: "4773837e-3565-49d7-8953-3b40f59fca7b",
        label: "Temporada 1",
        players: 6,
        baseline: "temporada1-jugar-live-victory"
      };

  await page.setViewportSize({ width: 1_280, height: 720 });
  await page.locator(".control-game select").selectOption({ label: definition.label });
  await page.locator(".control-players select").selectOption(String(definition.players));
  await page.waitForFunction(({ gameId, players }) => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === gameId && state.playerCount === players && state.snapshot.phase === "countdown";
  }, { gameId: definition.canonicalId, players: definition.players });
  await captureNativeDisplay(page, `${product}-countdown`);

  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(3_000));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  await captureNativeDisplay(page, `${product}-running`);

  if (product === "temporada1-niveles") {
    const damage = await page.evaluate(() => {
      const api = (window as BrowserPlaygroundWindow).ml;
      if (!api) throw new Error("window.ml is not ready");
      const before = api.getState().snapshot.lives;
      if (typeof before !== "number") throw new Error("Temporada 1 did not expose lives");
      for (let y = 0; y < 32; y += 1) {
        api.press(0, y);
        api.step(20);
        api.release(0, y);
        const after = api.getState().snapshot.lives;
        if (typeof after === "number" && after < before) return { before, after, y };
      }
      throw new Error("Temporada 1 authored frame did not expose a damaging tile");
    });
    assert.equal(damage.after, damage.before - 1, "Temporada 1 must apply exactly one authored hazard hit");
    await page.waitForFunction(
      (expectedLives) => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.lives === expectedLives,
      damage.after
    );
    await captureNativeDisplay(page, `${product}-damaged`);
  }

  await page.evaluate((game) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    // These are repository-owned authored frames, so their objectives are
    // deliberately discovered from the rendered contract instead of baking
    // coordinates from a fixture into the browser test. Animated levels can
    // expose different objectives on different frames.
    for (let batch = 0; batch < 12_000; batch += 1) {
      const state = api.getState();
      const objectives = state.frame.cells.filter((cell) => {
        const color = cell.color.toLowerCase();
        return color === "#0000ff" || color === "#f526ff";
      });
      for (const objective of objectives) {
        api.press(objective.x, objective.y);
        api.release(objective.x, objective.y);
        if (objective.color.toLowerCase() === "#f526ff") {
          api.press(objective.x, objective.y);
          api.release(objective.x, objective.y);
        }
      }
      if (api.getState().snapshot.phase === "finished") return;
      api.step(20);
    }
    throw new Error(`${game} authored objectives did not reach a terminal state`);
  }, product);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "finished");
  const floorFinished = await browserState(page);
  assert.equal(floorFinished.snapshot.success, true);
  await captureNativeDisplay(page, `${product}-finished`);

  const agentSurfaceButton = page.getByRole("button", { name: "Agents 3D" });
  assert.equal(await agentSurfaceButton.isEnabled(), true, `${definition.label} must expose its semantic Jugar controller`);
  await agentSurfaceButton.click();
  await page.locator(".jugar-agent-surface canvas").waitFor({ state: "visible" });
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Published-level Jugar API is unavailable");
    lab.pause();
    lab.setProfile("expert");
    lab.setSpeed(1);
    lab.reset();
    for (let batch = 0; batch < 400 && lab.getState().metrics?.completed !== true; batch += 1) {
      lab.step(50);
    }
  });
  const agentState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  const agentAuthority = await browserState(page);
  assert.ok(agentState);
  assert.equal(agentState.agentCount, definition.players);
  assert.equal(agentState.metrics?.completed, true, `${definition.label} semantic agents must reach a terminal state`);
  assert.equal(agentAuthority.snapshot.success, true, `${definition.label} semantic agents must win the authoritative game`);
  assert.ok(agentState.tick > 0 && agentState.tick <= 20_000);
  assert.match(agentState.checksum, /^[0-9a-f]{8}$/u);

  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Published-level Jugar API is unavailable");
    // Keep the visual baseline on a deterministic live tick. The real
    // repository-authored Parkour board can legitimately finish its first
    // level before the old 175-tick sample, so use an early active tick.
    lab.reset();
    lab.step(50);
  });
  const liveCaptureState = await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.agentLab?.getState());
  assert.ok(liveCaptureState);
  assert.equal(liveCaptureState.tick, 50, `${definition.label} visual baseline must use a deterministic live tick`);
  assert.notEqual(liveCaptureState.metrics?.completed, true, `${definition.label} visual baseline must retain the active floor`);

  await prepareNativeJugarCapture(page);
  await page.evaluate(() => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Published-level Jugar API is unavailable");
    lab.setQualityTier("capture");
  });
  const performance = await assertJugarPerformanceBudget(page, "capture", true);
  const capture = await captureJugar3d(page, definition.baseline);
  await restoreJugarCaptureLayout(page);
  await page.getByRole("button", { name: "Floor", exact: true }).click();
  await page.locator(".ml-floor-interactive").waitFor({ state: "visible" });

  return {
    canonicalId: definition.canonicalId,
    levelId: floorFinished.snapshot.level,
    levelSlug: floorFinished.snapshot.levelSlug,
    floorCaptures: product === "parkour"
      ? ["countdown", "running", "finished"]
      : ["countdown", "running", "damaged", "finished"],
    jugarCapture: capture.surface,
    agentCount: agentState.agentCount,
    terminalTick: agentState.tick,
    checksum: agentState.checksum,
    performance: performanceSummary(performance)
  };
}

async function assertJugarPerformanceBudget(
  page: Page,
  qualityTier: BrowserJugarPerformance["qualityTier"],
  requireNativeFramebuffer = false
): Promise<BrowserJugarPerformance> {
  try {
    await page.waitForFunction(({ nativeFramebuffer, tier }) => {
      const performance = (window as BrowserPlaygroundWindow).ml?.agentLab?.getState().performance;
      return performance?.qualityTier === tier
        && performance.budgetReady
        && performance.withinBudget
        && (!nativeFramebuffer || performance.latest.framebufferMemoryProxyMegabytes >= 15);
    }, { nativeFramebuffer: requireNativeFramebuffer, tier: qualityTier }, {
      timeout: jugarPerformanceReadinessTimeoutMillis
    });
  } catch (cause) {
    const diagnostic = await page.evaluate(() => {
      const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
      const canvas = document.querySelector<HTMLCanvasElement>(".jugar-agent-surface canvas");
      return {
        canvas: canvas ? { clientHeight: canvas.clientHeight, clientWidth: canvas.clientWidth, height: canvas.height, width: canvas.width } : undefined,
        state: lab?.getState()
      };
    });
    throw new Error(
      `${qualityTier} Jugar diagnostics did not become ready: ${JSON.stringify(diagnostic)}`,
      { cause }
    );
  }
  const performance = await page.evaluate(() =>
    (window as BrowserPlaygroundWindow).ml?.agentLab?.getState().performance
  );
  assert.ok(performance, `${qualityTier} Jugar diagnostics must be published`);
  assert.equal(performance.schemaVersion, 1);
  assert.equal(performance.qualityTier, qualityTier);
  assert.ok(performance.samples >= performance.budget.minimumSamples);
  assert.ok(performance.latest.drawCalls > 0, "Jugar diagnostics must report real renderer draw calls");
  assert.ok(performance.latest.triangles > 0, "Jugar diagnostics must report real renderer triangles");
  assert.ok(performance.latest.geometries > 0, "Jugar diagnostics must report live GPU geometry count");
  assert.ok(performance.latest.gpuMemoryProxyMegabytes > 0, "Jugar diagnostics must report its GPU memory proxy");
  assert.equal(
    performance.structuralWithinBudget,
    true,
    `${qualityTier} structural budget failed: ${JSON.stringify(performance)}`
  );
  assert.equal(
    performance.withinBudget,
    true,
    `${qualityTier} complete budget failed: ${JSON.stringify(performance)}`
  );
  const structuralViolations = performance.violations.filter((violation) => violation !== "frame-time");
  assert.deepEqual(structuralViolations, []);
  assert.ok(performance.caveats.some((entry) => entry.includes("requestAnimationFrame")));
  assert.ok(performance.caveats.some((entry) => entry.includes("lower-bound proxy")));
  if (performance.environment?.softwareRenderer) {
    if (performance.timingBudgetWaived) {
      assert.ok(
        qualityTier === "capture",
        `${qualityTier} must not waive its software-CI timing ceiling: ${JSON.stringify(performance)}`
      );
    } else {
      assert.equal(
        performance.softwareTimingWithinBudget,
        true,
        `${qualityTier} software-CI timing ceiling failed: ${JSON.stringify(performance)}`
      );
    }
    assert.ok(performance.caveats.some((entry) => entry.includes("not venue-hardware certification")));
  } else {
    assert.deepEqual(performance.violations, []);
  }
  return performance;
}

function performanceSummary(performance: BrowserJugarPerformance) {
  return {
    qualityTier: performance.qualityTier,
    samples: performance.samples,
    p95FrameMillis: performance.p95FrameMillis,
    maxDrawCalls: performance.maxDrawCalls,
    maxTriangles: performance.maxTriangles,
    maxGeometries: performance.maxGeometries,
    maxTextures: performance.maxTextures,
    maxPrograms: performance.maxPrograms,
    maxGpuMemoryProxyMegabytes: performance.maxGpuMemoryProxyMegabytes,
    environment: performance.environment,
    caveats: performance.caveats
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
  await pressFloorZones(page, [[2, 2], [13, 29]]);
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
  await pressFloorZones(page, maxZones ?? []);
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
  await pressFloorZones(page, [[4, 16], [11, 16]]);
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
  await pressFloorZones(page, [[4, 16], [11, 16]]);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
    [0, 0], [7, 0], [14, 0], [14, 15], [14, 30], [7, 30], [0, 30], [0, 15]
  ];

  await page.locator(".control-game select").selectOption("suelo-seguro");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "suelo-seguro" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await captureStableNativeDisplay(page, "suelo-seguro-waiting");
  await pressFloorZones(page, maxPlayerZones);
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

  await page.evaluate((zones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.reset();
    api.resume();
    for (const [x, y] of zones) api.press(x, y);
    api.step((api.getState().snapshot.countdownMillis ?? 0) + 100);
    for (const [x, y] of zones) api.release(x, y);
    api.step(1_250);
    const target = api.getState().snapshot.targetPlatform;
    if (!target) throw new Error("Suelo Seguro has no target platform");
    api.press(target.x, target.y);
    api.release(target.x, target.y);
  }, maxPlayerZones);
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "round-win");
  await captureNativeDisplay(page, "suelo-seguro-round-win");
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    if (api.getState().snapshot.phase === "round-win") api.step(1_420);
    if (api.getState().snapshot.phase === "running") {
      api.step((api.getState().snapshot.turnRemainingMillis ?? 4_800) + 20);
    }
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "turn-fail");
  const damaged = await browserState(page);
  assert.equal(damaged.snapshot.lives, 3);
  await captureNativeDisplay(page, "suelo-seguro-damaged");

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
  await captureNativeDisplay(page, "suelo-seguro-finished-loss");

  await page.locator(".control-game select").selectOption("hello-world");
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().gameId === "hello-world");
  await page.locator(".control-game select").selectOption("suelo-seguro");
  await page.locator(".control-players select").selectOption("8");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "suelo-seguro" && state.playerCount === 8 && state.snapshot.phase === "waiting";
  });
  await pressFloorZones(page, maxPlayerZones);
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
      api.step(900);
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
  await captureNativeDisplay(page, "suelo-seguro-finished-win");
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZones(page, [[7, 3], [7, 28]]);
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

  await pressFloorZones(page, dueloFourPlayerZones);
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
  await pressFloorZones(page, dueloFourPlayerZones, 0);

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
  await pressFloorZones(page, [[0, 0], [4, 0], [8, 0], [12, 0]]);
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
  await pressFloorZones(page, dueloEightPlayerZones);
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
  await pressFloorZone(page, 8, 29);
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

  await pressFloorZone(page, 8, 4);
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

  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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
  await pressFloorZone(page, 8, 16);
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

  await pressFloorZones(page, dueloEightPlayerZones);
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
  await pressFloorZones(page, dueloEightPlayerZones, 0);
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

async function assertMomentaryFloorInput(page: Page): Promise<void> {
  await preparePlaygroundInput(page);
  const floor = page.locator(".ml-floor-interactive");
  const firstTile = floor.locator('[data-tile-x="7"][data-tile-y="3"]');
  const secondTile = floor.locator('[data-tile-x="7"][data-tile-y="28"]');
  const [firstBox, secondBox, floorBox] = await Promise.all([
    firstTile.boundingBox(),
    secondTile.boundingBox(),
    floor.boundingBox()
  ]);
  assert.ok(firstBox && secondBox && floorBox, "playground floor tiles must be visible for input testing");

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => (
    document.querySelector<HTMLElement>('.ml-floor-interactive [data-tile-x="7"][data-tile-y="3"]')?.getAttribute("aria-pressed") === "true"
  ));

  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.waitForFunction(() => (
    document.querySelector<HTMLElement>('.ml-floor-interactive [data-tile-x="7"][data-tile-y="3"]')?.getAttribute("aria-pressed") === "false"
      && document.querySelector<HTMLElement>('.ml-floor-interactive [data-tile-x="7"][data-tile-y="28"]')?.getAttribute("aria-pressed") === "true"
  ));

  await page.mouse.move(floorBox.x + floorBox.width + 20, floorBox.y + floorBox.height + 20);
  await page.waitForFunction(() => (
    document.querySelectorAll('.ml-floor-interactive [data-input-pressed="true"]').length === 0
  ));

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.waitForFunction(() => (
    document.querySelector<HTMLElement>('.ml-floor-interactive [data-tile-x="7"][data-tile-y="3"]')?.getAttribute("aria-pressed") === "true"
  ));
  await page.mouse.up();
  await page.waitForFunction(() => (
    document.querySelectorAll('.ml-floor-interactive [data-input-pressed="true"]').length === 0
  ));
  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.reset());
  await preparePlaygroundInput(page);
}

async function assertStablePhaseHeader(page: Page): Promise<void> {
  await page.locator(".control-game select").selectOption("ping-pong-v2");
  await page.waitForFunction(() => {
    const state = (window as BrowserPlaygroundWindow).ml?.getState();
    return state?.gameId === "ping-pong-v2" && state.snapshot.phase === "waiting";
  });

  const waiting = await playgroundHeaderLayout(page);
  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.press(7, 3);
    api.press(7, 28);
  });
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "starting");
  const starting = await playgroundHeaderLayout(page);

  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.step(2_000));
  await page.waitForFunction(() => (window as BrowserPlaygroundWindow).ml?.getState().snapshot.phase === "running");
  const running = await playgroundHeaderLayout(page);

  await page.evaluate(() => (window as BrowserPlaygroundWindow).ml?.pause());
  await page.waitForFunction(() => (
    (window as BrowserPlaygroundWindow).ml?.getState().paused === true
      && document.querySelector<HTMLElement>(".phase-chip")?.textContent?.trim() === "Paused"
  ));
  const paused = await playgroundHeaderLayout(page);

  const layouts = [waiting, starting, running, paused];
  assert.ok(new Set(layouts.map((layout) => layout.phase)).size >= 3, "the browser gate must exercise changing phase labels");
  for (const layout of layouts) {
    assert.equal(layout.phaseSlot.width, waiting.phaseSlot.width, `${layout.phase} phase slot width changed`);
    assert.equal(layout.phaseSlot.x, waiting.phaseSlot.x, `${layout.phase} phase slot moved`);
    assert.equal(layout.controls.x, waiting.controls.x, `${layout.phase} header controls moved`);
    assert.equal(layout.controls.width, waiting.controls.width, `${layout.phase} header controls resized`);
    assert.equal(layout.surface.x, waiting.surface.x, `${layout.phase} surface controls moved`);
    assert.equal(layout.surface.width, waiting.surface.width, `${layout.phase} surface controls resized`);
  }

  await page.evaluate(() => {
    const api = (window as BrowserPlaygroundWindow).ml;
    api?.resume();
    api?.reset();
  });
  await preparePlaygroundInput(page);
}

async function playgroundHeaderLayout(page: Page): Promise<{
  controls: { width: number; x: number };
  phase: string;
  phaseSlot: { width: number; x: number };
  surface: { width: number; x: number };
}> {
  return page.evaluate(() => {
    const phase = document.querySelector<HTMLElement>(".phase-chip");
    const controls = document.querySelector<HTMLElement>(".playground-controls");
    const surface = document.querySelector<HTMLElement>(".surface-toolbar");
    if (!phase || !controls || !surface) throw new Error("playground header layout is not rendered");
    const phaseRect = phase.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    return {
      controls: { width: controlsRect.width, x: controlsRect.x },
      phase: phase.textContent?.trim() ?? "",
      phaseSlot: { width: phaseRect.width, x: phaseRect.x },
      surface: { width: surfaceRect.width, x: surfaceRect.x }
    };
  });
}

async function pressFloorZone(page: Page, x: number, y: number): Promise<void> {
  await preparePlaygroundInput(page);
  await page.evaluate(([tileX, tileY]: [number, number]) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    api.press(tileX, tileY);
  }, [x, y] as [number, number]);
}

async function pressFloorZones(page: Page, zones: Array<[number, number]>, delayMillis = 180): Promise<void> {
  await preparePlaygroundInput(page);
  await page.evaluate((nextZones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (const [x, y] of nextZones) api.press(x, y);
  }, zones);
  if (delayMillis > 0) {
    await page.waitForTimeout(delayMillis);
    return;
  }
  await page.evaluate((nextZones) => {
    const api = (window as BrowserPlaygroundWindow).ml;
    if (!api) throw new Error("window.ml is not ready");
    for (const [x, y] of nextZones) api.release(x, y);
  }, zones);
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

async function prepareNativeJugarCapture(page: Page): Promise<void> {
  await page.locator(".jugar-agent-surface").evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      borderRadius: "0",
      height: "1080px",
      left: "0",
      position: "fixed",
      top: "0",
      width: "1920px",
      zIndex: "2147483646"
    });
    const viewport = element.querySelector<HTMLElement>(".agent-lab-viewport");
    if (viewport) {
      Object.assign(viewport.style, {
        borderBottomWidth: "0",
        height: "1080px",
        width: "1920px"
      });
    }
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".jugar-agent-surface canvas");
    return (canvas?.width ?? 0) >= 1_920 && (canvas?.height ?? 0) >= 1_080;
  }, undefined, { timeout: 10_000 });
  const dimensions = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".jugar-agent-surface canvas");
    const bounds = canvas?.getBoundingClientRect();
    return {
      bufferWidth: canvas?.width ?? 0,
      bufferHeight: canvas?.height ?? 0,
      cssWidth: bounds?.width ?? 0,
      cssHeight: bounds?.height ?? 0,
      devicePixelRatio: window.devicePixelRatio
    };
  });
  assert.ok(
    dimensions.bufferWidth >= 1_920 && dimensions.bufferHeight >= 1_080,
    `Jugar capture buffer must be at least 1920x1080; received ${JSON.stringify(dimensions)}`
  );
  await page.waitForTimeout(100);
}

async function waitForJugarFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function restoreJugarCaptureLayout(page: Page): Promise<void> {
  await page.locator(".jugar-agent-surface").evaluate((element) => {
    element.removeAttribute("style");
    element.querySelector(".agent-lab-viewport")?.removeAttribute("style");
  });
  await page.waitForTimeout(100);
}

async function captureJugar3d(page: Page, name: string): Promise<BrowserPlaygroundCapture> {
  const capture = await page.evaluate(async () => {
    const lab = (window as BrowserPlaygroundWindow).ml?.agentLab;
    if (!lab) throw new Error("Duelo Jugar 3D API is unavailable");
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
  await verifyJugarVisualBaseline(page, capture, name);
  return capture;
}

async function verifyJugarVisualBaseline(
  page: Page,
  capture: BrowserPlaygroundCapture,
  name: string
): Promise<void> {
  if (!jugarVisualBaselineNames.has(name)) return;
  const currentBytes = Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const baselinePath = path.join(jugarVisualBaselineDirectory, `${name}.png`);
  if (updateJugarVisualBaselines) {
    await mkdir(jugarVisualBaselineDirectory, { recursive: true });
    await writeFile(baselinePath, currentBytes);
    return;
  }

  let baselineBytes: Buffer;
  try {
    baselineBytes = await readFile(baselinePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing Jugar 3D visual baseline ${baselinePath}: ${reason}`, { cause: error });
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
  const evaluation = evaluateVisualRegression(stats, JUGAR_3D_VISUAL_THRESHOLDS);
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
