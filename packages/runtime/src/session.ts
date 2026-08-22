import {
  createGameEngine,
  normalizeGameConfig,
  normalizeGameLookupKey,
  type Frame,
  type GameConfig,
  type GameEngine,
  type GameEngineState,
  type GameEngineOptions,
  type GameEvent,
  type GameInstance,
  type GameSnapshot,
  type NormalizedGameConfig
} from "@motion-levels-games/game-sdk";
import type { GameplayModule, GameplayRegistry } from "./registry.ts";

export type GameSelection = GameConfig & {
  gameId: string;
  /** Allows non-production games in playgrounds and tests only. */
  development?: boolean;
};

export type GameSessionState = {
  gameId: string;
  clockMillis: number;
  paused: boolean;
  frame: Frame;
  snapshot: GameSnapshot;
  events: GameEvent[];
};

export type GameSessionOptions = Readonly<Pick<GameEngineOptions, "fps">>;

export type AutomaticAttemptTransition = Readonly<{
  kind: "retry" | "level_advance";
  fromLevelId: string;
  fromLevelSlug: string;
  toLevelId: string;
  toLevelSlug: string;
}>;

type AutomaticAttemptTransitionGame = GameInstance & {
  advanceAutomaticAttemptTransition(): readonly GameEvent[];
  pendingAutomaticAttemptTransition(): AutomaticAttemptTransition | null;
  setAutomaticAttemptTransitionsBlocked(blocked: boolean): void;
};

/**
 * Direct, in-process owner of one TypeScript game. It deliberately has no
 * transport or request-envelope concepts; venue hosts call these methods.
 */
export class GameSession {
  private engine: GameEngine | null = null;
  private game: GameInstance | null = null;
  private gameId = "";
  private initialConfig: NormalizedGameConfig | null = null;
  private development = false;
  private paused = false;
  private held = new Set<string>();

  constructor(
    private readonly games: GameplayRegistry,
    private readonly options: GameSessionOptions = {}
  ) {}

  get active(): boolean {
    return this.engine !== null;
  }

  /** Current deterministic engine state for presentation and replay adapters. */
  engineState(): GameEngineState {
    return this.requireEngine().state;
  }

  get instance(): GameInstance {
    if (!this.game) throw new Error("game session has no active game");
    return this.game;
  }

  get clockMillis(): number {
    return this.requireEngine().clockMillis;
  }

  get fps(): number {
    return this.requireEngine().fps;
  }

  get frameMillis(): number {
    return this.requireEngine().frameMillis;
  }

  select(selection: GameSelection): GameSessionState {
    const lookupKey = normalizeGameLookupKey(selection.gameId);
    const module = this.games.get(lookupKey);
    if (!module) throw new Error(`unknown game: ${lookupKey}`);
    if (!module.manifest.availability.production && selection.development !== true) {
      throw new Error(`game is not production eligible: ${lookupKey}`);
    }
    const config = normalizeGameConfig(selection, module.manifest);
    const game = module.createGame(config);
    const engine = createSessionEngine(game, config.nowMillis, this.options);
    this.engine = engine;
    this.game = game;
    this.gameId = module.manifest.id;
    this.initialConfig = config;
    this.development = selection.development === true;
    this.paused = false;
    this.held.clear();
    return this.toState(engine.state);
  }

  press(x: number, y: number, atMillis?: number): GameSessionState {
    return this.input(x, y, true, atMillis);
  }

  release(x: number, y: number, atMillis?: number): GameSessionState {
    return this.input(x, y, false, atMillis);
  }

  tick(atMillis?: number): GameSessionState {
    const engine = this.requireEngine();
    if (this.paused) return this.toState(engine.refresh());
    return this.toState(engine.tickTo(finiteMillis(atMillis, engine.clockMillis)));
  }

  /** Explicit relative step used by deterministic development and replay hosts. */
  step(deltaMillis = this.frameMillis): GameSessionState {
    const engine = this.requireEngine();
    const delta = Number.isFinite(deltaMillis) ? Math.max(0, deltaMillis) : engine.frameMillis;
    return this.toState(engine.tickTo(engine.clockMillis + delta));
  }

  pause(atMillis?: number): GameSessionState {
    const engine = this.requireEngine();
    if (!this.paused) {
      this.releaseAll(finiteMillis(atMillis, engine.clockMillis));
      this.paused = true;
    }
    return this.toState(engine.refresh());
  }

