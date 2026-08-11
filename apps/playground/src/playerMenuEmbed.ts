export type PrimaryScreen = "display" | "menu";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const portPattern = /^\d{2,5}$/u;

export function readPrimaryScreen(
  search = typeof window === "undefined" ? "" : window.location.search,
): PrimaryScreen {
  return new URLSearchParams(search).get("screen") === "menu" ? "menu" : "display";
}

export function localPlayerMenuUrl(
  playgroundLocation = typeof window === "undefined" ? undefined : window.location,
  configuredPort?: string,
): string | undefined {
  if (!playgroundLocation || !loopbackHosts.has(playgroundLocation.hostname)) return undefined;
  if (playgroundLocation.protocol !== "http:" && playgroundLocation.protocol !== "https:") return undefined;

  const playerMenuPort = configuredPort
    ?? (import.meta.env?.DEV ? import.meta.env.VITE_LOCAL_PLAYER_MENU_PORT : undefined);
  if (!playerMenuPort || !portPattern.test(playerMenuPort)) return undefined;

  const host = playgroundLocation.hostname.includes(":")
    ? `[${playgroundLocation.hostname.replace(/^\[|\]$/gu, "")}]`
    : playgroundLocation.hostname;
  const url = new URL(`${playgroundLocation.protocol}//${host}:${playerMenuPort}/`);
  url.searchParams.set("embed", "playground");
  url.searchParams.set("kioskViewport", "1920x1080");
  if (portPattern.test(playgroundLocation.port)) {
    url.searchParams.set("playgroundPort", playgroundLocation.port);
  }
  return url.toString();
}
