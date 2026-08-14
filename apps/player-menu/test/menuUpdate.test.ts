import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMenuUpdateMarker,
  decideMenuUpdate,
  emptyMenuManifestObservation,
  loadedMenuIsSafe,
  maxAutomaticMenuReloads,
  menuBuildManifestURL,
  menuUpdateAttemptParam,
  menuUpdateGamesRevisionParam,
  menuUpdateMarkerFromURL,
  menuUpdateNavigationURL,
  menuUpdateRevisionParam,
  menuUpdateTransitionMillis,
  observeMenuManifest,
  parseMenuUpdateMarker,
  parsePlayerMenuBuildManifest,
  serializeMenuUpdateMarker,
  stripMenuUpdateURLParams,
  type MenuBuildIdentity,
  type MenuManifestObservation,
  type PlayerMenuBuildManifest,
} from "../src/menuUpdate.ts";

const gamesA = "a".repeat(40);
const gamesB = "b".repeat(40);
const gamesC = "c".repeat(40);
const buildA: MenuBuildIdentity = { menuBuildRevision: "menu-a", gamesSourceRevision: gamesA };
const buildB: MenuBuildIdentity = { menuBuildRevision: "menu-b", gamesSourceRevision: gamesB };

function manifest(identity: MenuBuildIdentity): PlayerMenuBuildManifest {
  return {
    schema: "motion-levels-player-menu-build-v1",
    menuBuildRevision: identity.menuBuildRevision,
    menuBuildDate: "2026-08-14T00:00:00Z",
    gamesSourceRevision: identity.gamesSourceRevision,
  };
}

function observed(identity: MenuBuildIdentity, stablePolls = 2): MenuManifestObservation {
  return { manifest: manifest(identity), stablePolls, settled: true };
}

describe("player menu update handshake", () => {
  it("accepts only the revision-matched build manifest contract", () => {
    assert.deepEqual(parsePlayerMenuBuildManifest(manifest(buildA)), manifest(buildA));
    assert.equal(parsePlayerMenuBuildManifest({ ...manifest(buildA), schema: "legacy" }), null);
    assert.equal(parsePlayerMenuBuildManifest({ ...manifest(buildA), gamesSourceRevision: "short" }), null);
    assert.equal(parsePlayerMenuBuildManifest({ ...manifest(buildA), menuBuildRevision: "" }), null);
  });

  it("requires two consecutive observations of the same static candidate", () => {
    const firstB = observeMenuManifest(emptyMenuManifestObservation, manifest(buildB));
    const secondB = observeMenuManifest(firstB, manifest(buildB));
    const changedToA = observeMenuManifest(secondB, manifest(buildA));
    const failedPoll = observeMenuManifest(secondB, null);

    assert.equal(firstB.stablePolls, 1);
    assert.equal(secondB.stablePolls, 2);
    assert.equal(changedToA.stablePolls, 1);
    assert.deepEqual(failedPoll, { manifest: null, stablePolls: 0, settled: true });
  });

  it("stages static files silently until the live runtime adopts them", () => {
    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildB),
      runtime: { kind: "available", revision: gamesA },
    }), { phase: "idle", target: null });
  });

  it("blocks immediately when runtime changes and waits for matching files", () => {
    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildA),
      runtime: { kind: "available", revision: gamesB },
    }), { phase: "waiting-for-files", target: null });

    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildB, 1),
      runtime: { kind: "available", revision: gamesB },
    }), { phase: "waiting-for-files", target: null });
  });

  it("reloads only after runtime and two manifest polls converge", () => {
    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildB),
      runtime: { kind: "available", revision: gamesB },
    }), { phase: "reloading", target: buildB });
  });

  it("handles a menu-only rebuild and a restarting unavailable runtime", () => {
    const menuOnly = { menuBuildRevision: "menu-a-hotfix", gamesSourceRevision: gamesA };
    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(menuOnly),
      runtime: { kind: "available", revision: gamesA },
    }), { phase: "reloading", target: menuOnly });

    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildB),
      runtime: { kind: "unavailable" },
    }), { phase: "reloading", target: buildB });

    assert.deepEqual(decideMenuUpdate({
      current: buildA,
      manifestObservation: observed(buildB),
      runtime: { kind: "pending" },
    }), { phase: "idle", target: null });
  });

  it("verifies the loaded build, including skipped versions and rollbacks", () => {
    assert.equal(loadedMenuIsSafe({
      current: buildB,
      manifestObservation: observed(buildB),
      runtime: { kind: "available", revision: gamesB },
    }), true);

    // B loaded successfully while C has already been staged. Runtime B makes
    // the current page safe; C starts its own cycle only when runtime C lands.
    assert.equal(loadedMenuIsSafe({
      current: buildB,
      manifestObservation: observed({ menuBuildRevision: "menu-c", gamesSourceRevision: gamesC }),
      runtime: { kind: "available", revision: gamesB },
    }), true);

    // A rollback is also safe once the loaded A menu and runtime A agree.
    assert.equal(loadedMenuIsSafe({
      current: buildA,
      manifestObservation: observed(buildA),
      runtime: { kind: "available", revision: gamesA },
    }), true);

    assert.equal(loadedMenuIsSafe({
      current: buildA,
      manifestObservation: observed({ menuBuildRevision: "menu-hotfix", gamesSourceRevision: gamesA }),
      runtime: { kind: "available", revision: gamesA },
    }), false);
    assert.equal(loadedMenuIsSafe({
      current: buildB,
      manifestObservation: observed(buildB),
      runtime: { kind: "unavailable" },
    }), false);
  });
});

