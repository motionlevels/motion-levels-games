import { createFrame, setFrameCell, type Frame, type GameSnapshot } from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";
import { targetColor } from "./game.ts";

export const runningFrame: Frame = setFrameCell(createFrame("#05070a"), 6, 12, targetColor);

export const runningSnapshot: GameSnapshot = {
  currentGame: manifest.id,
  label: manifest.label,
  phase: "running",
  playerCount: 1,
  players: [
    {
      index: 0,
      label: "Player 1",
      color: "#35d7ff",
      score: 4,
      lives: -1
    }
  ],
  score: 4,
  lives: -1,
  elapsedMillis: 12_000,
  remainingMillis: 48_000,
  activeTargets: 1,
  success: false,
  lastEventCue: "hit",
  lastEventMessage: "Target 4"
};

export const hitSnapshot: GameSnapshot = {
  ...runningSnapshot,
  score: 5,
  players: [
    {
      ...runningSnapshot.players[0],
      score: 5
    }
  ],
  elapsedMillis: 14_000,
  remainingMillis: 46_000,
  lastEventCue: "hit",
  lastEventMessage: "Target 5"
};

export const finishedSnapshot: GameSnapshot = {
  ...hitSnapshot,
  phase: "finished",
  elapsedMillis: 60_000,
  remainingMillis: 0,
  activeTargets: 0,
  success: true,
  lastEventCue: "win",
  lastEventMessage: "Time"
};

