import {
  inFloorBounds,
  type Frame,
  type GameInstance,
  type GameManifest,
  type GameSnapshot
} from "@motion-levels-games/game-sdk";

import type {
  PublishedLevelGameInstance,
  PublishedLevelSemanticTile,
  PublishedLevelSnapshot
} from "./types.ts";

type Point = Readonly<{ x: number; y: number }>;
export type PublishedLevelSessionAvatar = Readonly<{
  id: number;
  playerIndex: number;
  isBot: boolean;
  tile: Point;
  target: Point | null;
  airborneUntil?: number;
}>;

export type PublishedLevelSessionControllerAction = Readonly<{
  kind: string;
  target?: Point;
  path?: readonly Point[];
  explanation?: string;
}>;

export type PublishedLevelSessionControllerStepResult = Readonly<{
  action?: PublishedLevelSessionControllerAction;
  explanation?: string;
}>;

export type PublishedLevelSessionControllerObservation = Readonly<{
  tick: number;
  atMillis: number;
  deltaMillis: number;
  gameId: string;
  game: GameInstance;
  frame: Frame;
  snapshot: GameSnapshot;
  self: PublishedLevelSessionAvatar;
  avatars: readonly PublishedLevelSessionAvatar[];
}>;

export type PublishedLevelSessionController = Readonly<{
  id: string;
  step(
    observation: PublishedLevelSessionControllerObservation
  ): PublishedLevelSessionControllerStepResult | undefined;
  dispose?(): void;
}>;

export type PublishedLevelSessionControllerFactoryOptions = Readonly<{
  id: string;
  seed: number;
  playerIndex: number;
  game: GameInstance;
  manifest: GameManifest;
  profile?: string;
}>;

export type PublishedLevelSessionControllerFactory = (
  options: PublishedLevelSessionControllerFactoryOptions
) => PublishedLevelSessionController;

type TargetGroup = Readonly<{ uniq: string; tiles: readonly PublishedLevelSemanticTile[] }>;
type ControllerProfile = Readonly<{
  hazardCost: number;
  occupiedCost: number;
  emptyCost: number;
}>;
type SharedPlanner = {
  game: PublishedLevelGameInstance;
  seed: number;
  profileKey: string;
  assignments: Map<number, string>;
  references: number;
};

const SHARED_PLANNERS = new WeakMap<object, SharedPlanner>();

/** Semantic Jugar 3D adapter. It observes the supplied engine and never creates or advances one. */
export function createPublishedLevelSessionController(
  options: PublishedLevelSessionControllerFactoryOptions
): PublishedLevelSessionController {
  const initialGame = assertPublishedLevelGame(options.game);
  const initialSnapshot = initialGame.snapshot();
  if (initialSnapshot.currentGame !== options.manifest.id) {
    throw new Error(
      `Published-level controller cannot drive ${initialSnapshot.currentGame} as ${options.manifest.id}`
    );
  }
  if (!Number.isInteger(options.playerIndex)
    || options.playerIndex < 0
    || options.playerIndex >= initialSnapshot.playerCount) {
    throw new Error("Published-level controller playerIndex must address a configured player");
  }
  const profileKey = normalizeProfile(options.profile);
  let shared = sharedPlanner(initialGame, options.seed, profileKey);
  shared.references += 1;
  let disposed = false;

  return Object.freeze({
    id: options.id,
    step(observation) {
      if (disposed) return undefined;
      if (observation.gameId !== options.manifest.id) return undefined;
      const game = assertPublishedLevelGame(observation.game);
      if (game !== shared.game) {
        releaseShared(shared, options.playerIndex);
        shared = sharedPlanner(game, options.seed, profileKey);
        shared.references += 1;
      }
      return decide(shared, options.playerIndex, observation);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseShared(shared, options.playerIndex);
    }
  });
}

