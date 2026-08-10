import {
  DEFAULT_ENGINE_FPS,
  DEFAULT_ENGINE_MAX_CATCH_UP_STEPS,
  FLOOR_COLS,
  FLOOR_ROWS,
  createGameEngine,
  normalizeGameSeed,
  type GameConfig,
  type GameConfigOptions,
  type GameEngine,
  type GameEngineState,
  type GameEvent,
  type GameInstance
} from "@motion-levels-games/game-sdk";
import { replayChecksum } from "@motion-levels-games/replay-runtime";

import type {
  RegisteredGame,
  SessionController,
  SessionControllerObservation
} from "../contracts.ts";
import {
  createAvatar,
  setAvatarTarget,
  startAvatarJump,
  updateAvatar,
  type Avatar,
  type Point,
  type PressOp
} from "./avatar.ts";
import { ReadyZoneDirector, createSeededFallbackController } from "./bots.ts";
import { centroid, resolveReadyZones, type ZoneAwareGame } from "./readyZones.ts";
import type { Tile } from "./tileMath.ts";

export type SessionControllerSlots = "bots" | "all";

export type SessionOptions = Readonly<{
  playerCount: number;
  difficulty?: string;
  durationMillis?: number;
  gameOptions?: GameConfigOptions;
  seed?: number;
  fps?: number;
  maxCatchUpSteps?: number;
  /** `all` creates an AI-only session; the regular Jugar surface defaults to companion bots. */
  controllerSlots?: SessionControllerSlots;
  controllerProfile?: string;
}>;

export type SessionRestartOptions = Readonly<{
  /** Omit for a fresh live seed; pass a seed to reproduce an exact run. */
  seed?: number;
}>;

export type SessionAgentDebug = Readonly<{
  avatarId: number;
  playerIndex: number;
  target?: Readonly<Point>;
  path: readonly Readonly<Point>[];
  explanation: string;
}>;

export type SessionTrajectoryFrame = Readonly<{
  gameId: string;
  seed: number;
  tick: number;
  atMillis: number;
  state: GameEngineState;
  avatars: readonly Readonly<Avatar>[];
  agentDebug: readonly SessionAgentDebug[];
  checksum: string;
}>;

export type SessionSounds = {
  cue(cue: string): void;
  step(): void;
  jump(): void;
};

/** Travel speed in tiles per second. */
const HUMAN_SPEED = 6.4;
const BOT_SPEED = 4.8;
const NOTIFY_INTERVAL_MILLIS = 80;

const AVATAR_COLORS = ["#b8ff00", "#23d5ff", "#ff5c8a", "#ffb020", "#8f7bff", "#4dffb8"];

/**
 * Owns the one authoritative game instance used by Jugar 3D. Animation frames
 * only provide elapsed presentation time; authority advances in exact SDK
 * frame-sized ticks, which makes pause, replay and explicit stepping stable.
 */
export class GameSession {
  readonly game: RegisteredGame;
  readonly options: SessionOptions;
  readonly avatars: Avatar[];
  readonly engine: GameEngine;
  /** Live game instance; some games expose extras such as playerReadyZones(). */
  instance: GameInstance & ZoneAwareGame;

  clockMillis = 0;
  paused = false;
  timeScale = 1;
  version = 0;
  sounds: SessionSounds | null = null;

  private rafHandle = 0;
  private lastRafAt: number | null = null;
  private accumulatedMillis = 0;
  private lastNotifyAt = Number.NEGATIVE_INFINITY;
  private listeners = new Set<() => void>();
  private trajectoryListeners = new Set<(frame: SessionTrajectoryFrame) => void>();
  private seedValue: number;
  private tickValue = 0;
  private disposed = false;
  private readonly maxCatchUpSteps: number;
  private readonly readyZoneDirector = new ReadyZoneDirector();
  private controllers = new Map<number, SessionController>();
  private controllerPaths = new Map<number, Point[]>();
  private controllerDebug = new Map<number, SessionAgentDebug>();
  private presentationState: GameEngineState | undefined;
  private presentationDebug: readonly SessionAgentDebug[] | undefined;
  private playbackAuthorityAvatars: Avatar[] | undefined;

