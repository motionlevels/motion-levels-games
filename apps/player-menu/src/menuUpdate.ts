export const playerMenuBuildManifestSchema = "motion-levels-player-menu-build-v1";
export const menuUpdateStorageKey = "motion-levels-player-menu-update-v1";
export const menuUpdateRevisionParam = "__ml_menu_revision";
export const menuUpdateGamesRevisionParam = "__ml_games_revision";
export const menuUpdateAttemptParam = "__ml_update_attempt";
export const menuUpdateManifestPollParam = "__ml_manifest_poll";
export const maxAutomaticMenuReloads = 2;
export const menuUpdateMarkerTTLMillis = 5 * 60_000;
export const menuUpdateVerificationTimeoutMillis = 45_000;

const fullSourceRevisionPattern = /^[0-9a-f]{40}$/u;
const maximumRevisionLength = 128;

export type MenuBuildIdentity = {
  menuBuildRevision: string;
  gamesSourceRevision: string;
};

export type PlayerMenuBuildManifest = MenuBuildIdentity & {
  schema: typeof playerMenuBuildManifestSchema;
  menuBuildDate: string;
};

export type MenuUpdateMarker = {
  expectedMenuRevision: string;
  expectedGamesRevision: string;
  attempts: number;
  startedAt: number;
};

export type MenuManifestObservation = {
  manifest: PlayerMenuBuildManifest | null;
  stablePolls: number;
  settled: boolean;
};

export type RuntimeRevisionObservation =
  | { kind: "pending" }
  | { kind: "available"; revision: string }
  | { kind: "unavailable" };

export type MenuUpdatePhase = "idle" | "waiting-for-files" | "reloading" | "verifying" | "updated" | "failed";

export type MenuUpdateTransition = "reload" | "success";

export type MenuUpdateDecision = {
  phase: "idle" | "waiting-for-files" | "reloading";
  target: MenuBuildIdentity | null;
};

export const emptyMenuManifestObservation: MenuManifestObservation = {
  manifest: null,
  stablePolls: 0,
  settled: false,
};

export function parsePlayerMenuBuildManifest(value: unknown): PlayerMenuBuildManifest | null {
  if (!isRecord(value) || value.schema !== playerMenuBuildManifestSchema) return null;
  const menuBuildRevision = cleanRevision(value.menuBuildRevision);
  const gamesSourceRevision = cleanGamesSourceRevision(value.gamesSourceRevision);
  const menuBuildDate = cleanBuildDate(value.menuBuildDate);
  if (!menuBuildRevision || !gamesSourceRevision || !menuBuildDate) return null;
  return {
    schema: playerMenuBuildManifestSchema,
    menuBuildRevision,
    menuBuildDate,
    gamesSourceRevision,
  };
}

export function cleanGamesSourceRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const revision = value.trim();
  return fullSourceRevisionPattern.test(revision) ? revision : null;
}

export function manifestBuildIdentity(manifest: PlayerMenuBuildManifest): MenuBuildIdentity {
  return {
    menuBuildRevision: manifest.menuBuildRevision,
    gamesSourceRevision: manifest.gamesSourceRevision,
  };
}

export function sameMenuBuildIdentity(left: MenuBuildIdentity, right: MenuBuildIdentity): boolean {
  return left.menuBuildRevision === right.menuBuildRevision
    && left.gamesSourceRevision === right.gamesSourceRevision;
}

export function observeMenuManifest(
  previous: MenuManifestObservation,
  manifest: PlayerMenuBuildManifest | null,
): MenuManifestObservation {
  if (!manifest) return { manifest: null, stablePolls: 0, settled: true };
  const stablePolls = previous.manifest
    && sameMenuBuildIdentity(manifestBuildIdentity(previous.manifest), manifestBuildIdentity(manifest))
    ? previous.stablePolls + 1
    : 1;
  return { manifest, stablePolls, settled: true };
}

export function decideMenuUpdate({
  current,
  manifestObservation,
  runtime,
}: {
  current: MenuBuildIdentity;
  manifestObservation: MenuManifestObservation;
  runtime: RuntimeRevisionObservation;
}): MenuUpdateDecision {
  const manifest = manifestObservation.manifest;
  const available = manifest ? manifestBuildIdentity(manifest) : null;
  const stable = manifestObservation.stablePolls >= 2;
  const availableChanged = available !== null && !sameMenuBuildIdentity(current, available);

  if (runtime.kind === "available" && runtime.revision !== current.gamesSourceRevision) {
    if (stable && availableChanged && available?.gamesSourceRevision === runtime.revision) {
      return { phase: "reloading", target: available };
    }
    return { phase: "waiting-for-files", target: null };
  }

  if (!availableChanged) return { phase: "idle", target: null };

  if (runtime.kind === "available") {
    // The next games bundle is staged, but the currently loaded menu still
    // matches the live runtime. Wait without interrupting the players.
    if (available!.gamesSourceRevision !== current.gamesSourceRevision) {
      return { phase: "idle", target: null };
    }
    // A menu-only rebuild can be adopted once two fresh polls agree.
    return stable
      ? { phase: "reloading", target: available }
      : { phase: "idle", target: null };
  }

  // If the runtime cannot be reached, adopting a stable static candidate is
  // safer than repeatedly rendering stale HTML while the service restarts.
  if (runtime.kind === "unavailable" && stable) {
    return { phase: "reloading", target: available };
  }

  return { phase: "idle", target: null };
}

