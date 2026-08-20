import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Locator } from "playwright";

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

  await verifyIntegratedLaunchDoesNotNavigate();
  console.log(`Dev venue smoke passed: ${playgroundURL}/ and ${apiURL}/api/health`);
} finally {
  await stop(devVenue);
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
    await menu.getByRole("button", { name: "Comenzar" }).click();
    await menu.getByRole("button", { name: "Abrir equipo" }).waitFor({ state: "visible" });
    await menu.locator(".team-drawer .drawer-done").click();

    // Ambiente cards intentionally launch on selection. This must switch the
    // already-rendered display in memory instead of reloading the workbench.
    await menu.getByRole("button", { name: "Ambiente", exact: true }).click();
    await assertUsableDetailPreview(menu.locator(".detail-preview .preview"), "no-controller ambient default");
    const ambientAnimation = menu.locator('.game-card[data-game-id="animation-aurora"]');
    await ambientAnimation.click();
    await page.locator(".player-menu-preview-frame").waitFor({ state: "detached" });
    await assertTransparentLaunch(page, initialURL, mainNavigations, "ambient animation");

    // A regular game uses its explicit play action, but must take the same
    // in-memory path and preserve the floor/display surfaces.
    await page.locator('button[title="Player menu"]').click();
    const reopenedMenu = page.frameLocator('iframe[title="Player menu"]');
    await reopenedMenu.getByRole("button", { name: "Abrir equipo" }).waitFor({ state: "visible" });
    const reopenedDrawer = reopenedMenu.locator(".team-drawer");
    if (await reopenedDrawer.getAttribute("aria-hidden") === "false") {
      await reopenedDrawer.locator(".drawer-done").click();
    }
    await reopenedMenu.getByRole("button", { name: "Destacados", exact: true }).click();
    const regularGame = reopenedMenu.locator('.game-card[data-game-id="arkanoid"]');
    await regularGame.waitFor({ state: "visible" });
    await regularGame.click();
    await assertUsableDetailPreview(reopenedMenu.locator(".detail-preview .preview"), "no-controller regular game");
    const play = reopenedMenu.locator(".launch-actions button.play");
    await play.waitFor({ state: "visible" });
    await play.click();
    await page.locator(".player-menu-preview-frame").waitFor({ state: "detached" });
    await assertTransparentLaunch(page, initialURL, mainNavigations, "regular game");
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
