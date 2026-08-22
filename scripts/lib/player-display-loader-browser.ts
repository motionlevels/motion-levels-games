import assert from "node:assert/strict";
import { build, type Plugin } from "esbuild";
import type { Browser, Page, Route } from "playwright";

const fixtureOrigin = "http://player-display-loader.test";
const legacyStylesID = "motion-levels-games-display-styles";
const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);

export type PlayerDisplayLoaderCompatibilityReport = {
  embeddedBridge: true;
  foreignPendingStyleOwnership: true;
  historicalFallbackOrders: string[];
  pendingSupersession: true;
  sameRevisionErrorEpoch: true;
  supersededAcceptanceModes: string[];
};

/** Exercise the real player-display loader with deterministic script/link ordering. */
export async function assertPlayerDisplayLoaderCompatibility(
  browser: Browser,
): Promise<PlayerDisplayLoaderCompatibilityReport> {
  const loaderHarnessJavaScript = await bundleLoaderHarness();
  await assertEmbeddedRuntimeBridge(browser);
  await assertEmbeddedRuntimeRespectsForeignPendingStyle(browser);
  for (const order of ["script-first", "stylesheet-first"] as const) {
    await assertHistoricalFallback(browser, loaderHarnessJavaScript, order);
  }
  await assertPendingLegacyOwnership(browser, loaderHarnessJavaScript);
  await assertSameRevisionErrorEpoch(browser, loaderHarnessJavaScript);
  for (const acceptedMode of ["external", "legacy"] as const) {
    await assertSupersededLoad(browser, loaderHarnessJavaScript, acceptedMode);
  }
  return {
    embeddedBridge: true,
    foreignPendingStyleOwnership: true,
    historicalFallbackOrders: ["script-first", "stylesheet-first"],
    pendingSupersession: true,
    sameRevisionErrorEpoch: true,
    supersededAcceptanceModes: ["external", "legacy"],
  };
}

async function assertEmbeddedRuntimeBridge(browser: Browser): Promise<void> {
  const revision = "c".repeat(40);
  const sentinelStyles = ".embedded-css-bridge-sentinel{color:rgb(12,34,56)}";
  const runtimeJavaScript = await bundleDisplayRuntime(revision, sentinelStyles);
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addScriptTag({ content: runtimeJavaScript });
    const installed = await page.evaluate((styleID) => {
      const style = document.getElementById(styleID);
      return {
        registryRevision: window.MotionLevelsGamesDisplays?.[window.MotionLevelsGamesDisplay?.revision ?? ""]?.revision,
        runtimeRevision: window.MotionLevelsGamesDisplay?.revision,
        styleRevision: style instanceof HTMLStyleElement ? style.dataset.revision : undefined,
        styleTag: style?.tagName,
        text: style?.textContent,
      };
    }, legacyStylesID);
    assert.equal(installed.runtimeRevision, revision);
    assert.equal(installed.registryRevision, revision);
    assert.equal(installed.styleTag, "STYLE");
    assert.equal(installed.styleRevision, revision);
    assert.equal(installed.text, sentinelStyles);
  } finally {
    await page.close();
  }
}