function decide(
  shared: SharedPlanner,
  playerIndex: number,
  observation: PublishedLevelSessionControllerObservation
): PublishedLevelSessionControllerStepResult | undefined {
  const snapshot = observation.snapshot as PublishedLevelSnapshot;
  if (snapshot.phase !== "running") {
    return { explanation: `Published level is ${snapshot.phase}; the authoritative countdown remains in the game` };
  }

  const semantic = shared.game.semanticTiles(observation.atMillis);
  const targets = targetGroups(semantic);
  const availableIds = new Set(targets.map((target) => target.uniq));
  for (const [owner, uniq] of shared.assignments) {
    if (!availableIds.has(uniq)) shared.assignments.delete(owner);
  }

  const current = semantic.find((tile) =>
    tile.x === observation.self.tile.x && tile.y === observation.self.tile.y
  );
  if (current?.originalKind === 3 && !current.removed && current.kind === 4) {
    return jumpResult("Purple objective is held; jump releases it for the required second press");
  }

  let assigned = shared.assignments.get(playerIndex);
  let target = assigned ? targets.find((candidate) => candidate.uniq === assigned) : undefined;
  if (!target) {
    target = chooseTarget(shared, playerIndex, observation.self.tile, targets);
    assigned = target?.uniq;
    if (assigned) shared.assignments.set(playerIndex, assigned);
  }

  if (!target) {
    return { explanation: "No visible uncaptured blue or purple objective is available" };
  }

  const profile = profileFor(shared.profileKey, playerIndex);
  const occupied = observation.avatars
    .filter((avatar) => avatar.id !== observation.self.id)
    .flatMap((avatar) => [avatar.tile, ...(avatar.target ? [avatar.target] : [])]);
  const route = bestRoute(shared.game, observation.self.tile, target.tiles, semantic, occupied, profile, observation.atMillis);
  if (!route || route.length === 0) {
    return {
      explanation: current?.originalKind === 3 && current.primed
        ? "Purple objective is primed; allow the avatar to land and press it a second time"
        : `Objective ${target.uniq} is underfoot; allow floor authority to register the press`
    };
  }

  const immediate = observation.self.target ?? route[0]!;
  const airborneUntil = observation.self.airborneUntil ?? 0;
  // First give GameSession the route. On the next authority step its target is
  // observable here, so a jump starts before movement/press evaluation while
  // preserving the already-owned path through the jump arc.
  if (observation.self.target
    && shared.game.dangerAt(immediate.x, immediate.y, observation.atMillis) > 0
    && airborneUntil <= observation.atMillis) {
    return jumpResult(`A red hazard is forecast at ${immediate.x},${immediate.y}; jump before crossing`);
  }

  if (observation.self.target) {
    return { explanation: `Following a semantic route to objective ${target.uniq}` };
  }

  const destination = route.at(-1)!;
  const explanation = `Reserved objective ${target.uniq}; planned ${route.length} safe tile${route.length === 1 ? "" : "s"}`;
  return Object.freeze({
    action: Object.freeze({ kind: "move", target: destination, path: Object.freeze(route), explanation }),
    explanation
  });
}

function jumpResult(explanation: string): PublishedLevelSessionControllerStepResult {
  return Object.freeze({
    action: Object.freeze({ kind: "jump", explanation }),
    explanation
  });
}

function targetGroups(tiles: readonly PublishedLevelSemanticTile[]): TargetGroup[] {
  const grouped = new Map<string, PublishedLevelSemanticTile[]>();
  for (const tile of tiles) {
    if (tile.removed || !tile.uniq || (tile.originalKind !== 1 && tile.originalKind !== 3)) continue;
    const group = grouped.get(tile.uniq) ?? [];
    group.push(tile);
    grouped.set(tile.uniq, group);
  }
  return [...grouped.entries()]
    .map(([uniq, values]) => Object.freeze({
      uniq,
      tiles: Object.freeze(values.sort((left, right) => left.y - right.y || left.x - right.x))
    }))
    .sort((left, right) => left.uniq.localeCompare(right.uniq));
}

function chooseTarget(
  shared: SharedPlanner,
  playerIndex: number,
  from: Point,
  targets: readonly TargetGroup[]
): TargetGroup | undefined {
  const claimed = new Set(
    [...shared.assignments.entries()]
      .filter(([owner]) => owner !== playerIndex)
      .map(([, uniq]) => uniq)
  );
  const unclaimed = targets.filter((target) => !claimed.has(target.uniq));
  const candidates = unclaimed.length > 0 ? unclaimed : targets;
  return [...candidates].sort((left, right) => {
    const leftDistance = groupDistance(from, left);
    const rightDistance = groupDistance(from, right);
    return leftDistance - rightDistance
      || stableRank(shared.seed, playerIndex, left.uniq) - stableRank(shared.seed, playerIndex, right.uniq)
      || left.uniq.localeCompare(right.uniq);
  })[0];
}

function groupDistance(from: Point, target: TargetGroup): number {
  return Math.min(...target.tiles.map((tile) => manhattan(from, tile)));
}

