import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createSeededRng,
  defaultPlayers,
  normalizeGameConfig,
  setFrameCell,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GamePhase,
  type GamePlayer,
  type GameSnapshot,
  type HexColor,
  type NormalizedGameConfig,
  type PressEvent,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";

export const targetColor: HexColor = "#148cff";
const idleColor: HexColor = "#05070a";

type Target = {
  x: number;
  y: number;
};

export function createGame(config: GameConfig): GameInstance {
  return new ExampleCatchGame(config);
}

class ExampleCatchGame implements GameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private target: Target = { x: 0, y: 0 };
  private phase: GamePhase = "ready";
  private score = 0;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private finishedEventEmitted = false;
  private lastEvent: GameEvent = {
    cue: "none",
    message: "Ready",
    atMillis: 0
  };
  private players: GamePlayer[];

  constructor(config: GameConfig) {
    this.config = normalizeConfig(config);
    this.rng = createSeededRng(this.config.seed);
    this.players = defaultPlayers(this.config.playerCount, this.config.players);
    this.target = this.nextTarget();
  }

  init(nowMillis: number): GameEvent[] {
    this.startedAtMillis = nowMillis;
    this.nowMillis = nowMillis;
    this.phase = "running";
    this.finishedEventEmitted = false;
    this.lastEvent = {
      cue: "start",
      message: "Catch the blue tile",
      atMillis: nowMillis
    };

    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    if (this.phase !== "running" || !event.pressed) {
      return [];
    }

    this.nowMillis = event.atMillis;

    if (event.x !== this.target.x || event.y !== this.target.y) {
      return [];
    }

    const previousTarget = this.target;
    this.score += 1;
    this.players = this.players.map((player) => ({
      ...player,
      score: this.score
    }));
    this.target = this.nextTarget(previousTarget);
    this.lastEvent = {
      cue: "hit",
      message: `Target ${this.score}`,
      atMillis: event.atMillis
    };

    return [this.lastEvent];
  }

  release(_event: PressEvent): GameEvent[] {
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase !== "running") {
      return [];
    }

    if (this.remainingMillis() > 0) {
      return [];
    }

    this.phase = "finished";

    if (this.finishedEventEmitted) {
      return [];
    }

    this.finishedEventEmitted = true;
    this.lastEvent = {
      cue: "win",
      message: "Time",
      atMillis: event.atMillis
    };

    return [this.lastEvent];
  }

  render(): Frame {
    const frame = createFrame(idleColor);

    if (this.phase !== "running") {
      return frame;
    }

    return setFrameCell(frame, this.target.x, this.target.y, targetColor);
  }

  snapshot(): GameSnapshot {
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.score,
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? 1 : 0,
      success: this.phase === "finished" && this.score > 0,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeConfig({
      ...this.config,
      ...config
    });
    this.rng = createSeededRng(this.config.seed);
    this.phase = "ready";
    this.score = 0;
    this.startedAtMillis = this.config.nowMillis;
    this.nowMillis = this.config.nowMillis;
    this.finishedEventEmitted = false;
    this.lastEvent = {
      cue: "none",
      message: "Ready",
      atMillis: this.config.nowMillis
    };
    this.players = defaultPlayers(this.config.playerCount, this.config.players);
    this.target = this.nextTarget();
  }

  private nextTarget(previous?: Target): Target {
    let target = {
      x: this.rng.int(FLOOR_COLS),
      y: this.rng.int(FLOOR_ROWS)
    };

    for (let attempts = 0; attempts < 12 && previous && target.x === previous.x && target.y === previous.y; attempts += 1) {
      target = {
        x: this.rng.int(FLOOR_COLS),
        y: this.rng.int(FLOOR_ROWS)
      };
    }

    return target;
  }

  private elapsedMillis(): number {
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }
}

function normalizeConfig(config: GameConfig): NormalizedGameConfig {
  return normalizeGameConfig(config, manifest);
}
