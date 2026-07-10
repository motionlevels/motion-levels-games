import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createHorizontalPlayerReadyZones,
  createPlayerReadyGate,
  defaultPlayers,
  fillFrameRect,
  gameEvent,
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
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const targetColor: HexColor = "#7ee787";
export const hazardColor: HexColor = "#ff2036";
export const trailColor: HexColor = "#1f6feb";
export const idleColor: HexColor = "#05070a";
export const helloWorldTargetScore = 5;
export const helloWorldStartingLives = 3;
export const helloWorldCelebrationMillis = 5_000;

type Target = {
  x: number;
  y: number;
};

export type HelloWorldSnapshot = GameSnapshot & {
  celebrationDurationMillis: number;
  celebrationMillis: number;
  hazard?: Target;
  maxLives: number;
};

export type HelloWorldGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): HelloWorldSnapshot;
};

const targetPath: Target[] = [
  { x: 3, y: 5 },
  { x: 12, y: 5 },
  { x: 8, y: 16 },
  { x: 3, y: 26 },
  { x: 12, y: 26 }
];

const hazardPath: Target[] = [
  { x: 12, y: 15 },
  { x: 4, y: 15 },
  { x: 8, y: 28 }
];

export function createGame(config: GameConfig): HelloWorldGameInstance {
  return new HelloWorldGame(config);
}

class HelloWorldGame implements HelloWorldGameInstance {
  private config: NormalizedGameConfig;
  private finishedAtMillis: number | undefined;
  private hazardsHit = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private lives = helloWorldStartingLives;
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[];
  private readyGate: PlayerReadyGate;
  private score = 0;
  private startedAtMillis = 0;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, createHorizontalPlayerReadyZones(1), this.config.nowMillis);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
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

    const hazard = this.currentHazard();
    if (hazard && event.x === hazard.x && event.y === hazard.y) {
      return this.loseLife(event.atMillis);
    }

    const target = this.currentTarget();
    if (!target || event.x !== target.x || event.y !== target.y) {
      return [];
    }

    this.score += 1;
    this.players = this.scoredPlayers();
    if (this.score >= helloWorldTargetScore) {
      return this.finishGame(true, "¡Hola Mundo!", event.atMillis);
    }

    this.lastEvent = gameEvent("hit", `Hola ${this.score}`, event.atMillis);
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

    if (this.phase === "finished") {
      const finishedAtMillis = this.finishedAtMillis ?? event.atMillis;
      if (event.atMillis - finishedAtMillis < helloWorldCelebrationMillis) {
        return [];
      }

      this.resetState(event.atMillis);
      return [this.lastEvent];
    }

    if (this.phase !== "running" || this.remainingMillis() > 0) {
      return [];
    }

    return this.finishGame(false, "Tiempo agotado", event.atMillis);
  }

  render(): Frame {
    const frame = createFrame(idleColor);

    if (this.phase === "waiting" || this.phase === "starting") {
      this.drawPlayerStart(frame);
      return frame;
    }

    for (const target of targetPath.slice(0, this.score)) {
      paintFrameCell(frame, target.x, target.y, trailColor);
    }

    if (this.phase === "finished") {
      this.drawResultAnimation(frame);
      return frame;
    }

    const target = this.currentTarget();
    if (target) {
      fillFrameRect(frame, target.x - 1, target.y - 1, 3, 3, targetColor);
      paintFrameCell(frame, target.x, target.y, "#ffffff");
    }

    const hazard = this.currentHazard();
    if (hazard) {
      paintFrameCell(frame, hazard.x, hazard.y, hazardColor);
    }

    return frame;
  }

  snapshot(): HelloWorldSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.score,
      lives: this.lives,
      maxLives: helloWorldStartingLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? Number(Boolean(this.currentTarget())) + Number(Boolean(this.currentHazard())) : 0,
      success: this.phase === "finished" && this.score >= helloWorldTargetScore,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: helloWorldTargetScore,
      celebrationDurationMillis: helloWorldCelebrationMillis,
      celebrationMillis: this.celebrationMillis(),
      hazard: this.phase === "running" ? this.currentHazard() : undefined
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({
      ...this.config,
      ...config
    }, manifest);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Jugador listo", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a la zona iluminada", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastEvent = gameEvent("start", "Verde suma, rojo resta una vida", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private celebrationMillis(): number {
    if (this.phase !== "finished" || this.finishedAtMillis === undefined) {
      return 0;
    }
    return Math.max(0, helloWorldCelebrationMillis - (this.nowMillis - this.finishedAtMillis));
  }

  private currentHazard(): Target | undefined {
    return hazardPath[this.hazardsHit];
  }

  private currentTarget(): Target | undefined {
    return targetPath[this.score];
  }

  private drawPlayerStart(frame: Frame): void {
    const centerX = Math.floor(FLOOR_COLS / 2);
    const centerY = Math.floor(FLOOR_ROWS / 2);
    const pulse = Math.floor(this.nowMillis / (this.phase === "starting" ? 110 : 180));
    const color: HexColor = this.phase === "starting" ? "#ffe176" : targetColor;
    const radius = this.phase === "starting" ? 2 + pulse % 10 : 3 + pulse % 4;

    paintDiamondRing(frame, { centerX, centerY, color, radius });
  }

  private drawResultAnimation(frame: Frame): void {
    const animationStep = Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 140);
    const won = this.score >= helloWorldTargetScore;

    if (won) {
      paintDiamondWave(frame, {
        color: ({ x, y }) => (x + y + animationStep) % 3 === 0 ? "#ffffff" : targetColor,
        step: animationStep
      });
      return;
    }

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        if ((x + y + animationStep) % 8 <= 1 || (x - y - animationStep + 64) % 11 === 0) {
          paintFrameCell(frame, x, y, (x + animationStep) % 4 === 0 ? "#ff8090" : hazardColor);
        }
      }
    }
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") {
      return 0;
    }
    const elapsedAtMillis = this.phase === "finished" && this.finishedAtMillis !== undefined
      ? this.finishedAtMillis
      : this.nowMillis;
    return Math.max(0, elapsedAtMillis - this.startedAtMillis);
  }

  private finishGame(success: boolean, message: string, atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.finishedAtMillis = atMillis;
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private loseLife(atMillis: number): GameEvent[] {
    this.lives -= 1;
    this.hazardsHit += 1;
    if (this.lives <= 0) {
      return this.finishGame(false, "Sin vidas", atMillis);
    }

    this.lastEvent = gameEvent("fail", `Vida perdida, quedan ${this.lives}`, atMillis);
    return [this.lastEvent];
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.finishedAtMillis = undefined;
    this.hazardsHit = 0;
    this.lastEvent = gameEvent("ready", "Esperando jugador", nowMillis);
    this.lives = helloWorldStartingLives;
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.score = 0;
    this.startedAtMillis = nowMillis;
    this.players = this.scoredPlayers();
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      score: this.score
    }));
  }
}

export function helloWorldHazards(): Target[] {
  return hazardPath.map((hazard) => ({ ...hazard }));
}

export function helloWorldTargets(): Target[] {
  return targetPath.map((target) => ({ ...target }));
}
