import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

type FixtureRevision = "a" | "b";

type RequestObservation = {
  cacheControl: string;
  pragma: string;
  url: string;
};

type FixtureState = {
  documentRevision: FixtureRevision;
  indexRequests: RequestObservation[];
  manifestRequests: RequestObservation[];
  manifestRevision: FixtureRevision;
  playerStateRequests: RequestObservation[];
  runtimeRevision: FixtureRevision;
  runtimeSequence: number;
};

type UpdateTelemetry = {
  documents: number;
  overlays: string[];
  phases: string[];
  urls: string[];
};

const sourceRevisions: Record<FixtureRevision, string> = {
  a: "a".repeat(40),
  b: "b".repeat(40),
};
const repoRoot = process.cwd();
const viteEntry = path.join(repoRoot, "node_modules/vite/bin/vite.js");
const pollMillis = Math.max(50, Number(process.env.MOTION_LEVELS_PLAYER_MENU_UPDATE_POLL_MILLIS || 100));
const viewportWidth = Number(process.env.MOTION_LEVELS_PLAYER_MENU_UPDATE_WIDTH || 1920);
const viewportHeight = Number(process.env.MOTION_LEVELS_PLAYER_MENU_UPDATE_HEIGHT || 1080);
const captureScreenshots = process.env.MOTION_LEVELS_PLAYER_MENU_UPDATE_SCREENSHOTS === "1";
const originalQuery = new URLSearchParams([
  ["keep", "reservation value"],
  ["e2e_note", "browser-update"],
]);
const originalHash = "#preserved-anchor";
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "motion-levels-player-menu-update-"));
const fixtureRoots: Record<FixtureRevision, string> = {
  a: path.join(temporaryRoot, "menu-a"),
  b: path.join(temporaryRoot, "menu-b"),
};

let browser: Browser | undefined;
let fixtureServer: Server | undefined;
const failures: string[] = [];