  resume(): GameSessionState {
    const engine = this.requireEngine();
    this.paused = false;
    return this.toState(engine.refresh());
  }

  setAutomaticAttemptTransitionsBlocked(blocked: boolean): boolean {
    const game = this.game;
    if (!isAutomaticAttemptTransitionGame(game)) return false;
    game.setAutomaticAttemptTransitionsBlocked(blocked);
    return true;
  }

  pendingAutomaticAttemptTransition(): AutomaticAttemptTransition | null {
    const game = this.game;
    return isAutomaticAttemptTransitionGame(game) ? game.pendingAutomaticAttemptTransition() : null;
  }

  advanceAutomaticAttemptTransition(): GameSessionState {
    const engine = this.requireEngine();
    const game = this.game;
    if (!isAutomaticAttemptTransitionGame(game)) {
      throw new Error("active game does not support automatic attempt transitions");
    }
    this.releaseAll(engine.clockMillis);
    return this.toState(engine.refresh([...game.advanceAutomaticAttemptTransition()]));
  }

  clearHeldInputs(atMillis?: number): GameSessionState {
    const engine = this.requireEngine();
    this.releaseAll(finiteMillis(atMillis, engine.clockMillis));
    return this.toState(engine.refresh());
  }

  restart(nowMillis = 0): GameSessionState {
    if (!this.initialConfig) throw new Error("game session has no active game");
    const module = this.requireModule();
    if (!module.manifest.availability.production && !this.development) {
      throw new Error(`game is not production eligible: ${this.gameId}`);
    }
    const config = { ...this.initialConfig, nowMillis: finiteMillis(nowMillis, 0) };
    const game = module.createGame(config);
    const engine = createSessionEngine(game, config.nowMillis, this.options);
    this.engine = engine;
    this.game = game;
    this.paused = false;
    this.held.clear();
    return this.toState(engine.state);
  }

  stop(): void {
    this.engine = null;
    this.game = null;
    this.gameId = "";
    this.initialConfig = null;
    this.development = false;
    this.paused = false;
    this.held.clear();
  }

  state(): GameSessionState {
    return this.toState(this.requireEngine().state);
  }

  private input(x: number, y: number, pressed: boolean, atMillis?: number): GameSessionState {
    const engine = this.requireEngine();
    const boundedX = boundedInteger(x, 0, 15, "x");
    const boundedY = boundedInteger(y, 0, 31, "y");
    if (this.paused) return this.toState(engine.refresh());
    const timestamp = finiteMillis(atMillis, engine.clockMillis);
    const key = `${boundedX},${boundedY}`;
    const state = pressed
      ? engine.press(boundedX, boundedY, timestamp)
      : engine.release(boundedX, boundedY, timestamp);
    if (pressed) this.held.add(key); else this.held.delete(key);
    return this.toState(state);
  }

  private releaseAll(atMillis: number): void {
    const engine = this.requireEngine();
    for (const key of this.held) {
      const [x, y] = key.split(",").map(Number);
      engine.release(x ?? 0, y ?? 0, atMillis);
    }
    this.held.clear();
  }

  private requireEngine(): GameEngine {
    if (!this.engine) throw new Error("game session has no active game");
    return this.engine;
  }

  private requireModule(): GameplayModule {
    const module = this.games.get(normalizeGameLookupKey(this.gameId));
    if (!module) throw new Error(`unknown game: ${this.gameId}`);
    return module;
  }

  private toState(state: GameEngineState): GameSessionState {
    return {
      gameId: this.gameId,
      clockMillis: state.clockMillis,
      paused: this.paused,
      frame: state.frame,
      snapshot: state.snapshot,
      events: state.events
    };
  }
}

function isAutomaticAttemptTransitionGame(game: GameInstance | null): game is AutomaticAttemptTransitionGame {
  if (!game) return false;
  const candidate = game as Partial<AutomaticAttemptTransitionGame>;
  return typeof candidate.advanceAutomaticAttemptTransition === "function"
    && typeof candidate.pendingAutomaticAttemptTransition === "function"
    && typeof candidate.setAutomaticAttemptTransitionsBlocked === "function";
}

function createSessionEngine(
  game: GameInstance,
  nowMillis: number,
  options: GameSessionOptions
): GameEngine {
  const events = game.init(nowMillis);
  return createGameEngine(game, { ...options, initialEvents: events, nowMillis });
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function finiteMillis(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
