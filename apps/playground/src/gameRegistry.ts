import type { ComponentType } from "react";
import type {
  Frame,
  GameConfig,
  GameDifficulty,
  GameEngine,
  GameEngineState,
  GameInstance,
  GameManifest,
  GameSnapshot
} from "@motion-levels-games/game-sdk";

export type PlaygroundAgentProfile =
  | "mixed"
  | "cautious"
  | "balanced"
  | "bold"
  | "helper"
  | "explorer"
  | "expert";

export type PlaygroundAgentHarnessOptions = Readonly<{
  seed?: number;
  profile?: PlaygroundAgentProfile;
  agentCount?: number;
  difficulty?: GameDifficulty;
  durationMillis?: number;
  playerCount?: number;
}>;

export type PlaygroundAgentPoint = Readonly<{ x: number; y: number }>;

export type PlaygroundRenderableAgent = Readonly<{
  id: string;
  tick: number;
  atMillis: number;
  color: string;
  profileId: string;
  variant?: "explorer" | "runner" | "trickster" | "guardian";
  position: PlaygroundAgentPoint;
  velocity: PlaygroundAgentPoint;
  facingRadians: number;
  grounded: boolean;
  action: string;
  intention: string;
  target?: PlaygroundAgentPoint;
  targetId?: string;
  emotion: string;
  debug: Readonly<{
    path: readonly PlaygroundAgentPoint[];
    reservations: readonly Readonly<{
      id: string;
      ownerId: string;
      kind: string;
      point?: PlaygroundAgentPoint;
      points?: readonly PlaygroundAgentPoint[];
    }>[];
    utility?: number;
    explanation: string;
    replanReason?: string;
    replans: number;
    stuckReplans: number;
  }>;
}>;

export type PlaygroundAgentHarnessFrame = Readonly<{
  tick: number;
  atMillis: number;
  state: GameEngineState;
  agents: readonly PlaygroundRenderableAgent[];
  replay: Readonly<{ checksum: string }>;
  debug: Readonly<{
    collisions: number;
    damage: number;
    deadlocks: number;
    replans: number;
    stuckReplans: number;
    routeDiversity: number;
    paths: readonly Readonly<{
      id: string;
      points: readonly PlaygroundAgentPoint[];
      color?: string;
    }>[];
    reservations: readonly Readonly<{
      id: string;
      ownerId: string;
      points: readonly PlaygroundAgentPoint[];
      color?: string;
    }>[];
    targets: readonly Readonly<{
      id: string;
      position: PlaygroundAgentPoint;
      radiusTiles?: number;
      color?: string;
    }>[];
  }>;
  metrics: Readonly<{
    completed: boolean;
    elapsedMillis: number;
    score: number;
    collisions: number;
    damage: number;
    deadlocks: number;
    replans: number;
    stuckReplans: number;
    routeDiversity: number;
  }>;
}>;

export type PlaygroundAgentHarness = {
  readonly engine: GameEngine;
  readonly state: GameEngineState;
  readonly frame: PlaygroundAgentHarnessFrame;
  readonly replay: unknown;
  restart(options?: PlaygroundAgentHarnessOptions): PlaygroundAgentHarnessFrame;
  reset(options?: PlaygroundAgentHarnessOptions): PlaygroundAgentHarnessFrame;
  step(ticks?: number): PlaygroundAgentHarnessFrame;
  finishReplay(): unknown;
};

export type PlaygroundAgentHarnessFactory = (
  options?: PlaygroundAgentHarnessOptions
) => PlaygroundAgentHarness;

export type PlaygroundGame = {
  manifest: GameManifest;
  createGame: (config: GameConfig) => GameInstance;
  PlayerDisplay: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  /** Optional deterministic agent integration discovered from the game module. */
  createAgentHarness?: PlaygroundAgentHarnessFactory;
};

export type GameModule = {
  manifest?: GameManifest;
  createGame?: (config: GameConfig) => GameInstance;
  PlayerDisplay?: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  createAgentHarness?: PlaygroundAgentHarnessFactory;
  /** Cruce's named export remains game-specific while the playground consumes a generic factory. */
  createCruceAgentHarness?: PlaygroundAgentHarnessFactory;
};

const defaultGameId = "ping-pong";
const gameModules = import.meta.glob<GameModule>("../../../games/*/src/index.ts", {
  eager: true
});

export const playgroundGames = Object.entries(gameModules)
  .map(([modulePath, module]) => normalizeGameModule(modulePath, module))
  .sort((left, right) => {
    if (left.manifest.id === defaultGameId) {
      return -1;
    }
    if (right.manifest.id === defaultGameId) {
      return 1;
    }

    return left.manifest.label.localeCompare(right.manifest.label);
  });

const firstGame = playgroundGames[0];

if (!firstGame) {
  throw new Error("No games found under games/*/src/index.ts.");
}

export const defaultGame: PlaygroundGame = firstGame;

function normalizeGameModule(modulePath: string, module: GameModule): PlaygroundGame {
  if (!module.manifest || typeof module.createGame !== "function" || !module.PlayerDisplay) {
    throw new Error(`${modulePath} must export manifest, createGame, and PlayerDisplay.`);
  }

  const createAgentHarness = module.createAgentHarness ?? module.createCruceAgentHarness;
  return {
    manifest: module.manifest,
    createGame: module.createGame,
    PlayerDisplay: module.PlayerDisplay,
    ...(createAgentHarness ? { createAgentHarness } : {})
  };
}