async function assertEmbeddedRuntimeRespectsForeignPendingStyle(browser: Browser): Promise<void> {
  const runtimeRevision = "c".repeat(40);
  const pendingRevision = "d".repeat(40);
  const runtimeJavaScript = await bundleDisplayRuntime(
    runtimeRevision,
    ".stale-runtime-style{color:rgb(255,0,0)}",
  );
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html><head>
      <style
        id="${legacyStylesID}"
        data-motion-levels-games-pending-revision="${pendingRevision}"
        media="not all"
      >.pending-style{color:rgb(0,0,187)}</style>
    </head><body></body></html>`);
    await page.addScriptTag({ content: runtimeJavaScript });
    const candidate = await page.evaluate((styleID) => {
      const style = document.getElementById(styleID);
      return style instanceof HTMLStyleElement ? {
        pendingRevision: style.dataset.motionLevelsGamesPendingRevision,
        revision: style.dataset.revision,
        text: style.textContent,
      } : null;
    }, legacyStylesID);
    assert.deepEqual(candidate, {
      pendingRevision,
      revision: undefined,
      text: ".pending-style{color:rgb(0,0,187)}",
    });
  } finally {
    await page.close();
  }
}

async function assertHistoricalFallback(
  browser: Browser,
  loaderHarnessJavaScript: string,
  order: "script-first" | "stylesheet-first",
): Promise<void> {
  const page = await browser.newPage();
  const releaseScript = deferred<void>();
  const releaseStylesheet = deferred<void>();
  try {
    await installFixtureRoutes(page, loaderHarnessJavaScript, async (route, revision, asset) => {
      assert.equal(revision, revisionA);
      if (asset === "display.js") {
        if (order === "stylesheet-first") await releaseScript.promise;
        await route.fulfill({
          body: fixtureRuntimeJavaScript(
            revision,
            ".historical-style-marker{color:rgb(12,34,56)}",
            false,
          ),
          contentType: "application/javascript",
          status: 200,
        });
        return;
      }
      if (order === "script-first") await releaseStylesheet.promise;
      await route.fulfill({ body: "not found", contentType: "text/plain", status: 404 });
      if (order === "stylesheet-first") {
        setTimeout(() => releaseScript.resolve(), 25);
      }
    });
    await openLoaderHarness(page);
    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 1), revisionA);

    if (order === "script-first") {
      await page.waitForFunction(
        (revision) => window.MotionLevelsGamesDisplay?.revision === revision,
        revisionA,
      );
      releaseStylesheet.resolve();
    }
    try {
      await page.waitForFunction(() => (
        document.querySelector(".motion-levels-games-display-root.is-ready .historical-style-marker") !== null
      ), undefined, { timeout: 5_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        head: document.head.innerHTML,
        host: document.querySelector(".motion-levels-games-display-root")?.outerHTML,
        runtimeRevision: window.MotionLevelsGamesDisplay?.revision,
        states: window.displayLoaderHarness.states,
      }));
      throw new Error(`${order}: historical fallback did not mount: ${JSON.stringify(diagnostics)}`, { cause: error });
    }

    const result = await page.evaluate(() => {
      const style = document.getElementById("motion-levels-games-display-styles");
      const marker = document.querySelector(".historical-style-marker");
      return {
        activeExternalStyles: Array.from(document.querySelectorAll<HTMLLinkElement>(
          'link[rel="stylesheet"][data-motion-levels-games-revision]',
        )).filter((link) => link.media !== "not all").length,
        color: marker ? getComputedStyle(marker).color : "",
        mounted: document.querySelector(".motion-levels-games-display-root")?.textContent,
        renderStatus: window.displayLoaderHarness.states.at(-1)?.status,
        runtimeRevision: window.MotionLevelsGamesDisplay?.revision,
        styleMedia: style instanceof HTMLStyleElement ? style.media : undefined,
        styleRevision: style instanceof HTMLStyleElement ? style.dataset.revision : undefined,
        styleTag: style?.tagName,
      };
    });

    assert.equal(result.renderStatus, "ready", `${order}: historical runtime must become ready`);
    assert.equal(result.runtimeRevision, revisionA);
    assert.equal(result.styleTag, "STYLE");
    assert.equal(result.styleRevision, revisionA);
    assert.notEqual(result.styleMedia, "not all");
    assert.equal(result.activeExternalStyles, 0);
    assert.equal(result.color, "rgb(12, 34, 56)");
    assert.match(result.mounted ?? "", new RegExp(`(?:mount|update):${revisionA}:1`, "u"));
  } finally {
    releaseScript.resolve();
    releaseStylesheet.resolve();
    await page.close();
  }
}

async function assertPendingLegacyOwnership(
  browser: Browser,
  loaderHarnessJavaScript: string,
): Promise<void> {
  const page = await browser.newPage();
  const releaseRevisionAStylesheet = deferred<void>();
  const releaseRevisionBStylesheet = deferred<void>();
  let revisionBScriptRequests = 0;
  try {
    await page.addInitScript(() => {
      window.fixtureUnhandledRejections = [];
      window.addEventListener("unhandledrejection", (event) => {
        window.fixtureUnhandledRejections.push(String(event.reason));
      });
    });
    await installFixtureRoutes(page, loaderHarnessJavaScript, async (route, revision, asset) => {
      if (asset === "display.js") {
        if (revision === revisionB) revisionBScriptRequests += 1;
        await route.fulfill({
          body: fixtureRuntimeJavaScript(
            revision,
            `.embedded-${revision[0]}{color:${revision === revisionA ? "rgb(170,0,0)" : "rgb(0,0,187)"}}`,
          ),
          contentType: "application/javascript",
          status: 200,
        });
        return;
      }
      if (revision === revisionA) {
        await releaseRevisionAStylesheet.promise;
      } else {
        await releaseRevisionBStylesheet.promise;
      }
      await route.fulfill({ body: "not found", contentType: "text/plain", status: 404 });
    });
    await openLoaderHarness(page);
    await captureAppendedLoadCallbacks(page);

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 1), revisionA);
    await page.waitForFunction(
      (revision) => window.MotionLevelsGamesDisplay?.revision === revision,
      revisionA,
    );
    await page.waitForFunction(
      (revision) => Boolean(window.capturedRevisionLoads[revision]?.scriptOnload),
      revisionA,
    );

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 2), revisionB);
    await page.waitForFunction((revision) => {
      const style = document.getElementById("motion-levels-games-display-styles");
      return (
        window.MotionLevelsGamesDisplays?.[revision]?.revision === revision
        && style instanceof HTMLStyleElement
        && style.dataset.revision === revision
        && style.dataset.motionLevelsGamesPendingRevision === revision
        && style.textContent?.includes(".embedded-b")
      );
    }, revisionB);

    await page.evaluate((revision) => {
      const stale = window.capturedRevisionLoads[revision];
      const staleRuntime = window.fixtureDisplayRuntimes[revision];
      const legacyStyle = document.getElementById("motion-levels-games-display-styles");
      if (!stale?.script || !stale.stylesheet || !staleRuntime || !(legacyStyle instanceof HTMLStyleElement)) {
        throw new Error("pending supersession fixture is incomplete");
      }
      window.MotionLevelsGamesDisplay = staleRuntime;
      legacyStyle.textContent = `.stale-${revision[0]}{color:rgb(255,0,0)}`;
      legacyStyle.dataset.revision = revision;
      stale.scriptOnload?.call(stale.script, new Event("load"));
      stale.stylesheetOnload?.call(stale.stylesheet, new Event("load"));
    }, revisionA);
    await page.waitForFunction((revision) => {
      const style = document.getElementById("motion-levels-games-display-styles");
      return style instanceof HTMLStyleElement
        && style.dataset.revision === revision
        && style.dataset.motionLevelsGamesPendingRevision === revision
        && style.textContent?.includes(".embedded-b");
    }, revisionB);

    releaseRevisionBStylesheet.resolve();
    await page.waitForFunction((revision) => (
      window.MotionLevelsGamesDisplay?.revision === revision
      && document.querySelector(".motion-levels-games-display-root.is-ready")?.textContent?.includes(`${revision}:2`)
    ), revisionB);

    const accepted = await acceptedLoaderState(page);
    const finalState = await page.evaluate(() => ({
      attempt: window.displayLoaderHarness.states.at(-1)?.attempt,
      status: window.displayLoaderHarness.states.at(-1)?.status,
      unhandledRejections: window.fixtureUnhandledRejections,
    }));
    assert.equal(revisionBScriptRequests, 1, "replacement display script must load once");
    assert.equal(finalState.status, "ready");
    assert.equal(finalState.attempt, 0);
    assert.deepEqual(finalState.unhandledRejections, []);
    assert.equal(accepted.runtimeRevision, revisionB);
    assert.deepEqual(accepted.activeExternalRevisions, []);
    assert.equal(accepted.legacyRevision, revisionB);
    assert.match(accepted.legacyText ?? "", /\.embedded-b/u);
    assert.equal(accepted.staleRevisionNodes, 0);

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 7), revisionB);
    await page.waitForFunction((revision) => window.fixtureDisplayEvents.some((event) => (
      event.kind === "update" && event.revision === revision && event.score === 7
    )), revisionB);
  } finally {
    releaseRevisionAStylesheet.resolve();
    releaseRevisionBStylesheet.resolve();
    await page.close();
  }
}

async function assertSameRevisionErrorEpoch(
  browser: Browser,
  loaderHarnessJavaScript: string,
): Promise<void> {
  const page = await browser.newPage();
  try {
    await installFixtureRoutes(page, loaderHarnessJavaScript, async (route, revision, asset) => {
      assert.equal(revision, revisionA);
      await route.fulfill(asset === "display.js" ? {
        body: fixtureRuntimeJavaScript(revision, ".same-revision-style{color:rgb(12,34,56)}"),
        contentType: "application/javascript",
        status: 200,
      } : {
        body: ".same-revision-style{color:rgb(12,34,56)}",
        contentType: "text/css",
        status: 200,
      });
    });
    await openLoaderHarness(page);
    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 1, "game-a"), revisionA);
    await page.waitForFunction(() => (
      document.querySelector(".motion-levels-games-display-root.is-ready")?.textContent?.includes(":1:game-a")
      && window.fixtureDisplayErrorCallbacks?.some((entry) => entry.gameId === "game-a")
    ));
    await page.evaluate(() => {
      window.savedFixtureDisplayError = window.fixtureDisplayErrorCallbacks
        .filter((entry) => entry.gameId === "game-a")
        .at(-1)?.callback;
    });

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 2, "game-b"), revisionA);
    await page.waitForFunction(() => (
      document.querySelector(".motion-levels-games-display-root.is-ready")?.textContent?.includes(":2:game-b")
      && window.displayLoaderHarness.states.at(-1)?.status === "ready"
    ));
    const unmountsBeforeStaleError = await page.evaluate(() => (
      window.fixtureDisplayEvents.filter((event) => event.kind === "unmount").length
    ));
    await page.evaluate(() => {
      const staleError = window.savedFixtureDisplayError;
      if (!staleError) throw new Error("stale display error callback was not captured");
      queueMicrotask(() => staleError(new Error("stale game-a render error")));
    });
    await page.waitForTimeout(50);

    const afterStaleError = await page.evaluate(() => ({
      mounted: document.querySelector(".motion-levels-games-display-root.is-ready")?.textContent,
      status: window.displayLoaderHarness.states.at(-1)?.status,
      unmounts: window.fixtureDisplayEvents.filter((event) => event.kind === "unmount").length,
    }));
    assert.equal(afterStaleError.status, "ready");
    assert.match(afterStaleError.mounted ?? "", /:2:game-b/u);
    assert.equal(afterStaleError.unmounts, unmountsBeforeStaleError);

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 3, "game-b"), revisionA);
    await page.waitForFunction(() => window.fixtureDisplayEvents.some((event) => (
      event.kind === "update" && event.gameId === "game-b" && event.score === 3
    )));
  } finally {
    await page.close();
  }
}

async function assertSupersededLoad(
  browser: Browser,
  loaderHarnessJavaScript: string,
  acceptedMode: "external" | "legacy",
): Promise<void> {
  const page = await browser.newPage();
  const releaseRevisionAStylesheet = deferred<void>();
  try {
    await installFixtureRoutes(page, loaderHarnessJavaScript, async (route, revision, asset) => {
      if (asset === "display.js") {
        await route.fulfill({
          body: fixtureRuntimeJavaScript(
            revision,
            `.embedded-${revision[0]}{color:${revision === revisionA ? "rgb(170,0,0)" : "rgb(0,0,187)"}}`,
          ),
          contentType: "application/javascript",
          status: 200,
        });
        return;
      }
      if (revision === revisionA) {
        await releaseRevisionAStylesheet.promise;
      }
      const missing = revision === revisionB && acceptedMode === "legacy";
      await route.fulfill({
        body: missing
          ? "not found"
          : `.external-${revision[0]}{color:${revision === revisionA ? "rgb(170,0,0)" : "rgb(0,0,187)"}}`,
        contentType: missing ? "text/plain" : "text/css",
        status: missing ? 404 : 200,
      });
    });
    await openLoaderHarness(page);
    await captureAppendedLoadCallbacks(page);

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 1), revisionA);
    await page.waitForFunction(
      (revision) => window.MotionLevelsGamesDisplay?.revision === revision,
      revisionA,
    );
    await page.waitForFunction(
      (revision) => Boolean(window.capturedRevisionLoads[revision]?.scriptOnload),
      revisionA,
    );

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 2), revisionB);
    await page.waitForFunction((revision) => (
      window.MotionLevelsGamesDisplay?.revision === revision
      && document.querySelector(".motion-levels-games-display-root.is-ready")?.textContent?.includes(`${revision}:2`)
    ), revisionB);

    await page.evaluate((revision) => {
      const stale = window.capturedRevisionLoads[revision];
      const staleRuntime = window.fixtureDisplayRuntimes[revision];
      if (!stale?.script || !stale.stylesheet || !staleRuntime) {
        throw new Error("revision A fixture was not captured");
      }
      // Model the worst real ordering: removed A finishes after B is accepted,
      // overwrites the historical global/style, then queued callbacks execute.
      window.MotionLevelsGamesDisplay = staleRuntime;
      let legacyStyle = document.getElementById("motion-levels-games-display-styles");
      if (!(legacyStyle instanceof HTMLStyleElement)) {
        legacyStyle?.remove();
        legacyStyle = document.createElement("style");
        legacyStyle.id = "motion-levels-games-display-styles";
        document.head.append(legacyStyle);
      }
      legacyStyle.textContent = `.stale-${revision[0]}{color:rgb(255,0,0)}`;
      legacyStyle.dataset.revision = revision;
      stale.scriptOnload?.call(stale.script, new Event("load"));
      stale.stylesheetOnload?.call(stale.stylesheet, new Event("load"));
    }, revisionA);
    releaseRevisionAStylesheet.resolve();
    await page.waitForTimeout(50);

    const afterStaleLoad = await acceptedLoaderState(page);
    assert.equal(afterStaleLoad.runtimeRevision, revisionB, `${acceptedMode}: B runtime must remain accepted`);
    assert.deepEqual(
      afterStaleLoad.activeExternalRevisions,
      acceptedMode === "external" ? [revisionB] : [],
      `${acceptedMode}: only B's chosen CSS channel may remain active`,
    );
    assert.notEqual(afterStaleLoad.legacyRevision, revisionA, `${acceptedMode}: stale A legacy CSS must be removed`);
    if (acceptedMode === "legacy") {
      assert.equal(afterStaleLoad.legacyRevision, revisionB);
      assert.match(afterStaleLoad.legacyText ?? "", /\.embedded-b/u);
    }
    assert.equal(afterStaleLoad.staleRevisionNodes, 0);

    await page.evaluate((revision) => window.displayLoaderHarness.render(revision, 7), revisionB);
    await page.waitForFunction((revision) => window.fixtureDisplayEvents.some((event) => (
      event.kind === "update" && event.revision === revision && event.score === 7
    )), revisionB);
    const events = await page.evaluate(() => window.fixtureDisplayEvents);
    assert.ok(events.some((event) => event.kind === "mount" && event.revision === revisionB));
    assert.ok(events.some((event) => event.kind === "update" && event.revision === revisionB && event.score === 7));
    assert.equal(events.some((event) => event.kind === "update" && event.revision === revisionA), false);
  } finally {
    releaseRevisionAStylesheet.resolve();
    await page.close();
  }
}

