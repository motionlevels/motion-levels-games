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

export const gameWinAnimationMillis = 5_000;
export const gameFailAnimationMillis = 5_000;
export const startingEnergy = 64;

const backgroundColor: HexColor = "#03020a";
const gridColor: HexColor = "#09081a";
const readyColor: HexColor = "#145cff";
const readyPulseColor: HexColor = "#35d7ff";
const successColors = ["#35d7ff", "#ff3bd7", "#ffe176", "#5fff9e", "#ffffff"] as const satisfies readonly HexColor[];
const failColors = ["#ff3151", "#8d1235", "#280512"] as const satisfies readonly HexColor[];
const readyZone = { minX: 5, maxX: 10, minY: 13, maxY: 18 };

export const pulsePads = [
  { color: "#35d7ff" as HexColor, label: "Azul", minX: 1, maxX: 6, minY: 4, maxY: 11, x: 3, y: 7 },
  { color: "#ff3bd7" as HexColor, label: "Rosa", minX: 9, maxX: 14, minY: 4, maxY: 11, x: 12, y: 7 },
  { color: "#ffe176" as HexColor, label: "Amarillo", minX: 1, maxX: 6, minY: 20, maxY: 27, x: 3, y: 23 },
  { color: "#5fff9e" as HexColor, label: "Verde", minX: 9, maxX: 14, minY: 20, maxY: 27, x: 12, y: 23 }
] as const;

export type PulseNote = {
  atMillis: number;
  holdMillis: number;
  zones: number[];
};

type DifficultyProfile = {
  energyGain: number;
  energyLoss: number;
  spacingMillis: number;
  timingWindowMillis: number;
};

const profiles: Record<string, DifficultyProfile> = {
  easy: { energyGain: 8, energyLoss: 9, spacingMillis: 1_350, timingWindowMillis: 600 },
  medium: { energyGain: 7, energyLoss: 11, spacingMillis: 1_150, timingWindowMillis: 460 },
  hard: { energyGain: 6, energyLoss: 13, spacingMillis: 980, timingWindowMillis: 350 },
  expert: { energyGain: 5, energyLoss: 15, spacingMillis: 820, timingWindowMillis: 270 }
};

const notePattern: ReadonlyArray<{ zones: readonly number[]; holdBeats?: number }> = [
  { zones: [0] },
  { zones: [1] },
  { zones: [2] },
  { zones: [3] },
  { zones: [0, 3] },
  { zones: [1] },
  { zones: [2], holdBeats: 0.75 },
  { zones: [0] },
  { zones: [1, 2] },
  { zones: [3] },
  { zones: [0] },
  { zones: [1], holdBeats: 0.8 },
  { zones: [2, 3] },
  { zones: [0] },
  { zones: [3] },
  { zones: [0, 1] },
  { zones: [2] },
  { zones: [3], holdBeats: 0.75 },
  { zones: [0, 2] },
  { zones: [1, 3] }
];

export type PulseSnapshot = GameSnapshot & {
  accuracy: number;
  celebrating: boolean;
  combo: number;
  energy: number;
  hitZones: number[];
  maxCombo: number;
  noteCount: number;
  noteIndex: number;
  noteKind: "tap" | "chord" | "hold";
  noteProgress: number;
  noteZones: number[];
  section: number;
  timingWindowMillis: number;
};

export type PulseGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): PulseSnapshot;
};

export function pulseChart(difficulty = "medium"): PulseNote[] {
  const profile = profiles[difficulty] ?? profiles.medium!;
  return notePattern.map((entry, index) => ({
    atMillis: 1_200 + index * profile.spacingMillis,
    holdMillis: Math.round((entry.holdBeats ?? 0) * profile.spacingMillis),
    zones: [...entry.zones]
  }));
}

export function pulseDifficultyProfile(difficulty: string): DifficultyProfile {
  return { ...(profiles[difficulty] ?? profiles.medium!) };
}

export function createGame(config: GameConfig): PulseGameInstance {
  return new PulseGame(config);
}

class PulseGame implements PulseGameInstance {
  private chart: PulseNote[] = [];
  private combo = 0;
  private config: NormalizedGameConfig;
  private energy = startingEnergy;
  private finishedAtMillis = 0;
  private hitZones = new Set<number>();
  private heldZones = new Set<number>();
  private lastEvent: GameEvent = gameEvent("none", "La pista está lista", 0);
  private maxCombo = 0;
  private nowMillis = 0;
  private noteIndex = 0;
  private phase: GamePhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private resolvedNotes = 0;
  private startedAtMillis = 0;
  private successfulNotes = 0;
  private success = false;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [readyZone], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Entra en el centro para iniciar", nowMillis);
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

