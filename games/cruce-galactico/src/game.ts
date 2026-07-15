import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
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

export const startingLives = 3;
export const checkpointTarget = 4;
export const gameWinAnimationMillis = 3_000;
export const damageImmunityMillis = 1_500;

export type GalacticHazard = { x: number; y: number; width: number; height: number };
export type GalacticCrossingSnapshot = GameSnapshot & {
  checkpoint: number;
  checkpointTarget: number;
  hazards: GalacticHazard[];
  celebrating: boolean;
  celebrationMillis: number;
  maxLives: number;
};
export type GalacticCrossingGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): GalacticCrossingSnapshot;
};

const backgroundColor: HexColor = "#02030b";
const laneColor: HexColor = "#090d20";
const checkpointColor: HexColor = "#26d9ff";
const nextCheckpointColor: HexColor = "#66ff9a";
const hazardColor: HexColor = "#ff365c";
const hazardCoreColor: HexColor = "#fff0a6";
const playerColor: HexColor = "#ffffff";
const winColors = ["#7c5cff", "#26d9ff", "#66ff9a", "#ffffff"] as const satisfies readonly HexColor[];
const startZone = { minX: 4, maxX: 11, minY: 29, maxY: 31 };
const checkpointBands = [
  { minY: 22, maxY: 23 },
  { minY: 15, maxY: 16 },
  { minY: 8, maxY: 9 },
  { minY: 0, maxY: 2 }
] as const;
const lanes = [
  { minY: 24, maxY: 28, direction: 1, offset: 0 },
  { minY: 17, maxY: 21, direction: -1, offset: 4 },
  { minY: 10, maxY: 14, direction: 1, offset: 8 },
  { minY: 3, maxY: 7, direction: -1, offset: 2 }
] as const;
const difficultyStepMillis: Record<string, number> = { easy: 620, medium: 480, hard: 360, expert: 270 };

export function createGame(config: GameConfig): GalacticCrossingGameInstance {
  return new GalacticCrossingGame(config);
}

