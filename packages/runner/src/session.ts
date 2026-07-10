import {
  createGameEngine,
  normalizeGameConfig,
  type GameEngine,
  type GameEngineState
} from "@motion-levels-games/game-sdk";
import { gameRegistry } from "./registry.ts";
import { packFrame, type InitParams, type RunnerRequest, type RunnerState } from "./protocol.ts";

export class RunnerSession {
  private engine: GameEngine | null = null;
  private gameId = "";
  private paused = false;
  private held = new Set<string>();

  handle(request: RunnerRequest): RunnerState {
    switch (request.method) {
      case "init":
        return this.init(request.params as InitParams);
      case "input":
        return this.input(request.params ?? {});
      case "control":
        return this.control(request.params ?? {});
      case "tick":
        return this.tick(request.params ?? {});
      case "status":
        return this.state();
    }
  }

  private init(params: InitParams): RunnerState {
    const gameId = String(params?.gameId || "").trim();
    const module = gameRegistry.get(gameId);
    if (!module) throw new Error(`unknown game: ${gameId}`);
    if (!module.manifest.availability.production && params.development !== true) {
      throw new Error(`game is not production eligible: ${gameId}`);
    }
    const config = normalizeGameConfig(params, module.manifest);
    const game = module.createGame(config);
    const events = game.init(config.nowMillis);
    this.engine = createGameEngine(game, { initialEvents: events, nowMillis: config.nowMillis });
    this.gameId = gameId;
    this.paused = false;
    this.held.clear();
    return this.state(this.engine.state);
  }

  private input(params: Record<string, unknown>): RunnerState {
    const engine = this.requireEngine();
    if (this.paused) return this.state(engine.refresh());
    const x = boundedInteger(params.x, 0, 15, "x");
    const y = boundedInteger(params.y, 0, 31, "y");
    const pressed = params.pressed === true;
    const atMillis = finiteNumber(params.atMillis, engine.clockMillis);
    const key = `${x},${y}`;
    const state = pressed ? engine.press(x, y, atMillis) : engine.release(x, y, atMillis);
    if (pressed) this.held.add(key); else this.held.delete(key);
    return this.state(state);
  }

  private control(params: Record<string, unknown>): RunnerState {
    const action = String(params.action || "");
    const engine = this.requireEngine();
    if (action === "pause" && !this.paused) {
      for (const key of this.held) {
        const [x, y] = key.split(",").map(Number);
        engine.release(x ?? 0, y ?? 0);
      }
      this.held.clear();
      this.paused = true;
      return this.state(engine.refresh());
    }
    if (action === "resume") {
      this.paused = false;
      return this.state(engine.refresh());
    }
    if (action === "reset") {
      const module = gameRegistry.get(this.gameId);
      if (!module) throw new Error("runner has no active game");
      const game = module.createGame({});
      const events = game.init(0);
      this.engine = createGameEngine(game, { initialEvents: events });
      this.paused = false;
      this.held.clear();
      return this.state(this.engine.state);
    }
    if (action !== "status") throw new Error(`unknown control action: ${action}`);
    return this.state(engine.refresh());
  }

  private tick(params: Record<string, unknown>): RunnerState {
    const engine = this.requireEngine();
    if (this.paused) return this.state(engine.refresh());
    const atMillis = finiteNumber(params.atMillis, engine.clockMillis);
    return this.state(engine.tickTo(atMillis));
  }

  private requireEngine(): GameEngine {
    if (!this.engine) throw new Error("runner must be initialized first");
    return this.engine;
  }

  private state(state: GameEngineState = this.requireEngine().state): RunnerState {
    return {
      clockMillis: state.clockMillis,
      paused: this.paused,
      frame: packFrame(state.frame),
      snapshot: state.snapshot,
      events: state.events
    };
  }
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return number;
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
