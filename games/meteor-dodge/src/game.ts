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
  type PressEvent,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";

export const startingLives = 3;
export const gameWinAnimationMillis = 3_000;
export const meteorImpactVisibleMillis = 450;

export const meteorWarningColor: HexColor = "#ff5a36";
export const meteorCoreColor: HexColor = "#ffe176";
export const meteorImpactColor: HexColor = "#ffffff";
export const playerFootprintColor: HexColor = "#35d7ff";

const backgroundColor: HexColor = "#02050b";
const backgroundStripeColor: HexColor = "#050d19";
const readyZoneColor: HexColor = "#145cff";
const readyPulseColor: HexColor = "#35d7ff";
const startingColor: HexColor = "#ffe176";
const successColors: HexColor[] = ["#35d7ff", "#5fff9e", "#ffe176", "#ff3bd7", "#ffffff"];
const failColors: HexColor[] = ["#ff3151", "#7b1428", "#2a0710"];
const damageCooldownMillis = 1_000;
const firstMeteorDelayMillis = 350;
const maxSpawnCatchUp = 64;
const readyZone = [{ minX: 4, maxX: 11, minY: 12, maxY: 19 }];

type MeteorResult = "pending" | "dodged" | "hit" | "protected";

export type Meteor = {
  clearAtMillis: number;
  id: number;
  impactAtMillis: number;
  radius: number;
  result: MeteorResult;
  spawnedAtMillis: number;
  x: number;
  y: number;
};

export type MeteorDodgeSnapshot = GameSnapshot & {
  celebrating: boolean;
  celebrationMillis: number;
  dodgedMeteors: number;
  maxLives: number;
  meteors: Meteor[];
  stormDurationMillis: number;
};

export type MeteorDodgeGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): MeteorDodgeSnapshot;
};

type DifficultyProfile = {
  intervalMillis: number;
  largeMeteorEvery: number;
  radius: number;
  warningMillis: number;
};

const difficultyProfiles: Record<string, DifficultyProfile> = {
  easy: { intervalMillis: 1_900, largeMeteorEvery: 0, radius: 1, warningMillis: 1_650 },
  medium: { intervalMillis: 1_550, largeMeteorEvery: 5, radius: 1, warningMillis: 1_350 },
  hard: { intervalMillis: 1_200, largeMeteorEvery: 3, radius: 1, warningMillis: 1_050 },
  expert: { intervalMillis: 900, largeMeteorEvery: 1, radius: 2, warningMillis: 800 }
};

export function createGame(config: GameConfig): MeteorDodgeGameInstance {
  return new MeteorDodgeGame(config);
}

class MeteorDodgeGame implements MeteorDodgeGameInstance {
  private config: NormalizedGameConfig;
  private dodgedMeteors = 0;
  private finishedAtMillis = 0;
  private lastDamageMillis = Number.NEGATIVE_INFINITY;
  private lastEvent: GameEvent = gameEvent("none", "Listos para la tormenta", 0);
  private lives = startingLives;
  private meteors: Meteor[] = [];
  private nextMeteorId = 1;
  private nextMeteorMillis = 0;
  private nowMillis = 0;
  private occupiedTiles = new Set<string>();
  private phase: GamePhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private rng: SeededRng;
  private startedAtMillis = 0;
  private success = false;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyGate = createPlayerReadyGate(manifest.start, readyZone, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Entra en la zona azul", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupiedTile(event.x, event.y, event.pressed);

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    return [];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupiedTile(event.x, event.y, false);

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
    if (this.phase !== "running") {
      return [];
    }

    const events: GameEvent[] = [];
    this.spawnDueMeteors(event.atMillis);

    for (const meteor of this.meteors) {
      if (meteor.result !== "pending" || event.atMillis < meteor.impactAtMillis) {
        continue;
      }

      const occupied = this.meteorContainsOccupiedTile(meteor);
      if (!occupied) {
        meteor.result = "dodged";
        this.dodgedMeteors += 1;
        continue;
      }

      if (meteor.impactAtMillis - this.lastDamageMillis < damageCooldownMillis) {
        meteor.result = "protected";
        continue;
      }

      meteor.result = "hit";
      this.lastDamageMillis = meteor.impactAtMillis;
      this.lives = Math.max(0, this.lives - 1);
      if (this.lives === 0) {
        events.push(this.finish(false, meteor.impactAtMillis));
        break;
      }
      events.push(gameEvent("miss", "¡Impacto! Muévete", meteor.impactAtMillis));
    }

    this.meteors = this.meteors.filter((meteor) => meteor.clearAtMillis > event.atMillis);

    if (this.phase === "running" && this.remainingMillis() === 0) {
      events.push(this.finish(true, event.atMillis));
    }

    return this.recordEvents(events);
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    this.drawBackground(frame);

    if (this.phase === "waiting" || this.phase === "starting") {
      this.drawPlayerStart(frame);
      return frame;
    }

    if (this.phase === "finished") {
      if (this.success) {
        this.drawWinAnimation(frame);
      } else {
        this.drawFailAnimation(frame);
      }
      return frame;
    }

    for (const tile of this.occupiedTiles) {
      const [x, y] = tile.split(",").map(Number);
      paintFrameCell(frame, x, y, playerFootprintColor);
    }

    for (const meteor of this.meteors) {
      this.drawMeteor(frame, meteor);
    }
    return frame;
  }

