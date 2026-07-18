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
  type PlayerReadyZone,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const equilibrioRoundWinMillis = 3_000;
export const equilibrioGameWinMillis = 5_000;
export const equilibrioGameFailMillis = 5_000;
export const equilibrioMaxStability = 100;

const backgroundColor: HexColor = "#03080a";
const leftColor: HexColor = "#35d7ff";
const rightColor: HexColor = "#ff3bd7";
const successColors = ["#35d7ff", "#5fff9e", "#ffe176", "#ff3bd7", "#ffffff"] as const satisfies readonly HexColor[];
const readyZones: PlayerReadyZone[] = [
  { minX: 2, maxX: 6, minY: 14, maxY: 18 },
  { minX: 9, maxX: 13, minY: 14, maxY: 18 }
];

export type EquilibrioChallenge = {
  left: PlayerReadyZone;
  right: PlayerReadyZone;
};

export const equilibrioChallenges: readonly EquilibrioChallenge[] = [
  { left: { minX: 1, maxX: 4, minY: 4, maxY: 8 }, right: { minX: 11, maxX: 14, minY: 4, maxY: 8 } },
  { left: { minX: 3, maxX: 6, minY: 12, maxY: 16 }, right: { minX: 9, maxX: 12, minY: 12, maxY: 16 } },
  { left: { minX: 1, maxX: 4, minY: 22, maxY: 26 }, right: { minX: 11, maxX: 14, minY: 22, maxY: 26 } },
  { left: { minX: 4, maxX: 7, minY: 5, maxY: 9 }, right: { minX: 8, maxX: 11, minY: 22, maxY: 26 } },
  { left: { minX: 0, maxX: 3, minY: 27, maxY: 31 }, right: { minX: 12, maxX: 15, minY: 0, maxY: 4 } }
] as const;

type DifficultyProfile = {
  holdMillis: number;
  stabilityPenalty: number;
};

const difficultyProfiles: Record<string, DifficultyProfile> = {
  easy: { holdMillis: 1_200, stabilityPenalty: 8 },
  medium: { holdMillis: 1_600, stabilityPenalty: 12 },
  hard: { holdMillis: 2_000, stabilityPenalty: 16 },
  expert: { holdMillis: 2_400, stabilityPenalty: 20 }
};

type EquilibrioPhase = GamePhase | "round-win";

export type EquilibrioSnapshot = GameSnapshot & {
  challengeCount: number;
  challengeIndex: number;
  holdMillis: number;
  holdTargetMillis: number;
  leftOccupied: boolean;
  rightOccupied: boolean;
  stability: number;
  stage: "waiting" | "balancing" | "round-win" | "game-win" | "game-fail";
};

export type EquilibrioGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): EquilibrioSnapshot;
};

export function equilibrioDifficultyProfile(difficulty: string): DifficultyProfile {
  return { ...(difficultyProfiles[difficulty] ?? difficultyProfiles.medium!) };
}

export function createGame(config: GameConfig): EquilibrioGameInstance {
  return new EquilibrioGame(config);
}

class EquilibrioGame implements EquilibrioGameInstance {
  private challengeIndex = 0;
  private config: NormalizedGameConfig;
  private finishedAtMillis = 0;
  private heldTiles = new Set<string>();
  private holdStartedAtMillis: number | null = null;
  private lastEvent: GameEvent = gameEvent("none", "La balanza está preparada", 0);
  private nowMillis = 0;
  private phase: EquilibrioPhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private roundWinAtMillis = 0;
  private stability = equilibrioMaxStability;
  private startedAtMillis = 0;
  private success = false;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Ocupa las dos zonas centrales", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase !== "running" || !event.pressed) return [];

    const key = tileKey(event.x, event.y);
    if (this.heldTiles.has(key)) return [];
    this.heldTiles.add(key);

    if (!this.currentPadSide(event.x, event.y)) {
      this.stability = Math.max(0, this.stability - this.profile().stabilityPenalty);
      this.holdStartedAtMillis = null;
      if (this.stability === 0) return this.finish(false, event.atMillis, "La balanza perdió la estabilidad");
      this.lastEvent = gameEvent("miss", "Baldosa fuera de equilibrio", event.atMillis);
      return [this.lastEvent];
    }