async function bundleLoaderHarness(): Promise<string> {
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    define: {
      "import.meta.env.VITE_MOTION_LEVELS_GAMES_ASSET_URL": "undefined",
    },
    format: "iife",
    platform: "browser",
    stdin: {
      contents: `
        import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { MotionLevelsGamesDisplay } from "./apps/player-display/src/MotionLevelsGamesDisplay.tsx";

        const root = createRoot(document.getElementById("root"));
        const states = [];
        const onStateChange = (state) => states.push(state);
        window.displayLoaderHarness = {
          states,
          render(revision, score, gameId = "fixture-game") {
            root.render(createElement(MotionLevelsGamesDisplay, {
              fallback: createElement("span", null, "fallback"),
              onStateChange,
              status: {
                currentGame: "motion-levels-games:" + gameId,
                frame: undefined,
                gameSnapshot: { currentGame: gameId, phase: "running", score },
                phase: "running",
                sourceRevision: revision,
              },
            }));
          },
        };
      `,
      loader: "js",
      resolveDir: process.cwd(),
      sourcefile: "display-loader-harness.js",
    },
    target: "es2022",
    write: false,
  });
  const output = result.outputFiles?.find((file) => file.path.endsWith(".js")) ?? result.outputFiles?.[0];
  assert.ok(output, "loader harness build must emit JavaScript");
  return output.text;
}

