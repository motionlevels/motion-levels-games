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
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const lavaStartingLives = 3;
export const lavaCelebrationMillis = 5_000;
export const lavaDamageImmunityMillis = 1_000;

type SafePlatform = { bornMillis: number; height: number; id: number; width: number; x: number };
export type VisibleSafePlatform = { height: number; id: number; width: number; x: number; y: number };
export type LavaSnapshot = GameSnapshot & { maxLives: number; safePlatforms: VisibleSafePlatform[]; celebrationMillis: number };
export type LavaGameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): LavaSnapshot };

const difficultySettings: Record<string, { speed: number; width: number; height: number; spawnMillis: number }> = {
  easy: { speed: 2, width: 4, height: 3, spawnMillis: 2_400 },
  medium: { speed: 2.6, width: 3, height: 3, spawnMillis: 2_000 },
  hard: { speed: 3.2, width: 3, height: 2, spawnMillis: 1_650 },
  expert: { speed: 4, width: 2, height: 2, spawnMillis: 1_350 }
};

export function createGame(config: GameConfig): LavaGameInstance { return new LavaGame(config); }

class LavaGame implements LavaGameInstance {
  private config: NormalizedGameConfig;
  private finishedAtMillis: number | undefined;
  private lastDamageAtMillis = Number.NEGATIVE_INFINITY;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private lives = lavaStartingLives;
  private nextPlatformId = 1;
  private nextSpawnAtMillis = 0;
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private platforms: SafePlatform[] = [];
  private players: GamePlayer[];
  private readyGate: PlayerReadyGate;
  private rng: SeededRng;
  private score = 0;
  private startedAtMillis = 0;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [{ minX: 5, maxX: 10, minY: 13, maxY: 18 }], this.config.nowMillis);
    this.rng = createSeededRng(this.config.seed);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); return [this.lastEvent]; }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    if (this.phase !== "running" || !event.pressed) return [];
    this.advancePlatforms(event.atMillis);
    const safe = this.visiblePlatforms().find((platform) => inside(event, platform));
    if (safe) {
      this.platforms = this.platforms.filter((platform) => platform.id !== safe.id);
      this.score += 1;
      this.players = this.scoredPlayers();
      this.lastEvent = gameEvent("coin", `Plataforma ${this.score}`, event.atMillis);
      return [this.lastEvent];
    }
    if (event.atMillis - this.lastDamageAtMillis < lavaDamageImmunityMillis) return [];
    this.lastDamageAtMillis = event.atMillis;
    this.lives -= 1;
    this.players = this.scoredPlayers();
    if (this.lives <= 0) return this.finish(false, "La lava os ha alcanzado", event.atMillis);
    this.lastEvent = gameEvent("damage", `Vida perdida, quedan ${this.lives}`, event.atMillis);
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
      if (event.atMillis - (this.finishedAtMillis ?? event.atMillis) >= lavaCelebrationMillis) { this.resetState(event.atMillis); return [this.lastEvent]; }
      return [];
    }
    this.advancePlatforms(event.atMillis);
    if (this.phase === "running" && this.remainingMillis() === 0) return this.finish(true, `${this.score} plataformas seguras`, event.atMillis);
    return [];
  }

  render(): Frame {
    const frame = createFrame("#8e0b1d");
    if (this.phase === "waiting" || this.phase === "starting") {
      const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
      paintDiamondRing(frame, { centerX: 8, centerY: 16, radius: 2 + step % 8, color: this.phase === "starting" ? "#ffe176" : "#22d3ee" });
      return frame;
    }
    const pulse = Math.floor(this.nowMillis / 160);
    for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = 0; x < FLOOR_COLS; x += 1) {
      paintFrameCell(frame, x, y, (x * 5 + y + pulse) % 13 < 3 ? "#ff5a1f" : "#b20d21");
    }
    for (const platform of this.visiblePlatforms()) fillFrameRect(frame, platform.x, platform.y, platform.width, platform.height, "#39e77d");
    if (this.phase === "finished") {
      paintDiamondWave(frame, { color: this.lives > 0 ? "#39e77d" : "#ff334e", step: Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 140) });
    }
    return frame;
  }

  snapshot(): LavaSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id, label: manifest.label, phase: this.phase,
      playerCount: this.config.playerCount, players: this.players, score: this.score,
      lives: this.lives, maxLives: lavaStartingLives,
      elapsedMillis: this.elapsedMillis(), remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? this.visiblePlatforms().length : 0,
      success: this.phase === "finished" && this.lives > 0,
      lastEventCue: this.lastEvent.cue, lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers, requiredPlayers: ready.requiredPlayers,
      safePlatforms: this.visiblePlatforms(),
      celebrationMillis: this.phase === "finished" ? Math.max(0, lavaCelebrationMillis - (this.nowMillis - (this.finishedAtMillis ?? this.nowMillis))) : 0
    };
  }

  reset(config: Partial<GameConfig> = {}): void { this.config = normalizeGameConfig({ ...this.config, ...config }, manifest); this.resetState(this.config.nowMillis); }

  private advancePlatforms(nowMillis: number): void {
    if (this.phase !== "running") return;
    const settings = difficultySettings[this.config.difficulty] ?? difficultySettings.medium!;
    while (nowMillis >= this.nextSpawnAtMillis) {
      this.platforms.push({ id: this.nextPlatformId++, bornMillis: this.nextSpawnAtMillis, width: settings.width, height: settings.height, x: this.rng.range(0, FLOOR_COLS - settings.width) });
      this.nextSpawnAtMillis += settings.spawnMillis;
    }
    this.platforms = this.platforms.filter((platform) => this.platformY(platform) < FLOOR_ROWS);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") { this.phase = "starting"; this.lastEvent = gameEvent("ready", "Equipo listo", nowMillis); }
    else if (transition === "players-left") { this.phase = "waiting"; this.lastEvent = gameEvent("ready", "Vuelve a la zona azul", nowMillis); }
    else if (transition === "started") {
      this.phase = "running"; this.startedAtMillis = nowMillis; this.nextSpawnAtMillis = nowMillis;
      this.advancePlatforms(nowMillis); this.lastEvent = gameEvent("start", "Pisa solo las plataformas verdes", nowMillis);
    } else return [];
    return [this.lastEvent];
  }

  private elapsedMillis(): number { if (this.phase === "waiting" || this.phase === "starting") return 0; return Math.max(0, (this.finishedAtMillis ?? this.nowMillis) - this.startedAtMillis); }
  private finish(success: boolean, message: string, atMillis: number): GameEvent[] { this.phase = "finished"; this.finishedAtMillis = atMillis; this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis); return [this.lastEvent]; }
  private platformY(platform: SafePlatform): number { const speed = (difficultySettings[this.config.difficulty] ?? difficultySettings.medium!).speed; return Math.floor((this.nowMillis - platform.bornMillis) * speed / 1_000) - platform.height; }
  private remainingMillis(): number { return Math.max(0, this.config.durationMillis - this.elapsedMillis()); }
  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis); this.finishedAtMillis = undefined; this.lastDamageAtMillis = Number.NEGATIVE_INFINITY;
    this.lastEvent = gameEvent("ready", "Espera en la zona azul", nowMillis); this.lives = lavaStartingLives;
    this.nextPlatformId = 1; this.nextSpawnAtMillis = nowMillis; this.nowMillis = nowMillis; this.phase = "waiting";
    this.platforms = []; this.rng = createSeededRng(this.config.seed); this.score = 0; this.startedAtMillis = nowMillis; this.players = this.scoredPlayers();
  }
  private scoredPlayers(): GamePlayer[] { return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, score: this.score, lives: this.lives })); }
  private visiblePlatforms(): VisibleSafePlatform[] { return this.platforms.map((platform) => ({ id: platform.id, x: platform.x, y: this.platformY(platform), width: platform.width, height: platform.height })).filter((platform) => platform.y + platform.height > 0 && platform.y < FLOOR_ROWS); }
}

function inside(point: { x: number; y: number }, platform: VisibleSafePlatform): boolean { return point.x >= platform.x && point.x < platform.x + platform.width && point.y >= platform.y && point.y < platform.y + platform.height; }
