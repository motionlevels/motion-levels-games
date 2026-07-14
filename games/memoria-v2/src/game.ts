import {
  createFrame,
  createPlayerReadyGate,
  createSeededRng,
  defaultPlayers,
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

export const memoriaV2TotalLevels = 20;
export const memoriaV2StartingLives = 3;
export const memoriaV2MemorizeMillis = 5_000;
export const memoriaV2RoundWinMillis = 2_200;
export const memoriaV2GameWinMillis = 5_000;

export type MemoryPoint = { x: number; y: number };
type MemoryStage = "memorize" | "recall" | "round-win" | "game-win" | "game-loss";

export type MemoriaV2Snapshot = GameSnapshot & {
  claimedTargets: number;
  level: number;
  maxLives: number;
  memoryStage: MemoryStage;
  stageMillis: number;
  targets: MemoryPoint[];
  totalLevels: number;
  totalTargets: number;
};

export type MemoriaV2GameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): MemoriaV2Snapshot };

export function createGame(config: GameConfig): MemoriaV2GameInstance { return new MemoriaV2Game(config); }

export function memoryTargetsForLevel(seed: number, level: number): MemoryPoint[] {
  const rng = createSeededRng((seed + level * 0x9e3779b9) >>> 0);
  const targetCount = Math.min(20, 4 + Math.floor((level - 1) / 2));
  const points: MemoryPoint[] = [];
  const used = new Set<string>();
  while (points.length < targetCount) {
    const point = { x: rng.int(16), y: 4 + rng.int(24) };
    const key = `${point.x},${point.y}`;
    if (!used.has(key)) { used.add(key); points.push(point); }
  }
  return points;
}

class MemoriaV2Game implements MemoriaV2GameInstance {
  private claimed = new Set<string>();
  private config: NormalizedGameConfig;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private level = 1;
  private lives = memoriaV2StartingLives;
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[];
  private readyGate: PlayerReadyGate;
  private stage: MemoryStage = "memorize";
  private stageEndsAtMillis = 0;
  private startedAtMillis = 0;
  private targets: MemoryPoint[] = [];

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [{ minX: 5, maxX: 10, minY: 13, maxY: 18 }], this.config.nowMillis);
    this.targets = memoryTargetsForLevel(this.config.seed, this.level);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); return [this.lastEvent]; }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    if (this.phase !== "running" || this.stage !== "recall" || !event.pressed) return [];
    const key = `${event.x},${event.y}`;
    if (this.targets.some((target) => target.x === event.x && target.y === event.y)) {
      if (this.claimed.has(key)) return [];
      this.claimed.add(key);
      this.players = this.scoredPlayers();
      if (this.claimed.size === this.targets.length) return this.completeLevel(event.atMillis);
      this.lastEvent = gameEvent("hit", `Acierto ${this.claimed.size} de ${this.targets.length}`, event.atMillis);
      return [this.lastEvent];
    }
    this.lives -= 1;
    this.players = this.scoredPlayers();
    if (this.lives <= 0) return this.finish(false, "Sin vidas", event.atMillis);
    this.lastEvent = gameEvent("damage", `Error, quedan ${this.lives} vidas`, event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis);
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis);
    if (this.phase === "finished") {
      if (event.atMillis >= this.stageEndsAtMillis) { this.resetState(event.atMillis); return [this.lastEvent]; }
      return [];
    }
    if (this.stage === "memorize" && event.atMillis >= this.stageEndsAtMillis) {
      this.stage = "recall";
      this.lastEvent = gameEvent("start", "Reconstruye la figura", event.atMillis);
      return [this.lastEvent];
    }
    if (this.stage === "round-win" && event.atMillis >= this.stageEndsAtMillis) {
      this.level += 1;
      this.lives = memoriaV2StartingLives;
      this.claimed.clear();
      this.targets = memoryTargetsForLevel(this.config.seed, this.level);
      this.stage = "memorize";
      this.stageEndsAtMillis = event.atMillis + memoriaV2MemorizeMillis;
      this.lastEvent = gameEvent("ready", `Memoriza el nivel ${this.level}`, event.atMillis);
      this.players = this.scoredPlayers();
      return [this.lastEvent];
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame("#020712");
    if (this.phase === "waiting" || this.phase === "starting") {
      const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
      paintDiamondRing(frame, { centerX: 8, centerY: 16, radius: 2 + step % 8, color: this.phase === "starting" ? "#ffe176" : "#22d3ee" });
      return frame;
    }
    if (this.stage === "memorize") {
      for (const target of this.targets) paintFrameCell(frame, target.x, target.y, "#22d3ee");
    } else if (this.stage === "recall") {
      for (const target of this.targets) if (this.claimed.has(`${target.x},${target.y}`)) paintFrameCell(frame, target.x, target.y, "#35e77a");
    } else {
      const color = this.stage === "game-loss" ? "#ff334e" : this.stage === "round-win" ? "#ffe176" : "#35e77a";
      paintDiamondWave(frame, { color, step: Math.floor((this.stageEndsAtMillis - this.nowMillis) / 140) });
    }
    return frame;
  }

  snapshot(): MemoriaV2Snapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.claimed.size,
      lives: this.lives,
      maxLives: memoriaV2StartingLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.stage === "memorize" ? Math.max(0, this.stageEndsAtMillis - this.nowMillis) : 0,
      activeTargets: this.stage === "recall" ? this.targets.length - this.claimed.size : 0,
      success: this.phase === "finished" && this.stage === "game-win",
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      matchTarget: this.targets.length,
      level: this.level,
      totalLevels: memoriaV2TotalLevels,
      memoryStage: this.stage,
      claimedTargets: this.claimed.size,
      totalTargets: this.targets.length,
      targets: this.targets.map((target) => ({ ...target })),
      stageMillis: Math.max(0, this.stageEndsAtMillis - this.nowMillis)
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") { this.phase = "starting"; this.lastEvent = gameEvent("ready", "Jugador listo", nowMillis); }
    else if (transition === "players-left") { this.phase = "waiting"; this.lastEvent = gameEvent("ready", "Vuelve al centro", nowMillis); }
    else if (transition === "started") {
      this.phase = "running";
      this.stage = "memorize";
      this.stageEndsAtMillis = nowMillis + memoriaV2MemorizeMillis;
      this.startedAtMillis = nowMillis;
      this.lastEvent = gameEvent("start", "Memoriza la figura azul", nowMillis);
    } else return [];
    return [this.lastEvent];
  }

  private completeLevel(atMillis: number): GameEvent[] {
    if (this.level >= memoriaV2TotalLevels) return this.finish(true, "Memoria completada", atMillis);
    this.stage = "round-win";
    this.stageEndsAtMillis = atMillis + memoriaV2RoundWinMillis;
    this.lastEvent = gameEvent("win", `Nivel ${this.level} completado`, atMillis);
    return [this.lastEvent];
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") return 0;
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private finish(success: boolean, message: string, atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.stage = success ? "game-win" : "game-loss";
    this.stageEndsAtMillis = atMillis + memoriaV2GameWinMillis;
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.claimed.clear();
    this.level = 1;
    this.lives = memoriaV2StartingLives;
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.stage = "memorize";
    this.stageEndsAtMillis = 0;
    this.startedAtMillis = nowMillis;
    this.targets = memoryTargetsForLevel(this.config.seed, this.level);
    this.lastEvent = gameEvent("ready", "Espera en la zona central", nowMillis);
    this.players = this.scoredPlayers();
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, score: this.level - 1, lives: this.lives }));
  }
}
