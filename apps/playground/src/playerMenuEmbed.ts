export type PrimaryScreen = "display" | "menu";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type PlayerMenuTargetOptions = Readonly<{
  basePath: string;
  enabled: boolean;
  loopbackOnly: boolean;
}>;

function defaultTargetOptions(): PlayerMenuTargetOptions {
  const hosted = import.meta.env?.VITE_HOSTED_PLAYER_EXPERIENCE === "true";
  return {
    basePath: import.meta.env?.BASE_URL || "/",
    enabled: import.meta.env?.DEV === true || hosted,
    loopbackOnly: !hosted,
  };
}

export function readPrimaryScreen(
  search = typeof window === "undefined" ? "" : window.location.search,
): PrimaryScreen {
  return new URLSearchParams(search).get("screen") === "menu" ? "menu" : "display";
}

export function localPlayerMenuUrl(
  playgroundLocation = typeof window === "undefined" ? undefined : window.location,
  options = defaultTargetOptions(),
): string | undefined {
  if (!options.enabled || !playgroundLocation) return undefined;
  if (options.loopbackOnly && !loopbackHosts.has(playgroundLocation.hostname)) return undefined;
  if (playgroundLocation.protocol !== "http:" && playgroundLocation.protocol !== "https:") return undefined;

  const basePath = options.basePath.endsWith("/") ? options.basePath : `${options.basePath}/`;
  const url = new URL(`${basePath}player-menu/`, playgroundLocation.origin);
  url.searchParams.set("embed", "playground");
  url.searchParams.set("kioskViewport", "1920x1080");
  return url.toString();
}