    this.updateHoldStart(event.atMillis);
    this.lastEvent = gameEvent("hold", this.bothPadsOccupied() ? "Mantén el equilibrio" : "Falta el otro lado", event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis);
    }
    this.heldTiles.delete(tileKey(event.x, event.y));
    if (this.phase === "running" && !this.bothPadsOccupied()) this.holdStartedAtMillis = null;
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis);
    }
    if (this.phase === "finished") {
      const resultMillis = this.success ? equilibrioGameWinMillis : equilibrioGameFailMillis;
      if (event.atMillis - this.finishedAtMillis >= resultMillis) {
        this.resetState(event.atMillis);
        this.phase = "waiting";
        this.lastEvent = gameEvent("ready", "Ocupa las dos zonas centrales", event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase === "round-win") {
      if (event.atMillis - this.roundWinAtMillis >= equilibrioRoundWinMillis) {
        this.challengeIndex += 1;
        this.phase = "running";
        this.heldTiles.clear();
        this.holdStartedAtMillis = null;
        this.lastEvent = gameEvent("start", `Nivel ${this.challengeIndex + 1}`, event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase !== "running") return [];
    if (this.remainingMillis() <= 0) return this.finish(false, event.atMillis, "Se acabó el tiempo");

    this.updateHoldStart(event.atMillis);
    if (this.holdStartedAtMillis !== null && event.atMillis - this.holdStartedAtMillis >= this.profile().holdMillis) {
      if (this.challengeIndex + 1 >= equilibrioChallenges.length) {
        return this.finish(true, event.atMillis, "Equilibrio perfecto");
      }
      this.phase = "round-win";
      this.roundWinAtMillis = event.atMillis;
      this.holdStartedAtMillis = null;
      this.players = this.scoredPlayers();
      this.lastEvent = gameEvent("round-win", `Nivel ${this.challengeIndex + 1} superado`, event.atMillis);
      return [this.lastEvent];
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    this.paintBoard(frame);
    if (this.phase === "waiting" || this.phase === "starting") {
      readyZones.forEach((zone, index) => {
        const ready = this.readyGate.zoneReady(index, this.nowMillis);
        fillFrameRect(frame, zone.minX, zone.minY, zone.maxX, zone.maxY, ready ? "#ffffff" : index === 0 ? leftColor : rightColor);
      });
      const radius = 2 + Math.floor(this.nowMillis / 150) % 9;
      paintDiamondRing(frame, { centerX: 8, centerY: 16, color: this.phase === "starting" ? "#ffe176" : "#5fff9e", radius });
      return frame;
    }
    if (this.phase === "round-win") {
      this.paintRoundWin(frame);
      return frame;
    }
    if (this.phase === "finished") {
      this.paintResult(frame);
      return frame;
    }
    const challenge = equilibrioChallenges[this.challengeIndex];
    if (challenge) {
      this.paintPad(frame, challenge.left, leftColor, this.padOccupied(challenge.left));
      this.paintPad(frame, challenge.right, rightColor, this.padOccupied(challenge.right));
    }
    const progress = this.holdProgress();
    const progressCells = Math.round(progress * FLOOR_ROWS);
    for (let offset = 0; offset < progressCells; offset += 1) {
      paintFrameCell(frame, 7, FLOOR_ROWS - 1 - offset, "#5fff9e");
      paintFrameCell(frame, 8, FLOOR_ROWS - 1 - offset, "#5fff9e");
    }
    return frame;
  }

  snapshot(): EquilibrioSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const completed = this.challengeIndex + Number(this.phase === "round-win" || this.success);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: Math.min(completed, equilibrioChallenges.length),
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? 2 : 0,
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: equilibrioChallenges.length,
      challengeCount: equilibrioChallenges.length,
      challengeIndex: Math.min(this.challengeIndex, equilibrioChallenges.length - 1),
      holdMillis: Math.round(this.holdProgress() * this.profile().holdMillis),
      holdTargetMillis: this.profile().holdMillis,
      leftOccupied: this.currentPadOccupied("left"),
      rightOccupied: this.currentPadOccupied("right"),
      stability: this.stability,
      stage: this.phase === "finished" ? (this.success ? "game-win" : "game-fail") : this.phase === "round-win" ? "round-win" : this.phase === "running" ? "balancing" : "waiting"
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Ocupa las dos zonas centrales", this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Balanza preparada", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a las dos zonas centrales", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.heldTiles.clear();
      this.lastEvent = gameEvent("start", "Busca las dos plataformas", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private finish(success: boolean, atMillis: number, message: string): GameEvent[] {
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    this.heldTiles.clear();
    this.holdStartedAtMillis = null;
    if (success) this.challengeIndex = equilibrioChallenges.length - 1;
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private paintBoard(frame: Frame): void {
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      paintFrameCell(frame, 7, y, "#10242c");
      paintFrameCell(frame, 8, y, "#281329");
    }
    for (let y = 3; y < FLOOR_ROWS; y += 6) {
      fillFrameRect(frame, 0, y, 6, y, "#07151b");
      fillFrameRect(frame, 9, y, FLOOR_COLS - 1, y, "#190a1c");
    }
  }

  private paintPad(frame: Frame, zone: PlayerReadyZone, color: HexColor, occupied: boolean): void {
    fillFrameRect(frame, zone.minX, zone.minY, zone.maxX, zone.maxY, occupied ? "#ffffff" : color);
    const insetColor = occupied ? color : "#061015";
    if (zone.maxX - zone.minX > 1 && zone.maxY - zone.minY > 1) {
      fillFrameRect(frame, zone.minX + 1, zone.minY + 1, zone.maxX - 1, zone.maxY - 1, insetColor);
    }
  }

  private paintRoundWin(frame: Frame): void {
    const elapsed = Math.max(0, this.nowMillis - this.roundWinAtMillis);
    paintDiamondWave(frame, {
      centerX: 8,
      centerY: 16,
      color: ({ distance, step }) => successColors[(distance + step) % successColors.length],
      period: 7,
      bandWidth: 4,
      step: Math.floor(elapsed / 90)
    });
  }

  private paintResult(frame: Frame): void {
    const elapsed = Math.max(0, this.nowMillis - this.finishedAtMillis);
    if (this.success) {
      paintDiamondWave(frame, {
        centerX: 8,
        centerY: 16,
        color: ({ distance, step }) => successColors[(distance + step) % successColors.length],
        period: 9,
        bandWidth: 6,
        step: Math.floor(elapsed / 85)
      });
      return;
    }
    fillFrameRect(frame, 0, 0, FLOOR_COLS - 1, FLOOR_ROWS - 1, Math.floor(elapsed / 180) % 2 === 0 ? "#4a0715" : "#17030a");
    paintDiamondRing(frame, { centerX: 8, centerY: 16, color: "#ff3151", radius: 2 + Math.floor(elapsed / 100) % 13 });
  }

  private updateHoldStart(atMillis: number): void {
    if (this.bothPadsOccupied()) {
      this.holdStartedAtMillis ??= atMillis;
    } else {
      this.holdStartedAtMillis = null;
    }
  }

  private bothPadsOccupied(): boolean {
    return this.currentPadOccupied("left") && this.currentPadOccupied("right");
  }

  private currentPadOccupied(side: "left" | "right"): boolean {
    const challenge = equilibrioChallenges[this.challengeIndex];
    return challenge ? this.padOccupied(challenge[side]) : false;
  }

  private padOccupied(zone: PlayerReadyZone): boolean {
    for (let y = zone.minY; y <= zone.maxY; y += 1) {
      for (let x = zone.minX; x <= zone.maxX; x += 1) {
        if (this.heldTiles.has(tileKey(x, y))) return true;
      }
    }
    return false;
  }

  private currentPadSide(x: number, y: number): "left" | "right" | null {
    const challenge = equilibrioChallenges[this.challengeIndex];
    if (!challenge) return null;
    if (insideZone(x, y, challenge.left)) return "left";
    if (insideZone(x, y, challenge.right)) return "right";
    return null;
  }

  private holdProgress(): number {
    if (this.holdStartedAtMillis === null || !this.bothPadsOccupied()) return 0;
    return Math.max(0, Math.min(1, (this.nowMillis - this.holdStartedAtMillis) / this.profile().holdMillis));
  }

  private profile(): DifficultyProfile {
    return difficultyProfiles[this.config.difficulty] ?? difficultyProfiles.medium!;
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") return 0;
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    const score = Math.min(this.challengeIndex + Number(this.phase === "round-win" || this.success), equilibrioChallenges.length);
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, label: player.label || `Jugador ${player.index + 1}`, score, lives: -1 }));
  }

  private resetState(nowMillis: number): void {
    this.challengeIndex = 0;
    this.finishedAtMillis = 0;
    this.heldTiles.clear();
    this.holdStartedAtMillis = null;
    this.nowMillis = nowMillis;
    this.phase = "ready";
    this.readyGate.reset(nowMillis);
    this.roundWinAtMillis = 0;
    this.stability = equilibrioMaxStability;
    this.startedAtMillis = nowMillis;
    this.success = false;
    this.players = this.scoredPlayers();
  }
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function insideZone(x: number, y: number, zone: PlayerReadyZone): boolean {
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY;
}