async function bundleDisplayRuntime(revision: string, styles: string): Promise<string> {
  const registryStub: Plugin = {
    name: "display-registry-stub",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^\.\/displayRegistry\.ts$/ }, () => ({
        namespace: "display-registry-stub",
        path: "displayRegistry",
      }));
      buildContext.onLoad({ filter: /.*/, namespace: "display-registry-stub" }, () => ({
        contents: "export const displayRegistry = new Map();",
        loader: "js",
      }));
    },
  };
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    define: {
      MOTION_LEVELS_GAMES_DISPLAY_CSS: JSON.stringify(styles),
      MOTION_LEVELS_GAMES_REVISION: JSON.stringify(revision),
    },
    entryPoints: ["packages/game-catalog/src/display.tsx"],
    format: "iife",
    loader: { ".css": "empty", ".png": "dataurl" },
    platform: "browser",
    plugins: [registryStub],
    target: "es2022",
    write: false,
  });
  const output = result.outputFiles?.find((file) => file.path.endsWith(".js")) ?? result.outputFiles?.[0];
  assert.ok(output, "display runtime build must emit JavaScript");
  return output.text;
}

async function installFixtureRoutes(
  page: Page,
  loaderHarnessJavaScript: string,
  assetHandler: (route: Route, revision: string, asset: "display.css" | "display.js") => Promise<void>,
): Promise<void> {
  await page.route(`${fixtureOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      await route.fulfill({
        body: '<!doctype html><html><head></head><body><div id="root"></div><script src="/harness.js"></script></body></html>',
        contentType: "text/html",
        status: 200,
      });
      return;
    }
    if (url.pathname === "/harness.js") {
      await route.fulfill({ body: loaderHarnessJavaScript, contentType: "application/javascript", status: 200 });
      return;
    }
    const match = url.pathname.match(/^\/games\/([^/]+)\/display\/(display\.(?:css|js))$/u);
    if (match?.[1] && (match[2] === "display.css" || match[2] === "display.js")) {
      await assetHandler(route, decodeURIComponent(match[1]), match[2]);
      return;
    }
    await route.fulfill({ body: "not found", contentType: "text/plain", status: 404 });
  });
}

async function openLoaderHarness(page: Page): Promise<void> {
  await page.goto(`${fixtureOrigin}/?floorRotation=0`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.displayLoaderHarness));
}

async function captureAppendedLoadCallbacks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.capturedRevisionLoads = {};
    const append = document.head.append;
    document.head.append = function (this: HTMLHeadElement, ...nodes: Array<Node | string>): void {
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const revision = node.dataset.motionLevelsGamesRevision;
        if (!revision) continue;
        const capture = window.capturedRevisionLoads[revision] ?? {};
        if (node instanceof HTMLScriptElement) {
          capture.script = node;
          capture.scriptOnload = node.onload;
        } else if (node instanceof HTMLLinkElement) {
          capture.stylesheet = node;
          capture.stylesheetOnload = node.onload;
        }
        window.capturedRevisionLoads[revision] = capture;
      }
      append.apply(this, nodes);
    };
  });
}

async function acceptedLoaderState(page: Page): Promise<{
  activeExternalRevisions: string[];
  legacyRevision?: string;
  legacyText?: string;
  runtimeRevision?: string;
  staleRevisionNodes: number;
}> {
  return page.evaluate((staleRevision) => {
    const legacy = document.getElementById("motion-levels-games-display-styles");
    return {
      activeExternalRevisions: Array.from(document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"][data-motion-levels-games-revision]',
      )).filter((link) => link.media !== "not all").map((link) => link.dataset.motionLevelsGamesRevision ?? ""),
      legacyRevision: legacy instanceof HTMLStyleElement ? legacy.dataset.revision : undefined,
      legacyText: legacy instanceof HTMLStyleElement ? legacy.textContent ?? undefined : undefined,
      runtimeRevision: window.MotionLevelsGamesDisplay?.revision,
      staleRevisionNodes: document.querySelectorAll(`[data-motion-levels-games-revision="${staleRevision}"]`).length
        + document.querySelectorAll(`#motion-levels-games-display-styles[data-revision="${staleRevision}"]`).length,
    };
  }, revisionA);
}

