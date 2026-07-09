import { createFrame, fillFrameRect, paintFrameCell, type Frame } from "@motion-levels-games/game-sdk";
import { ballColor, blueColor, redColor, type PingPongSnapshot } from "./game.ts";
import { manifest } from "./manifest.ts";

export const runningFrame: Frame = (() => {
  const frame = createFrame("#05070a");
  fillFrameRect(frame, 5, 2, 5, 1, redColor);
  fillFrameRect(frame, 6, 29, 5, 1, blueColor);
  paintFrameCell(frame, 8, 16, ballColor);
  return frame;
})();

export const waitingSnapshot: PingPongSnapshot = {
  currentGame: manifest.id,
  label: manifest.label,
  phase: "waiting",
  playerCount: 2,
  players: [
    { index: 0, label: "Rojo", color: redColor, score: 0, lives: 5 },
    { index: 1, label: "Azul", color: blueColor, score: 0, lives: 5 }
  ],
  score: 0,
  lives: -1,
  elapsedMillis: 0,
  remainingMillis: 0,
  activeTargets: 0,
  success: false,
  lastEventCue: "ready",
  lastEventMessage: "Ping Pong espera rojo y azul.",
  countdownMillis: 0,
  matchTarget: 5,
  roundHits: 0,
  lastRoundHits: 0,
  lastRoundWinner: "",
  rounds: [],
  ball: { x: 8, y: 16, dx: 1, dy: 1 },
  ballTrail: [],
  rallyPace: 0,
  pointScorer: -1,
  pointFlashMillis: 0,
  winnerIndex: -1,
  impact: null,
  motionEventId: 1,
  initialBallSpeed: 6.9,
  ballSpeed: 6.9,
  returnSpeedMultiplier: 1.042,
  difficultySpeedFactor: 1.2
};

export const runningSnapshot: PingPongSnapshot = {
  ...waitingSnapshot,
  phase: "running",
  elapsedMillis: 8200,
  activeTargets: 2,
  lastEventCue: "coin",
  lastEventMessage: "Azul devuelve.",
  roundHits: 3,
  ball: { x: 11, y: 21, dx: 1, dy: 1 },
  ballTrail: [
    { x: 10, y: 20 },
    { x: 9, y: 19 },
    { x: 8, y: 18 }
  ],
  rallyPace: 0.1935,
  ballSpeed: 7.8064,
  impact: { team: 1, x: 10, y: 29, remainingMillis: 180 },
  motionEventId: 4
};

export const finishedSnapshot: PingPongSnapshot = {
  ...runningSnapshot,
  phase: "finished",
  score: 5,
  remainingMillis: 2400,
  success: true,
  lastEventCue: "score",
  lastEventMessage: "Punto para azul.",
  players: [
    { index: 0, label: "Rojo", color: redColor, score: 2, lives: 3 },
    { index: 1, label: "Azul", color: blueColor, score: 3, lives: 2 }
  ],
  lastRoundHits: 2,
  lastRoundWinner: "Azul",
  pointScorer: 1,
  winnerIndex: 1,
  motionEventId: 8,
  rounds: [
    { index: 1, winnerIndex: 0, winnerLabel: "Rojo", hits: 1 },
    { index: 2, winnerIndex: 1, winnerLabel: "Azul", hits: 2 }
  ]
};
