import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { beginVenueHttpShutdown, createVenueHttpServer } from "../apps/venue-runtime/src/httpServer.ts";
import { VenueRuntime } from "../apps/venue-runtime/src/venueRuntime.ts";

const repoRoot = process.cwd();
const revision = "1".repeat(40);
const menuPort = Number(process.env.MOTION_LEVELS_PLAYER_MENU_SYNC_PORT || 4177);
const menuURL = `http://127.0.0.1:${menuPort}/?remoteControl=1`;
const runtime = new VenueRuntime({
  sourceRevision: revision,
  controllerAddress: "127.0.0.1:4201",
});
const engine = createVenueHttpServer(runtime);
engine.listen(0, "127.0.0.1");
await once(engine, "listening");
const address = engine.address();
assert.ok(address && typeof address === "object");
const engineURL = `http://127.0.0.1:${address.port}`;

const viteEntry = path.join(repoRoot, "node_modules/vite/bin/vite.js");
const menuServer = spawn(
  process.execPath,
  [viteEntry, "--host", "127.0.0.1", "--port", String(menuPort), "--strictPort"],
  {
    cwd: path.join(repoRoot, "apps/player-menu"),
    env: { ...process.env, VITE_GAME_ENGINE_URL: engineURL },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
menuServer.stdout?.on("data", (chunk) => process.stderr.write(chunk));
menuServer.stderr?.on("data", (chunk) => process.stderr.write(chunk));

let browser: Browser | undefined;
let firstContext: BrowserContext | undefined;
let secondContext: BrowserContext | undefined;

try {
  await waitForServer(menuURL, menuServer);
  browser = await chromium.launch({ headless: true });
  firstContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await installCatalogFallback(firstContext);
  await installCatalogFallback(secondContext);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await Promise.all([openMenu(first), openMenu(second)]);

  await waitFor(async () => (await menuState()).activeClients === 2, "two live menu subscribers");

  await first.getByRole("button", { name: "Comenzar" }).click();
  const firstTeam = first.locator(".team-drawer");
  const secondTeam = second.locator(".team-drawer");
  await firstTeam.waitFor({ state: "visible" });
  try {
    await waitFor(async () => await secondTeam.getAttribute("aria-hidden") === "false", "shared team drawer open");
  } catch (error) {
    throw new Error(`second client did not mirror the team drawer: ${JSON.stringify({
      canonical: await menuState(),
      first: await menuEvidence(first),
      second: await menuEvidence(second),
    })}`, { cause: error });
  }
  assert.equal(await second.getByRole("button", { name: "Comenzar" }).count(), 0, "both clients must leave welcome together");

  await secondTeam.locator(".drawer-done").click();
  await waitFor(async () => await firstTeam.getAttribute("aria-hidden") === "true", "shared team drawer close");

  await first.getByRole("button", { name: "Arcade", exact: true }).click();
  await waitFor(
    async () => await second.getByRole("button", { name: "Arcade", exact: true }).getAttribute("aria-pressed") === "true",
    "shared category selection",
  );

  const selectedGameID = await first.locator('.game-card[aria-pressed="true"]').getAttribute("data-game-id");
  assert.ok(selectedGameID, "the canonical category must select a game");
  await waitFor(
    async () => await second.locator('.game-card[aria-pressed="true"]').getAttribute("data-game-id") === selectedGameID,
    "shared game selection",
  );

  const canonical = await menuState();
  assert.equal(canonical.activeClients, 2);
  assert.equal(canonical.snapshot?.screen, "browse");
  assert.equal(canonical.snapshot?.menu.category, "arcade");
  assert.equal(canonical.snapshot?.menu.selectedGame, selectedGameID);
  assert.equal(canonical.snapshot?.view.teamOpen, false);
  assert.equal(canonical.version > 0, true);

  await Promise.all([first.waitForTimeout(800), second.waitForTimeout(800)]);
  await Promise.all([
    first.locator('.game-card[aria-pressed="true"] h3').waitFor({ state: "visible" }),
    second.locator('.game-card[aria-pressed="true"] h3').waitFor({ state: "visible" }),
    first.getByRole("group", { name: "Dificultad" }).waitFor({ state: "visible" }),
    second.getByRole("group", { name: "Dificultad" }).waitFor({ state: "visible" }),
  ]);
  await first.screenshot({ path: "/tmp/player-menu-sync-first.png", fullPage: true });
  await second.screenshot({ path: "/tmp/player-menu-sync-second.png", fullPage: true });

  await secondContext.close();
  secondContext = undefined;
  await waitFor(async () => (await menuState()).activeClients === 1, "subscriber disconnect");

  process.stdout.write(`ok - two menu clients share screen, panel, category and game at revision ${canonical.version}\n`);
} finally {
  await secondContext?.close().catch(() => {});
  await firstContext?.close().catch(() => {});
  await browser?.close().catch(() => {});
  stopProcess(menuServer);
  const shutdown = beginVenueHttpShutdown(engine);
  await shutdown.mutationsDrained;
  await runtime.stop();
  await shutdown.serverClosed;
}

type CanonicalMenuState = {
  activeClients: number;
  version: number;
  snapshot: null | {
    menu: { category: string; selectedGame: string };
    screen?: string;
    view: { teamOpen: boolean };
  };
};

async function menuState(): Promise<CanonicalMenuState> {
  const response = await fetch(`${engineURL}/api/menu-state`, { cache: "no-store" });
  assert.equal(response.ok, true, `menu state request failed with ${response.status}`);
  return await response.json() as CanonicalMenuState;
}

async function installCatalogFallback(context: BrowserContext) {
  await context.route("**/api/game-catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ games: [] }),
  }));
}

async function openMenu(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(menuURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Comenzar" }).waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
}

async function menuEvidence(page: Page) {
  return await page.evaluate(() => ({
    selectedCategory: document.querySelector<HTMLElement>('.category-tabs [aria-pressed="true"]')?.innerText.trim() || "",
    selectedGame: document.querySelector<HTMLElement>('.game-card[aria-pressed="true"]')?.dataset.gameId || "",
    teamOpen: document.querySelector(".team-drawer")?.getAttribute("aria-hidden") || "missing",
    welcome: Boolean(document.querySelector(".welcome-app")),
  }));
}

async function waitForServer(url: string, process: ChildProcess) {
  await waitFor(async () => {
    if (process.exitCode !== null) throw new Error(`player-menu server exited with ${process.exitCode}`);
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }, "player-menu server", 10_000);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMillis = 8_000) {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function stopProcess(process: ChildProcess) {
  if (process.exitCode === null && process.signalCode === null) process.kill("SIGTERM");
}
