import type { GamePlaytestDriver, GamePlaytestScenario } from "@motion-levels-games/game-sdk";
import { finishMillis, type WhackAMoleGameInstance } from "./game.ts";
import { manifest } from "./manifest.ts";

function startMatch(driver: GamePlaytestDriver): WhackAMoleGameInstance {
  const game = driver.game as WhackAMoleGameInstance;
  const readyTiles = game.playerReadyZones().map((zone) => ({
    x: Math.floor((zone.minX + zone.maxX) / 2),
    y: Math.floor((zone.minY + zone.maxY) / 2)
  }));
  for (const tile of readyTiles) driver.press(tile.x, tile.y);
  driver.step(manifest.start.mode === "player-ready" ? (manifest.start.countdownMillis ?? 2_000) : 0);
  for (const tile of readyTiles) driver.release(tile.x, tile.y);
  if (game.snapshot().phase !== "running") {
    throw new Error("Whack-a-mole scenario could not start the match");
  }
  return game;
}

const countdownScenario: GamePlaytestScenario = {
  id: "countdown",
  label: "Ready to start countdown",
  recording: { durationMillis: 3_400, frameIntervalMillis: 100, leadInMillis: 300 },
  prepare(driver) {
    const game = driver.game as WhackAMoleGameInstance;
    const tiles = game.playerReadyZones().map((zone) => ({
      x: Math.floor((zone.minX + zone.maxX) / 2),
      y: Math.floor((zone.minY + zone.maxY) / 2)
    }));
    for (const tile of tiles.slice(0, -1)) driver.press(tile.x, tile.y);
    const last = tiles.at(-1);
    if (!last) throw new Error("Whack-a-mole countdown scenario has no ready platform");
    return {
      description: "All but the final player are ready",
      trigger: [{ type: "press", ...last }]
    };
  }
};

const hitScenario: GamePlaytestScenario = {
  id: "hit",
  label: "One target ready to hit",
  recording: { durationMillis: 1_100, frameIntervalMillis: 80, leadInMillis: 300 },
  prepare(driver) {
    const game = startMatch(driver);
    const target = game.snapshot().targets[0];
    if (!target) throw new Error("Whack-a-mole hit scenario found no target");
    return {
      description: "Player 1 has a fresh target",
      trigger: [
        { type: "press", x: target.x, y: target.y },
        { type: "release", x: target.x, y: target.y }
      ]
    };
  }
};

const expiredScenario: GamePlaytestScenario = {
  id: "expired",
  label: "One target about to expire",
  recording: { durationMillis: 1_100, frameIntervalMillis: 80, leadInMillis: 350 },
  prepare(driver) {
    const game = startMatch(driver);
    const target = game.snapshot().targets[0];
    if (!target) throw new Error("Whack-a-mole expiration scenario found no target");
    driver.step(Math.max(0, target.deadlineMillis - driver.clockMillis - 60));
    return {
      description: "Player 1 target has 60 ms remaining",
      trigger: [{ type: "step", deltaMillis: 60 }]
    };
  }
};

const victoryScenario: GamePlaytestScenario = {
  id: "victory",
  label: "One tick before victory",
  recording: { durationMillis: finishMillis + 800, frameIntervalMillis: 100, leadInMillis: 350 },
  prepare(driver) {
    const game = startMatch(driver);
    const target = game.snapshot().targets[0];
    if (!target) throw new Error("Whack-a-mole victory scenario found no target");
    driver.press(target.x, target.y);
    driver.release(target.x, target.y);
    driver.step(Math.max(0, game.snapshot().remainingMillis - 20));
    return {
      description: "Player 1 leads with 20 ms remaining",
      trigger: [{ type: "step", deltaMillis: 20 }]
    };
  }
};

export const playtestScenarios = Object.freeze([
  countdownScenario,
  hitScenario,
  expiredScenario,
  victoryScenario
]);
