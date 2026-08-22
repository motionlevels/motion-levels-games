import {
  FLOOR_COLS,
  FLOOR_ROWS,
  type GamePlaytestScenario
} from "@motion-levels-games/game-sdk";
import { type DueloGameInstance, winAnimationMillis } from "./game.ts";
import { manifest } from "./manifest.ts";

const victoryScenario: GamePlaytestScenario = {
  id: "victory",
  label: "One tile before victory",
  recording: {
    durationMillis: winAnimationMillis,
    frameIntervalMillis: 100,
    leadInMillis: 400
  },
  prepare(driver) {
    const game = driver.game as DueloGameInstance;
    const readyTiles = game.playerReadyZones().map((zone) => ({
      x: Math.floor((zone.minX + zone.maxX) / 2),
      y: Math.floor((zone.minY + zone.maxY) / 2)
    }));

    for (const tile of readyTiles) driver.press(tile.x, tile.y);
    driver.step(manifest.start.mode === "player-ready" ? manifest.start.countdownMillis : 3_000);
    for (const tile of readyTiles) driver.release(tile.x, tile.y);

    if (game.snapshot().phase !== "running") {
      throw new Error("Duelo victory scenario could not start the match");
    }

    const winnerIndex = 0;
    const targets: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        if (game.targetOwner(x, y) === winnerIndex) targets.push({ x, y });
      }
    }

    const finalTile = targets.at(-1);
    if (!finalTile) throw new Error("Duelo victory scenario found no targets for player 1");

    for (const tile of targets.slice(0, -1)) {
      driver.press(tile.x, tile.y);
      driver.release(tile.x, tile.y);
    }

    return {
      description: `Player 1 has one of ${targets.length} tiles left`,
      trigger: [
        { type: "press", ...finalTile },
        { type: "release", ...finalTile }
      ]
    };
  }
};

export const playtestScenarios = Object.freeze([victoryScenario]);
