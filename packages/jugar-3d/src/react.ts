export { Jugar3DApp, type Jugar3DAppProps } from "./MinigameApp.tsx";
export { useGameSession, type UseGameSessionOptions } from "./core/useGameSession.ts";
export type { SessionAgentDebug, SessionTrajectoryFrame } from "./core/session.ts";
export {
  default as Stage,
  type JugarStageDebugOptions,
  type JugarStageProps,
  type JugarStageQuality
} from "./scene/Stage.tsx";
export {
  jugarStageQualityBudgets,
  type JugarStageBudgetViolation,
  type JugarStageDiagnostics,
  type JugarStageDiagnosticsContext,
  type JugarStagePerformanceSample,
  type JugarStageQualityBudget,
  type JugarStageRendererEnvironment
} from "./performance.ts";