function fixtureRuntimeJavaScript(revision: string, styles: string, registerRevision = true): string {
  return `
    (() => {
      const revision = ${JSON.stringify(revision)};
      const styleID = ${JSON.stringify(legacyStylesID)};
      let style = document.getElementById(styleID);
      if (!(style instanceof HTMLStyleElement)) {
        style?.remove();
        style = document.createElement("style");
        style.id = styleID;
        document.head.append(style);
      }
      style.textContent = ${JSON.stringify(styles)};
      style.dataset.revision = revision;
      const record = (kind, input) => {
        window.fixtureDisplayEvents ??= [];
        window.fixtureDisplayEvents.push({
          gameId: input?.gameId,
          kind,
          revision,
          score: input?.snapshot?.score,
        });
        if (typeof input?.onError === "function") {
          window.fixtureDisplayErrorCallbacks ??= [];
          window.fixtureDisplayErrorCallbacks.push({
            callback: input.onError,
            gameId: input.gameId,
            revision,
            score: input.snapshot?.score,
          });
        }
      };
      const paint = (host, kind, input) => {
        record(kind, input);
        const marker = document.createElement("span");
        marker.className = "historical-style-marker";
        marker.textContent = kind + ":" + revision + ":" + input.snapshot.score + ":" + input.gameId;
        host.replaceChildren(marker);
      };
      const runtime = {
        revision,
        mount: (host, input) => paint(host, "mount", input),
        update: (host, input) => paint(host, "update", input),
        unmount: (host) => { record("unmount"); host.replaceChildren(); },
      };
      window.fixtureDisplayRuntimes ??= {};
      window.fixtureDisplayRuntimes[revision] = runtime;
      if (${JSON.stringify(registerRevision)}) {
        window.MotionLevelsGamesDisplays ??= {};
        window.MotionLevelsGamesDisplays[revision] = runtime;
      }
      window.MotionLevelsGamesDisplay = runtime;
    })();
  `;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve(value?: T) { resolvePromise(value as T); },
  };
}

