import type { ComponentType } from "react";
import type {
  Frame,
  GameConfig,
  GameContent,
  GameDifficulty,
  GameInstance,
  GameManifest,
  GameSnapshot
} from "@motion-levels-games/game-sdk";

import type { Avatar, Point } from "./core/avatar.ts";

export type SessionControllerAction = Readonly<{
  kind: string;
  target?: Readonly<Point>;
  /** Product-planned waypoints; JugarPresentationSession remains the movement adapter. */
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
  /** Host-owned live content provider for editor-authored games. */
  contentSource?: GameContentSource;
}>;

export type GameContentSelection = Readonly<{
  difficulty: GameDifficulty;
  levelId?: string;
  mode?: string;
}>;

export type GameLevelChoice = Readonly<{
  /** Immutable level-row UUID/hash used by runs, progress and replay. */
  id: string;
  /** Mutable author-facing name retained only for display and compatibility. */
  slug?: string;
  label: string;
  description?: string;
}>;

export type GameModeChoice = Readonly<{
  id: string;
  label: string;
  description?: string;
}>;

/**
 * Fetches current authored content from the host. Jugar owns no level database;
 * the same provider contract can be backed by the platform editor API in the
 * browser and by the venue's platform client on the physical floor.
 */
export type GameContentSource = Readonly<{
  modes?: readonly GameModeChoice[];
  defaultMode?: string;
  list(selection: Pick<GameContentSelection, "difficulty" | "mode">): Promise<readonly GameLevelChoice[]>;
  load(selection: GameContentSelection): Promise<GameContent>;
}>;

export type JugarRunStarted = Readonly<{
  gameId: string;
  playerCount: number;
  difficulty: string;
  levelId?: string;
  mode?: string;
}>;

export type JugarRunFinished = Readonly<{
  gameId: string;
  levelId?: string;
  mode?: string;
  score: number;
  success: boolean;
}>;
