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
  type HexColor,
  type NormalizedGameConfig,
  type PlayerReadyGate,
  type PlayerReadyTransition,
  type PlayerReadyZone,
  type PressEvent,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const sueloSeguroPlatformSize = 2;
export const sueloSeguroHazardSize = 8;
export const sueloSeguroRoundWinMillis = 1_400;
export const sueloSeguroTurnFailMillis = 1_200;
export const sueloSeguroGameResultMillis = 5_000;
export const sueloSeguroDamageImmunityMillis = 1_100;
export const sueloSeguroDepartureGraceMillis = 650;

export type SafePlatform = {
  x: number;
  y: number;
};

export type VisibleSafePlatform = SafePlatform & {
  color: HexColor;
  ownerIndex: number;
  target: boolean;
};

export type SueloSeguroDifficultyProfile = {
  hazardStepMillis: number;
  lives: number;
  turnMillis: number;
};

const difficultyProfiles: Record<string, SueloSeguroDifficultyProfile> = {
  easy: { hazardStepMillis: 380, lives: 5, turnMillis: 5_400 },
  medium: { hazardStepMillis: 310, lives: 4, turnMillis: 4_800 },
  hard: { hazardStepMillis: 250, lives: 3, turnMillis: 4_200 },
  expert: { hazardStepMillis: 190, lives: 2, turnMillis: 3_600 }
};

const backgroundColor: HexColor = "#05080b";
const dangerColor: HexColor = "#ff183d";
const playerColors = [
  "#35d7ff",
  "#ff3bd7",
  "#ffe176",
  "#5fff9e",
  "#a88bff",
  "#ff8a3d",
  "#4c7dff",
  "#f5f7ff"
] as const satisfies readonly HexColor[];

const perimeterStarts: readonly SafePlatform[] = [
  { x: 0, y: 0 },
  { x: 7, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 15 },
  { x: 14, y: 30 },
  { x: 7, y: 30 },
  { x: 0, y: 30 },
  { x: 0, y: 15 }
] as const;

const horizontalPlatformXs = [0, 3, 6, 9, 12, 14] as const;
const verticalPlatformYs = [3, 6, 9, 12, 15, 18, 21, 24, 27] as const;

export const sueloSeguroPlatformAnchors: readonly SafePlatform[] = [
  ...horizontalPlatformXs.map((x) => ({ x, y: 0 })),
  ...verticalPlatformYs.map((y) => ({ x: FLOOR_COLS - sueloSeguroPlatformSize, y })),
  ...[...horizontalPlatformXs].reverse().map((x) => ({ x, y: FLOOR_ROWS - sueloSeguroPlatformSize })),
  ...[...verticalPlatformYs].reverse().map((y) => ({ x: 0, y }))
];

const hazardMaxX = FLOOR_COLS - sueloSeguroHazardSize;
const hazardMaxY = FLOOR_ROWS - sueloSeguroHazardSize;
const sueloSeguroHazardOrbit: readonly SafePlatform[] = [
  ...Array.from({ length: hazardMaxX + 1 }, (_, x) => ({ x, y: 0 })),
  ...Array.from({ length: hazardMaxY }, (_, index) => ({ x: hazardMaxX, y: index + 1 })),
  ...Array.from({ length: hazardMaxX }, (_, index) => ({ x: hazardMaxX - index - 1, y: hazardMaxY })),
  ...Array.from({ length: hazardMaxY - 1 }, (_, index) => ({ x: 0, y: hazardMaxY - index - 1 }))
];

const floorPerimeter: readonly SafePlatform[] = [
  ...Array.from({ length: FLOOR_COLS }, (_, x) => ({ x, y: 0 })),
  ...Array.from({ length: FLOOR_ROWS - 1 }, (_, index) => ({ x: FLOOR_COLS - 1, y: index + 1 })),
  ...Array.from({ length: FLOOR_COLS - 1 }, (_, index) => ({ x: FLOOR_COLS - index - 2, y: FLOOR_ROWS - 1 })),
  ...Array.from({ length: FLOOR_ROWS - 2 }, (_, index) => ({ x: 0, y: FLOOR_ROWS - index - 2 }))
];

type SueloSeguroPhase = GamePhase | "round-win" | "turn-fail";

export type SueloSeguroSnapshot = GameSnapshot & {
  activePlayerIndex: number;
  activePlayerLabel: string;
  bestTransferMillis: number | null;
  completedTransfers: number;
  failedTurns: number;
  hazardStep: number;
  lastTransferMillis: number | null;
  maxLives: number;
  platforms: VisibleSafePlatform[];
  requiredTransfers: number;
  stage: "waiting" | "moving" | "round-win" | "turn-fail" | "game-win" | "game-fail";
  targetPlatform: VisibleSafePlatform | null;
  teamTransferMillis: number;
  turnDurationMillis: number;
  turnRemainingMillis: number;
};