/**
 * A loaded menu is safe after navigation when it matches the live runtime and
 * the manifest is either the same build or a games revision staged for a
 * future runtime restart. The latter lets a rapid B -> C deployment verify B,
 * unblock, and start a fresh bounded update cycle when runtime C appears.
 */
export function loadedMenuIsSafe({
  current,
  manifestObservation,
  runtime,
}: {
  current: MenuBuildIdentity;
  manifestObservation: MenuManifestObservation;
  runtime: RuntimeRevisionObservation;
}): boolean {
  const manifest = manifestObservation.manifest;
  if (!manifest || manifestObservation.stablePolls < 2 || runtime.kind !== "available") return false;
  if (runtime.revision !== current.gamesSourceRevision) return false;
  const available = manifestBuildIdentity(manifest);
  return sameMenuBuildIdentity(current, available)
    || available.gamesSourceRevision !== current.gamesSourceRevision;
}

export function createMenuUpdateMarker(
  target: MenuBuildIdentity,
  attempts: number,
  startedAt: number,
): MenuUpdateMarker {
  return {
    expectedMenuRevision: target.menuBuildRevision,
    expectedGamesRevision: target.gamesSourceRevision,
    attempts,
    startedAt,
  };
}

export function serializeMenuUpdateMarker(marker: MenuUpdateMarker): string {
  return JSON.stringify(marker);
}

export function parseMenuUpdateMarker(raw: string | null, now: number): MenuUpdateMarker | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const expectedMenuRevision = cleanRevision(value.expectedMenuRevision);
    const expectedGamesRevision = cleanGamesSourceRevision(value.expectedGamesRevision);
    const attempts = Number(value.attempts);
    const startedAt = Number(value.startedAt);
    if (
      !expectedMenuRevision
      || !expectedGamesRevision
      || !Number.isSafeInteger(attempts)
      || attempts < 0
      || attempts > maxAutomaticMenuReloads
      || !Number.isFinite(startedAt)
      || startedAt <= 0
      || startedAt > now + 60_000
      || now - startedAt > menuUpdateMarkerTTLMillis
    ) {
      return null;
    }
    return { expectedMenuRevision, expectedGamesRevision, attempts, startedAt };
  } catch {
    return null;
  }
}

export function menuUpdateMarkerFromURL(href: string, now: number): MenuUpdateMarker | null {
  const url = new URL(href);
  const expectedMenuRevision = cleanRevision(url.searchParams.get(menuUpdateRevisionParam));
  const expectedGamesRevision = cleanGamesSourceRevision(url.searchParams.get(menuUpdateGamesRevisionParam));
  const attempts = Number(url.searchParams.get(menuUpdateAttemptParam));
  if (
    !expectedMenuRevision
    || !expectedGamesRevision
    || !Number.isSafeInteger(attempts)
    || attempts < 0
    || attempts > maxAutomaticMenuReloads
  ) {
    return null;
  }
  return { expectedMenuRevision, expectedGamesRevision, attempts, startedAt: now };
}

export function menuUpdateNavigationURL(
  href: string,
  target: MenuBuildIdentity,
  attempts: number,
): string {
  const url = new URL(href);
  url.searchParams.set(menuUpdateRevisionParam, target.menuBuildRevision);
  url.searchParams.set(menuUpdateGamesRevisionParam, target.gamesSourceRevision);
  url.searchParams.set(menuUpdateAttemptParam, String(attempts));
  return url.href;
}

export function stripMenuUpdateURLParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(menuUpdateRevisionParam);
  url.searchParams.delete(menuUpdateGamesRevisionParam);
  url.searchParams.delete(menuUpdateAttemptParam);
  return url.href;
}

export function menuBuildManifestURL(href: string, nonce: string): string {
  const page = new URL(href);
  page.search = "";
  page.hash = "";
  const lastSegment = page.pathname.split("/").at(-1) || "";
  if (!page.pathname.endsWith("/") && !lastSegment.includes(".")) page.pathname += "/";
  const manifestURL = new URL("build.json", page);
  manifestURL.searchParams.set(menuUpdateManifestPollParam, nonce);
  return manifestURL.href;
}

export function menuUpdateTransitionMillis(
  transition: MenuUpdateTransition,
  reducedMotion: boolean,
  pollOverrideMillis: number | null = null,
): number {
  if (pollOverrideMillis !== null) {
    return Math.max(transition === "success" ? 150 : 100, pollOverrideMillis);
  }
  if (transition === "success") return reducedMotion ? 350 : 1_400;
  return reducedMotion ? 250 : 900;
}

function cleanRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const revision = value.trim();
  return revision && revision.length <= maximumRevisionLength ? revision : null;
}

function cleanBuildDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  return date && date.length <= maximumRevisionLength ? date : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
