import {
  defaultGamePlayerCount,
  gamePlayerCountOptions,
  normalizeGameConfigOptions,
  normalizeGameDifficulty,
  type GameConfigOptions,
  type GameDifficulty,
} from "@motion-levels-games/game-sdk";
import type { PlaygroundGame } from "./gameRegistry.ts";

export type PlayerJourneyLaunch = Readonly<{
  gameId: string;
  playerCount: number;
  difficulty: GameDifficulty;
  options: GameConfigOptions;
  returnUrl?: string;
}>;

export function readPlayerJourneyLaunch(
  games: readonly PlaygroundGame[],
  search = typeof window === "undefined" ? "" : window.location.search,
): PlayerJourneyLaunch | undefined {
  const params = new URLSearchParams(search);
  if (params.get("journey") !== "1") return undefined;
  const gameId = params.get("game") || "";
  const game = games.find((candidate) => candidate.manifest.id === gameId);
  if (!game) return undefined;

  const requestedPlayers = Number(params.get("players"));
  const playerChoices = gamePlayerCountOptions(game.manifest);
  const playerCount = Number.isInteger(requestedPlayers) && playerChoices.includes(requestedPlayers)
    ? requestedPlayers
    : defaultGamePlayerCount(game.manifest);
  const difficulty = normalizeGameDifficulty(params.get("difficulty") ?? undefined, game.manifest);
  const rawOptions = parseOptions(params.get("options"));
  const returnUrl = safeReturnUrl(params.get("return"));

  return {
    gameId,
    playerCount,
    difficulty,
    options: normalizeGameConfigOptions(rawOptions, game.manifest),
    ...(returnUrl ? { returnUrl } : {}),
  };
}

function parseOptions(value: string | null): GameConfigOptions {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as GameConfigOptions
      : {};
  } catch {
    return {};
  }
}

function safeReturnUrl(value: string | null): string | undefined {
  if (!value || typeof window === "undefined") return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