describe("player menu update recovery marker", () => {
  it("round-trips a valid marker and rejects expired or excessive retries", () => {
    const now = Date.now();
    const marker = createMenuUpdateMarker(buildB, 1, now - 1_000);
    assert.deepEqual(parseMenuUpdateMarker(serializeMenuUpdateMarker(marker), now), marker);
    assert.equal(parseMenuUpdateMarker(serializeMenuUpdateMarker({ ...marker, attempts: maxAutomaticMenuReloads + 1 }), now), null);
    assert.equal(parseMenuUpdateMarker(serializeMenuUpdateMarker({ ...marker, startedAt: now - 6 * 60_000 }), now), null);
    assert.equal(parseMenuUpdateMarker("not-json", now), null);
  });

  it("uses URL state when sessionStorage is unavailable, including pre-navigation attempt zero", () => {
    const href = menuUpdateNavigationURL("https://venue.test/menu/?session=visit-1#team", buildB, 0);
    assert.deepEqual(menuUpdateMarkerFromURL(href, 1234), createMenuUpdateMarker(buildB, 0, 1234));
  });

  it("preserves customer query parameters and hashes across replacement", () => {
    const original = "https://venue.test/gateways/kiosk-7/menu/?session=visit-1&mode=mirror#team";
    const updateURL = new URL(menuUpdateNavigationURL(original, buildB, 2));

    assert.equal(updateURL.searchParams.get("session"), "visit-1");
    assert.equal(updateURL.searchParams.get("mode"), "mirror");
    assert.equal(updateURL.searchParams.get(menuUpdateRevisionParam), buildB.menuBuildRevision);
    assert.equal(updateURL.searchParams.get(menuUpdateGamesRevisionParam), gamesB);
    assert.equal(updateURL.searchParams.get(menuUpdateAttemptParam), "2");
    assert.equal(updateURL.hash, "#team");

    const cleaned = new URL(stripMenuUpdateURLParams(updateURL.href));
    assert.equal(cleaned.searchParams.get("session"), "visit-1");
    assert.equal(cleaned.searchParams.get("mode"), "mirror");
    assert.equal(cleaned.searchParams.has(menuUpdateRevisionParam), false);
    assert.equal(cleaned.searchParams.has(menuUpdateGamesRevisionParam), false);
    assert.equal(cleaned.searchParams.has(menuUpdateAttemptParam), false);
    assert.equal(cleaned.hash, "#team");
  });

  it("resolves a cache-busted manifest beside every supported menu mount", () => {
    assert.equal(
      menuBuildManifestURL("https://venue.test/menu/?session=1#x", "one"),
      "https://venue.test/menu/build.json?__ml_manifest_poll=one",
    );
    assert.equal(
      menuBuildManifestURL("https://venue.test/games/menu", "two"),
      "https://venue.test/games/menu/build.json?__ml_manifest_poll=two",
    );
    assert.equal(
      menuBuildManifestURL("https://venue.test/gateways/kiosk-7/menu/index.html?mode=mirror", "three"),
      "https://venue.test/gateways/kiosk-7/menu/build.json?__ml_manifest_poll=three",
    );
  });

  it("keeps reload and success confirmation brief under reduced motion", () => {
    assert.ok(menuUpdateTransitionMillis("reload", true) < menuUpdateTransitionMillis("reload", false));
    assert.ok(menuUpdateTransitionMillis("success", true) < menuUpdateTransitionMillis("success", false));
    assert.equal(menuUpdateTransitionMillis("reload", false, 75), 100);
    assert.equal(menuUpdateTransitionMillis("success", false, 75), 150);
  });
});