try {
  for (const revision of ["a", "b"] as const) {
    await buildMenuFixture(revision, fixtureRoots[revision]);
  }

  const state = newFixtureState();
  fixtureServer = createFixtureServer(state, fixtureRoots);
  const baseURL = await listen(fixtureServer);
  browser = await chromium.launch({ headless: true });

  await scenario(browser, "runtime-first update blocks until files arrive, then reloads once", state, async ({ page }) => {
    await openMatchingMenu(page, baseURL);
    state.runtimeRevision = "b";
    state.runtimeSequence += 1;

    const waiting = page.locator('[data-menu-update-gate][data-update-phase="waiting-for-files"]');
    await waiting.waitFor({ state: "visible" });
    await assertBlockingOverlay(page, "waiting-for-files", "Hay una nueva versión", "Estamos preparando el menú actualizado. No apagues la sala.");
    await assertVisibleOrbitAnimation(page);
    await captureUpdateScreenshot(page, "waiting");
    assert.equal(await page.locator("[data-menu-update-content]").getAttribute("inert"), "", "waiting update must inert menu actions");
    assert.equal((await readTelemetry(page)).documents, 1, "runtime-first mismatch must not reload before matching files exist");

    state.documentRevision = "b";
    state.manifestRevision = "b";
    if (captureScreenshots) {
      await page.locator('[data-menu-update-gate][data-update-phase="reloading"]').waitFor({ state: "visible" });
      await captureUpdateScreenshot(page, "reloading");
    }
    await assertSuccessfulUpdate(page, state, 2);
  });

  await scenario(browser, "static-first update stages silently until runtime arrives, then reloads once", state, async ({ page }) => {
    await openMatchingMenu(page, baseURL);
    const manifestRequestsBeforeStaging = state.manifestRequests.length;
    state.documentRevision = "b";
    state.manifestRevision = "b";

    await waitForCondition(
      () => state.manifestRequests.length >= manifestRequestsBeforeStaging + 2,
      "the menu to poll the staged manifest twice",
    );
    await page.waitForTimeout(pollMillis * 4);
    assert.equal(await page.locator('[data-menu-update-gate][data-update-phase="idle"]').count(), 1);
    assert.equal(await page.locator("[data-menu-update-overlay]").count(), 0, "static-first staging must not block an old matching runtime");
    assert.equal((await readTelemetry(page)).documents, 1, "static-first staging must not reload before runtime advances");

    state.runtimeRevision = "b";
    state.runtimeSequence += 1;
    await assertSuccessfulUpdate(page, state, 2);
  });

  await scenario(browser, "a persistently stale document fails closed after at most two automatic reloads", state, async ({ page }) => {
    await openMatchingMenu(page, baseURL);
    state.manifestRevision = "b";
    state.runtimeRevision = "b";
    state.runtimeSequence += 1;
    // Deliberately keep serving document/assets A. This models a stale CDN or
    // web boundary whose manifest and runtime have advanced independently.
    state.documentRevision = "a";

    const failed = page.locator('[data-menu-update-gate][data-update-phase="failed"]');
    await failed.waitFor({ state: "visible", timeout: 10_000 });
    await assertBlockingOverlay(
      page,
      "failed",
      "No se pudo completar la actualización",
      "El menú sigue bloqueado para evitar acciones incompatibles.",
    );
    await page.locator("[data-menu-update-retry]").waitFor({ state: "visible" });
    const telemetryAtFailure = await readTelemetry(page);
    const automaticReloads = telemetryAtFailure.documents - 1;
    assert.ok(automaticReloads >= 1, "a stale document must attempt at least one automatic recovery navigation");
    assert.ok(automaticReloads <= 2, `anti-loop guard allowed ${automaticReloads} automatic reloads`);
    assertOriginalLocationPreserved(telemetryAtFailure.urls);
    assert.equal(await page.locator("[data-menu-update-content]").getAttribute("inert"), "", "failed update must remain fail-closed");

    await page.waitForTimeout(pollMillis * 8);
    const telemetryAfterWait = await readTelemetry(page);
    assert.equal(
      telemetryAfterWait.documents,
      telemetryAtFailure.documents,
      "failed update must not start another automatic reload loop",
    );
  });

  if (failures.length === 0) assertCacheBypass(state);
} finally {
  await browser?.close();
  await closeServer(fixtureServer);
  await rm(temporaryRoot, { force: true, recursive: true });
}