  snapshot(): MeteorDodgeSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const celebrationMillis = this.success && this.phase === "finished"
      ? Math.max(0, Math.min(gameWinAnimationMillis, this.nowMillis - this.finishedAtMillis))
      : 0;

    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players.map((player) => ({ ...player, lives: this.lives, score: this.dodgedMeteors })),
      score: this.dodgedMeteors,
      lives: this.lives,
      maxLives: startingLives,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.meteors.filter((meteor) => meteor.result === "pending").length,
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      celebrating: this.success && this.phase === "finished" && celebrationMillis < gameWinAnimationMillis,
      celebrationMillis,
      dodgedMeteors: this.dodgedMeteors,
      meteors: this.meteors.map((meteor) => ({ ...meteor })),
      stormDurationMillis: this.config.durationMillis
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.resetState(this.config.nowMillis);
    this.phase = "waiting";
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Zona lista", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a la zona azul", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.nextMeteorMillis = nowMillis + firstMeteorDelayMillis;
      this.lastEvent = gameEvent("start", "Esquiva las zonas rojas", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private difficultyProfile(): DifficultyProfile {
    return difficultyProfiles[this.config.difficulty] ?? difficultyProfiles.medium;
  }

  private drawBackground(frame: Frame): void {
    for (let y = 3; y < FLOOR_ROWS; y += 4) {
      fillFrameRect(frame, 0, y, FLOOR_COLS, 1, backgroundStripeColor);
    }
  }

  private drawFailAnimation(frame: Frame): void {
    const pulse = Math.floor((this.nowMillis - this.finishedAtMillis) / 180) % failColors.length;
    const color = failColors[pulse] ?? failColors[0];
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      const x = Math.floor((y * FLOOR_COLS) / FLOOR_ROWS);
      fillFrameRect(frame, x - 1, y, 3, 1, color);
      fillFrameRect(frame, FLOOR_COLS - x - 2, y, 3, 1, color);
    }
  }

  private drawMeteor(frame: Frame, meteor: Meteor): void {
    if (meteor.result === "pending") {
      const pulseOn = Math.floor((this.nowMillis - meteor.spawnedAtMillis) / 160) % 2 === 0;
      const size = meteor.radius * 2 + 1;
      const warningColor = pulseOn ? meteorWarningColor : "#6c1b19";
      fillFrameRect(frame, meteor.x - meteor.radius, meteor.y - meteor.radius, size, size, warningColor);
      if (meteor.radius > 0) {
        fillFrameRect(frame, meteor.x - meteor.radius + 1, meteor.y - meteor.radius + 1, size - 2, size - 2, backgroundColor);
      }
      paintFrameCell(frame, meteor.x, meteor.y, meteorCoreColor);
      return;
    }

    const impactAge = Math.max(0, this.nowMillis - meteor.impactAtMillis);
    const extraRadius = Math.min(2, Math.floor(impactAge / 130));
    const radius = meteor.radius + extraRadius;
    const color = impactAge < 140 ? meteorImpactColor : meteor.result === "hit" ? "#ff3151" : "#ff8a2a";
    fillFrameRect(frame, meteor.x - radius, meteor.y - radius, radius * 2 + 1, radius * 2 + 1, color);
    paintFrameCell(frame, meteor.x, meteor.y, meteorImpactColor);
  }

