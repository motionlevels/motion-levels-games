import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

type MockEngineStatus = Record<string, unknown> & {
  revision: number;
  teamName: string;
  venueSessionId: string;
  venueSessionRecordingEnabled: boolean;
  venueSessionRecordingPolicy: { scope: string };
  venueSessionStartedUnix: number;
};

type BrowserScenario = {
  context: BrowserContext;
  page: Page;
  outputTestRequests: Array<Record<string, unknown>>;
  platformCatalog: Array<Record<string, unknown>>;
  selectRequests: Array<Record<string, unknown>>;
  status: MockEngineStatus;
  venueSessionFailures: string[];
  venueSessionRequests: Array<Record<string, unknown>>;
};

const recordingScopes = ["off", "visit", "selection", "run"] as const;

const repoRoot = process.cwd();
const port = Number(process.env.MOTION_LEVELS_PLAYER_MENU_BROWSER_PORT || 4175);
const viewportWidth = Number(process.env.MOTION_LEVELS_PLAYER_MENU_BROWSER_WIDTH || 1920);
const viewportHeight = Number(process.env.MOTION_LEVELS_PLAYER_MENU_BROWSER_HEIGHT || 1080);
const captureScreenshots = process.env.MOTION_LEVELS_PLAYER_MENU_BROWSER_SCREENSHOTS === "1";
const scenarioFilter = String(process.env.MOTION_LEVELS_PLAYER_MENU_BROWSER_SCENARIO || "").trim().toLowerCase();
const baseURL = `http://127.0.0.1:${port}`;
const viteEntry = path.join(repoRoot, "node_modules/vite/bin/vite.js");
const server = spawn(
  process.execPath,
  [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: path.join(repoRoot, "apps/player-menu"),
    env: { ...process.env, VITE_GAME_ENGINE_URL: "http://127.0.0.1:4102" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout?.on("data", (chunk) => process.stderr.write(chunk));
server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

let browser: Browser | undefined;
const failures: string[] = [];

try {
  await waitForServer(baseURL, server);
  browser = await chromium.launch({ headless: true });

  await scenario("team name accepts multiple words and Done stays dismissed on touch", async ({ page }) => {
    await startSession(page);
    if (captureScreenshots) await page.screenshot({ path: `/private/tmp/player-menu-drawer-${viewportWidth}.png` });
    const input = page.locator('input[placeholder="Nombre del equipo"]');
    await openTouchKeyboard(input, page);
    if (captureScreenshots) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `/private/tmp/player-menu-keyboard-${viewportWidth}.png` });
    }
    await replaceWithVirtualKeyboard(page, "LOS LOBOS");
    await page.locator(".kb-done").tap();
    await assertKeyboardDismissed(page, input, "Done");
    assert.equal(await input.inputValue(), "LOS LOBOS");

    await openTouchKeyboard(input, page);
    const maximumWideName = "W".repeat(24);
    await replaceWithVirtualKeyboard(page, maximumWideName);
    const layout = await page.locator(".kb-field").evaluate((field) => {
      const value = field.querySelector<HTMLElement>(".kb-value");
      const text = field.querySelector<HTMLElement>(".kb-value > span:first-child");
      const caret = field.querySelector<HTMLElement>(".kb-caret");
      if (!value || !text || !caret) throw new Error("incomplete keyboard composition field");
      const fieldBounds = field.getBoundingClientRect();
      const caretBounds = caret.getBoundingClientRect();
      return {
        caretInside: caretBounds.left >= fieldBounds.left && caretBounds.right <= fieldBounds.right,
        fieldWidth: fieldBounds.width,
        fontSize: getComputedStyle(value).fontSize,
        textClientWidth: text.clientWidth,
        textFits: text.scrollWidth <= text.clientWidth + 1,
        textScrollWidth: text.scrollWidth,
        valueClientWidth: value.clientWidth,
        valueFits: value.scrollWidth <= value.clientWidth + 1,
        valueScrollWidth: value.scrollWidth,
      };
    });
    const layoutEvidence = JSON.stringify(layout);
    assert.equal(layout.caretInside, true, `max-length caret must remain inside the compose field: ${layoutEvidence}`);
    assert.equal(layout.textFits, true, `max-length text must not clip its tail: ${layoutEvidence}`);
    assert.equal(layout.valueFits, true, `max-length value row must remain inside the compose field: ${layoutEvidence}`);
    await page.locator(".kb-done").tap();
    await assertKeyboardDismissed(page, input, "max-length Done");
    assert.equal(await input.inputValue(), maximumWideName);
    const drawer = page.locator(".team-drawer");
    await drawer.locator(".drawer-done").tap();
    await waitForAttribute(drawer, "aria-hidden", "true");
    await assertBrowseChromeNotInert(page);
  });

  await scenario("player name accepts multiple words and a focused key activates with Enter", async ({ page }) => {
    await startSession(page);
    const input = page.getByRole("textbox", { name: "Nombre del jugador 1" });
    await openTouchKeyboard(input, page);
    await replaceWithVirtualKeyboard(page, "ANA MAR", { activateFirstKeyWithEnter: true });
    await page.locator(".kb-done").tap();
    await assertKeyboardDismissed(page, input, "Done");
    assert.equal(await input.inputValue(), "ANA MAR");
  });

  await scenario("Escape dismisses the touch keyboard without reopening it", async ({ page }) => {
    await startSession(page);
    const input = page.locator('input[placeholder="Nombre del equipo"]');
    await openTouchKeyboard(input, page);
    await replaceWithVirtualKeyboard(page, "EQUIPO AZUL");
    await page.keyboard.press("Escape");
    await assertKeyboardDismissed(page, input, "Escape");
    assert.equal(await input.inputValue(), "EQUIPO AZUL");
  });

  await scenario("the keyboard backdrop dismisses without reopening it", async ({ page }) => {
    await startSession(page);
    const input = page.getByRole("textbox", { name: "Nombre del jugador 1" });
    await openTouchKeyboard(input, page);
    await replaceWithVirtualKeyboard(page, "LUNA ROJA");
    await page.locator(".keyboard-modal-layer").tap({ position: { x: 4, y: 4 } });
    await assertKeyboardDismissed(page, input, "backdrop");
    assert.equal(await input.inputValue(), "LUNA ROJA");
  });

  await scenario("an empty roster persists and an allow-any game launches with zero players", async ({ page, selectRequests }) => {
    await startSession(page);
    await page.getByRole("button", { name: /^Quitar a /u }).tap();
    const confirmation = page.getByRole("dialog", { name: "¿Quitar jugador?" });
    await confirmation.waitFor({ state: "visible" });
    await confirmation.getByRole("button", { name: "Quitar", exact: true }).tap();

    const drawer = page.locator(".team-drawer");
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(
      await drawer.evaluate((element) => element.contains(document.activeElement)),
      true,
      "removing the focused last player must restore focus inside the open team drawer",
    );
    assert.equal((await drawer.locator(".drawer-head span").textContent())?.trim(), "0 jugadores");
    assert.equal(await drawer.locator(".roster-issue").count(), 0, "allow-any games must not show a roster error");

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Abrir equipo" }).tap();
    await waitForAttribute(drawer, "aria-hidden", "false");
    assert.equal((await drawer.locator(".drawer-head span").textContent())?.trim(), "0 jugadores");
    assert.equal(await drawer.locator(".roster .player").count(), 0, "reload must not resurrect the default player");
    assert.equal(await drawer.locator(".roster-issue").count(), 0, "allow-any games must remain valid after reload");

    await drawer.locator(".drawer-done").tap();
    await waitForAttribute(drawer, "aria-hidden", "true");
    await assertBrowseChromeNotInert(page);
    const allowAnyGame = page.locator('.game-card[data-game-id="lava"]');
    await allowAnyGame.tap();
    await waitForAttribute(allowAnyGame, "aria-pressed", "true");
    const launch = page.locator(".launch-actions .play");
    try {
      await waitForCondition(
        async () => (await launch.textContent())?.trim() === "Empezar partida",
        "allow-any launch to reconnect after reload",
        5_000,
      );
    } catch (error) {
      const evidence = await page.evaluate(() => ({
        category: document.querySelector<HTMLElement>(".category-tabs [aria-pressed='true']")?.innerText.trim(),
        launch: document.querySelector<HTMLElement>(".launch-actions .play")?.innerText.trim(),
        saved: JSON.parse(localStorage.getItem("ml-player-menu-state-v1") || "{}"),
        selected: document.querySelector<HTMLElement>(".game-card[aria-pressed='true']")?.dataset.gameId,
        visibleGames: Array.from(document.querySelectorAll<HTMLElement>(".game-grid .game-card")).map((card) => card.dataset.gameId),
      }));
      throw new Error(`allow-any launch did not reconnect: ${JSON.stringify(evidence)}`, { cause: error });
    }
    assert.equal((await launch.textContent())?.trim(), "Empezar partida");
    assert.equal(await launch.isEnabled(), true);
    await launch.tap();
    await waitForCondition(() => selectRequests.length === 1, "allow-any /api/select request", 5_000);
    const request = selectRequests[0];
    assert.ok(request, "allow-any launch must send a selection request");
    assert.equal(request.game, "motion-levels-games:lava");
    assert.equal(request.engineGame, "motion-levels-games:lava");
    assert.equal(request.playerCount, 0);
    assert.equal(request.allowAnyPlayers, true);
    assert.deepEqual(request.players, []);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Abrir equipo" }).tap();
    await waitForAttribute(drawer, "aria-hidden", "false");
    assert.equal((await drawer.locator(".drawer-head span").textContent())?.trim(), "0 jugadores");
    assert.equal(await drawer.locator(".roster .player").count(), 0, "launch and reload must keep the allow-any roster empty");
    assert.equal(await drawer.locator(".roster-issue").count(), 0, "launch must not introduce an allow-any roster error");
  });

  await scenario("a staged cloud revision cannot hide bundled production games", async ({ page, platformCatalog, status }) => {
    const stagedRevision = "f".repeat(40);
    platformCatalog.push(
      mockCatalogEntry({
        id: "cloud-lava",
        engine_game: "motion-levels-games:lava",
        source_game_id: "lava",
        source_revision: stagedRevision,
      }),
      mockCatalogEntry({
        id: "cloud-arkanoid",
        engine_game: "motion-levels-games:arkanoid",
        source_game_id: "arkanoid",
        source_revision: stagedRevision,
      }),
    );
    (status.catalog as Array<Record<string, unknown>>).push({
      game: "motion-levels-games:arkanoid",
      label: "Arkanoid",
      description: "Bundled production fallback",
      music: "",
      players: false,
      minPlayers: 1,
      maxPlayers: 1,
      difficulty: true,
      volume: 1,
    });

    await startSession(page);
    const drawer = page.locator(".team-drawer");
    await drawer.locator(".drawer-done").tap();
    await waitForAttribute(drawer, "aria-hidden", "true");
    assert.equal(await page.getByRole("button", { name: "Destacados", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('.game-card[data-game-id="lava"]').getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Cooperativos", exact: true }).tap();
    await page.locator('.game-card[data-game-id="lava"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('.game-card[data-game-id="cloud-lava"]').count(), 0);
    await page.getByRole("button", { name: "Individual", exact: true }).tap();
    await page.locator('.game-card[data-game-id="arkanoid"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('.game-card[data-game-id="cloud-arkanoid"]').count(), 0);
  });

  await scenario("a failed cloud catalog keeps the curated bundled game featured", async ({ page }) => {
    await page.route("**/api/game-catalog", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "catalog unavailable" }),
    }));
    await startSession(page);
    const drawer = page.locator(".team-drawer");
    await drawer.locator(".drawer-done").tap();
    await waitForAttribute(drawer, "aria-hidden", "true");
    const featured = page.getByRole("button", { name: "Destacados", exact: true });
    assert.equal(await featured.getAttribute("aria-pressed"), "true");
    const lava = page.locator('.game-card[data-game-id="lava"]');
    await lava.waitFor({ state: "visible" });
    assert.equal(await lava.getAttribute("aria-pressed"), "true");
  });

  await scenario("recording scope exposes four choices and Welcome recovers from an unavailable service", async ({ page, status, venueSessionFailures, venueSessionRequests }) => {
    status.venueSessionRecordingAvailable = false;
    await openWelcome(page);
    const welcomeStatus = page.locator(".recording-picker--welcome .recording-picker__head small");
    assert.equal((await welcomeStatus.textContent())?.trim(), "Elige un modo; se intentará al iniciar la sesión");
    assert.equal((await welcomeStatus.textContent())?.includes("toca el modo activo"), false);

    status.venueSessionRecordingAvailable = true;
    venueSessionFailures.push("mock welcome start rejection");
    await openWelcome(page);
    const start = page.getByRole("button", { name: "Comenzar" });
    await start.tap();
    const welcomeError = page.locator(".welcome-app .kiosk-toast.error");
    await welcomeError.waitFor({ state: "visible" });
    assert.equal((await welcomeError.textContent())?.includes("No se pudo iniciar la sesión. Inténtalo de nuevo."), true);
    await waitForCondition(() => start.isEnabled(), "Welcome start button to recover after rejection");
    assert.equal((await start.textContent())?.trim(), "Comenzar");
    assert.equal(venueSessionRequests.length, 1);

    await start.tap();
    await page.getByRole("dialog", { name: "Configuración del equipo" }).waitFor({ state: "visible" });
    assert.equal(venueSessionRequests.length, 2);
    const choices = page.locator("[data-recording-scope]");
    assert.deepEqual(await choices.evaluateAll((buttons) => buttons.map((button) => (
      button.querySelector("span")?.textContent?.trim()
    ))), [
      "Desactivada",
      "Sesión completa",
      "Cada juego",
      "Cada intento",
    ]);
    assert.deepEqual(await choices.evaluateAll((buttons) => (
      buttons.map((button) => button.getAttribute("data-recording-scope"))
    )), ["off", "visit", "selection", "run"]);
  });

  for (const scope of recordingScopes) {
    await scenario(`welcome starts the session with ${scope} recording policy`, async ({ page, venueSessionRequests }) => {
      await openWelcome(page);
      const choice = page.locator(`[data-recording-scope="${scope}"]`);
      await choice.tap();
      await waitForAttribute(choice, "aria-pressed", "true");
      assert.equal(venueSessionRequests.length, 0, "choosing a pre-session mode must not mutate a nonexistent session");

      await page.getByRole("button", { name: "Comenzar" }).tap();
      await page.getByRole("dialog", { name: "Configuración del equipo" }).waitFor({ state: "visible" });
      assert.equal(venueSessionRequests.length, 1);
      assertRecordingRequest(venueSessionRequests[0], scope);
    });
  }

  await scenario("active session switches policies and rolls back a rejected scope above the drawer", async ({ page, venueSessionFailures, venueSessionRequests }) => {
    await startSession(page);
    assert.equal(venueSessionRequests.length, 1);
    assertRecordingRequest(venueSessionRequests[0], "visit");

    for (const scope of recordingScopes) {
      const previousCount = venueSessionRequests.length;
      const choice = page.locator(`[data-recording-scope="${scope}"]`);
      await choice.tap();
      await waitForCondition(
        () => venueSessionRequests.length === previousCount + 1,
        `venue-session request for ${scope}`,
      );
      await waitForAttribute(choice, "aria-pressed", "true");
      assertRecordingRequest(venueSessionRequests.at(-1), scope);
    }

    venueSessionFailures.push("mock active recording scope rejection");
    const rejectedChoice = page.locator('[data-recording-scope="selection"]');
    const previousCount = venueSessionRequests.length;
    await rejectedChoice.tap();
    await waitForCondition(
      () => venueSessionRequests.length === previousCount + 1,
      "rejected active recording request",
    );
    const activeError = page.locator(".layout > .kiosk-toast.error");
    await activeError.waitFor({ state: "visible" });
    assert.equal((await activeError.textContent())?.includes("No se pudo cambiar el alcance de grabación. Se ha restaurado la configuración anterior."), true);
    await waitForAttribute(page.locator('[data-recording-scope="run"]'), "aria-pressed", "true");
    assert.equal(await rejectedChoice.getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator(".team-drawer").getAttribute("aria-hidden"), "false");
    const layers = await page.locator(".layout").evaluate(() => ({
      drawer: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>(".team-drawer")!).zIndex, 10),
      toast: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>(".kiosk-toast.error")!).zIndex, 10),
    }));
    assert.ok(layers.toast > layers.drawer, `error toast must layer above the open drawer: ${JSON.stringify(layers)}`);
  });

  await scenario("operator settings run floor and audio diagnostics with authoritative feedback", async ({ page, outputTestRequests, status }) => {
    Object.assign(status, {
      audioEnabled: true,
      audioMuted: false,
      audioOutputState: "ready",
      pressureStreamConnected: true,
    });
    await startSession(page);
    await page.locator(".team-drawer .drawer-done").tap();
    await waitForAttribute(page.locator(".team-drawer"), "aria-hidden", "true");
    await page.locator('.topbar button[aria-label="Ajustes"]').tap();
    const settings = page.getByRole("dialog", { name: "Ajustes" });
    await settings.waitFor({ state: "visible" });
    const compactRevision = (await settings.locator(".settings-version-card > strong").textContent())?.trim() ?? "";
    assert.match(compactRevision, /^[0-9a-f]{7,8}$/u);
    assert.equal(compactRevision.startsWith("menu"), false);

    const floor = settings.getByRole("button", { name: /^Suelo:/u });
    const audio = settings.getByRole("button", { name: /^Audio:/u });
    assert.equal(await floor.isEnabled(), true, `floor diagnostic must be enabled: ${(await floor.textContent())?.trim()}`);
    await floor.tap();
    await waitForCondition(
      async () => outputTestRequests.length === 1 || (await floor.textContent())?.includes("No se pudo") === true,
      "floor output-test result",
      8_000,
    );
    assert.equal(outputTestRequests.length, 1, `floor diagnostic failed before the request: ${(await floor.textContent())?.trim()}`);
    assert.equal(outputTestRequests[0]?.target, "floor");
    assert.match(String(outputTestRequests[0]?.commandId ?? ""), /^[0-9a-f-]{36}$/u);
    await waitForCondition(async () => (await floor.textContent())?.includes("Pulso confirmado") === true, "confirmed floor pulse", 5_000);
    status.pressureStreamConnected = false;
    status.revision += 1;
    await waitForCondition(async () => (await floor.textContent())?.includes("Sin señal") === true, "disconnected floor health", 5_000);
    assert.equal(await floor.isDisabled(), true, "a previous pass must not mask a floor disconnect");
    status.pressureStreamConnected = true;
    status.revision += 1;
    await waitForCondition(() => floor.isEnabled(), "reconnected floor diagnostic", 5_000);

    await audio.tap();
    await waitForCondition(() => outputTestRequests.length === 2, "audio output-test request");
    assert.equal(outputTestRequests[1]?.target, "audio");
    await waitForCondition(async () => (await audio.textContent())?.includes("Reproducido") === true, "completed audio playback", 5_000);
    assert.match((await audio.locator("small").textContent()) ?? "", /La reproducción terminó/u);
    if (captureScreenshots) {
      await page.screenshot({ path: `/private/tmp/player-menu-settings-passed-${viewportWidth}.png` });
    }
    status.audioOutputState = "failed";
    status.revision += 1;
    await waitForCondition(async () => (await audio.textContent())?.includes("Error de salida") === true, "failed audio health", 5_000);
    await waitForCondition(() => audio.isEnabled(), "retryable failed audio diagnostic", 5_000);
    if (captureScreenshots) {
      await page.screenshot({ path: `/private/tmp/player-menu-settings-failed-${viewportWidth}.png` });
    }
  });

  await scenario("saved live catalog selection follows category moves and hides unsupported authored entries", async ({ page, platformCatalog, status }) => {
    const venueSessionId = "10000000-0000-4000-8000-000000000001";
    platformCatalog.push(
      mockCatalogEntry({
        id: "live-lava",
        engine_game: "motion-levels-games:lava",
        label: "Live Lava",
        catalog_category: "arcade",
        source_kind: "motion_levels_games",
        source_game_id: "lava",
      }),
      mockCatalogEntry({
        id: "authored-duel",
        engine_game: "duel",
        label: "Legacy Authored Duel",
        catalog_category: "arcade",
        source_kind: "authored",
        source_game_id: "duel",
      }),
      mockCatalogEntry({
        id: "team-neighbor",
        engine_game: "motion-levels-games:arkanoid",
        label: "Supported Team Neighbor",
        catalog_category: "team",
        source_kind: "motion_levels_games",
        source_game_id: "arkanoid",
      }),
      ...["duelo", "estela", "ping-pong", "ping-pong-v2", "whack-a-mole"].map((gameID, index) => mockCatalogEntry({
        id: `disabled-versus-${index}`,
        engine_game: `motion-levels-games:${gameID}`,
        catalog_category: "versus",
        catalog_enabled: false,
        source_game_id: gameID,
      })),
    );
    const runtimeCatalog = status.catalog as Array<Record<string, unknown>>;
    runtimeCatalog.push({
      game: "motion-levels-games:arkanoid",
      label: "Arkanoid",
      description: "Supported old-category neighbor",
      music: "",
      players: true,
      minPlayers: 1,
      maxPlayers: 6,
      difficulty: true,
      volume: 1,
    });
    Object.assign(status, {
      venueSessionId,
      venueSessionRecordingEnabled: true,
      venueSessionRecordingPolicy: { scope: "visit" },
      venueSessionStartedUnix: Math.floor(Date.now() / 1_000),
      teamName: "Catalog Test",
    });
    await page.addInitScript(({ sessionId }) => {
      if (sessionStorage.getItem("ml-browser-catalog-seeded")) return;
      sessionStorage.setItem("ml-browser-catalog-seeded", "1");
      localStorage.setItem("ml-player-menu-state-v1", JSON.stringify({
        sessionActive: true,
        sessionId,
        sessionStartedUnix: Math.floor(Date.now() / 1_000),
        recordingEnabled: true,
        recordingPolicy: "visit",
        teamName: "Catalog Test",
        players: [],
        category: "team",
        selectedGame: "live-lava",
        difficulty: "easy",
        selectedLevels: {},
        levelModes: {},
        levelProgress: {},
        challengeRuns: {},
        freeRuns: {},
        nextPlayerId: 1,
        narrationArmed: {},
        operatorUnlockLevels: false,
        gameConfig: {},
        processedAttemptIDs: [],
      }));
    }, { sessionId: venueSessionId });

    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await assertReconciledCatalog(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertReconciledCatalog(page);

    const emptyCategory = page.getByRole("button", { name: "Competitivos", exact: true });
    await emptyCategory.tap();
    await assertEmptyCategorySelected(page, emptyCategory);
    await waitForCondition(async () => {
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ml-player-menu-state-v1") || "{}") as Record<string, unknown>);
      return saved.category === "versus" && saved.selectedGame === "";
    }, "intentional empty category persistence");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertEmptyCategorySelected(page, emptyCategory);
    await page.waitForTimeout(5_600);
    await assertEmptyCategorySelected(page, emptyCategory);
  });
} finally {
  await browser?.close();
  await stopServer(server);
}