  constructor(game: RegisteredGame, options: SessionOptions) {
    this.game = game;
    this.options = options;
    this.seedValue = normalizeGameSeed(options.seed ?? randomSeed());
    this.maxCatchUpSteps = normalizeCatchUpSteps(options.maxCatchUpSteps);
    const instance = game.createGame(this.buildConfig());
    const initialEvents = instance.init(0);
    this.instance = instance;
    this.engine = createGameEngine(instance, {
      fps: options.fps ?? DEFAULT_ENGINE_FPS,
      initialEvents,
      nowMillis: 0
    });

    const snapshot = instance.snapshot();
    const players = snapshot.players ?? [];
    const playerCount = Math.max(1, Math.trunc(options.playerCount));
    const allBots = options.controllerSlots === "all";

    // Which game player each avatar plays. The first local slot gets whichever
    // ready zone sits nearest the camera; automated sessions still retain that
    // stable assignment so replay output matches the regular Jugar surface.
    const zones = resolveReadyZones(this.instance, this.engine.state.frame, snapshot);
    const assignment = assignPlayers(zones, playerCount);
    const firstZone = humanSpawnZone(zones, assignment[0] ?? 0);

    this.avatars = assignment.map((playerIndex, index) => {
      const automated = allBots || index > 0;
      return createAvatar(
        index,
        playerIndex,
        automated,
        players[playerIndex]?.color ??
          AVATAR_COLORS[playerIndex % AVATAR_COLORS.length] ??
          "#b8ff00",
        spawnTile(index, playerCount, index === 0 ? firstZone : undefined),
        automated ? BOT_SPEED : HUMAN_SPEED
      );
    });

    this.rebuildControllers();
    this.emitEvents(initialEvents);
  }

  get state(): GameEngineState {
    return this.presentationState ?? this.engine.state;
  }

  get agentDebug(): readonly SessionAgentDebug[] {
    return this.presentationDebug ?? [...this.controllerDebug.values()];
  }

  get seed(): number {
    return this.seedValue;
  }

  get tick(): number {
    return this.tickValue;
  }

  /** Clock visible to scene animation; exact recorded time during playback. */
  get presentationMillis(): number {
    return this.presentationState?.clockMillis ?? this.clockMillis;
  }

  /** True while the Stage is presenting a retained frame over parked live authority. */
  get isPresentingTrajectory(): boolean {
    return this.presentationState !== undefined;
  }

  get running(): boolean {
    return this.rafHandle !== 0;
  }

