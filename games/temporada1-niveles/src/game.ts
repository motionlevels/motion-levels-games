import type { GameConfig } from "@motion-levels-games/game-sdk";
import {
  createPublishedLevelGame,
  createPublishedLevelSessionController,
  type PublishedLevelProduct
} from "@motion-levels-games/published-level-runtime/game";

import { fallbackContent } from "./fixtures-content.ts";
import { manifest } from "./manifest.ts";

const product: PublishedLevelProduct = Object.freeze({
  manifest,
  fallbackContent
});

export function createGame(config: GameConfig) {
  return createPublishedLevelGame(product, config);
}

export const createSessionController = createPublishedLevelSessionController;
