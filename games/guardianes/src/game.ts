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

export const guardianesMaxLives = 4;
export const guardianesGameWinMillis = 5_000;
export const guardianesGameFailMillis = 5_000;

const backgroundColor: HexColor = "#02050b";
const readyZone = { minX: 5, maxX: 10, minY: 14, maxY: 18 };
const successColors = ["#35d7ff", "#ff3bd7", "#ffe176", "#5fff9e", "#ffffff"] as const satisfies readonly HexColor[];

export const guardianLanes = [
  { color: "#35d7ff" as HexColor, label: "Azul", minX: 0, maxX: 3, shieldX: 1 },
  { color: "#ff3bd7" as HexColor, label: "Rosa", minX: 4, maxX: 7, shieldX: 5 },
  { color: "#ffe176" as HexColor, label: "Amarillo", minX: 8, maxX: 11, shieldX: 9 },
  { color: "#5fff9e" as HexColor, label: "Verde", minX: 12, maxX: 15, shieldX: 13 }
] as const;

const threatPattern = [0, 2, 1, 3, 0, 3, 2, 1, 1, 3, 0, 2, 3, 1, 2, 0] as const;

type DifficultyProfile = {
  spacingMillis: number;
  travelMillis: number;
};

const difficultyProfiles: Record<string, DifficultyProfile> = {
  easy: { spacingMillis: 2_000, travelMillis: 4_000 },
  medium: { spacingMillis: 1_750, travelMillis: 3_300 },
  hard: { spacingMillis: 1_500, travelMillis: 2_700 },
  expert: { spacingMillis: 1_300, travelMillis: 2_200 }
};

export type GuardianThreat = {
  impactMillis: number;
  lane: number;
  spawnMillis: number;
};

export type VisibleGuardianThreat = {
  lane: number;
  millisRemaining: number;
  progress: number;
};

export type GuardianesSnapshot = GameSnapshot & {
  blockedThreats: number;
  shieldLanes: number[];
  threatCount: number;
  threatIndex: number;
  threats: VisibleGuardianThreat[];
};

export type GuardianesGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): GuardianesSnapshot;
};

export function guardianesDifficultyProfile(difficulty: string): DifficultyProfile {
  return { ...(difficultyProfiles[difficulty] ?? difficultyProfiles.medium!) };
}

export function guardianesThreatChart(difficulty = "medium"): GuardianThreat[] {
  const profile = difficultyProfiles[difficulty] ?? difficultyProfiles.medium!;
  return threatPattern.map((lane, index) => {
    const spawnMillis = 1_000 + index * profile.spacingMillis;
    return { impactMillis: spawnMillis + profile.travelMillis, lane, spawnMillis };
  });
}

export function createGame(config: GameConfig): GuardianesGameInstance {
  return new GuardianesGame(config);
}

