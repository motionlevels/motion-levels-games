import {
  FLOOR_COLS, FLOOR_ROWS, clamp, createFrame, createPlayerReadyGate, createSeededRng,
  defaultPlayers, gameEvent, normalizeGameConfig, paintFrameCell,
  type Frame, type GameConfig, type GameEvent, type GameInstance, type GameSnapshot,
  type HexColor, type NormalizedGameConfig, type PlayerReadyGate, type PlayerReadyTransition,
  type PlayerReadyZone, type PressEvent, type SeededRng, type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";

const targetSize = 2;
const finishMillis = 4_000;
const hitFlashMillis = 500;
const baseLifeMillis = 3_400;
const minLifeMillis = 2_300;

export type MoleTarget = { playerIndex: number; x: number; y: number; bornMillis: number; deadlineMillis: number };
export type MolePlayerProgress = { index: number; label: string; color: HexColor; score: number; hits: number; lastPoints: number };
export type WhackAMoleSnapshot = GameSnapshot & {
  phase: "waiting" | "starting" | "running" | "finished";
  targets: Array<MoleTarget & { remainingMillis: number }>;
  playerProgress: MolePlayerProgress[];
  readyPlayerIndices: number[];
  winnerIndex: number;
  winnerLabel: string;
  motionEventId: number;
};
export type WhackAMoleGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): WhackAMoleSnapshot;
  playerReadyZones(): PlayerReadyZone[];
};

export function createGame(config: GameConfig): WhackAMoleGameInstance { return new WhackAMoleGame(config); }

