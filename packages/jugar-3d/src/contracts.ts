import type { ComponentType } from "react";
import type {
  Frame,
  GameConfig,
  GameInstance,
  GameManifest,
  GameSnapshot
} from "@motion-levels-games/game-sdk";

import type { Avatar, Point } from "./core/avatar.ts";

export type SessionControllerAction = Readonly<{
  kind: string;
  target?: Readonly<Point>;
  /** Product-planned waypoints; GameSession remains the movement authority. */
  path?: readonly Readonly<Point>[];
  explanation?: string;
}>;

export type SessionControllerStepResult = Readonly<{
  action?: SessionControllerAction;
  explanation?: string;
}>;

export type SessionControllerObservation = Readonly<{
  tick: number;
  atMillis: number;
  deltaMillis: number;
  gameId: string;
  game: GameInstance;
  frame: Frame;
  snapshot: GameSnapshot;
  self: Readonly<Avatar>;
  avatars: readonly Readonly<Avatar>[];
}>;

export type SessionController = Readonly<{
  id: string;
  step(observation: SessionControllerObservation): SessionControllerStepResult | undefined;
  dispose?(): void;
}>;

export type SessionControllerFactoryOptions = Readonly<{
  id: string;
  seed: number;
  playerIndex: number;
  game: GameInstance;
  manifest: GameManifest;
  /** Optional product profile id selected by a Jugar agent-surface host. */
  profile?: string;
}>;

export type SessionControllerFactory = (
  options: SessionControllerFactoryOptions
) => SessionController;

export type RegisteredGame = Readonly<{
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
  PlayerDisplay: ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  /** Optional product adapter; it must use the supplied game and never create another engine. */
  createSessionController?: SessionControllerFactory;
}>;

export type GameEntry = Readonly<{
  manifest: GameManifest;
  load(): Promise<RegisteredGame>;
}>;

export type JugarRunStarted = Readonly<{
  gameId: string;
  playerCount: number;
  difficulty: string;
}>;

export type JugarRunFinished = Readonly<{
  gameId: string;
  score: number;
  success: boolean;
}>;