class GuardianesGame implements GuardianesGameInstance {
  private blockedThreats = 0;
  private chart: GuardianThreat[] = [];
  private config: NormalizedGameConfig;
  private finishedAtMillis = 0;
  private heldTiles = new Set<string>();
  private lastEvent: GameEvent = gameEvent("none", "Los escudos están preparados", 0);
  private lives = guardianesMaxLives;
  private nowMillis = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private resolvedThreats = 0;
  private startedAtMillis = 0;
  private success = false;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [readyZone], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Entra en el núcleo para iniciar", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase !== "running" || !event.pressed) return [];
    const lane = this.shieldLaneAt(event.x, event.y);
    if (lane < 0) return [];
    this.heldTiles.add(tileKey(event.x, event.y));
    this.lastEvent = gameEvent("shield", `Escudo ${guardianLanes[lane]!.label.toLowerCase()} activado`, event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis);
    }
    this.heldTiles.delete(tileKey(event.x, event.y));
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis);
    }
    if (this.phase === "finished") {
      const resultMillis = this.success ? guardianesGameWinMillis : guardianesGameFailMillis;
      if (event.atMillis - this.finishedAtMillis >= resultMillis) {
        this.resetState(event.atMillis);
        this.phase = "waiting";
        this.lastEvent = gameEvent("ready", "Entra en el núcleo para iniciar", event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase !== "running") return [];

    const events: GameEvent[] = [];
    while (this.resolvedThreats < this.chart.length) {
      const threat = this.chart[this.resolvedThreats]!;
      if (this.elapsedMillis() < threat.impactMillis) break;
      const blocked = this.shieldLaneActive(threat.lane);
      this.resolvedThreats += 1;
      if (blocked) {
        this.blockedThreats += 1;
        this.lastEvent = gameEvent("hit", `Amenaza ${guardianLanes[threat.lane]!.label.toLowerCase()} bloqueada`, event.atMillis);
      } else {
        this.lives = Math.max(0, this.lives - 1);
        this.lastEvent = gameEvent("miss", `Impacto en el carril ${guardianLanes[threat.lane]!.label.toLowerCase()}`, event.atMillis);
      }
      this.players = this.scoredPlayers();
      events.push(this.lastEvent);
      if (this.lives === 0) return [...events, ...this.finish(false, event.atMillis, "El núcleo quedó sin defensas")];
    }

    if (this.resolvedThreats >= this.chart.length) return [...events, ...this.finish(true, event.atMillis, "Oleada repelida")];
    if (this.remainingMillis() <= 0) return [...events, ...this.finish(false, event.atMillis, "La oleada superó las defensas")];
    return events;
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    this.paintLanes(frame);
    if (this.phase === "waiting" || this.phase === "starting") {
      fillFrameRect(frame, readyZone.minX, readyZone.minY, readyZone.maxX, readyZone.maxY, this.phase === "starting" ? "#ffe176" : "#145cff");
      paintDiamondRing(frame, { centerX: 8, centerY: 16, color: this.phase === "starting" ? "#ffffff" : "#35d7ff", radius: 2 + Math.floor(this.nowMillis / 150) % 9 });
      return frame;
    }
    if (this.phase === "finished") {
      this.paintResult(frame);
      return frame;
    }

    for (let lane = 0; lane < guardianLanes.length; lane += 1) {
      const descriptor = guardianLanes[lane]!;
      const active = this.shieldLaneActive(lane);
      fillFrameRect(frame, descriptor.minX, 26, descriptor.maxX, 31, active ? descriptor.color : "#10182a");
      fillFrameRect(frame, descriptor.minX + 1, 27, descriptor.maxX - 1, 30, active ? "#ffffff" : descriptor.color);
    }
    for (const threat of this.visibleThreats()) {
      const lane = guardianLanes[threat.lane]!;
      const y = Math.max(0, Math.min(24, Math.round(threat.progress * 24)));
      fillFrameRect(frame, lane.minX, y, lane.maxX, Math.min(25, y + 1), "#ff3151");
      paintFrameCell(frame, lane.shieldX, y, "#ffffff");
    }
    return frame;
  }

  snapshot(): GuardianesSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.blockedThreats,
      lives: this.lives,
      maxLives: guardianesMaxLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? this.visibleThreats().length : 0,
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: this.chart.length,
      blockedThreats: this.blockedThreats,
      shieldLanes: guardianLanes.map((_lane, index) => index).filter((lane) => this.shieldLaneActive(lane)),
      threatCount: this.chart.length,
      threatIndex: this.resolvedThreats,
      threats: this.visibleThreats()
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [readyZone], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Entra en el núcleo para iniciar", this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Núcleo protegido", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve al núcleo central", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.heldTiles.clear();
      this.lastEvent = gameEvent("start", "Activa el primer escudo", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private finish(success: boolean, atMillis: number, message: string): GameEvent[] {
    if (this.phase === "finished") return [];
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    this.heldTiles.clear();
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private paintLanes(frame: Frame): void {
    for (const lane of guardianLanes) {
      fillFrameRect(frame, lane.minX, 0, lane.maxX, FLOOR_ROWS - 1, "#050917");
      fillFrameRect(frame, lane.minX, 0, lane.minX, FLOOR_ROWS - 1, "#10182a");
    }
    for (let y = 4; y < FLOOR_ROWS; y += 5) {
      fillFrameRect(frame, 0, y, FLOOR_COLS - 1, y, "#090f20");
    }
  }

  private paintResult(frame: Frame): void {
    const elapsed = Math.max(0, this.nowMillis - this.finishedAtMillis);
    if (this.success) {
      paintDiamondWave(frame, {
        centerX: 8,
        centerY: 16,
        color: ({ distance, step }) => successColors[(distance + step) % successColors.length],
        period: 8,
        bandWidth: 5,
        step: Math.floor(elapsed / 85)
      });
      return;
    }
    fillFrameRect(frame, 0, 0, FLOOR_COLS - 1, FLOOR_ROWS - 1, Math.floor(elapsed / 170) % 2 === 0 ? "#4f0615" : "#140208");
    paintDiamondRing(frame, { centerX: 8, centerY: 16, color: "#ff3151", radius: 2 + Math.floor(elapsed / 100) % 13 });
  }

  private visibleThreats(): VisibleGuardianThreat[] {
    if (this.phase !== "running") return [];
    const elapsed = this.elapsedMillis();
    return this.chart.slice(this.resolvedThreats).filter((threat) => elapsed >= threat.spawnMillis && elapsed <= threat.impactMillis).map((threat) => ({
      lane: threat.lane,
      millisRemaining: Math.max(0, threat.impactMillis - elapsed),
      progress: Math.max(0, Math.min(1, (elapsed - threat.spawnMillis) / (threat.impactMillis - threat.spawnMillis)))
    }));
  }

  private shieldLaneAt(x: number, y: number): number {
    if (y < 26 || y >= FLOOR_ROWS) return -1;
    return guardianLanes.findIndex((lane) => x >= lane.minX && x <= lane.maxX);
  }

  private shieldLaneActive(laneIndex: number): boolean {
    const lane = guardianLanes[laneIndex];
    if (!lane) return false;
    for (let y = 26; y < FLOOR_ROWS; y += 1) {
      for (let x = lane.minX; x <= lane.maxX; x += 1) {
        if (this.heldTiles.has(tileKey(x, y))) return true;
      }
    }
    return false;
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") return 0;
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({ ...player, label: player.label || `Jugador ${player.index + 1}`, score: this.blockedThreats, lives: this.lives }));
  }

  private resetState(nowMillis: number): void {
    this.blockedThreats = 0;
    this.chart = guardianesThreatChart(this.config.difficulty);
    this.finishedAtMillis = 0;
    this.heldTiles.clear();
    this.lastEvent = gameEvent("none", "Los escudos están preparados", nowMillis);
    this.lives = guardianesMaxLives;
    this.nowMillis = nowMillis;
    this.phase = "ready";
    this.readyGate.reset(nowMillis);
    this.resolvedThreats = 0;
    this.startedAtMillis = nowMillis;
    this.success = false;
    this.players = this.scoredPlayers();
  }
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}
