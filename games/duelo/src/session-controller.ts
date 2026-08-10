import type {
  Frame,
  GameInstance,
  GameManifest,
  GameSnapshot
} from "@motion-levels-games/game-sdk";
import {
  createDueloAgentDirector,
  type DueloAgentDirector,
  type DueloAgentDirectorFrame,
  type DueloDirectorProfileSelection,
  type DueloDirectedAgentDecision,
  type DueloProfileId
} from "./agents.ts";
import type { DueloGameInstance, DueloSnapshot } from "./game.ts";

export type DueloSessionAvatar = Readonly<{
  id: number;
  playerIndex: number;
  isBot: boolean;
  position: Readonly<{ x: number; y: number }>;
  tile: Readonly<{ x: number; y: number }>;
  target: Readonly<{ x: number; y: number }> | null;
}>;

export type DueloSessionControllerAction = Readonly<{
  kind: string;
  target?: Readonly<{ x: number; y: number }>;
  path?: readonly Readonly<{ x: number; y: number }>[];
  explanation?: string;
}>;

export type DueloSessionControllerStepResult = Readonly<{
  action?: DueloSessionControllerAction;
  explanation?: string;
}>;

export type DueloSessionControllerObservation = Readonly<{
  tick: number;
  atMillis: number;
  deltaMillis: number;
  gameId: string;
  game: GameInstance;
  frame: Frame;
  snapshot: GameSnapshot;
  self: DueloSessionAvatar;
  avatars: readonly DueloSessionAvatar[];
}>;

export type DueloSessionController = Readonly<{
  id: string;
  step(observation: DueloSessionControllerObservation): DueloSessionControllerStepResult | undefined;
  dispose(): void;
}>;

export type DueloSessionControllerFactoryOptions = Readonly<{
  id: string;
  seed: number;
  playerIndex: number;
  game: GameInstance;
  manifest: GameManifest;
  /** Kept structurally compatible with renderer-neutral hosts; validated at the package boundary. */
  profile?: string;
}>;

export type DueloSessionProfile = DueloProfileId | "mixed";

type SharedSessionDirector = {
  game: DueloGameInstance;
  director: DueloAgentDirector;
  seed: number;
  profile: DueloDirectorProfileSelection | undefined;
  profileKey: string;
  playerCount: number;
  activeTargetIds: Map<number, string>;
  cachedTick: number;
  cachedFrame?: DueloAgentDirectorFrame;
  references: number;
};

const SESSION_DIRECTORS = new WeakMap<object, SharedSessionDirector>();

/**
 * Structurally compatible with Jugar 3D's optional SessionControllerFactory.
 * It imports no UI/runtime package and never creates or advances a game engine.
 */
export function createDueloSessionController(
  options: DueloSessionControllerFactoryOptions
): DueloSessionController {
  if (options.manifest.id !== "duelo") {
    throw new Error(`Duelo session controller cannot drive ${options.manifest.id}`);
  }
  if (!Number.isInteger(options.playerIndex) || options.playerIndex < 0 || options.playerIndex >= 8) {
    throw new Error("Duelo session controller playerIndex must be 0 through 7");
  }
  const initialGame = assertDueloGame(options.game);
  const profile = normalizeSessionProfile(options.profile);
  let shared = sharedDirector(initialGame, options.seed, profile);
  shared.references += 1;
  let disposed = false;

  return Object.freeze({
    id: options.id,
    step(observation) {
      if (disposed) return undefined;
      if (observation.gameId !== "duelo") return undefined;
      const game = assertDueloGame(observation.game);
      if (game !== shared.game) {
        releaseShared(shared);
        shared = sharedDirector(game, options.seed, profile);
        shared.references += 1;
      }
      const snapshot = observation.snapshot as DueloSnapshot;
      if (snapshot.phase !== "running") {
        return Object.freeze({ explanation: `Duelo is ${snapshot.phase}; readiness stays with GameSession` });
      }
      const frame = stepSharedDirector(shared, observation, snapshot);
      const decision = frame.decisions.find((entry) => entry.playerIndex === options.playerIndex);
      return sessionResult(decision);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseShared(shared);
    }
  });
}

/** Game-package registration alias; remains structurally typed and renderer-neutral. */
export const createSessionController = createDueloSessionController;