class WhackAMoleGame implements WhackAMoleGameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private readyZones: PlayerReadyZone[];
  private readyGate: PlayerReadyGate;
  private players: MolePlayerProgress[] = [];
  private targets: MoleTarget[] = [];
  private lastPositions: Array<{ x: number; y: number } | undefined> = [];
  private catchUp: boolean[] = [];
  private hitFlash: Array<{ x: number; y: number; untilMillis: number; color: HexColor }> = [];
  private phase: WhackAMoleSnapshot["phase"] = "waiting";
  private nowMillis = 0;
  private startedAtMillis = 0;
  private finishAtMillis = 0;
  private winnerIndex = -1;
  private motionEventId = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyZones = readyZonesForPlayers(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); this.lastEvent = gameEvent("ready", "Busca tu plataforma de color", nowMillis); return [this.lastEvent]; }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update(event), event.atMillis));
    if (this.phase !== "running" || !event.pressed) return [];
    const targetIndex = this.targets.findIndex((target) => event.atMillis < target.deadlineMillis && containsTarget(target, event.x, event.y));
    if (targetIndex < 0) return this.record([gameEvent("miss", "No había ningún topo ahí", event.atMillis)]);
    const target = this.targets[targetIndex]!;
    const player = this.players[target.playerIndex]!;
    const points = targetScore(target, event.atMillis);
    player.score += points;
    player.hits += 1;
    player.lastPoints = points;
    for (let dy = 0; dy < targetSize; dy += 1) for (let dx = 0; dx < targetSize; dx += 1) this.hitFlash.push({ x: target.x + dx, y: target.y + dy, untilMillis: event.atMillis + hitFlashMillis, color: player.color });
    this.lastPositions[target.playerIndex] = { x: target.x, y: target.y };
    this.targets.splice(targetIndex, 1);
    this.spawnTarget(target.playerIndex, event.atMillis);
    this.motionEventId += 1;
    return this.record([gameEvent("hit", `${player.label} +${points}`, event.atMillis)]);
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update({ ...event, pressed: false }), event.atMillis));
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.tick(event.atMillis), event.atMillis));
    if (this.phase === "finished") {
      if (event.atMillis - this.finishAtMillis >= finishMillis) { this.resetState(event.atMillis); return this.record([gameEvent("ready", "Nueva caza", event.atMillis)]); }
      return [];
    }
    this.hitFlash = this.hitFlash.filter((flash) => flash.untilMillis > event.atMillis);
    const expired = this.targets.filter((target) => event.atMillis >= target.deadlineMillis);
    for (const target of expired) { this.catchUp[target.playerIndex] = true; this.targets = this.targets.filter((candidate) => candidate !== target); this.spawnTarget(target.playerIndex, event.atMillis); }
    if (this.remainingMillis() <= 0) return this.finish(event.atMillis);
    return [];
  }

  render(): Frame {
    const frame = createFrame("#05070a");
    if (this.phase === "waiting" || this.phase === "starting") { this.drawReadiness(frame); return frame; }
    if (this.phase === "finished") { this.drawFinish(frame); return frame; }
    for (const target of this.targets) {
      const player = this.players[target.playerIndex]!;
      const ratio = clamp((target.deadlineMillis - this.nowMillis) / Math.max(1, target.deadlineMillis - target.bornMillis), 0.16, 1);
      const color = scaleHex(player.color, ratio);
      for (let dy = 0; dy < targetSize; dy += 1) for (let dx = 0; dx < targetSize; dx += 1) paintFrameCell(frame, target.x + dx, target.y + dy, color);
    }
    for (const flash of this.hitFlash) paintFrameCell(frame, flash.x, flash.y, "#ffffff");
    return frame;
  }

  snapshot(): WhackAMoleSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id, label: manifest.label, phase: this.phase, playerCount: this.config.playerCount,
      players: this.players.map((player) => ({ index: player.index, label: player.label, color: player.color, score: player.score, lives: -1 })),
      score: this.players.reduce((sum, player) => sum + player.score, 0), lives: -1,
      elapsedMillis: this.elapsedMillis(), remainingMillis: this.phase === "finished" ? Math.max(0, this.finishAtMillis + finishMillis - this.nowMillis) : this.remainingMillis(),
      activeTargets: this.targets.length, success: this.phase === "finished", lastEventCue: this.lastEvent.cue, lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0, readyPlayers: ready.readyPlayers, requiredPlayers: ready.requiredPlayers,
      targets: this.targets.map((target) => ({ ...target, remainingMillis: Math.max(0, target.deadlineMillis - this.nowMillis) })),
      playerProgress: this.players.map((player) => ({ ...player })),
      readyPlayerIndices: this.readyZones.flatMap((_, index) => this.readyGate.zoneReady(index, this.nowMillis) ? [index] : []),
      winnerIndex: this.winnerIndex, winnerLabel: this.players[this.winnerIndex]?.label ?? "", motionEventId: this.motionEventId
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyZones = readyZonesForPlayers(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  playerReadyZones(): PlayerReadyZone[] { return this.readyZones.map((zone) => ({ ...zone })); }

  private resetState(nowMillis: number): void {
    this.rng = createSeededRng(this.config.seed);
    this.readyGate.reset(nowMillis);
    const roster = defaultPlayers(this.config.playerCount, this.config.players);
    this.players = roster.map((player, index) => ({ index, label: player.label === `Player ${index + 1}` ? `Jugador ${index + 1}` : player.label, color: player.color, score: 0, hits: 0, lastPoints: 0 }));
    this.targets = []; this.lastPositions = []; this.catchUp = []; this.hitFlash = [];
    this.phase = "waiting"; this.nowMillis = nowMillis; this.startedAtMillis = nowMillis; this.finishAtMillis = 0; this.winnerIndex = -1; this.motionEventId = 0;
    this.lastEvent = gameEvent("ready", "Busca tu plataforma de color", nowMillis);
  }

  private applyReady(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") { this.phase = "starting"; this.motionEventId += 1; return [gameEvent("ready", "Todos listos para cazar", nowMillis)]; }
    if (transition === "players-left") { this.phase = "waiting"; this.motionEventId += 1; return [gameEvent("ready", "Vuelve a tu plataforma", nowMillis)]; }
    if (transition === "started") {
      this.phase = "running"; this.startedAtMillis = nowMillis; this.targets = [];
      this.players.forEach((_, index) => this.spawnTarget(index, nowMillis));
      this.motionEventId += 1; return [gameEvent("start", "¡Atrapa los topos de colores!", nowMillis)];
    }
    return [];
  }

  private spawnTarget(playerIndex: number, nowMillis: number): void {
    let chosen = { x: this.rng.int(FLOOR_COLS - 1), y: this.rng.int(FLOOR_ROWS - 1) };
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = { x: this.rng.int(FLOOR_COLS - targetSize + 1), y: this.rng.int(FLOOR_ROWS - targetSize + 1) };
      const last = this.lastPositions[playerIndex];
      const distance = last ? (candidate.x - last.x) ** 2 + (candidate.y - last.y) ** 2 : 64;
      const clear = this.targets.every((target) => Math.abs(candidate.x - target.x) >= 4 || Math.abs(candidate.y - target.y) >= 4);
      if (clear && distance >= 25 && distance <= 225) { chosen = candidate; break; }
    }
    const interval = this.targetInterval();
    const extra = this.catchUp[playerIndex] ? 2_000 : 0;
    this.catchUp[playerIndex] = false;
    this.targets.push({ playerIndex, ...chosen, bornMillis: nowMillis, deadlineMillis: nowMillis + interval + 1_000 + extra });
  }

  private targetInterval(): number { const progress = clamp(this.elapsedMillis() / this.config.durationMillis, 0, 1); const base = baseLifeMillis - 1_000; const drop = baseLifeMillis - minLifeMillis; const difficulty = this.config.difficulty === "easy" ? 1.18 : 1; return (base - progress * drop) * difficulty; }
  private finish(atMillis: number): GameEvent[] { this.phase = "finished"; this.finishAtMillis = atMillis; this.targets = []; this.winnerIndex = this.players.reduce((best, player, index) => player.score > (this.players[best]?.score ?? -1) ? index : best, 0); this.motionEventId += 1; return this.record([gameEvent("win", `¡Gana ${this.players[this.winnerIndex]?.label}!`, atMillis)]); }
  private elapsedMillis(): number { return this.phase === "waiting" || this.phase === "starting" ? 0 : Math.max(0, this.nowMillis - this.startedAtMillis); }
  private remainingMillis(): number { return Math.max(0, this.config.durationMillis - this.elapsedMillis()); }
  private record(events: GameEvent[]): GameEvent[] { const latest = events.at(-1); if (latest) this.lastEvent = latest; return events; }

  private drawReadiness(frame: Frame): void { this.players.forEach((player, index) => { const zone = this.readyZones[index]!; const ready = this.readyGate.zoneReady(index, this.nowMillis); for (let y = zone.minY; y <= zone.maxY; y += 1) for (let x = zone.minX; x <= zone.maxX; x += 1) if (ready || (x + y + Math.floor(this.nowMillis / 120)) % 4 < 2) paintFrameCell(frame, x, y, ready ? "#ffffff" : player.color); }); }
  private drawFinish(frame: Frame): void { const winner = this.players[this.winnerIndex]; const step = Math.floor((this.nowMillis - this.finishAtMillis) / 90); for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = 0; x < FLOOR_COLS; x += 1) if ((x * 2 + y + step) % 7 < 3) paintFrameCell(frame, x, y, winner?.color ?? "#36d9ff"); }
}

export function readyZonesForPlayers(count: number): PlayerReadyZone[] {
  const points = [[0,0],[12,28],[0,28],[12,0],[0,14],[12,14],[6,0],[6,28]];
  return points.slice(0, clamp(Math.trunc(count), 1, 8)).map(([x = 0, y = 0]) => ({ minX: x, maxX: x + 3, minY: y, maxY: y + 3 }));
}

function containsTarget(target: MoleTarget, x: number, y: number): boolean { return x >= target.x && x < target.x + targetSize && y >= target.y && y < target.y + targetSize; }
function targetScore(target: MoleTarget, nowMillis: number): number { const total = Math.max(1, target.deadlineMillis - target.bornMillis); return 4 + Math.ceil(clamp((target.deadlineMillis - nowMillis) / total, 0, 1) * 8); }
function scaleHex(color: HexColor, factor: number): HexColor { const value = color.replace("#", ""); const parts = [0,2,4].map((offset) => Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * factor).toString(16).padStart(2, "0")); return `#${parts.join("")}`; }