if (failures.length > 0) {
  throw new Error(`player-menu browser checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

async function scenario(name: string, run: (fixture: BrowserScenario) => Promise<void>): Promise<void> {
  if (scenarioFilter && !name.toLowerCase().includes(scenarioFilter)) return;
  if (!browser) throw new Error("browser was not started");
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: false,
    viewport: { width: viewportWidth, height: viewportHeight },
  });
  const selectRequests: Array<Record<string, unknown>> = [];
  const outputTestRequests: Array<Record<string, unknown>> = [];
  const venueSessionFailures: string[] = [];
  const venueSessionRequests: Array<Record<string, unknown>> = [];
  const platformCatalog: Array<Record<string, unknown>> = [];
  const status = idleStatus();
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  await installMockAPIs(context, status, platformCatalog, selectRequests, outputTestRequests, venueSessionFailures, venueSessionRequests);
  try {
    await run({ context, page, outputTestRequests, platformCatalog, selectRequests, status, venueSessionFailures, venueSessionRequests });
    assert.deepEqual(pageErrors, [], "the rendered menu must not raise browser errors");
    assert.equal(await page.locator("vite-error-overlay, [data-nextjs-dialog], #webpack-dev-server-client-overlay").count(), 0, "the rendered menu must not show a framework error overlay");
    assert.equal((await page.locator("body").innerText()).trim().length > 0, true, "the rendered menu must not be blank");
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failures.push(`${name}: ${message}`);
    process.stdout.write(`not ok - ${name}\n${indent(message)}\n`);
  } finally {
    await context.close();
  }
}

async function installMockAPIs(
  context: BrowserContext,
  status: MockEngineStatus,
  platformCatalog: Array<Record<string, unknown>>,
  selectRequests: Array<Record<string, unknown>>,
  outputTestRequests: Array<Record<string, unknown>>,
  venueSessionFailures: string[],
  venueSessionRequests: Array<Record<string, unknown>>,
): Promise<void> {
  await context.route("**/api/game-catalog", (route) => json(route, { games: platformCatalog }));
  await context.route("**/api/player-state/events", (route) => route.fulfill({
    status: 200,
    headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
    body: `event: player-state\ndata: ${JSON.stringify(status)}\n\n`,
  }));
  await context.route("**/api/player-state", (route) => json(route, status));
  await context.route("**/api/venue-session", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    venueSessionRequests.push(structuredClone(request));
    const failure = venueSessionFailures.shift();
    if (failure) {
      await route.fulfill({ status: 503, contentType: "text/plain", body: failure });
      return;
    }
    status.revision += 1;
    if (request.action === "start") {
      status.venueSessionId = String(request.venueSessionId ?? "");
      status.teamName = String(request.teamName ?? "");
      status.venueSessionStartedUnix = Math.floor(Date.now() / 1_000);
      status.venueSessionRecordingPolicy = request.recordingPolicy as { scope: string };
      status.venueSessionRecordingEnabled = status.venueSessionRecordingPolicy.scope !== "off";
    } else {
      status.venueSessionId = "";
      status.teamName = "";
      status.venueSessionStartedUnix = 0;
      status.venueSessionRecordingPolicy = { scope: "off" };
      status.venueSessionRecordingEnabled = false;
    }
    await json(route, status);
  });
  await context.route("**/api/menu-state", (route) => json(route, {
    kioskId: "browser-test",
    snapshot: null,
    updatedUnixMillis: Date.now(),
    version: 1,
  }));
  await context.route("**/api/menu-event", (route) => json(route, {}));
  await context.route("**/api/select", async (route) => {
    selectRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    status.revision += 1;
    await json(route, status);
  });
  await context.route("**/api/output-test", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": "*",
        },
      });
      return;
    }
    const request = route.request().postDataJSON() as Record<string, unknown>;
    outputTestRequests.push(structuredClone(request));
    const sequence = outputTestRequests.length;
    status.revision += 1;
    status.outputTest = {
      id: crypto.randomUUID(),
      target: request.target,
      sequence,
      state: "passed",
      startedUnixMillis: Date.now() - 100,
      finishedUnixMillis: Date.now(),
    };
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify(status),
    });
  });
}

function idleStatus(): MockEngineStatus {
  return {
    activeTargets: 0,
    allowedControls: [],
    audioEnabled: false,
    audioMuted: true,
    catalog: [{
      game: "motion-levels-games:lava",
      label: "El suelo es lava",
      description: "Mocked allow-any game",
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
    label: "Mock runtime",
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
    revision: 1,
    runId: "",
    score: 0,
    sessionId: "",
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

async function startSession(page: Page): Promise<void> {
  await openWelcome(page);
  await page.getByRole("button", { name: "Comenzar" }).tap();
  await page.getByRole("dialog", { name: "Configuración del equipo" }).waitFor({ state: "visible" });
}

async function openWelcome(page: Page): Promise<void> {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Comenzar" }).waitFor({ state: "visible" });
  if (captureScreenshots) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `/private/tmp/player-menu-welcome-${viewportWidth}.png` });
  }
}

async function openTouchKeyboard(input: ReturnType<Page["locator"]>, page: Page): Promise<void> {
  await input.tap();
  await page.getByRole("dialog", { name: "Editar nombre" }).waitFor({ state: "visible" });
}

async function replaceWithVirtualKeyboard(
  page: Page,
  value: string,
  options: { activateFirstKeyWithEnter?: boolean } = {},
): Promise<void> {
  const clear = page.getByRole("button", { name: "Borrar todo" });
  if (await clear.isEnabled()) await clear.tap();
  let typedCharacter = false;
  for (const character of value) {
    if (character === " ") {
      await page.getByRole("button", { name: "Espacio" }).tap();
      continue;
    }
    const key = page.getByRole("button", { name: character, exact: true });
    if (options.activateFirstKeyWithEnter && !typedCharacter) {
      await key.focus();
      await page.keyboard.press("Enter");
    } else {
      await key.tap();
    }
    typedCharacter = true;
  }
  assert.equal((await page.locator(".kb-value > span:first-child").textContent())?.trim(), value);
}

async function assertKeyboardDismissed(
  page: Page,
  input: ReturnType<Page["locator"]>,
  action: string,
): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".keyboard-modal-layer").count(), 0, `${action} must keep the keyboard closed`);
  assert.equal(await input.evaluate((element) => document.activeElement === element), false, `${action} must not refocus the name input`);
}

async function waitForAttribute(pageOrLocator: ReturnType<Page["locator"]>, name: string, value: string): Promise<void> {
  await waitForCondition(
    async () => await pageOrLocator.getAttribute(name) === value,
    `${name}=${value}`,
  );
}

async function waitForCondition(condition: () => boolean | Promise<boolean>, label: string, timeoutMillis = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function assertRecordingRequest(request: Record<string, unknown> | undefined, scope: typeof recordingScopes[number]): void {
  assert.ok(request, `missing venue-session request for ${scope}`);
  assert.equal(request.action, "start");
  assert.equal(request.recordingEnabled, scope !== "off");
  assert.deepEqual(request.recordingPolicy, { scope });
  assert.equal(typeof request.venueSessionId, "string");
  assert.notEqual(request.venueSessionId, "");
}

async function assertReconciledCatalog(page: Page): Promise<void> {
  const arcade = page.getByRole("button", { name: "Arcade", exact: true });
  await waitForAttribute(arcade, "aria-pressed", "true");
  const selected = page.locator('.game-card[data-game-id="live-lava"]');
  await selected.waitFor({ state: "visible" });
  assert.equal(await selected.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".empty-category").count(), 0, "the moved selection must not leave an empty category view");
  assert.equal(
    await page.locator('.game-card[data-game-id="authored-duel"]').count(),
    0,
    "enabled but unsupported authored entries must not be rendered",
  );
}

async function assertEmptyCategorySelected(page: Page, tab: ReturnType<Page["locator"]>): Promise<void> {
  await waitForAttribute(tab, "aria-pressed", "true");
  await page.locator(".empty-category").waitFor({ state: "visible" });
  assert.equal(await page.locator(".game-grid .game-card").count(), 0, "an empty category must render no game cards");
  assert.equal((await page.locator("#games-heading").textContent())?.trim(), "Competitivos");
}

async function assertBrowseChromeNotInert(page: Page): Promise<void> {
  assert.equal(await page.locator(".topbar").getAttribute("inert"), null, "closed drawer must not leave the topbar inert");
  assert.equal(await page.locator(".main-panel").getAttribute("inert"), null, "closed drawer must not leave the main panel inert");
}

function mockCatalogEntry(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "catalog-game",
    engine_game: "catalog-game",
    label: "Catalog Game",
    description: "",
    catalog_category: "team",
    catalog_enabled: true,
    catalog_featured: false,
    catalog_color: "#36d9ff",
    catalog_order: 10,
    players_label: "",
    difficulty_label: "",
    duration_label: "",
    estimated_duration_seconds: 60,
    supports_levels: false,
    mode_label: "",
    audio_label: "",
    min_players: 1,
    max_players: 6,
    allow_any_players: true,
    difficulties: ["easy", "medium", "hard", "expert"],
    default_music_ref: "",
    default_music_volume: 0.16,
    source_kind: "motion_levels_games",
    source_game_id: "lava",
    source_available: true,
    code_editable: false,
    ...patch,
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
}

async function waitForServer(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`player-menu Vite server exited with ${process.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for player-menu Vite server at ${url}`);
}

async function stopServer(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => process.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
