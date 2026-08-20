import type { GameConfigOptions } from "@motion-levels-games/game-sdk";

export type PrimaryScreen = "display" | "menu";

export const playerMenuLaunchMessageType = "motion-levels:playground-launch" as const;

export type PlayerMenuLaunchMessage = Readonly<{
  type: typeof playerMenuLaunchMessageType;
  gameId: string;
  playerCount: number;
  difficulty?: string;
  options: GameConfigOptions;
}>;

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

export function readPlayerMenuLaunchMessage(value: unknown): PlayerMenuLaunchMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (message.type !== playerMenuLaunchMessageType) return undefined;
  if (typeof message.gameId !== "string" || message.gameId.trim() === "") return undefined;
  if (!Number.isSafeInteger(message.playerCount) || Number(message.playerCount) < 0) return undefined;
  if (message.difficulty !== undefined && typeof message.difficulty !== "string") return undefined;

  const options: GameConfigOptions = {};
  if (message.options !== undefined) {
    if (!message.options || typeof message.options !== "object" || Array.isArray(message.options)) return undefined;
    for (const [key, option] of Object.entries(message.options)) {
      if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
        options[key] = option;
      }
    }
  }

  return {
    type: playerMenuLaunchMessageType,
    gameId: message.gameId.trim(),
    playerCount: Number(message.playerCount),
    ...(message.difficulty ? { difficulty: message.difficulty } : {}),
    options,
  };
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
