import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Locator } from "playwright";

const repoRoot = process.cwd();
const playgroundPort = Number(process.env.MOTION_LEVELS_DEV_VENUE_PORT || 4104);
const apiPort = Number(process.env.MOTION_LEVELS_DEV_VENUE_API_PORT || 4102);
const playgroundURL = `http://127.0.0.1:${playgroundPort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const output: string[] = [];
const sessionHistoryDir = await mkdtemp(path.join(tmpdir(), "motion-levels-dev-venue-"));
const devVenue = spawn(npmCommand, ["run", "dev:venue:no-controller"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MOTION_LEVELS_PLAYGROUND_PORT: String(playgroundPort),
    MOTION_LEVELS_ENGINE_HTTP: `127.0.0.1:${apiPort}`,
    MOTION_LEVELS_SESSION_HISTORY_DIR: sessionHistoryDir,
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

  let healthPayload: { status?: string; controllerConnected?: boolean } = {};
  await waitFor(async () => {
    const health = await fetch(`${playgroundURL}/api/health`);
    if (health.status !== 200) return false;
    healthPayload = await health.json() as { status?: string; controllerConnected?: boolean };
    return healthPayload.status === "ok" && healthPayload.controllerConnected === true;
  }, devVenue, "the venue health endpoint");
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.controllerConnected, true, "no-controller mode must provide the mock controller");

  const playerMenu = await fetch(`${playgroundURL}/player-menu/`);
  assert.equal(playerMenu.status, 200, "the player-menu entry point must be served by the same dev command");
  assert.match(await playerMenu.text(), /Motion Levels Player Menu/u);

  const directAPI = await fetch(`${apiURL}/api/health`);
  assert.equal(directAPI.status, 200, "the venue API must remain available beside the playground");

  await verifyIntegratedLaunchDoesNotNavigate();
  console.log(`Dev venue smoke passed: ${playgroundURL}/ and ${apiURL}/api/health`);
} finally {
  await stop(devVenue);
  await rm(sessionHistoryDir, { recursive: true, force: true });
}

async function verifyIntegratedLaunchDoesNotNavigate(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const initialURL = `${playgroundURL}/?screen=menu`;
    const mainNavigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) mainNavigations.push(frame.url());
    });

    await page.goto(initialURL, { waitUntil: "domcontentloaded" });
    const menu = page.frameLocator('iframe[title="Player menu"]');
    // VenueRuntime owns the kiosk visit/session, so a freshly mounted menu
    // either hydrates directly into its browse screen or shows the normal
    // production welcome action until that runtime visit is started.
    await menu.locator(".welcome-screen, main.app").first().waitFor({ state: "visible" });
    if (await menu.locator(".welcome-screen").isVisible()) {
      await menu.getByRole("button", { name: "Comenzar" }).click();
    }
    await menu.getByRole("button", { name: "Abrir equipo" }).waitFor({ state: "visible" });
    if (await menu.getByRole("button", { name: "Abrir equipo" }).getAttribute("aria-expanded") !== "true") {
      await menu.getByRole("button", { name: "Abrir equipo" }).click();
    }
    await menu.locator(".team-drawer .drawer-done").click();

    // Ambiente cards intentionally launch on selection. This must switch the
    // already-rendered display in memory instead of reloading the workbench.
    await menu.getByRole("button", { name: "Ambiente", exact: true }).click();
    await assertUsableDetailPreview(menu.locator(".detail-preview .preview"), "no-controller ambient default");
    const ambientAnimation = menu.locator('.game-card[data-game-id="animation-aurora"]');
    await ambientAnimation.click();
    await assertTransparentLaunch(page, initialURL, mainNavigations, "ambient animation");

    // A regular game uses its explicit play action. The menu remains mounted
    // and derives its active screen from the same runtime snapshot.
    await menu.getByRole("button", { name: "Individual", exact: true }).click();
    const regularGame = menu.locator('.game-card[data-game-id="arkanoid"]');
    await regularGame.waitFor({ state: "visible" });
    await regularGame.click();
    await assertUsableDetailPreview(menu.locator(".detail-preview .preview"), "no-controller regular game");
    const play = menu.locator(".launch-actions button.play");
    await play.waitFor({ state: "visible" });
    await play.click();
    await assertTransparentLaunch(page, initialURL, mainNavigations, "regular game");

    await menu.locator("main.app.playing").waitFor({ state: "visible" });
    await page.locator('button[title="Player display"]').click();
    await page.locator(".player-menu-preview-frame").waitFor({ state: "detached" });
    await waitForRuntimeState(page, "arkanoid", false);
    await pressRuntimeZone(page, 7, 30);
    await waitForRuntimeState(page, "arkanoid", false, "running");

    // Returning to the menu pauses the authoritative runtime. Remounting the
    // iframe must recover the active paused game, not the welcome/browse view.
    await page.locator('button[title="Player menu"]').click();
    const reopenedMenu = page.frameLocator('iframe[title="Player menu"]');
    await reopenedMenu.locator("main.app.playing").waitFor({ state: "visible" });
    await waitForRuntimeState(page, "arkanoid", true);
    assert.equal(await reopenedMenu.locator(".welcome-screen").count(), 0, "returning to menu must not show Welcome");
    assert.equal(await reopenedMenu.locator("main.app.playing").count(), 1, "returning to menu must show active game controls");

    // A second unmount/remount must preserve the same runtime-derived screen.
    await page.locator('button[title="Player display"]').click();
    await page.locator(".player-menu-preview-frame").waitFor({ state: "detached" });
    await waitForRuntimeState(page, "arkanoid", false);
    await page.locator('button[title="Player menu"]').click();
    const remountedMenu = page.frameLocator('iframe[title="Player menu"]');
    await remountedMenu.locator("main.app.playing").waitFor({ state: "visible" });
    await waitForRuntimeState(page, "arkanoid", true);
  } finally {
    await browser.close();
  }
}

async function assertUsableDetailPreview(preview: Locator, label: string): Promise<void> {
  const geometry = await preview.evaluate((element) => {
    const media = element.querySelector<HTMLElement>(".preview-media-frame, canvas.floor-canvas");
    if (!media) throw new Error("selected game preview is missing its media frame");
    return {
      width: media.offsetWidth,
      height: media.offsetHeight,
      aspect: media.offsetHeight > 0 ? media.offsetWidth / media.offsetHeight : 0,
    };
  });
  const evidence = `${label}: ${JSON.stringify(geometry)}`;
  assert.ok(geometry.width >= 180, `${label} must not collapse to a tiny thumbnail: ${evidence}`);
  assert.ok(geometry.height >= 80, `${label} must occupy a useful height: ${evidence}`);
  assert.ok(Math.abs(geometry.aspect - 2) <= 0.05, `${label} must retain the canonical 2:1 board aspect ratio: ${evidence}`);
}

async function assertTransparentLaunch(page: import("playwright").Page, initialURL: string, mainNavigations: string[], label: string): Promise<void> {
  assert.equal(page.url(), initialURL, `${label} must not navigate the playground document`);
  assert.deepEqual(mainNavigations, [initialURL], `${label} must not add a full-page navigation`);
  assert.equal(await page.locator("#app-loading-screen").count(), 0, `${label} must not show the boot loading screen`);
  assert.equal(await page.locator(".display-preview-native .ml-display-shell").count(), 1, `${label} must keep the display mounted`);
  assert.equal(await page.locator(".playground-floor-preview").count(), 1, `${label} must keep the floor preview mounted`);
}

async function waitForRuntimeState(
  page: import("playwright").Page,
  currentGame: string,
  paused: boolean,
  phase?: string,
): Promise<void> {
  await page.waitForFunction(async ({ expectedGame, expectedPaused, expectedPhase }) => {
    const response = await fetch(`/api/player-state?wait=${Date.now()}`, { cache: "no-store" });
    const state = await response.json() as { currentGame?: string; paused?: boolean; phase?: string };
    const runtimeGame = String(state.currentGame || "").replace(/^motion-levels-games:/u, "");
    return runtimeGame === expectedGame
      && state.paused === expectedPaused
      && (expectedPhase === undefined || state.phase === expectedPhase);
  }, { expectedGame: currentGame, expectedPaused: paused, expectedPhase: phase });
}

async function pressRuntimeZone(page: import("playwright").Page, x: number, y: number): Promise<void> {
  const clientId = await page.evaluate(() => crypto.randomUUID());
  await page.evaluate(async ({ clientId: nextClientId, x: tileX, y: tileY }) => {
    const response = await fetch("/api/floor-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        clientId: nextClientId,
        clientSequence: 1,
        changes: [{ x: tileX, y: tileY, pressed: true }],
      }),
    });
    if (!response.ok) throw new Error(`floor input returned HTTP ${response.status}`);
  }, { clientId, x, y });
  await page.waitForTimeout(2_100);
  await page.evaluate(async ({ clientId: nextClientId, x: tileX, y: tileY }) => {
    const response = await fetch("/api/floor-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        clientId: nextClientId,
        clientSequence: 2,
        changes: [{ x: tileX, y: tileY, pressed: false }],
      }),
    });
    if (!response.ok) throw new Error(`floor input release returned HTTP ${response.status}`);
  }, { clientId, x, y });
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