  private drawPlayerStart(frame: Frame): void {
    const pulse = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 190));
    const color = this.phase === "starting" ? startingColor : pulse % 2 === 0 ? readyPulseColor : readyZoneColor;
    const inset = this.phase === "starting" ? pulse % 3 : pulse % 2;
    const x = readyZone[0].minX + inset;
    const y = readyZone[0].minY + inset;
    const width = readyZone[0].maxX - readyZone[0].minX + 1 - inset * 2;
    const height = readyZone[0].maxY - readyZone[0].minY + 1 - inset * 2;

    fillFrameRect(frame, x, y, width, height, color);
    if (width > 2 && height > 2) {
      fillFrameRect(frame, x + 1, y + 1, width - 2, height - 2, backgroundColor);
    }
    paintFrameCell(frame, 7, 15, "#ffffff");
    paintFrameCell(frame, 8, 16, "#ffffff");
  }

  private drawWinAnimation(frame: Frame): void {
    const step = Math.floor(Math.max(0, this.nowMillis - this.finishedAtMillis) / 120);
    const centerX = 7.5;
    const centerY = 15.5;
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const distance = Math.floor(Math.abs(x - centerX) + Math.abs(y - centerY));
        if ((distance + step) % 7 <= 1) {
          paintFrameCell(frame, x, y, successColors[(distance + step) % successColors.length]);
        }
      }
    }
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") {
      return 0;
    }
    const endMillis = this.phase === "finished" ? this.finishedAtMillis : this.nowMillis;
    return Math.max(0, endMillis - this.startedAtMillis);
  }

  private finish(success: boolean, atMillis: number): GameEvent {
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    const event = gameEvent(success ? "win" : "fail", success ? "Tormenta superada" : "Sin vidas", atMillis);
    this.lastEvent = event;
    return event;
  }

  private meteorContainsOccupiedTile(meteor: Meteor): boolean {
    for (const tile of this.occupiedTiles) {
      const [x, y] = tile.split(",").map(Number);
      if (Math.abs(x - meteor.x) <= meteor.radius && Math.abs(y - meteor.y) <= meteor.radius) {
        return true;
      }
    }
    return false;
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    if (events.length > 0) {
      this.lastEvent = events[events.length - 1];
    }
    return events;
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.rng = createSeededRng(this.config.seed);
    this.dodgedMeteors = 0;
    this.finishedAtMillis = 0;
    this.lastDamageMillis = Number.NEGATIVE_INFINITY;
    this.lives = startingLives;
    this.meteors = [];
    this.nextMeteorId = 1;
    this.nextMeteorMillis = 0;
    this.nowMillis = nowMillis;
    this.occupiedTiles.clear();
    this.players = defaultPlayers(this.config.playerCount, this.config.players);
    this.startedAtMillis = nowMillis;
    this.success = false;
  }

  private spawnDueMeteors(nowMillis: number): void {
    const profile = this.difficultyProfile();
    let spawned = 0;
    while (this.nextMeteorMillis > 0 && this.nextMeteorMillis <= nowMillis && spawned < maxSpawnCatchUp) {
      const id = this.nextMeteorId;
      const large = profile.largeMeteorEvery > 0 && id % profile.largeMeteorEvery === 0;
      const radius = large ? Math.min(2, profile.radius + 1) : profile.radius;
      const impactAtMillis = this.nextMeteorMillis + profile.warningMillis;
      this.meteors.push({
        clearAtMillis: impactAtMillis + meteorImpactVisibleMillis,
        id,
        impactAtMillis,
        radius,
        result: "pending",
        spawnedAtMillis: this.nextMeteorMillis,
        x: this.rng.range(radius, FLOOR_COLS - radius - 1),
        y: this.rng.range(radius, FLOOR_ROWS - radius - 1)
      });
      this.nextMeteorId += 1;
      this.nextMeteorMillis += profile.intervalMillis;
      spawned += 1;
    }
  }

  private updateOccupiedTile(x: number, y: number, pressed: boolean): void {
    if (x < 0 || x >= FLOOR_COLS || y < 0 || y >= FLOOR_ROWS) {
      return;
    }
    const key = `${x},${y}`;
    if (pressed) {
      this.occupiedTiles.add(key);
    } else {
      this.occupiedTiles.delete(key);
    }
  }
}

export function meteorDifficultyProfile(difficulty: string): DifficultyProfile {
  return { ...(difficultyProfiles[difficulty] ?? difficultyProfiles.medium) };
}