export type SueloSeguroGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): SueloSeguroSnapshot;
};

export function sueloSeguroDifficultyProfile(difficulty: string): SueloSeguroDifficultyProfile {
  return { ...(difficultyProfiles[difficulty] ?? difficultyProfiles.medium!) };
}

export function sueloSeguroRequiredTransfers(playerCount: number): number {
  return Math.max(6, playerCount * 2);
}

export function sueloSeguroStartingPlatforms(playerCount: number): SafePlatform[] {
  return Array.from({ length: playerCount }, (_, index) => {
    const perimeterIndex = Math.floor(index * perimeterStarts.length / playerCount);
    return { ...perimeterStarts[perimeterIndex]! };
  });
}

export function sueloSeguroHazardOrigin(step: number): SafePlatform {
  return { ...sueloSeguroHazardOrbit[positiveModulo(step, sueloSeguroHazardOrbit.length)]! };
}

export function createGame(config: GameConfig): SueloSeguroGameInstance {
  return new SueloSeguroGame(config);
}

class SueloSeguroGame implements SueloSeguroGameInstance {
  private activePlayerIndex = 0;
  private bestTransferMillis: number | null = null;
  private completedTransfers = 0;
  private config: NormalizedGameConfig;
  private failedTurns = 0;
  private finishedAtMillis: number | null = null;
  private heldTiles = new Set<string>();
  private lastDamageAtMillis = Number.NEGATIVE_INFINITY;
  private lastEvent: GameEvent = gameEvent("none", "Busca tu plataforma", 0);
  private lastTransferMillis: number | null = null;
  private lives = 0;
  private nowMillis = 0;
  private phase: SueloSeguroPhase = "ready";
  private platforms: SafePlatform[] = [];
  private playerScores: number[] = [];
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private resultAtMillis = 0;
  private rng: SeededRng;
  private startedAtMillis = 0;
  private success = false;
  private targetPlatform: SafePlatform | null = null;
  private teamTransferMillis = 0;
  private turnDeadlineMillis = 0;
  private turnStartedAtMillis = 0;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = this.createReadyGate(this.config.nowMillis);
    this.rng = createSeededRng(this.config.seed);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const key = tileKey(event.x, event.y);
    if (event.pressed) this.heldTiles.add(key);

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase !== "running" || !event.pressed) return [];

    if (this.targetPlatform && insidePlatform(event.x, event.y, this.targetPlatform)) {
      return this.completeTransfer(event.atMillis);
    }
    if (this.isDangerousContact(event.x, event.y, event.atMillis)) {
      return this.takeDamage("Has pisado el patrón rojo", event.atMillis);
    }
    return [];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.heldTiles.delete(tileKey(event.x, event.y));
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
      if (event.atMillis - (this.finishedAtMillis ?? event.atMillis) >= sueloSeguroGameResultMillis) {
        this.resetState(event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase === "round-win" || this.phase === "turn-fail") {
      const transitionMillis = this.phase === "round-win" ? sueloSeguroRoundWinMillis : sueloSeguroTurnFailMillis;
      if (event.atMillis - this.resultAtMillis >= transitionMillis) {
        this.advancePlayer();
        this.beginTurn(event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase !== "running") return [];
    if (this.remainingMillis() <= 0) return this.finish(false, "Se acabó el tiempo", event.atMillis);

    if (this.targetPlatform && this.heldOnPlatform(this.targetPlatform)) {
      return this.completeTransfer(event.atMillis);
    }
    if (event.atMillis >= this.turnDeadlineMillis) {
      return this.failTurn(event.atMillis);
    }
    if (event.atMillis >= this.turnStartedAtMillis + sueloSeguroDepartureGraceMillis && this.heldOnDanger(event.atMillis)) {
      return this.takeDamage("El patrón rojo ha alcanzado al equipo", event.atMillis);
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    if (this.phase === "waiting" || this.phase === "starting") {
      this.paintWaiting(frame);
      return frame;
    }
    if (this.phase === "finished") {
      this.paintFinished(frame);
      return frame;
    }

    this.paintHazard(frame);
    for (const platform of this.visiblePlatforms()) this.paintPlatform(frame, platform);

    if (this.phase === "round-win") {
      const winner = this.players[this.activePlayerIndex];
      paintDiamondRing(frame, {
        centerX: (this.platforms[this.activePlayerIndex]?.x ?? 7) + 0.5,
        centerY: (this.platforms[this.activePlayerIndex]?.y ?? 15) + 0.5,
        color: winner?.color ?? "#5fff9e",
        radius: 2 + Math.floor((this.nowMillis - this.resultAtMillis) / 110) % 10,
        thickness: 2
      });
    }
    return frame;
  }

  snapshot(): SueloSeguroSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    const profile = this.profile();
    const active = this.players[this.activePlayerIndex];
    const visiblePlatforms = this.visiblePlatforms();
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.teamTransferMillis,
      lives: this.lives,
      maxLives: profile.lives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.targetPlatform ? 1 : 0,
      success: this.phase === "finished" && this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      activePlayerIndex: this.activePlayerIndex,
      activePlayerLabel: active?.label ?? "Jugador 1",
      bestTransferMillis: this.bestTransferMillis,
      completedTransfers: this.completedTransfers,
      failedTurns: this.failedTurns,
      hazardStep: this.hazardStep(this.nowMillis),
      lastTransferMillis: this.lastTransferMillis,
      platforms: visiblePlatforms,
      requiredTransfers: sueloSeguroRequiredTransfers(this.config.playerCount),
      stage: this.stage(),
      targetPlatform: visiblePlatforms.find((platform) => platform.target) ?? null,
      teamTransferMillis: this.teamTransferMillis,
      turnDurationMillis: profile.turnMillis,
      turnRemainingMillis: this.phase === "running" ? Math.max(0, this.turnDeadlineMillis - this.nowMillis) : 0
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyGate = this.createReadyGate(this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Todos en su plataforma", nowMillis);
    } else if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a tu plataforma", nowMillis);
    } else if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.beginTurn(nowMillis);
    } else {
      return [];
    }
    return [this.lastEvent];
  }

  private beginTurn(nowMillis: number): void {
    this.phase = "running";
    this.turnStartedAtMillis = nowMillis;
    this.turnDeadlineMillis = nowMillis + this.profile().turnMillis;
    this.targetPlatform = this.pickTargetPlatform();
    const active = this.players[this.activePlayerIndex];
    this.lastEvent = gameEvent("turn", `${active?.label ?? "Jugador"}: busca tu nueva plataforma`, nowMillis);
  }

  private completeTransfer(atMillis: number): GameEvent[] {
    if (!this.targetPlatform || this.phase !== "running") return [];
    const transferMillis = Math.max(0, atMillis - this.turnStartedAtMillis);
    this.platforms[this.activePlayerIndex] = { ...this.targetPlatform };
    this.targetPlatform = null;
    this.completedTransfers += 1;
    this.lastTransferMillis = transferMillis;
    this.bestTransferMillis = this.bestTransferMillis === null
      ? transferMillis
      : Math.min(this.bestTransferMillis, transferMillis);
    this.teamTransferMillis += transferMillis;
    this.playerScores[this.activePlayerIndex] = (this.playerScores[this.activePlayerIndex] ?? 0) + transferMillis;
    this.updatePlayers();

    if (this.completedTransfers >= sueloSeguroRequiredTransfers(this.config.playerCount)) {
      return this.finish(true, `Todos los relevos en ${formatTransferTime(this.teamTransferMillis)}`, atMillis);
    }
    this.phase = "round-win";
    this.resultAtMillis = atMillis;
    const active = this.players[this.activePlayerIndex];
    this.lastEvent = gameEvent("round-win", `${active?.label ?? "Jugador"} llegó en ${formatTransferTime(transferMillis)}`, atMillis);
    return [this.lastEvent];
  }

  private failTurn(atMillis: number): GameEvent[] {
    if (this.targetPlatform) this.platforms[this.activePlayerIndex] = { ...this.targetPlatform };
    this.targetPlatform = null;
    this.failedTurns += 1;
    const events = this.takeDamage("No has llegado a tiempo", atMillis);
    if (this.phase === "finished") return events;
    this.phase = "turn-fail";
    this.resultAtMillis = atMillis;
    return events;
  }

  private takeDamage(message: string, atMillis: number): GameEvent[] {
    if (atMillis - this.lastDamageAtMillis < sueloSeguroDamageImmunityMillis) return [];
    this.lastDamageAtMillis = atMillis;
    this.lives = Math.max(0, this.lives - 1);
    this.updatePlayers();
    if (this.lives === 0) return this.finish(false, "El patrón rojo ha ganado", atMillis);
    this.lastEvent = gameEvent("damage", `${message}; quedan ${this.lives} vidas`, atMillis);
    return [this.lastEvent];
  }

  private finish(success: boolean, message: string, atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.finishedAtMillis = atMillis;
    this.success = success;
    this.targetPlatform = null;
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
  }

  private advancePlayer(): void {
    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.config.playerCount;
  }

  private pickTargetPlatform(): SafePlatform {
    const origin = this.platforms[this.activePlayerIndex]!;
    const occupied = this.platforms.filter((_platform, index) => index !== this.activePlayerIndex);
    const candidates = sueloSeguroPlatformAnchors.filter((candidate) =>
      !samePlatform(origin, candidate) &&
      !occupied.some((platform) => touchesOrAdjacent(platform, candidate)) &&
      manhattan(origin, candidate) >= 8
    );
    const fallback = sueloSeguroPlatformAnchors.filter((candidate) =>
      !samePlatform(origin, candidate) &&
      !occupied.some((platform) => touchesOrAdjacent(platform, candidate))
    );
    const pool = candidates.length > 0 ? candidates : fallback;
    const selected = pool[this.rng.int(pool.length)];
    if (!selected) throw new Error("Suelo Seguro could not place a separated perimeter platform");
    return { ...selected };
  }

  private paintWaiting(frame: Frame): void {
    const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 150));
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        if (positiveModulo(x * 7 + y * 3 + step, 47) === 0) paintFrameCell(frame, x, y, "#0a2630");
      }
    }
    floorPerimeter.forEach((cell, index) => {
      const trail = positiveModulo(index - step, 23);
      if (trail === 0) paintFrameCell(frame, cell.x, cell.y, this.phase === "starting" ? "#ffe176" : "#7feaff");
      else if (trail === 1 || trail === 22) paintFrameCell(frame, cell.x, cell.y, "#164a5a");
    });
    this.platforms.forEach((platform, index) => {
      const ready = this.readyGate.zoneReady(index, this.nowMillis);
      const color = ready ? "#ffffff" : this.players[index]?.color ?? playerColors[index]!;
      fillFrameRect(frame, platform.x, platform.y, sueloSeguroPlatformSize, sueloSeguroPlatformSize, color);
      if (!ready) {
        const shimmer = positiveModulo(step + index, sueloSeguroPlatformSize * sueloSeguroPlatformSize);
        paintFrameCell(
          frame,
          platform.x + shimmer % sueloSeguroPlatformSize,
          platform.y + Math.floor(shimmer / sueloSeguroPlatformSize),
          "#ffffff"
        );
      }
    });
    paintDiamondRing(frame, {
      centerX: 7.5,
      centerY: 15.5,
      color: this.phase === "starting" ? "#ffe176" : "#35d7ff",
      radius: 2 + step % 11
    });
  }

  private paintHazard(frame: Frame): void {
    const origin = sueloSeguroHazardOrigin(this.hazardStep(this.nowMillis));
    fillFrameRect(frame, origin.x, origin.y, sueloSeguroHazardSize, sueloSeguroHazardSize, dangerColor);
  }

  private paintPlatform(frame: Frame, platform: VisibleSafePlatform): void {
    const pulse = platform.target && Math.floor(this.nowMillis / 180) % 2 === 0 ? "#ffffff" : platform.color;
    fillFrameRect(frame, platform.x, platform.y, sueloSeguroPlatformSize, sueloSeguroPlatformSize, pulse);
  }

  private paintFinished(frame: Frame): void {
    const step = Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 120);
    paintDiamondWave(frame, {
      color: ({ distance }) => this.success ? playerColors[distance % playerColors.length]! : distance % 2 === 0 ? dangerColor : "#560719",
      step,
      period: this.success ? 8 : 5,
      bandWidth: this.success ? 4 : 3
    });
  }

  private visiblePlatforms(): VisibleSafePlatform[] {
    const visible = this.platforms
      .map((platform, ownerIndex) => ({ platform, ownerIndex }))
      .filter(({ ownerIndex }) => this.phase !== "running" || ownerIndex !== this.activePlayerIndex)
      .map(({ platform, ownerIndex }) => ({
        ...platform,
        color: this.players[ownerIndex]?.color ?? playerColors[ownerIndex]!,
        ownerIndex,
        target: false
      }));
    if (this.targetPlatform) {
      visible.push({
        ...this.targetPlatform,
        color: this.players[this.activePlayerIndex]?.color ?? playerColors[this.activePlayerIndex]!,
        ownerIndex: this.activePlayerIndex,
        target: true
      });
    }
    return visible;
  }

  private heldOnPlatform(platform: SafePlatform): boolean {
    for (const key of this.heldTiles) {
      const [x, y] = key.split(",").map(Number);
      if (insidePlatform(x ?? -1, y ?? -1, platform)) return true;
    }
    return false;
  }

  private heldOnDanger(atMillis: number): boolean {
    for (const key of this.heldTiles) {
      const [x, y] = key.split(",").map(Number);
      if (this.isDangerousContact(x ?? -1, y ?? -1, atMillis)) return true;
    }
    return false;
  }

  private isDangerousContact(x: number, y: number, atMillis: number): boolean {
    if (this.visiblePlatforms().some((platform) => insidePlatform(x, y, platform))) return false;
    const origin = sueloSeguroHazardOrigin(this.hazardStep(atMillis));
    return x >= origin.x && x < origin.x + sueloSeguroHazardSize && y >= origin.y && y < origin.y + sueloSeguroHazardSize;
  }

  private hazardStep(atMillis: number): number {
    return Math.floor(Math.max(0, atMillis - this.startedAtMillis) / this.profile().hazardStepMillis);
  }

  private stage(): SueloSeguroSnapshot["stage"] {
    if (this.phase === "waiting" || this.phase === "starting") return "waiting";
    if (this.phase === "round-win") return "round-win";
    if (this.phase === "turn-fail") return "turn-fail";
    if (this.phase === "finished") return this.success ? "game-win" : "game-fail";
    return "moving";
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") return 0;
    return Math.max(0, (this.finishedAtMillis ?? this.nowMillis) - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private profile(): SueloSeguroDifficultyProfile {
    return sueloSeguroDifficultyProfile(this.config.difficulty);
  }

  private createReadyGate(nowMillis: number): PlayerReadyGate {
    const zones: PlayerReadyZone[] = sueloSeguroStartingPlatforms(this.config.playerCount).map((platform) => ({
      minX: platform.x,
      maxX: platform.x + sueloSeguroPlatformSize - 1,
      minY: platform.y,
      maxY: platform.y + sueloSeguroPlatformSize - 1
    }));
    return createPlayerReadyGate(manifest.start, zones, nowMillis);
  }

  private resetState(nowMillis: number): void {
    this.activePlayerIndex = 0;
    this.bestTransferMillis = null;
    this.completedTransfers = 0;
    this.failedTurns = 0;
    this.finishedAtMillis = null;
    this.heldTiles.clear();
    this.lastDamageAtMillis = Number.NEGATIVE_INFINITY;
    this.lastTransferMillis = null;
    this.lives = this.profile().lives;
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.platforms = sueloSeguroStartingPlatforms(this.config.playerCount);
    this.playerScores = Array.from({ length: this.config.playerCount }, () => 0);
    this.readyGate.reset(nowMillis);
    this.resultAtMillis = 0;
    this.rng = createSeededRng(this.config.seed);
    this.startedAtMillis = nowMillis;
    this.success = false;
    this.targetPlatform = null;
    this.teamTransferMillis = 0;
    this.turnDeadlineMillis = 0;
    this.turnStartedAtMillis = 0;
    this.updatePlayers();
    this.lastEvent = gameEvent("ready", "Cada jugador ocupa su plataforma", nowMillis);
  }

  private updatePlayers(): void {
    this.players = defaultPlayers(this.config.playerCount, this.config.players).map((player, index) => ({
      ...player,
      label: /^Player \d+$/u.test(player.label) ? `Jugador ${index + 1}` : player.label,
      color: this.config.players[index]?.color ?? playerColors[index] ?? playerColors[0],
      score: this.playerScores[index] ?? 0,
      lives: this.lives
    }));
  }
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function insidePlatform(x: number, y: number, platform: SafePlatform): boolean {
  return x >= platform.x && x < platform.x + sueloSeguroPlatformSize && y >= platform.y && y < platform.y + sueloSeguroPlatformSize;
}

function touchesOrAdjacent(left: SafePlatform, right: SafePlatform): boolean {
  return left.x <= right.x + sueloSeguroPlatformSize &&
    left.x + sueloSeguroPlatformSize >= right.x &&
    left.y <= right.y + sueloSeguroPlatformSize &&
    left.y + sueloSeguroPlatformSize >= right.y;
}

function samePlatform(left: SafePlatform, right: SafePlatform): boolean {
  return left.x === right.x && left.y === right.y;
}

function manhattan(left: SafePlatform, right: SafePlatform): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function formatTransferTime(millis: number): string {
  return `${(Math.max(0, millis) / 1_000).toFixed(2).replace(".", ",")} s`;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