  start(): void {
    this.assertActive();
    if (this.rafHandle) return;
    if (typeof requestAnimationFrame !== "function") {
      throw new Error("GameSession.start() requires a browser animation frame scheduler");
    }
    this.lastRafAt = null;
    const loop = (nowMillis: number) => {
      if (!this.rafHandle) return;
      this.advanceTo(nowMillis);
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  /** Stop advancing; safe to start() again (including StrictMode remounts). */
  stop(): void {
    if (this.rafHandle && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = 0;
    this.lastRafAt = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposeControllers();
    this.listeners.clear();
    this.trajectoryListeners.clear();
    this.sounds = null;
    this.disposed = true;
  }

  subscribe(listener: () => void): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Receives every exact authority tick, including ticks batched inside one rAF. */
  subscribeTrajectory(listener: (frame: SessionTrajectoryFrame) => void): () => void {
    this.assertActive();
    this.trajectoryListeners.add(listener);
    return () => this.trajectoryListeners.delete(listener);
  }

  setPaused(paused: boolean): void {
    this.assertActive();
    if (this.paused === paused) return;
    this.paused = paused;
    // Re-anchor rAF on either transition so resume never catches up wall time.
    this.lastRafAt = null;
    this.accumulatedMillis = 0;
    this.notify(true);
  }

  setTimeScale(timeScale: number): void {
    this.assertActive();
    if (!Number.isFinite(timeScale) || timeScale <= 0 || timeScale > 4) {
      throw new Error("GameSession timeScale must be finite and greater than 0 through 4");
    }
    this.timeScale = timeScale;
    this.accumulatedMillis = 0;
    this.lastRafAt = null;
    this.notify(true);
  }

  restart(options: SessionRestartOptions = {}): void {
    this.assertActive();
    this.clearTrajectoryPlayback(false);
    this.seedValue = normalizeGameSeed(options.seed ?? randomSeed());
    this.clockMillis = 0;
    this.tickValue = 0;
    this.lastRafAt = null;
    this.accumulatedMillis = 0;
    this.disposeControllers();
    this.controllerDebug.clear();
    this.controllerPaths.clear();
    this.readyZoneDirector.reset();

    const instance = this.game.createGame(this.buildConfig());
    const initialEvents = instance.init(0);
    this.instance = instance;
    this.engine.replaceGame(instance, { initialEvents, nowMillis: 0 });

    // Player assignment is kept across restarts: moving a person to a
    // different corner between rounds would be disorienting.
    const zones = resolveReadyZones(this.instance, this.engine.state.frame, instance.snapshot());
    const firstZone = humanSpawnZone(zones, this.avatars[0]?.playerIndex ?? 0);

    for (const [index, avatar] of this.avatars.entries()) {
      const spawn = spawnTile(index, this.avatars.length, index === 0 ? firstZone : undefined);
      avatar.tile = spawn;
      avatar.position = { x: spawn.x, y: spawn.y };
      avatar.pressedTile = null;
      avatar.target = null;
      avatar.jumpStartedAt = 0;
      avatar.airborneUntil = 0;
      avatar.stepCount = 0;
      avatar.zoneIndex = null;
    }

    this.rebuildControllers();
    this.emitEvents(initialEvents);
    this.notify(true);
  }

  /** Local input: walk the first non-automated avatar toward a board point. */
  moveTo(point: Point): void {
    this.assertActive();
    const human = this.avatars.find((avatar) => !avatar.isBot);
    if (!human || this.paused) return;
    setAvatarTarget(human, point);
  }

  /** Local input: jump. Travel continues through the arc. */
  jump(): void {
    this.assertActive();
    const human = this.avatars.find((avatar) => !avatar.isBot);
    if (!human || this.paused) return;
    const ops = startAvatarJump(human, this.clockMillis);
    if (ops.length > 0 || human.jumpStartedAt === this.clockMillis) this.sounds?.jump();
    this.applyOps(ops);
  }

  /**
   * Consume a monotonic presentation timestamp. No partial authority step is
   * exposed: elapsed time is accumulated and converted to fixed engine ticks.
   */
  advanceTo(nowMillis: number): void {
    this.assertActive();
    if (!Number.isFinite(nowMillis)) {
      throw new Error("GameSession.advanceTo() requires a finite timestamp");
    }
    if (this.lastRafAt === null || nowMillis < this.lastRafAt) {
      this.lastRafAt = nowMillis;
      return;
    }

    const elapsed = nowMillis - this.lastRafAt;
    this.lastRafAt = nowMillis;
    if (this.paused) return;

    const frameMillis = this.engine.frameMillis;
    const maxElapsed = frameMillis * this.maxCatchUpSteps;
    this.accumulatedMillis += Math.min(elapsed * this.timeScale, maxElapsed);

    let steps = 0;
    while (this.accumulatedMillis + Number.EPSILON >= frameMillis && steps < this.maxCatchUpSteps) {
      this.stepAuthority(frameMillis);
      this.accumulatedMillis -= frameMillis;
      steps += 1;
    }
    if (steps === this.maxCatchUpSteps && this.accumulatedMillis >= frameMillis) {
      this.accumulatedMillis = 0;
    }
    if (steps > 0) this.notify(false);
  }

  /** Explicit developer/replay step; advances even while the session is paused. */
  stepTicks(ticks = 1): GameEngineState {
    this.assertActive();
    if (this.presentationState) {
      throw new Error("Exit trajectory playback before advancing live authority");
    }
    if (!Number.isInteger(ticks) || ticks < 1) {
      throw new Error("GameSession.stepTicks() requires a positive integer");
    }
    for (let index = 0; index < ticks; index += 1) {
      this.stepAuthority(this.engine.frameMillis);
    }
    this.notify(true);
    return this.state;
  }

  captureTrajectoryFrame(): SessionTrajectoryFrame {
    this.assertActive();
    const state = cloneState(this.presentationState ?? this.engine.state);
    const avatars = this.avatars.map(cloneAvatar);
    const agentDebug = (this.presentationDebug ?? [...this.controllerDebug.values()]).map(cloneDebug);
    const payload = {
      gameId: this.game.manifest.id,
      seed: this.seedValue,
      tick: this.presentationState ? trajectoryTickFromState(state, this.engine.frameMillis) : this.tickValue,
      atMillis: state.clockMillis,
      state,
      avatars,
      agentDebug
    };
    return Object.freeze({ ...payload, checksum: trajectoryChecksum(payload) });
  }

  /** Present an exact recorded frame while leaving live authority untouched. */
  presentTrajectoryFrame(frame: SessionTrajectoryFrame): void {
    this.assertActive();
    if (frame.gameId !== this.game.manifest.id || frame.seed !== this.seedValue) {
      throw new Error("Trajectory frame does not belong to this Jugar session");
    }
    if (trajectoryChecksum(frame) !== frame.checksum) {
      throw new Error("Trajectory frame checksum mismatch");
    }
    if (!this.playbackAuthorityAvatars) {
      this.playbackAuthorityAvatars = this.avatars.map(cloneAvatar);
    }
    this.presentationState = cloneState(frame.state);
    this.presentationDebug = frame.agentDebug.map(cloneDebug);
    this.avatars.splice(0, this.avatars.length, ...frame.avatars.map(cloneAvatar));
    this.notify(true);
  }

  /** Restore the live engine/avatar state held when playback began. */
  exitTrajectoryPlayback(): void {
    this.clearTrajectoryPlayback(true);
  }

  private stepAuthority(deltaMillis: number): void {
    this.clockMillis += deltaMillis;
    this.tickValue += 1;

    this.updateControllers(deltaMillis);
    this.readyZoneDirector.update(this);

    let humanStepped = false;
    for (const avatar of this.avatars) {
      const stepsBefore = avatar.stepCount;
      const ops = this.controllers.has(avatar.id)
        ? updateAvatar(avatar, this.clockMillis, deltaMillis, {
            // AI routes clamp exactly onto their destination centre without
            // the human click-settle curve, preserving configured tile speed.
            settleAtTarget: false,
            nextTarget: () => this.takeControllerWaypoint(avatar.id)
          })
        : updateAvatar(avatar, this.clockMillis, deltaMillis);
      this.applyOps(ops);
      if (!avatar.isBot && avatar.stepCount > stepsBefore) humanStepped = true;
    }
    if (humanStepped) this.sounds?.step();

    const state = this.engine.tickTo(this.clockMillis);
    this.emitEvents(state.events);
    if (this.trajectoryListeners.size > 0) {
      const frame = this.captureTrajectoryFrame();
      for (const listener of this.trajectoryListeners) listener(frame);
    }
  }

  private updateControllers(deltaMillis: number): void {
    if (this.controllers.size === 0) return;
    for (const avatar of this.avatars) this.advanceControllerPath(avatar);
    const avatars = Object.freeze(this.avatars.map(readonlyAvatar));
    const state = this.state;
    for (const avatar of this.avatars) {
      const controller = this.controllers.get(avatar.id);
      if (!controller) continue;
      const self = avatars.find((candidate) => candidate.id === avatar.id);
      if (!self) continue;
      const observation: SessionControllerObservation = Object.freeze({
        tick: this.tickValue,
        atMillis: this.clockMillis,
        deltaMillis,
        gameId: this.game.manifest.id,
        game: this.instance,
        frame: state.frame,
        snapshot: state.snapshot,
        self,
        avatars
      });
      const result = controller.step(observation);
      const action = result?.action;
      if (action?.kind === "move" && isFinitePoint(action.target)) {
        const plannedPath = sanitizePath(action.path, avatar.tile, action.target);
        this.controllerPaths.set(avatar.id, plannedPath);
        this.advanceControllerPath(avatar);
        const remainingPath = this.controllerPaths.get(avatar.id) ?? [];
        this.controllerDebug.set(avatar.id, Object.freeze({
          avatarId: avatar.id,
          playerIndex: avatar.playerIndex,
          target: Object.freeze({ ...action.target }),
          path: Object.freeze([
            Object.freeze({ ...avatar.tile }),
            ...(avatar.target ? [Object.freeze({ ...avatar.target })] : []),
            ...remainingPath.map((point) => Object.freeze({ ...point }))
          ]),
          explanation: action.explanation ?? result?.explanation ?? "Controller selected a target"
        }));
      } else if (action?.kind === "jump") {
        this.applyOps(startAvatarJump(avatar, this.clockMillis));
      } else if (result?.explanation) {
        const previous = this.controllerDebug.get(avatar.id);
        if (previous) {
          this.controllerDebug.set(avatar.id, Object.freeze({
            ...previous,
            explanation: result.explanation
          }));
        }
      }
    }
  }

  private rebuildControllers(): void {
    const factory = this.game.createSessionController ?? createSeededFallbackController;
    for (const avatar of this.avatars) {
      if (!avatar.isBot) continue;
      const controller = factory({
        id: `jugar-${this.game.manifest.id}-${avatar.id}`,
        // A product factory may coordinate all avatars through one director.
        // It receives one session seed and derives per-player streams itself.
        seed: this.seedValue,
        playerIndex: avatar.playerIndex,
        game: this.instance,
        manifest: this.game.manifest,
        profile: this.options.controllerProfile
      });
      this.controllers.set(avatar.id, controller);
    }
  }

  private disposeControllers(): void {
    for (const controller of this.controllers.values()) controller.dispose?.();
    this.controllers.clear();
  }

  private advanceControllerPath(avatar: Avatar): void {
    if (avatar.target !== null) return;
    const next = this.takeControllerWaypoint(avatar.id);
    if (next) setAvatarTarget(avatar, next);
  }

  private takeControllerWaypoint(avatarId: number): Point | undefined {
    const path = this.controllerPaths.get(avatarId);
    if (!path || path.length === 0) {
      this.controllerPaths.delete(avatarId);
      return undefined;
    }
    const next = path.shift();
    if (path.length === 0) this.controllerPaths.delete(avatarId);
    return next;
  }

  private clearTrajectoryPlayback(notify: boolean): void {
    if (!this.presentationState && !this.playbackAuthorityAvatars) return;
    if (this.playbackAuthorityAvatars) {
      this.avatars.splice(
        0,
        this.avatars.length,
        ...this.playbackAuthorityAvatars.map(cloneAvatar)
      );
    }
    this.playbackAuthorityAvatars = undefined;
    this.presentationState = undefined;
    this.presentationDebug = undefined;
    if (notify) this.notify(true);
  }

  private applyOps(ops: PressOp[]): void {
    for (const op of ops) {
      const state = op.kind === "press"
        ? this.engine.press(op.x, op.y, this.clockMillis)
        : this.engine.release(op.x, op.y, this.clockMillis);
      this.emitEvents(state.events);
    }
  }

  private emitEvents(events: GameEvent[]): void {
    if (!this.sounds) return;
    for (const event of events) {
      if (event.cue && event.cue !== "none") this.sounds.cue(event.cue);
    }
  }

  private notify(force: boolean): void {
    this.version += 1;
    const now = typeof performance === "undefined" ? this.clockMillis : performance.now();
    if (!force && now - this.lastNotifyAt < NOTIFY_INTERVAL_MILLIS) return;
    this.lastNotifyAt = now;
    for (const listener of this.listeners) listener();
  }

  private buildConfig(): GameConfig {
    return {
      seed: this.seedValue,
      playerCount: this.options.playerCount,
      difficulty: this.options.difficulty,
      durationMillis: this.options.durationMillis,
      options: this.options.gameOptions,
      nowMillis: 0
    };
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("GameSession has been disposed");
  }
}

function readonlyAvatar(avatar: Avatar): Readonly<Avatar> {
  return Object.freeze({
    ...avatar,
    position: Object.freeze({ ...avatar.position }),
    tile: Object.freeze({ ...avatar.tile }),
    pressedTile: avatar.pressedTile ? Object.freeze({ ...avatar.pressedTile }) : null,
    target: avatar.target ? Object.freeze({ ...avatar.target }) : null
  });
}

function cloneAvatar(avatar: Readonly<Avatar>): Avatar {
  return {
    ...avatar,
    position: { ...avatar.position },
    tile: { ...avatar.tile },
    pressedTile: avatar.pressedTile ? { ...avatar.pressedTile } : null,
    target: avatar.target ? { ...avatar.target } : null
  };
}

function cloneDebug(debug: SessionAgentDebug): SessionAgentDebug {
  return Object.freeze({
    ...debug,
    ...(debug.target ? { target: Object.freeze({ ...debug.target }) } : {}),
    path: Object.freeze(debug.path.map((point) => Object.freeze({ ...point })))
  });
}

function cloneState(state: GameEngineState): GameEngineState {
  return structuredClone(state);
}

function orthogonalPath(from: Readonly<Point>, to: Readonly<Point>): Readonly<Point>[] {
  const points: Point[] = [{ x: from.x, y: from.y }];
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const targetX = Math.round(to.x);
  const targetY = Math.round(to.y);
  while (x !== targetX) {
    x += Math.sign(targetX - x);
    points.push({ x, y });
  }
  while (y !== targetY) {
    y += Math.sign(targetY - y);
    points.push({ x, y });
  }
  return points.map((point) => Object.freeze(point));
}

function sanitizePath(
  path: readonly Readonly<Point>[] | undefined,
  from: Readonly<Point>,
  target: Readonly<Point>
): Point[] {
  const candidate = (path?.filter(isFinitePoint).map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y)
  })) ?? orthogonalPath(from, target).map((point) => ({ ...point })))
    .slice(0, FLOOR_COLS * FLOOR_ROWS * 2);
  while (candidate.length > 0 && candidate[0]?.x === from.x && candidate[0]?.y === from.y) {
    candidate.shift();
  }
  if (candidate.length === 0
    || candidate.at(-1)?.x !== Math.round(target.x)
    || candidate.at(-1)?.y !== Math.round(target.y)) {
    candidate.push({ x: Math.round(target.x), y: Math.round(target.y) });
  }
  return candidate;
}