declare global {
  interface Window {
    MotionLevelsGamesDisplay?: FixtureRuntime;
    MotionLevelsGamesDisplays?: Record<string, FixtureRuntime>;
    capturedRevisionLoads: Record<string, {
      script?: HTMLScriptElement;
      scriptOnload?: ((this: GlobalEventHandlers, event: Event) => unknown) | null;
      stylesheet?: HTMLLinkElement;
      stylesheetOnload?: ((this: GlobalEventHandlers, event: Event) => unknown) | null;
    }>;
    displayLoaderHarness: {
      render(revision: string, score: number, gameId?: string): void;
      states: Array<{ attempt?: number; status: string }>;
    };
    fixtureDisplayErrorCallbacks: Array<{
      callback(reason: unknown): void;
      gameId: string;
      revision: string;
      score?: number;
    }>;
    fixtureDisplayEvents: Array<{ gameId?: string; kind: string; revision: string; score?: number }>;
    fixtureDisplayRuntimes: Record<string, FixtureRuntime>;
    fixtureUnhandledRejections: string[];
    savedFixtureDisplayError?: (reason: unknown) => void;
  }
}

type FixtureRuntime = {
  revision: string;
  mount(host: Element, input: FixtureDisplayInput): void;
  update(host: Element, input: FixtureDisplayInput): void;
  unmount(host: Element): void;
};

type FixtureDisplayInput = {
  gameId: string;
  onError?: (reason: unknown) => void;
  snapshot: { score?: number };
};
