export { PlayerDisplay } from "./display.tsx";
// Product/browser entrypoint. Headless harnesses and agent internals stay on
// their explicit package subpaths; the semantic session adapter is the only
// AI boundary consumed by Jugar 3D.
export * from "./session-controller.ts";
export {
  createGame,
  dueloPlayerPalette,
  dueloReadyZoneAnimation,
  dueloReadyZones,
  dueloStartingAnimation,
  dueloVictoryAnimation,
  dueloWaitingIdleAnimation,
  winAnimationMillis,
  type DueloClaimSnapshot,
  type DueloGameInstance,
  type DueloPlayerProgress,
  type DueloSnapshot
} from "./game.ts";
export {
  crowdedRunningFrame,
  crowdedRunningSnapshot,
  finishedFrame,
  finishedSnapshot,
  runningFrame,
  runningSnapshot,
  startingFrame,
  startingSnapshot,
  waitingFrame,
  waitingSnapshot
} from "./fixtures.ts";
export { dueloConfigVars, manifest } from "./manifest.ts";
export { playtestScenarios } from "./playtest.ts";
