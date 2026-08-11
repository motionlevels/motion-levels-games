export type PrimaryScreen = "display" | "menu";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function readPrimaryScreen(
  search = typeof window === "undefined" ? "" : window.location.search,
): PrimaryScreen {
  return new URLSearchParams(search).get("screen") === "menu" ? "menu" : "display";
}

export function localPlayerMenuUrl(
  playgroundLocation = typeof window === "undefined" ? undefined : window.location,
  development = import.meta.env?.DEV === true,
): string | undefined {
  if (!development || !playgroundLocation || !loopbackHosts.has(playgroundLocation.hostname)) return undefined;
  if (playgroundLocation.protocol !== "http:" && playgroundLocation.protocol !== "https:") return undefined;

  const url = new URL("/player-menu/", playgroundLocation.href);
  url.searchParams.set("embed", "playground");
  url.searchParams.set("kioskViewport", "1920x1080");
  return url.toString();
}
