import {
  createGameEngine,
  normalizeGameConfig,
  normalizeGameLookupKey,
  type Frame,
  type GameConfig,
  type GameEngine,
  type GameEngineState,
  type GameEvent,
  type GameInstance,
  type GameSnapshot,
  type NormalizedGameConfig
} from "@motion-levels-games/game-sdk";
import { gameplayRegistry } from "./gameplayRegistry.ts";

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

/**
 * Direct, in-process owner of one TypeScript game. It deliberately has no
 * transport or request-envelope concepts; venue hosts call these methods.
 */
export class GameSession {
  private engine: GameEngine | null = null;
  private gameId = "";
  private initialConfig: NormalizedGameConfig | null = null;
  private development = false;
  private paused = false;
  private held = new Set<string>();

  get active(): boolean {
    return this.engine !== null;
  }

  select(selection: GameSelection): GameSessionState {
    const lookupKey = normalizeGameLookupKey(selection.gameId);
    const module = gameplayRegistry.get(lookupKey);
    if (!module) throw new Error(`unknown game: ${lookupKey}`);
    if (!module.manifest.availability.production && selection.development !== true) {
      throw new Error(`game is not production eligible: ${lookupKey}`);
    }
    const config = normalizeGameConfig(selection, module.manifest);
    const engine = createSessionEngine(module.createGame(config), config.nowMillis);
    this.engine = engine;
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

  restart(nowMillis = 0): GameSessionState {
    if (!this.initialConfig) throw new Error("game session has no active game");
    const module = gameplayRegistry.get(normalizeGameLookupKey(this.gameId));
    if (!module) throw new Error(`unknown game: ${this.gameId}`);
    if (!module.manifest.availability.production && !this.development) {
      throw new Error(`game is not production eligible: ${this.gameId}`);
    }
    const config = { ...this.initialConfig, nowMillis: finiteMillis(nowMillis, 0) };
    const engine = createSessionEngine(module.createGame(config), config.nowMillis);
    this.engine = engine;
    this.paused = false;
    this.held.clear();
    return this.toState(engine.state);
  }

  stop(): void {
    this.engine = null;
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

function createSessionEngine(game: GameInstance, nowMillis: number): GameEngine {
  const events = game.init(nowMillis);
  return createGameEngine(game, { initialEvents: events, nowMillis });
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
