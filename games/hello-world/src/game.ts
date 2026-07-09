import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createHorizontalPlayerReadyZones,
  createPlayerReadyGate,
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
  type PlayerReadyGate,
  type PlayerReadyTransition,
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
  private readyGate: PlayerReadyGate;
  private score = 0;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private players: GamePlayer[];
  private lastEvent: GameEvent = {
    cue: "none",
    message: "Listo",
    atMillis: 0
  };

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, createHorizontalPlayerReadyZones(1), this.config.nowMillis);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] {
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.nowMillis = nowMillis;
    this.lastEvent = {
      cue: "ready",
      message: "Esperando jugador",
      atMillis: nowMillis
    };

    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }

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
      message: this.score >= helloWorldTargetScore ? "Hola Mundo" : `Hola ${this.score}`,
      atMillis: event.atMillis
    };

    if (this.score >= helloWorldTargetScore) {
      this.phase = "finished";
    }

    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis);
    }
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis);
    }

    if (this.phase !== "running" || this.remainingMillis() > 0) {
      return [];
    }

    this.phase = "finished";
    this.lastEvent = {
      cue: this.score >= helloWorldTargetScore ? "win" : "fail",
      message: this.score >= helloWorldTargetScore ? "Hola Mundo" : "Tiempo",
      atMillis: event.atMillis
    };

    return [this.lastEvent];
  }

  render(): Frame {
    const frame = createFrame(idleColor);

    if (this.phase === "waiting" || this.phase === "starting") {
      this.drawPlayerStart(frame);
      return frame;
    }

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
    const readyState = this.readyGate.state(this.nowMillis);
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
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: helloWorldTargetScore
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({
      ...this.config,
      ...config
    }, manifest);
    this.readyGate.reset(this.config.nowMillis);
    this.phase = "waiting";
    this.score = 0;
    this.startedAtMillis = this.config.nowMillis;
    this.nowMillis = this.config.nowMillis;
    this.players = this.scoredPlayers();
    this.lastEvent = {
      cue: "ready",
      message: "Esperando jugador",
      atMillis: this.config.nowMillis
    };
  }

  private currentTarget(): Target | undefined {
    return targetPath[this.score];
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = { cue: "ready", message: "Jugador listo", atMillis: nowMillis };
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = { cue: "ready", message: "Vuelve a la zona iluminada", atMillis: nowMillis };
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastEvent = { cue: "start", message: "Pisa la baldosa verde", atMillis: nowMillis };
      return [this.lastEvent];
    }
    return [];
  }

  private drawPlayerStart(frame: Frame): void {
    const centerX = Math.floor(FLOOR_COLS / 2);
    const centerY = Math.floor(FLOOR_ROWS / 2);
    const pulse = Math.floor(this.nowMillis / (this.phase === "starting" ? 110 : 180));
    const color: HexColor = this.phase === "starting" ? "#ffe176" : targetColor;
    const radius = this.phase === "starting" ? 2 + pulse % 10 : 3 + pulse % 4;

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
        if (Math.abs(distance - radius) <= 1) {
          paintFrameCell(frame, x, y, color);
        }
      }
    }
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") {
      return 0;
    }
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      score: this.score
    }));
  }
}

export function helloWorldTargets(): Target[] {
  return targetPath.map((target) => ({ ...target }));
}