function trajectoryChecksum(frame: Omit<SessionTrajectoryFrame, "checksum"> | SessionTrajectoryFrame): string {
  return replayChecksum({
    gameId: frame.gameId,
    seed: frame.seed,
    tick: frame.tick,
    atMillis: frame.atMillis,
    state: frame.state,
    avatars: frame.avatars,
    agentDebug: frame.agentDebug
  });
}

function trajectoryTickFromState(state: GameEngineState, frameMillis: number): number {
  return frameMillis > 0 ? Math.round(state.clockMillis / frameMillis) : 0;
}

function isFinitePoint(point: Readonly<Point> | undefined): point is Readonly<Point> {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizeCatchUpSteps(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ENGINE_MAX_CATCH_UP_STEPS;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("GameSession maxCatchUpSteps must be a positive integer");
  }
  return value;
}

/** Maps avatar slots to game players while putting the local player nearest the camera. */
function assignPlayers(zones: Array<Tile[]>, playerCount: number): number[] {
  const identity = Array.from({ length: playerCount }, (_, index) => index);
  if (zones.length < 2 || playerCount < 2) return identity;
  const nearest = nearestZoneIndex(zones);
  if (nearest < 0 || nearest >= playerCount) return identity;
  return [nearest, ...identity.filter((index) => index !== nearest)];
}