class GalacticCrossingGame implements GalacticCrossingGameInstance {
  private checkpoint = 0;
  private config: NormalizedGameConfig;
  private finishedAtMillis: number | undefined;
  private lastDamageAtMillis = Number.NEGATIVE_INFINITY;
  private lastEvent: GameEvent = gameEvent("none", "Listo para despegar", 0);
  private lives = startingLives;
  private nowMillis = 0;
  private occupiedTiles = new Set<string>();
  private phase: GamePhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private startedAtMillis = 0;
  private success = false;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [startZone], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupied(event.x, event.y, event.pressed);
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase !== "running" || !event.pressed) return [];

    const band = checkpointBands[this.checkpoint];
    if (!band || event.y < band.minY || event.y > band.maxY) return [];
    this.checkpoint += 1;
    this.players = this.scoredPlayers();
    if (this.checkpoint === checkpointTarget) {
      return [this.finish(true, "Portal alcanzado", event.atMillis)];
    }
    this.lastEvent = gameEvent("hit", `Control ${this.checkpoint} activado`, event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupied(event.x, event.y, false);
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
    if (this.phase !== "running") return [];

    if (this.remainingMillis() === 0) return [this.finish(false, "Tiempo agotado", event.atMillis)];
    if (event.atMillis - this.lastDamageAtMillis < damageImmunityMillis || !this.playerTouchesHazard()) return [];

    this.lastDamageAtMillis = event.atMillis;
    this.lives = Math.max(0, this.lives - 1);
    this.players = this.scoredPlayers();
    if (this.lives === 0) return [this.finish(false, "Nave destruida", event.atMillis)];
    this.lastEvent = gameEvent("miss", `Impacto: quedan ${this.lives} vidas`, event.atMillis);
    return [this.lastEvent];
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    for (const lane of lanes) fillFrameRect(frame, 0, lane.minY, FLOOR_COLS, lane.maxY - lane.minY + 1, laneColor);

    if (this.phase === "waiting" || this.phase === "starting") {
      const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
      paintDiamondRing(frame, {
        centerX: 8,
        centerY: 30,
        radius: 1 + step % 6,
        color: this.phase === "starting" ? "#ffe176" : checkpointColor
      });
      return frame;
    }

    if (this.phase === "finished") {
      if (this.success) {
        const step = Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 120);
        paintDiamondWave(frame, {
          color: ({ distance }) => winColors[(distance + step) % winColors.length] ?? winColors[0],
          step
        });
      } else {
        const pulse = Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 180) % 2;
        fillFrameRect(frame, 0, 0, FLOOR_COLS, FLOOR_ROWS, pulse === 0 ? "#5b0717" : "#18030a");
      }
      return frame;
    }

    checkpointBands.forEach((band, index) => {
      const color = index < this.checkpoint ? checkpointColor : index === this.checkpoint ? nextCheckpointColor : "#15233d";
      fillFrameRect(frame, 0, band.minY, FLOOR_COLS, band.maxY - band.minY + 1, color);
    });
    for (const hazard of this.currentHazards()) {
      fillFrameRect(frame, hazard.x, hazard.y, hazard.width, hazard.height, hazardColor);
      paintFrameCell(frame, hazard.x + 1, hazard.y + 1, hazardCoreColor);
    }
    for (const tile of this.occupiedTiles) {
      const [x, y] = parseTile(tile);
      paintFrameCell(frame, x, y, playerColor);
    }
    return frame;
  }

  snapshot(): GalacticCrossingSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    const celebrationMillis = this.phase === "finished" && this.success
      ? Math.min(gameWinAnimationMillis, Math.max(0, this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)))
      : 0;
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.checkpoint,
      lives: this.lives,
      maxLives: startingLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? 1 : 0,
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      matchTarget: checkpointTarget,
      checkpoint: this.checkpoint,
      checkpointTarget,
      hazards: this.phase === "running" ? this.currentHazards() : [],
      celebrating: this.success && celebrationMillis < gameWinAnimationMillis,
      celebrationMillis
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Tripulación lista", nowMillis);
    } else if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a la plataforma azul", nowMillis);
    } else if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastEvent = gameEvent("start", "Avanza hacia el control verde", nowMillis);
    } else return [];
    return [this.lastEvent];
  }

  private currentHazards(): GalacticHazard[] {
    const stepMillis = difficultyStepMillis[this.config.difficulty] ?? difficultyStepMillis.medium!;
    const step = Math.floor(Math.max(0, this.nowMillis - this.startedAtMillis) / stepMillis);
    return lanes.flatMap((lane, laneIndex) => [0, 7, 14].map((gap) => {
      const raw = lane.offset + gap + step * lane.direction;
      const x = ((raw % 20) + 20) % 20 - 3;
      return { x, y: lane.minY + (laneIndex % 2), width: 3, height: 3 };
    })).filter((hazard) => hazard.x < FLOOR_COLS && hazard.x + hazard.width > 0);
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") return 0;
    return Math.max(0, (this.finishedAtMillis ?? this.nowMillis) - this.startedAtMillis);
  }

  private finish(success: boolean, message: string, atMillis: number): GameEvent {
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return this.lastEvent;
  }

  private playerTouchesHazard(): boolean {
    const hazards = this.currentHazards();
    for (const tile of this.occupiedTiles) {
      const [x, y] = parseTile(tile);
      if (hazards.some((hazard) => x >= hazard.x && x < hazard.x + hazard.width && y >= hazard.y && y < hazard.y + hazard.height)) return true;
    }
    return false;
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.checkpoint = 0;
    this.finishedAtMillis = undefined;
    this.lastDamageAtMillis = Number.NEGATIVE_INFINITY;
    this.lastEvent = gameEvent("ready", "Espera en la plataforma azul", nowMillis);
    this.lives = startingLives;
    this.nowMillis = nowMillis;
    this.occupiedTiles.clear();
    this.phase = "waiting";
    this.players = this.scoredPlayers();
    this.startedAtMillis = nowMillis;
    this.success = false;
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      score: this.checkpoint,
      lives: this.lives
    }));
  }

  private updateOccupied(x: number, y: number, pressed: boolean): void {
    if (x < 0 || x >= FLOOR_COLS || y < 0 || y >= FLOOR_ROWS) return;
    const key = `${x},${y}`;
    if (pressed) this.occupiedTiles.add(key);
    else this.occupiedTiles.delete(key);
  }
}

function parseTile(tile: string): [number, number] {
  const [x = "0", y = "0"] = tile.split(",");
  return [Number(x), Number(y)];
}