function sharedDirector(
  game: DueloGameInstance,
  seed: number,
  sessionProfile: DueloSessionProfile | undefined
): SharedSessionDirector {
  const existing = SESSION_DIRECTORS.get(game as object);
  const profileKey = sessionProfile ?? "duelo-reference";
  if (existing !== undefined) {
    if (existing.seed !== seed || existing.profileKey !== profileKey) {
      throw new Error("Duelo controllers sharing one game must use the same seed and profile");
    }
    return existing;
  }
  const playerCount = game.snapshot().playerCount;
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error("Duelo session controller requires the game's strict 2–8 player configuration");
  }
  const profile = directorProfile(sessionProfile);
  const shared: SharedSessionDirector = {
    game,
    director: createDueloAgentDirector({ game, playerCount, seed, profile }),
    seed,
    profile,
    profileKey,
    playerCount,
    activeTargetIds: new Map(),
    cachedTick: -1,
    cachedFrame: undefined,
    references: 0
  };
  SESSION_DIRECTORS.set(game as object, shared);
  return shared;
}

function stepSharedDirector(
  shared: SharedSessionDirector,
  observation: DueloSessionControllerObservation,
  snapshot: DueloSnapshot
): DueloAgentDirectorFrame {
  if (shared.cachedTick === observation.tick && shared.cachedFrame !== undefined) {
    return shared.cachedFrame;
  }
  if (observation.tick <= shared.cachedTick) {
    shared.director.reset({
      game: shared.game,
      playerCount: shared.playerCount,
      seed: shared.seed,
      profile: shared.profile
    });
    shared.activeTargetIds.clear();
  }
  const bots = observation.avatars
    .filter((avatar) => avatar.isBot)
    .sort((first, second) => first.playerIndex - second.playerIndex || first.id - second.id);
  const frame = shared.director.step({
    tick: observation.tick,
    atMillis: observation.atMillis,
    snapshot,
    agents: bots.map((avatar) => {
      const requesting = avatar.target === null;
      if (requesting) shared.activeTargetIds.delete(avatar.playerIndex);
      return Object.freeze({
        id: directorAgentId(avatar.playerIndex),
        playerIndex: avatar.playerIndex,
        position: Object.freeze({ x: avatar.tile.x, y: avatar.tile.y }),
        requestDecision: requesting,
        targetId: requesting ? undefined : shared.activeTargetIds.get(avatar.playerIndex)
      });
    })
  });
  for (const decision of frame.decisions) {
    if (decision.targetInvalidated) shared.activeTargetIds.delete(decision.playerIndex);
    if (decision.action?.targetId !== undefined) {
      shared.activeTargetIds.set(decision.playerIndex, decision.action.targetId);
    }
  }
  shared.cachedTick = observation.tick;
  shared.cachedFrame = frame;
  return frame;
}

const MIXED_SESSION_PROFILES = Object.freeze([
  "cautious",
  "balanced",
  "bold",
  "helper",
  "explorer",
  "expert"
] as const satisfies readonly DueloProfileId[]);

const SESSION_PROFILE_IDS = Object.freeze([
  "mixed",
  "cautious",
  "balanced",
  "bold",
  "helper",
  "explorer",
  "chaotic",
  "expert",
  "duelo-reference"
] as const satisfies readonly DueloSessionProfile[]);

function normalizeSessionProfile(profile: string | undefined): DueloSessionProfile | undefined {
  if (profile === undefined) return undefined;
  if (!(SESSION_PROFILE_IDS as readonly string[]).includes(profile)) {
    throw new Error(`Unknown Duelo session profile: ${profile}`);
  }
  return profile as DueloSessionProfile;
}

function directorProfile(
  profile: DueloSessionProfile | undefined
): DueloDirectorProfileSelection | undefined {
  return profile === "mixed" ? MIXED_SESSION_PROFILES : profile;
}

function sessionResult(
  decision: DueloDirectedAgentDecision | undefined
): DueloSessionControllerStepResult | undefined {
  if (decision === undefined) return undefined;
  const action = decision.action;
  return Object.freeze({
    action: action === undefined
      ? undefined
      : Object.freeze({
          kind: action.kind,
          target: action.target,
          path: decision.path,
          explanation: action.explanation
        }),
    explanation: decision.explanation
  });
}

function directorAgentId(playerIndex: number): string {
  return `duelo-session-player-${playerIndex + 1}`;
}

function assertDueloGame(game: GameInstance): DueloGameInstance {
  const candidate = game as Partial<DueloGameInstance>;
  if (typeof candidate.targetOwner !== "function"
    || typeof candidate.targetClaimed !== "function"
    || typeof candidate.playerReadyZones !== "function") {
    throw new Error("Duelo session controller requires a semantic DueloGameInstance");
  }
  return candidate as DueloGameInstance;
}

function releaseShared(shared: SharedSessionDirector): void {
  shared.references = Math.max(0, shared.references - 1);
  if (shared.references === 0) SESSION_DIRECTORS.delete(shared.game as object);
}
