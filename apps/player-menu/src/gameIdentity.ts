import type { GameCard } from "./catalog.ts";

type MenuGameIdentity = Pick<GameCard, "engineGame" | "id" | "sourceGameId">;

const runtimeGamePrefix = "motion-levels-games:";

/**
 * Resolve persisted and runtime identities without confusing catalog row IDs
 * with mutable game slugs. Exact catalog IDs always win; aliases are accepted
 * only when they identify one unique game.
 */
export function gameForMenuIdentity<T extends MenuGameIdentity>(games: readonly T[], identity: string | undefined): T | undefined {
  const requested = cleanGameIdentity(identity);
  if (!requested) return undefined;

  const exactCatalogMatches = games.filter((game) => cleanGameIdentity(game.id) === requested);
  if (exactCatalogMatches.length === 1) return exactCatalogMatches[0];

  const exactRuntimeMatches = games.filter((game) => (
    cleanGameIdentity(game.engineGame) === requested
    || cleanGameIdentity(game.sourceGameId) === requested
  ));
  if (exactRuntimeMatches.length === 1) return exactRuntimeMatches[0];

  const normalizedRequested = normalizeRuntimeGameIdentity(requested);
  const normalizedMatches = games.filter((game) => gameIdentityKeys(game).includes(normalizedRequested));
  return normalizedMatches.length === 1 ? normalizedMatches[0] : undefined;
}

function gameIdentityKeys(game: MenuGameIdentity): string[] {
  return [...new Set([game.id, game.engineGame, game.sourceGameId]
    .map((value) => normalizeRuntimeGameIdentity(cleanGameIdentity(value)))
    .filter(Boolean))];
}

function cleanGameIdentity(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRuntimeGameIdentity(value: string): string {
  return value.startsWith(runtimeGamePrefix) ? value.slice(runtimeGamePrefix.length) : value;
}