function nearestZoneIndex(zones: Array<Tile[]>): number {
  let bestIndex = -1;
  let bestDepth = Number.NEGATIVE_INFINITY;
  let bestOffset = Number.POSITIVE_INFINITY;
  zones.forEach((zone, index) => {
    if (zone.length === 0) return;
    const depth = zone.reduce((sum, tile) => sum + tile.y, 0) / zone.length;
    const offset = Math.abs(
      zone.reduce((sum, tile) => sum + tile.x, 0) / zone.length - (FLOOR_COLS - 1) / 2
    );
    if (depth > bestDepth + 0.5 || (Math.abs(depth - bestDepth) <= 0.5 && offset < bestOffset)) {
      bestDepth = depth;
      bestOffset = offset;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function humanSpawnZone(zones: Array<Tile[]>, playerIndex: number): Tile[] | undefined {
  return zones.length >= 2 ? zones[playerIndex] : undefined;
}

const HUMAN_SPAWN_STANDOFF = 4;

function spawnTile(index: number, playerCount: number, zone?: Tile[]): Tile {
  if (index === 0 && zone && zone.length > 0) {
    const center = centroid(zone);
    if (center) {
      const towardMiddleX = (FLOOR_COLS - 1) / 2 - center.x;
      const towardMiddleY = (FLOOR_ROWS - 1) / 2 - center.y;
      const distance = Math.hypot(towardMiddleX, towardMiddleY) || 1;
      const step = Math.min(HUMAN_SPAWN_STANDOFF, distance);
      return {
        x: Math.round(center.x + (towardMiddleX / distance) * step),
        y: Math.round(center.y + (towardMiddleY / distance) * step)
      };
    }
  }
  const lanes = [7, 3, 12, 5, 10, 8];
  return {
    x: lanes[index % lanes.length] ?? 7,
    y: 27 - Math.floor(index / lanes.length) * 3 - (index % 2) * (playerCount > 2 ? 2 : 0)
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffff_ffff);
}