    const zone = this.zoneAt(event.x, event.y);
    if (zone === -1) {
      return [];
    }
    this.heldZones.add(zone);
    const note = this.chart[this.noteIndex];
    if (!note || !note.zones.includes(zone)) {
      return [];
    }

    const delta = Math.abs(this.elapsedMillis() - note.atMillis);
    if (delta > this.profile().timingWindowMillis) {
      return [];
    }
    this.hitZones.add(zone);

    if (note.holdMillis > 0) {
      this.lastEvent = gameEvent("hold", `Mantén ${pulsePads[zone]!.label.toLowerCase()}`, event.atMillis);
      return [this.lastEvent];
    }
    if (note.zones.every((requiredZone) => this.hitZones.has(requiredZone))) {
      return this.completeNote(event.atMillis);
    }

    this.lastEvent = gameEvent("hit", "Completa el acorde", event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis);
    }
    const zone = this.zoneAt(event.x, event.y);
    if (zone >= 0) {
      this.heldZones.delete(zone);
    }
    if (this.phase !== "running") {
      return [];
    }

    const note = this.chart[this.noteIndex];
    if (note?.holdMillis && note.zones.includes(zone) && this.hitZones.has(zone)) {
      return this.missNote(event.atMillis, "Nota larga soltada demasiado pronto");
    }
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis);
    }
    if (this.phase === "finished") {
      const resultMillis = this.success ? gameWinAnimationMillis : gameFailAnimationMillis;
      if (event.atMillis - this.finishedAtMillis >= resultMillis) {
        this.resetState(event.atMillis);
        this.phase = "waiting";
        this.lastEvent = gameEvent("ready", "Entra en el centro para iniciar", event.atMillis);
        return [this.lastEvent];
      }
      return [];
    }
    if (this.phase !== "running") {
      return [];
    }

    if (this.elapsedMillis() >= this.config.durationMillis) {
      return this.finish(false, event.atMillis, "La energía no llegó al final");
    }

    const note = this.chart[this.noteIndex];
    if (!note) {
      return this.finish(this.energy > 0, event.atMillis, "Pista completada");
    }

    if (note.holdMillis > 0 && note.zones.every((zone) => this.hitZones.has(zone) && this.heldZones.has(zone))) {
      if (this.elapsedMillis() >= note.atMillis + note.holdMillis) {
        return this.completeNote(event.atMillis);
      }
    }

    if (this.elapsedMillis() > note.atMillis + this.profile().timingWindowMillis) {
      return this.missNote(event.atMillis, "Pulso perdido");
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    for (let y = 0; y < FLOOR_ROWS; y += 4) {
      fillFrameRect(frame, 0, y, FLOOR_COLS - 1, y, gridColor);
    }
    for (let x = 0; x < FLOOR_COLS; x += 4) {
      fillFrameRect(frame, x, 0, x, FLOOR_ROWS - 1, gridColor);
    }

    if (this.phase === "waiting" || this.phase === "starting") {
      fillFrameRect(frame, readyZone.minX, readyZone.minY, readyZone.maxX, readyZone.maxY, readyColor);
      const radius = 1 + Math.floor(this.nowMillis / 160) % 7;
      paintDiamondRing(frame, {
        centerX: 8,
        centerY: 16,
        color: this.phase === "starting" ? "#ffe176" : readyPulseColor,
        radius
      });
      return frame;
    }

    if (this.phase === "finished") {
      this.paintResult(frame);
      return frame;
    }

    for (const pad of pulsePads) {
      fillFrameRect(frame, pad.minX, pad.minY, pad.maxX, pad.maxY, "#101025");
      paintFrameCell(frame, pad.x, pad.y, pad.color);
    }

    const note = this.chart[this.noteIndex];
    if (note) {
      const untilBeat = note.atMillis - this.elapsedMillis();
      const visibleMillis = this.profile().spacingMillis;
      const progress = Math.max(0, Math.min(1, 1 - untilBeat / visibleMillis));
      const radius = Math.max(1, Math.round(7 * (1 - progress)));
      for (const zone of note.zones) {
        const pad = pulsePads[zone]!;
        fillFrameRect(frame, pad.minX, pad.minY, pad.maxX, pad.maxY, this.hitZones.has(zone) ? "#ffffff" : "#18183a");
        paintDiamondRing(frame, { centerX: pad.x, centerY: pad.y, color: pad.color, radius });
        paintFrameCell(frame, pad.x, pad.y, pad.color);
      }
    }

    const progressCells = Math.round((this.noteIndex / this.chart.length) * FLOOR_COLS);
    for (let x = 0; x < progressCells; x += 1) {
      paintFrameCell(frame, x, FLOOR_ROWS - 1, successColors[x % successColors.length]!);
    }
    return frame;
  }

  snapshot(): PulseSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const note = this.chart[this.noteIndex];
    const noteProgress = note
      ? Math.max(0, Math.min(1, 1 - (note.atMillis - this.elapsedMillis()) / this.profile().spacingMillis))
      : 1;
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.successfulNotes,
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" && note ? note.zones.length : 0,
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: this.chart.length,
      accuracy: this.resolvedNotes === 0 ? 100 : Math.round((this.successfulNotes / this.resolvedNotes) * 100),
      celebrating: this.phase === "finished",
      combo: this.combo,
      energy: this.energy,
      hitZones: [...this.hitZones],
      maxCombo: this.maxCombo,
      noteCount: this.chart.length,
      noteIndex: this.noteIndex,
      noteKind: note?.holdMillis ? "hold" : (note?.zones.length ?? 0) > 1 ? "chord" : "tap",
      noteProgress,
      noteZones: note ? [...note.zones] : [],
      section: Math.min(4, Math.floor((this.noteIndex / this.chart.length) * 4) + 1),
      timingWindowMillis: this.profile().timingWindowMillis
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, [readyZone], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
    this.phase = "waiting";
    this.lastEvent = gameEvent("ready", "Entra en el centro para iniciar", this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Ritmo preparado", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve al centro", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.heldZones.clear();
      this.lastEvent = gameEvent("start", "Sigue el primer pulso", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private completeNote(atMillis: number): GameEvent[] {
    const note = this.chart[this.noteIndex];
    if (!note) {
      return [];
    }
    this.successfulNotes += 1;
    this.resolvedNotes += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.energy = Math.min(100, this.energy + this.profile().energyGain + Math.max(0, note.zones.length - 1) * 2);
    this.noteIndex += 1;
    this.hitZones.clear();
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent("hit", this.combo >= 4 ? `¡Combo x${this.combo}!` : "Pulso perfecto", atMillis);
    if (this.noteIndex >= this.chart.length) {
      return this.finish(true, atMillis, "Pista completada");
    }
    return [this.lastEvent];
  }

  private missNote(atMillis: number, message: string): GameEvent[] {
    this.resolvedNotes += 1;
    this.combo = 0;
    this.energy = Math.max(0, this.energy - this.profile().energyLoss);
    this.noteIndex += 1;
    this.hitZones.clear();
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent("miss", message, atMillis);
    if (this.energy === 0) {
      return this.finish(false, atMillis, "La pista se quedó sin energía");
    }
    if (this.noteIndex >= this.chart.length) {
      return this.finish(true, atMillis, "Pista completada");
    }
    return [this.lastEvent];
  }

  private finish(success: boolean, atMillis: number, message: string): GameEvent[] {
    this.phase = "finished";
    this.success = success;
    this.finishedAtMillis = atMillis;
    this.hitZones.clear();
    this.heldZones.clear();
    this.lastEvent = gameEvent(success ? "win" : "fail", message, atMillis);
    return [this.lastEvent];
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
        step: Math.floor(elapsed / 90)
      });
      return;
    }
    const color = failColors[Math.floor(elapsed / 180) % failColors.length]!;
    fillFrameRect(frame, 0, 0, FLOOR_COLS - 1, FLOOR_ROWS - 1, color);
    const radius = 2 + Math.floor(elapsed / 120) % 12;
    paintDiamondRing(frame, { centerX: 8, centerY: 16, color: "#ff3151", radius });
  }

  private zoneAt(x: number, y: number): number {
    return pulsePads.findIndex((pad) => x >= pad.minX && x <= pad.maxX && y >= pad.minY && y <= pad.maxY);
  }

  private profile(): DifficultyProfile {
    return profiles[this.config.difficulty] ?? profiles.medium!;
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting" || this.phase === "ready") {
      return 0;
    }
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      label: player.label || `Jugador ${player.index + 1}`,
      score: this.successfulNotes,
      lives: -1
    }));
  }

  private resetState(nowMillis: number): void {
    this.chart = pulseChart(this.config.difficulty);
    this.combo = 0;
    this.energy = startingEnergy;
    this.finishedAtMillis = 0;
    this.hitZones.clear();
    this.heldZones.clear();
    this.maxCombo = 0;
    this.noteIndex = 0;
    this.nowMillis = nowMillis;
    this.phase = "ready";
    this.readyGate.reset(nowMillis);
    this.resolvedNotes = 0;
    this.startedAtMillis = nowMillis;
    this.success = false;
    this.successfulNotes = 0;
    this.players = this.scoredPlayers();
  }
}
