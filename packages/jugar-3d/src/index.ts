export type {
  GameEntry,
  JugarRunFinished,
  JugarRunStarted,
  RegisteredGame,
  SessionController,
  SessionControllerAction,
  SessionControllerFactory,
  SessionControllerFactoryOptions,
  SessionControllerObservation,
  SessionControllerStepResult
} from "./contracts.ts";
export {
  GameSession,
  type SessionAgentDebug,
  type SessionControllerSlots,
  type SessionOptions,
  type SessionRestartOptions,
  type SessionTrajectoryFrame
} from "./core/session.ts";
export { characterCatalog, defaultCharacterId, findCharacter } from "./characters/catalog.ts";
export {
  JugarStagePerformanceMonitor,
  bytesToMegabytes,
  estimateJugarStageMemoryProxy,
  jugarStageQualityBudgets,
  type JugarStageBudgetViolation,
  type JugarStageDiagnostics,
  type JugarStageDiagnosticsContext,
  type JugarStageMemoryProxy,
  type JugarStageMemoryProxyOptions,
  type JugarStagePerformanceSample,
  type JugarStageQuality,
  type JugarStageQualityBudget,
  type JugarStageRendererEnvironment
} from "./performance.ts";
