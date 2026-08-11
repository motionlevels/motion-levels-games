import type { GameCard } from "./catalog.ts";

export function partyLaunchGame(
  game: GameCard,
  catalogGames: GameCard[],
  index = 0,
): GameCard | null {
  if (!game.partyMiniGames?.length) return game;
  const miniGame = game.partyMiniGames[index] || game.partyMiniGames[0];
  return catalogGames.find((candidate) => (
    candidate.id === miniGame.gameId
    || (candidate.engineGame || candidate.id) === miniGame.gameId
  )) || null;
}

export function partyCatalogIsComplete(game: GameCard, catalogGames: GameCard[]): boolean {
  if (!game.partyMiniGames?.length) return true;
  return game.partyMiniGames.every((_, index) => partyLaunchGame(game, catalogGames, index) !== null);
}
