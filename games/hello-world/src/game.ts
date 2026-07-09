import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  defaultPlayers,
  fillFrameRect,
  normalizeGameConfig,
  paintFrameCell,
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
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";

export const targetColor: HexColor = "#7ee787";
export const trailColor: HexColor = "#1f6feb";
export const idleColor: HexColor = "#05070a";
export const helloWorldTargetScore = 5;

type Target = {
  x: number;
  y: number;
};

const targetPath: Target[] = [
  { x: 3, y: 5 },
  { x: 12, y: 5 },
  { x: 8, y: 16 },
  { x: 3, y: 26 },
  { x: 12, y: 26 }
];

export function createGame(config: GameConfig): GameInstance {
  return new HelloWorldGame(config);
}

class HelloWorldGame implements GameInstance {
  private config: NormalizedGameConfig;
  private phase: GamePhase = "ready";
  private score = 0;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private players: GamePlayer[];
  private lastEvent: GameEvent = {
    cue: "none",
    message: "Ready",
    atMillis: 0
  };

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] {
    this.phase = "running";
    this.startedAtMillis = nowMillis;
    this.nowMillis = nowMillis;
    this.lastEvent = {
      cue: "start",
      message: "Step on the green tile",
      atMillis: nowMillis
    };

    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase !== "running" || !event.pressed) {
      return [];
    }

    const target = this.currentTarget();
    if (!target || event.x !== target.x || event.y !== target.y) {
      return [];
    }

    this.score += 1;
    this.players = this.scoredPlayers();
    this.lastEvent = {
      cue: this.score >= helloWorldTargetScore ? "win" : "hit",
      message: this.score >= helloWorldTargetScore ? "Hello World" : `Hello ${this.score}`,
      atMillis: event.atMillis
    };

    if (this.score >= helloWorldTargetScore) {
      this.phase = "finished";
    }

    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase !== "running" || this.remainingMillis() > 0) {
      return [];
    }

    this.phase = "finished";
    this.lastEvent = {
      cue: this.score >= helloWorldTargetScore ? "win" : "fail",
      message: this.score >= helloWorldTargetScore ? "Hello World" : "Time",
      atMillis: event.atMillis
    };

    return [this.lastEvent];
  }

  render(): Frame {
    const frame = createFrame(idleColor);

    for (let index = 0; index < Math.min(this.score, targetPath.length); index += 1) {
      const target = targetPath[index];
      paintFrameCell(frame, target.x, target.y, trailColor);
    }

    if (this.phase === "running") {
      const target = this.currentTarget();
      if (target) {
        fillFrameRect(frame, target.x - 1, target.y - 1, 3, 3, targetColor);
        paintFrameCell(frame, target.x, target.y, "#ffffff");
      }
    }

    return frame;
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
      success: this.score >= helloWorldTargetScore,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      matchTarget: helloWorldTargetScore
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({
      ...this.config,
      ...config
    }, manifest);
    this.phase = "ready";
    this.score = 0;
    this.startedAtMillis = this.config.nowMillis;
    this.nowMillis = this.config.nowMillis;
    this.players = this.scoredPlayers();
    this.lastEvent = {
      cue: "none",
      message: "Ready",
      atMillis: this.config.nowMillis
    };
  }

  private currentTarget(): Target | undefined {
    return targetPath[this.score];
  }

  private elapsedMillis(): number {
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount).map((player) => ({
      ...player,
      score: this.score
    }));
  }
}

export function helloWorldTargets(): Target[] {
  return targetPath.map((target) => ({ ...target }));
}