if (failures.length > 0) {
  throw new Error(`player-menu update browser checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

async function scenario(
  activeBrowser: Browser,
  name: string,
  state: FixtureState,
  run: (fixture: { context: BrowserContext; page: Page }) => Promise<void>,
): Promise<void> {
  resetFixtureState(state);
  const context = await activeBrowser.newContext({
    reducedMotion: "no-preference",
    viewport: { height: viewportHeight, width: viewportWidth },
  });
  await installNavigationTelemetry(context);
  const page = await context.newPage();
  page.setDefaultTimeout(6_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  try {
    await run({ context, page });
    assert.deepEqual(pageErrors, [], "update flow must not raise a browser error");
    assert.equal((await page.locator("body").innerText()).trim().length > 0, true, "updated menu must not be blank");
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failures.push(`${name}: ${message}`);
    process.stdout.write(`not ok - ${name}\n${indent(message)}\n`);
  } finally {
    await context.close();
  }
}

async function openMatchingMenu(page: Page, baseURL: string): Promise<void> {
  const target = new URL("/menu/", baseURL);
  target.search = originalQuery.toString();
  target.hash = originalHash;
  await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  const gate = page.locator("[data-menu-update-gate]");
  await gate.waitFor({ state: "visible" });
  try {
    await page.locator('[data-menu-update-gate][data-update-phase="idle"]').waitFor({ state: "visible" });
  } catch (error) {
    const evidence = await page.evaluate(async () => {
      const [manifest, runtime] = await Promise.all([
        fetch(`build.json?diagnostic=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()),
        fetch(`/engine/api/player-state?diagnostic=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()),
      ]);
      return {
        body: document.body.innerText.replace(/\s+/gu, " ").slice(0, 800),
        manifest,
        phase: document.querySelector<HTMLElement>("[data-menu-update-gate]")?.dataset.updatePhase,
        runtime,
        url: location.href,
      };
    });
    throw new Error(`matching fixture did not become idle: ${JSON.stringify(evidence)}`, { cause: error });
  }
  await page.getByRole("button", { name: "Comenzar" }).waitFor({ state: "visible" });
  assert.equal((await readTelemetry(page)).documents, 1);
  assertCurrentLocationPreserved(page.url());
}

async function assertSuccessfulUpdate(page: Page, state: FixtureState, expectedDocuments: number): Promise<void> {
  await waitForCondition(
    () => state.indexRequests.length === expectedDocuments,
    `${expectedDocuments - 1} automatic update navigation`,
    10_000,
  );
  await page.locator('[data-menu-update-gate][data-update-phase="updated"]').waitFor({ state: "visible", timeout: 10_000 });
  await assertBlockingOverlay(page, "updated", "Menú actualizado", "Ya estás usando la última versión.");
  await captureUpdateScreenshot(page, "updated");
  assert.equal(await page.locator("[data-menu-update-content]").getAttribute("inert"), "", "success transition must stay inert until verification is complete");
  await page.locator('[data-menu-update-gate][data-update-phase="idle"]').waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await page.locator("[data-menu-update-overlay]").count(), 0, "successful update must remove its blocking overlay");
  assert.equal(await page.locator("[data-menu-update-content]").getAttribute("inert"), null, "successful update must restore menu actions");
  await page.getByRole("button", { name: "Comenzar" }).waitFor({ state: "visible" });

  const telemetry = await readTelemetry(page);
  assert.equal(telemetry.documents, expectedDocuments, "successful update must perform exactly one reload");
  assert.ok(telemetry.phases.includes("reloading"), `missing visible reloading phase: ${JSON.stringify(telemetry)}`);
  assert.ok(telemetry.phases.includes("updated"), `missing visible updated phase: ${JSON.stringify(telemetry)}`);
  assert.ok(telemetry.overlays.some((copy) => copy.includes("Actualizando el menú")), `missing updating overlay copy: ${JSON.stringify(telemetry.overlays)}`);
  assert.ok(telemetry.overlays.some((copy) => copy.includes("Menú actualizado")), `missing success overlay copy: ${JSON.stringify(telemetry.overlays)}`);
  assertOriginalLocationPreserved(telemetry.urls);
  assertCurrentLocationPreserved(page.url());
  const currentURL = new URL(page.url());
  assert.equal(currentURL.searchParams.has("__ml_menu_revision"), false, "successful verification must clean its menu marker");
  assert.equal(currentURL.searchParams.has("__ml_games_revision"), false, "successful verification must clean its games marker");
  assert.equal(currentURL.searchParams.has("__ml_update_attempt"), false, "successful verification must clean its attempt marker");
  assert.equal(state.indexRequests.length, expectedDocuments, "server must observe one HTML request per document");
  const build = await page.evaluate(async () => {
    const response = await fetch(`build.json?e2e=${Date.now()}`, { cache: "no-store" });
    return response.json() as Promise<{ gamesSourceRevision?: string }>;
  });
  assert.equal(build.gamesSourceRevision, sourceRevisions.b);
}

async function assertBlockingOverlay(page: Page, phase: string, title: string, copy: string): Promise<void> {
  const overlay = page.locator(`[data-menu-update-overlay][data-update-phase="${phase}"]`);
  await overlay.waitFor({ state: "visible" });
  const text = compactWhitespace(await overlay.innerText());
  assert.ok(text.includes(title), `update overlay is missing title ${JSON.stringify(title)}: ${JSON.stringify(text)}`);
  assert.ok(text.includes(copy), `update overlay is missing copy ${JSON.stringify(copy)}: ${JSON.stringify(text)}`);
}

async function assertVisibleOrbitAnimation(page: Page): Promise<void> {
  const orbit = page.locator(".menu-update-orbit span");
  const before = await orbit.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      animationName: style.animationName,
      height: bounds.height,
      opacity: style.opacity,
      transform: style.transform,
      width: bounds.width,
    };
  });
  assert.ok(before.width > 0 && before.height > 0, `update orbit must occupy visible space: ${JSON.stringify(before)}`);
  assert.notEqual(before.opacity, "0", `update orbit must be visible: ${JSON.stringify(before)}`);
  assert.ok(before.animationName.includes("menuUpdateOrbit"), `update orbit animation is not active: ${JSON.stringify(before)}`);
  assert.equal(before.animationIterationCount, "infinite");
  await page.waitForTimeout(160);
  const afterTransform = await orbit.evaluate((element) => getComputedStyle(element).transform);
  assert.notEqual(afterTransform, before.transform, "update orbit must visibly advance between browser frames");
}

function assertCacheBypass(state: FixtureState): void {
  assert.ok(state.manifestRequests.length >= 2, "update gate must poll build.json more than once");
  for (const request of state.manifestRequests) {
    const url = new URL(request.url, "http://fixture.test");
    assert.notEqual(url.search, "", `build.json request needs a cache-busting query: ${request.url}`);
    assert.ok(
      /no-cache|no-store/u.test(request.cacheControl) || request.pragma.includes("no-cache"),
      `build.json request must bypass browser caches: ${JSON.stringify(request)}`,
    );
  }
  assert.ok(state.playerStateRequests.length > 0, "update gate must compare the manifest with player-state runtime");
  assert.ok(
    state.playerStateRequests.some((request) => /no-cache|no-store/u.test(request.cacheControl) || request.pragma.includes("no-cache")),
    "player-state update checks must bypass browser caches",
  );
}

function assertOriginalLocationPreserved(urls: string[]): void {
  assert.ok(urls.length > 0);
  for (const url of urls) assertCurrentLocationPreserved(url);
}

function assertCurrentLocationPreserved(value: string): void {
  const url = new URL(value);
  for (const [key, expected] of originalQuery) {
    assert.equal(url.searchParams.get(key), expected, `update navigation lost query parameter ${key}: ${value}`);
  }
  assert.equal(url.hash, originalHash, `update navigation lost the URL hash: ${value}`);
}

async function installNavigationTelemetry(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: String.raw`
    (() => {
      const telemetryKey = "ml-player-menu-update-e2e-telemetry";
      const empty = () => ({ documents: 0, overlays: [], phases: [], urls: [] });
      const read = () => {
        try {
          const parsed = JSON.parse(sessionStorage.getItem(telemetryKey) || "null");
          if (parsed && Array.isArray(parsed.overlays) && Array.isArray(parsed.phases) && Array.isArray(parsed.urls)) return parsed;
        } catch {}
        return empty();
      };
      const write = (value) => {
        try { sessionStorage.setItem(telemetryKey, JSON.stringify(value)); } catch {}
      };
      const telemetry = read();
      telemetry.documents += 1;
      telemetry.urls.push(location.href);
      write(telemetry);

      const sample = () => {
        const current = read();
        const gate = document.querySelector("[data-menu-update-gate]");
        const phase = gate?.dataset.updatePhase;
        if (phase && !current.phases.includes(phase)) current.phases.push(phase);
        const overlay = document.querySelector("[data-menu-update-overlay]");
        const copy = overlay?.innerText.replace(/\s+/gu, " ").trim();
        if (copy && !current.overlays.includes(copy)) current.overlays.push(copy);
        write(current);
      };
      const observer = new MutationObserver(sample);
      observer.observe(document, { attributes: true, childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", sample, { once: true });
    })();
  ` });
}

async function readTelemetry(page: Page): Promise<UpdateTelemetry> {
  return page.evaluate(() => JSON.parse(
    sessionStorage.getItem("ml-player-menu-update-e2e-telemetry") || "null",
  ) as UpdateTelemetry);
}

function newFixtureState(): FixtureState {
  return {
    documentRevision: "a",
    indexRequests: [],
    manifestRequests: [],
    manifestRevision: "a",
    playerStateRequests: [],
    runtimeRevision: "a",
    runtimeSequence: 1,
  };
}

function resetFixtureState(state: FixtureState): void {
  state.documentRevision = "a";
  state.indexRequests.length = 0;
  state.manifestRequests.length = 0;
  state.manifestRevision = "a";
  state.playerStateRequests.length = 0;
  state.runtimeRevision = "a";
  state.runtimeSequence = 1;
}

function createFixtureServer(state: FixtureState, roots: Record<FixtureRevision, string>): Server {
  return createServer((request, response) => {
    void handleFixtureRequest(request, response, state, roots).catch((error) => {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(error instanceof Error ? error.stack ?? error.message : String(error));
    });
  });
}

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: FixtureState,
  roots: Record<FixtureRevision, string>,
): Promise<void> {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const observation = observe(request, url);

  if (url.pathname === "/menu") {
    response.writeHead(308, { location: `/menu/${url.search}${url.hash}` });
    response.end();
    return;
  }
  if (url.pathname === "/menu/" || url.pathname === "/menu/index.html") {
    state.indexRequests.push(observation);
    await sendFile(response, path.join(roots[state.documentRevision], "index.html"), "text/html; charset=utf-8", "no-cache", method);
    return;
  }
  if (url.pathname === "/menu/build.json") {
    state.manifestRequests.push(observation);
    await sendFile(response, path.join(roots[state.manifestRevision], "build.json"), "application/json; charset=utf-8", "no-cache", method);
    return;
  }
  if (url.pathname === "/engine/api/player-state") {
    state.playerStateRequests.push(observation);
    sendJSON(response, runtimeStatus(state), method);
    return;
  }
  if (url.pathname === "/engine/api/player-state/events") {
    response.writeHead(200, {
      "cache-control": "no-cache",
      connection: "close",
      "content-type": "text/event-stream",
    });
    if (method !== "HEAD") response.end(`event: player-state\ndata: ${JSON.stringify(runtimeStatus(state))}\n\n`);
    else response.end();
    return;
  }
  if (url.pathname === "/engine/api/menu-state") {
    sendJSON(response, { kioskId: "update-e2e", snapshot: null, updatedUnixMillis: Date.now(), version: 1 }, method);
    return;
  }
  if (url.pathname === "/api/game-catalog") {
    sendJSON(response, { games: [] }, method);
    return;
  }
  if (url.pathname.startsWith("/engine/api/")) {
    sendJSON(response, {}, method);
    return;
  }
  if (url.pathname.startsWith("/menu/")) {
    const relative = decodeURIComponent(url.pathname.slice("/menu/".length));
    if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
      sendNotFound(response);
      return;
    }
    const filePath = await firstExisting([
      path.join(roots[state.documentRevision], relative),
      path.join(roots.a, relative),
      path.join(roots.b, relative),
    ]);
    if (!filePath) {
      sendNotFound(response);
      return;
    }
    await sendFile(response, filePath, contentType(relative), immutableCacheControl(relative), method);
    return;
  }

  sendNotFound(response);
}

function runtimeStatus(state: FixtureState): Record<string, unknown> {
  return {
    activeTargets: 0,
    allowedControls: [],
    audioEnabled: false,
    audioMuted: true,
    catalog: [{
      game: "motion-levels-games:lava",
      label: "El suelo es lava",
      description: "Update fixture",
      music: "",
      players: false,
      minPlayers: 1,
      maxPlayers: 6,
      difficulty: true,
      volume: 1,
    }],
    contractVersion: 1,
    countdownRemainingMillis: 0,
    currentGame: "salvapantallas",
    difficulty: "medium",
    elapsedMillis: 0,
    endsUnix: 0,
    introRemainingMillis: 0,
    label: "Mock update runtime",
    lastEventCue: "",
    lastEventMessage: "",
    lastEventUnixNanos: 0,
    lastPressureUnix: Math.floor(Date.now() / 1_000),
    lifecycle: "idle",
    lives: -1,
    music: "",
    musicVolume: 0,
    paused: false,
    phase: "idle",
    playerCount: 0,
    players: [],
    pressureStreamConnected: true,
    remainingMillis: 0,
    revision: state.runtimeSequence,
    runId: "",
    score: 0,
    sessionId: "",
    sourceRevision: sourceRevisions[state.runtimeRevision],
    startedUnix: 0,
    success: false,
    teamName: "",
    venueSessionId: "",
    venueSessionRecordingAvailable: true,
    venueSessionRecordingConfigured: true,
    venueSessionRecordingEnabled: false,
    venueSessionRecordingPolicy: { scope: "off" },
    venueSessionStartedUnix: 0,
  };
}

function observe(request: IncomingMessage, url: URL): RequestObservation {
  return {
    cacheControl: String(request.headers["cache-control"] || ""),
    pragma: String(request.headers.pragma || ""),
    url: `${url.pathname}${url.search}`,
  };
}

async function buildMenuFixture(revision: FixtureRevision, outputRoot: string): Promise<void> {
  await runProcess(process.execPath, [
    viteEntry,
    "build",
    "--outDir",
    outputRoot,
    "--emptyOutDir",
  ], {
    ...process.env,
    MOTION_LEVELS_BUILD_DATE: "2026-08-14T00:00:00.000Z",
    MOTION_LEVELS_BUILD_REVISION: sourceRevisions[revision],
    MOTION_LEVELS_GAMES_SOURCE_REVISION: sourceRevisions[revision],
    VITE_MENU_UPDATE_POLL_MILLIS: String(pollMillis),
  });
  const build = JSON.parse(await readFile(path.join(outputRoot, "build.json"), "utf8")) as {
    gamesSourceRevision?: string;
    menuBuildRevision?: string;
  };
  assert.equal(build.gamesSourceRevision, sourceRevisions[revision]);
  assert.equal(build.menuBuildRevision, sourceRevisions[revision]);
}

async function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, args, {
    cwd: path.join(repoRoot, "apps/player-menu"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await childExit(child);
  if (exitCode !== 0) {
    throw new Error(`fixture build exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
}

async function childExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose an IPv4 port");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  type: string,
  cacheControl: string,
  method: string,
): Promise<void> {
  const contents = await readFile(filePath);
  response.writeHead(200, {
    "cache-control": cacheControl,
    "content-length": contents.length,
    "content-type": type,
  });
  response.end(method === "HEAD" ? undefined : contents);
}

function sendJSON(response: ServerResponse, value: unknown, method: string): void {
  const contents = Buffer.from(JSON.stringify(value));
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": contents.length,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(method === "HEAD" ? undefined : contents);
}

function sendNotFound(response: ServerResponse): void {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue to the next revision root.
    }
  }
  return null;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function immutableCacheControl(filePath: string): string {
  return filePath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  label: string,
  timeoutMillis = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

async function captureUpdateScreenshot(page: Page, phase: "waiting" | "reloading" | "updated"): Promise<void> {
  if (!captureScreenshots) return;
  await page.screenshot({
    path: `/private/tmp/player-menu-update-${phase}-${viewportWidth}x${viewportHeight}.png`,
  });
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
