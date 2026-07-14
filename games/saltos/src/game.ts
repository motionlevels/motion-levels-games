import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createPlayerReadyGate,
  createSeededRng,
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
  type NormalizedGameConfig,
  type PlayerReadyGate,
  type PlayerReadyTransition,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const saltosCelebrationMillis = 5_000;
export const saltosStartingLives = 1;

type Point = { x: number; y: number };

export type SaltosSnapshot = GameSnapshot & {
  celebrationMillis: number;
  currentPlatform: Point;
  maxLives: number;
  targetPlatform?: Point;
};

export type SaltosGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): SaltosSnapshot;
};

const startPlatform: Point = { x: 7, y: 3 };
const platformSize = 3;

export function createGame(config: GameConfig): SaltosGameInstance {
  return new SaltosGame(config);
}

class SaltosGame implements SaltosGameInstance {
  private config: NormalizedGameConfig;
  private current = startPlatform;
  private finishedAtMillis: number | undefined;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private lives = saltosStartingLives;
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[];
  private readyGate: PlayerReadyGate;
  private rng: ReturnType<typeof createSeededRng>;
  private score = 0;
  private startedAtMillis = 0;
  private target: Point = startPlatform;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [{ minX: 5, maxX: 10, minY: 0, maxY: 7 }], this.config.nowMillis);
    this.rng = createSeededRng(this.config.seed);
    this.players = this.scoredPlayers();
    this.target = this.nextTarget(this.current);
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
    if (this.phase !== "running" || !event.pressed) return [];
    if (insidePlatform(event, this.current)) return [];
    if (!insidePlatform(event, this.target)) {
      this.lives = 0;
      return this.finish(false, "Has pisado lava", event.atMillis);
    }

    this.current = this.target;
    this.score += 1;
    this.players = this.scoredPlayers();
    this.target = this.nextTarget(this.current);
    this.lastEvent = gameEvent("coin", `Salto ${this.score}`, event.atMillis);
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
      if (event.atMillis - (this.finishedAtMillis ?? event.atMillis) >= saltosCelebrationMillis) {
        this.resetState(event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase === "running" && this.remainingMillis() === 0) {
      return this.finish(true, `${this.score} saltos completados`, event.atMillis);
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame("#170408");
    if (this.phase === "waiting" || this.phase === "starting") {
      const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
      paintDiamondRing(frame, { centerX: 8, centerY: 4, radius: 2 + step % 5, color: this.phase === "starting" ? "#ffe176" : "#1677ff" });
      return frame;
    }
    this.paintLava(frame);
    fillFrameRect(frame, this.current.x, this.current.y, platformSize, platformSize, "#1677ff");
    if (this.phase === "running") {
      fillFrameRect(frame, this.target.x, this.target.y, platformSize, platformSize, "#38e86b");
      paintFrameCell(frame, this.target.x + 1, this.target.y + 1, "#ffffff");
    } else {
      paintDiamondWave(frame, { color: this.lives > 0 ? "#38e86b" : "#ff263d", step: Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 140) });
    }
    return frame;
  }

  snapshot(): SaltosSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.score,
      lives: this.lives,
      maxLives: saltosStartingLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? 1 : 0,
      success: this.phase === "finished" && this.lives > 0,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      currentPlatform: { ...this.current },
      targetPlatform: this.phase === "running" ? { ...this.target } : undefined,
      celebrationMillis: this.phase === "finished" ? Math.max(0, saltosCelebrationMillis - (this.nowMillis - (this.finishedAtMillis ?? this.nowMillis))) : 0
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Jugador listo", nowMillis);
    } else if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a la plataforma azul", nowMillis);
    } else if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastEvent = gameEvent("start", "Salta del azul al verde", nowMillis);
    } else return [];
    return [this.lastEvent];
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") return 0;
    const end = this.finishedAtMillis ?? this.nowMillis;
    return Math.max(0, end - this.startedAtMillis);
  }

  private finish(success: boolean, message: string, atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.finishedAtMillis = atMillis;
    this.lastEvent = gameEvent(success ? "win" : "damage", message, atMillis);
    return [this.lastEvent];
  }

  private nextTarget(from: Point): Point {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = {
        x: this.rng.range(0, FLOOR_COLS - platformSize),
        y: this.rng.range(0, FLOOR_ROWS - platformSize)
      };
      if (Math.abs(candidate.x - from.x) + Math.abs(candidate.y - from.y) >= 7) return candidate;
    }
    return { x: from.x < 8 ? 12 : 1, y: from.y < 16 ? 25 : 3 };
  }

  private paintLava(frame: Frame): void {
    const pulse = Math.floor(this.nowMillis / 180);
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        paintFrameCell(frame, x, y, (x * 3 + y + pulse) % 11 < 2 ? "#ff5a1f" : "#b20d21");
      }
    }
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.rng = createSeededRng(this.config.seed);
    this.current = { ...startPlatform };
    this.target = this.nextTarget(this.current);
    this.finishedAtMillis = undefined;
    this.lastEvent = gameEvent("ready", "Espera en la plataforma azul", nowMillis);
    this.lives = saltosStartingLives;
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.score = 0;
    this.startedAtMillis = nowMillis;
    this.players = this.scoredPlayers();
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, score: this.score, lives: this.lives }));
  }
}

function insidePlatform(point: Point, platform: Point): boolean {
  return point.x >= platform.x && point.x < platform.x + platformSize && point.y >= platform.y && point.y < platform.y + platformSize;
}
