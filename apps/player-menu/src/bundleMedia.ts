import {
  gameMediaAssetSpecs,
  gameMediaReferences,
  mediaReferenceURL,
} from "@motion-levels-games/game-sdk";

declare const MOTION_LEVELS_GAMES_SOURCE_REVISION: string;

export type PlayerMenuLocation = string | URL | Pick<Location, "href">;

export const floorPreviewMediaSpec = gameMediaAssetSpecs.animation;

export function bundledGamesSourceRevision(): string {
  if (
    typeof MOTION_LEVELS_GAMES_SOURCE_REVISION === "string"
    && MOTION_LEVELS_GAMES_SOURCE_REVISION.trim()
  ) {
    return MOTION_LEVELS_GAMES_SOURCE_REVISION.trim();
  }
  return "dev";
}

/**
 * Resolve the immutable games bundle next to every supported menu mount.
 *
 * Venue and gateway menus are exposed as a convenience route while the full
 * revision-matched bundle is exposed under `games/`. A menu already reached
 * through `games/menu/` must not gain a second `games/` segment.
 */
export function resolveBundleRootURL(menuLocation: PlayerMenuLocation = browserMenuLocation()): URL {
  const menuURL = new URL(locationHref(menuLocation), "http://localhost/menu/");
  const menuMatch = menuURL.pathname.match(/^(.*\/)(player-menu|menu)(?:\/.*)?$/u);

  if (!menuMatch) return withoutSearchOrHash(new URL("./", menuURL));

  const menuKind = menuMatch[2];
  let bundlePath = menuMatch[1] || "/";
  if (menuKind === "player-menu" && bundlePath.endsWith("/games/play/")) {
    bundlePath = bundlePath.slice(0, -"play/".length);
  } else if (
    menuKind === "menu"
    && !bundlePath.endsWith("/games/")
    && !/\/games\/[^/]+\/$/u.test(bundlePath)
  ) {
    bundlePath = `${bundlePath}games/`;
  }

  menuURL.pathname = bundlePath;
  return withoutSearchOrHash(menuURL);
}

export function revisionedBundleMediaURL(
  reference: string,
  sourceRevision: string,
  menuLocation: PlayerMenuLocation = browserMenuLocation(),
): string {
  const revision = String(sourceRevision || "").trim();
  if (!revision) throw new Error("A games source revision is required for bundle media");

  const bundleRoot = revisionedBundleRootURL(revision, menuLocation);
  const mediaURL = new URL(mediaReferenceURL(reference, bundleRoot));
  mediaURL.searchParams.set("revision", revision);
  return mediaURL.toString();
}

export function gameBundleMediaSources(
  gameId: string,
  sourceRevision = bundledGamesSourceRevision(),
  menuLocation: PlayerMenuLocation = browserMenuLocation(),
) {
  const references = gameMediaReferences(gameId);
  return Object.freeze({
    thumbnailSmall: revisionedBundleMediaURL(references.thumbnailSmall, sourceRevision, menuLocation),
    thumbnail: revisionedBundleMediaURL(references.thumbnail, sourceRevision, menuLocation),
    animation: revisionedBundleMediaURL(references.animation, sourceRevision, menuLocation),
  });
}

function browserMenuLocation(): PlayerMenuLocation {
  return globalThis.location?.href || "http://localhost/menu/";
}

function locationHref(menuLocation: PlayerMenuLocation): string {
  if (typeof menuLocation === "string") return menuLocation;
  return menuLocation.href;
}

function revisionedBundleRootURL(sourceRevision: string, menuLocation: PlayerMenuLocation): URL {
  const menuURL = new URL(locationHref(menuLocation), "http://localhost/menu/");
  const menuKind = menuURL.pathname.match(/^(?:.*\/)(player-menu|menu)(?:\/.*)?$/u)?.[1];
  const bundleRoot = resolveBundleRootURL(menuLocation);

  // Native venue and gateway `/menu/` routes are aliases to the active menu,
  // while `/games/<revision>/` is the immutable bundle namespace. Embedded
  // `/player-menu/` builds already live beside their media and stay relative
  // to their host application.
  if (menuKind !== "menu" || /\/games\/[^/]+\/$/u.test(bundleRoot.pathname)) return bundleRoot;
  return withoutSearchOrHash(new URL(`${encodeURIComponent(sourceRevision)}/`, bundleRoot));
}

function withoutSearchOrHash(url: URL): URL {
  url.search = "";
  url.hash = "";
  return url;
}