function bestRoute(
  game: PublishedLevelGameInstance,
  from: Point,
  destinations: readonly Point[],
  semantic: readonly PublishedLevelSemanticTile[],
  occupied: readonly Point[],
  profile: ControllerProfile,
  atMillis: number
): Point[] | undefined {
  const targetKeys = new Set(destinations.map(pointKey));
  const byKey = new Map(semantic.map((tile) => [pointKey(tile), tile]));
  const startKey = pointKey(from);
  const open = new Set([startKey]);
  const cameFrom = new Map<string, string>();
  const scores = new Map([[startKey, 0]]);
  const estimates = new Map([[startKey, nearestDistance(from, destinations)]]);

  while (open.size > 0) {
    const currentKey = [...open].sort((left, right) =>
      (estimates.get(left) ?? Infinity) - (estimates.get(right) ?? Infinity)
      || left.localeCompare(right)
    )[0]!;
    if (targetKeys.has(currentKey)) return reconstructPath(cameFrom, currentKey).slice(1);
    open.delete(currentKey);
    const current = parsePointKey(currentKey);
    for (const next of neighbors(current)) {
      const nextKey = pointKey(next);
      const tile = byKey.get(nextKey);
      const hazard = tile?.kind === 2 || game.dangerAt(next.x, next.y, atMillis) > 0;
      const occupiedPenalty = occupied.some((spot) => spot.x === next.x && spot.y === next.y)
        ? profile.occupiedCost
        : 0;
      const traversal = tile?.present ? 1 : profile.emptyCost;
      const tentative = (scores.get(currentKey) ?? Infinity)
        + traversal
        + (hazard ? profile.hazardCost : 0)
        + occupiedPenalty;
      if (tentative >= (scores.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      scores.set(nextKey, tentative);
      estimates.set(nextKey, tentative + nearestDistance(next, destinations));
      open.add(nextKey);
    }
  }
  return undefined;
}

function reconstructPath(cameFrom: ReadonlyMap<string, string>, end: string): Point[] {
  const path = [parsePointKey(end)];
  let cursor = end;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    path.push(parsePointKey(cursor));
  }
  return path.reverse();
}

function neighbors(point: Point): Point[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 }
  ].filter((next) => inFloorBounds(next.x, next.y));
}

function nearestDistance(point: Point, destinations: readonly Point[]): number {
  return Math.min(...destinations.map((destination) => manhattan(point, destination)));
}

function manhattan(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function parsePointKey(value: string): Point {
  const [x = "0", y = "0"] = value.split(",");
  return { x: Number(x), y: Number(y) };
}

function stableRank(seed: number, playerIndex: number, value: string): number {
  let hash = (seed ^ Math.imul(playerIndex + 1, 0x9e3779b1)) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  return hash;
}

function normalizeProfile(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() || "balanced";
  if (!["balanced", "cautious", "bold", "expert", "mixed"].includes(normalized)) {
    throw new Error(`Unknown published-level controller profile: ${value}`);
  }
  return normalized;
}

function profileFor(profileKey: string, playerIndex: number): ControllerProfile {
  const key = profileKey === "mixed"
    ? ["cautious", "balanced", "bold", "expert"][playerIndex % 4]!
    : profileKey;
  if (key === "cautious") return { hazardCost: 120, occupiedCost: 16, emptyCost: 2.4 };
  if (key === "bold") return { hazardCost: 14, occupiedCost: 5, emptyCost: 1.4 };
  if (key === "expert") return { hazardCost: 200, occupiedCost: 12, emptyCost: 1.8 };
  return { hazardCost: 60, occupiedCost: 9, emptyCost: 1.8 };
}

function sharedPlanner(
  game: PublishedLevelGameInstance,
  seed: number,
  profileKey: string
): SharedPlanner {
  const existing = SHARED_PLANNERS.get(game as object);
  if (existing) {
    if (existing.seed !== seed || existing.profileKey !== profileKey) {
      throw new Error("Published-level controllers sharing one game must use the same seed and profile");
    }
    return existing;
  }
  const shared: SharedPlanner = {
    game,
    seed,
    profileKey,
    assignments: new Map(),
    references: 0
  };
  SHARED_PLANNERS.set(game as object, shared);
  return shared;
}

function releaseShared(shared: SharedPlanner, playerIndex: number): void {
  shared.assignments.delete(playerIndex);
  shared.references = Math.max(0, shared.references - 1);
  if (shared.references === 0) SHARED_PLANNERS.delete(shared.game as object);
}

function assertPublishedLevelGame(game: GameInstance): PublishedLevelGameInstance {
  const candidate = game as Partial<PublishedLevelGameInstance>;
  if (typeof candidate.semanticTiles !== "function"
    || typeof candidate.dangerAt !== "function"
    || typeof candidate.playerReadyZones !== "function") {
    throw new Error("Published-level controller requires a semantic published-level game instance");
  }
  return candidate as PublishedLevelGameInstance;
}
