import {
  createFrame,
  createPlayerReadyGate,
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

export const patronesCelebrationMillis = 5_000;
export type PatternPoint = { x: number; y: number };
export type PatronesSnapshot = GameSnapshot & { celebrationMillis: number; claimedTargets: number; totalTargets: number };
export type PatronesGameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): PatronesSnapshot };

const patterns: Record<string, PatternPoint[]> = {
  easy: [
    { x: 7, y: 11 }, { x: 8, y: 11 }, { x: 6, y: 12 }, { x: 9, y: 12 },
    { x: 5, y: 13 }, { x: 10, y: 13 }, { x: 7, y: 14 }, { x: 8, y: 14 }
  ],
  medium: [
    { x: 7, y: 8 }, { x: 8, y: 8 }, { x: 6, y: 10 }, { x: 9, y: 10 },
    { x: 5, y: 12 }, { x: 10, y: 12 }, { x: 6, y: 14 }, { x: 9, y: 14 },
    { x: 7, y: 16 }, { x: 8, y: 16 }, { x: 7, y: 18 }, { x: 8, y: 18 }
  ],
  hard: [
    { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 5, y: 9 }, { x: 10, y: 9 },
    { x: 4, y: 12 }, { x: 11, y: 12 }, { x: 6, y: 13 }, { x: 9, y: 13 },
    { x: 5, y: 16 }, { x: 10, y: 16 }, { x: 7, y: 17 }, { x: 8, y: 17 },
    { x: 6, y: 20 }, { x: 9, y: 20 }, { x: 7, y: 22 }, { x: 8, y: 22 }
  ]
};

export function patternTargets(difficulty = "medium"): PatternPoint[] {
  return (patterns[difficulty] ?? patterns.medium ?? []).map((point) => ({ ...point }));
}

export function createGame(config: GameConfig): PatronesGameInstance {
  return new PatronesGame(config);
}

class PatronesGame implements PatronesGameInstance {
  private claimed = new Set<string>();
  private config: NormalizedGameConfig;
  private finishedAtMillis: number | undefined;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[];
  private readyGate: PlayerReadyGate;
  private startedAtMillis = 0;
  private success = false;
  private targets: PatternPoint[];

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [{ minX: 5, maxX: 10, minY: 13, maxY: 18 }], this.config.nowMillis);
    this.targets = patternTargets(this.config.difficulty);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); return [this.lastEvent]; }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    if (this.phase !== "running" || !event.pressed) return [];
    const key = `${event.x},${event.y}`;
    if (this.targets.some((target) => target.x === event.x && target.y === event.y)) {
      if (this.claimed.has(key)) return [];
      this.claimed.add(key);
      this.players = this.scoredPlayers();
      if (this.claimed.size === this.targets.length) return this.finish(true, "Patrón completado", event.atMillis);
      this.lastEvent = gameEvent("hit", `Acierto ${this.claimed.size} de ${this.targets.length}`, event.atMillis);
      return [this.lastEvent];
    }
    return this.finish(false, "Baldosa incorrecta", event.atMillis);
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
      if (event.atMillis - (this.finishedAtMillis ?? event.atMillis) >= patronesCelebrationMillis) {
        this.resetState(event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase === "running" && this.remainingMillis() === 0) return this.finish(false, "Tiempo agotado", event.atMillis);
    return [];
  }

  render(): Frame {
    const frame = createFrame("#030712");
    if (this.phase === "waiting" || this.phase === "starting") {
      const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
      paintDiamondRing(frame, { centerX: 8, centerY: 16, radius: 2 + step % 8, color: this.phase === "starting" ? "#ffe176" : "#176bff" });
      return frame;
    }
    for (const target of this.targets) {
      paintFrameCell(frame, target.x, target.y, this.claimed.has(`${target.x},${target.y}`) ? "#35e77a" : "#176bff");
    }
    if (this.phase === "finished") {
      paintDiamondWave(frame, { color: this.success ? "#35e77a" : "#ff334e", step: Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 140) });
    }
    return frame;
  }

  snapshot(): PatronesSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.claimed.size,
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? this.targets.length - this.claimed.size : 0,
      success: this.phase === "finished" && this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      matchTarget: this.targets.length,
      claimedTargets: this.claimed.size,
      totalTargets: this.targets.length,
      celebrationMillis: this.phase === "finished" ? Math.max(0, patronesCelebrationMillis - (this.nowMillis - (this.finishedAtMillis ?? this.nowMillis))) : 0
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.targets = patternTargets(this.config.difficulty);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") { this.phase = "starting"; this.lastEvent = gameEvent("ready", "Jugador listo", nowMillis); }
    else if (transition === "players-left") { this.phase = "waiting"; this.lastEvent = gameEvent("ready", "Vuelve al centro", nowMillis); }
    else if (transition === "started") { this.phase = "running"; this.startedAtMillis = nowMillis; this.lastEvent = gameEvent("start", "Reconstruye el patrón azul", nowMillis); }
    else return [];
    return [this.lastEvent];
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") return 0;
    return Math.max(0, (this.finishedAtMillis ?? this.nowMillis) - this.startedAtMillis);
  }

  private finish(success: boolean, message: string, atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private remainingMillis(): number { return Math.max(0, this.config.durationMillis - this.elapsedMillis()); }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.claimed.clear();
    this.finishedAtMillis = undefined;
    this.lastEvent = gameEvent("ready", "Espera en la zona central", nowMillis);
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.startedAtMillis = nowMillis;
    this.success = false;
    this.players = this.scoredPlayers();
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, score: this.claimed.size }));
  }
}
