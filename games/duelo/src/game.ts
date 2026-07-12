import {
  FLOOR_COLS,
  FLOOR_ROWS,
  FRAME_SIZE,
  addRgb,
  clamp,
  createFrame,
  createPlayerReadyGate,
  createSeededRng,
  gameEvent,
  inFloorBounds,
  normalizeGameConfig,
  paintFrameCell,
  readGameConfigOption,
  rgbToHex,
  scaleRgb,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GamePlayer,
  type GameSnapshot,
  type HexColor,
  type NormalizedGameConfig,
  type PlayerReadyGate,
  type PlayerReadyTransition,
  type PlayerReadyZone,
  type PressEvent,
  type RgbColor,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { dueloConfigVars, manifest } from "./manifest.ts";

const startPadSize = 4;
const boardCandidateCount = 18;
const claimFlashMillis = 420;
const recentClaimMillis = 700;
export const winAnimationMillis = 5_000;
const idleColor: HexColor = "#03060b";
const white: RgbColor = { r: 255, g: 255, b: 255 };

export const dueloPlayerPalette = [
  "#ff3048",
  "#24d9ff",
  "#42e879",
  "#ff4fd8",
  "#376bff",
  "#ffd84d",
  "#a66cff",
  "#ff8a3d"
] as const satisfies readonly HexColor[];

type DueloPhase = "waiting" | "starting" | "running" | "finished";

export type DueloPlayerProgress = {
  claimed: number;
  color: HexColor;
  index: number;
  label: string;
  progress: number;
  remaining: number;
  target: number;
};

export type DueloClaimSnapshot = {
  playerIndex: number;
  remainingMillis: number;
  x: number;
  y: number;
};

export type DueloSnapshot = GameSnapshot & {
  phase: DueloPhase;
  claimedTargets: number;
  countdownMillis: number;
  fillPercent: number;
  leaderIndex: number;
  leaderLabel: string;
  motionEventId: number;
  playerProgress: DueloPlayerProgress[];
  readyPlayers: number;
  readyPlayerIndices: number[];
  requiredPlayers: number;
  recentClaim: DueloClaimSnapshot | null;
  remainingTargets: number;
  totalTargets: number;
  winnerIndex: number;
  winnerLabel: string;
};

export type DueloGameInstance = Omit<GameInstance, "snapshot"> & {
  playerReadyZones(): PlayerReadyZone[];
  snapshot(): DueloSnapshot;
  targetOwner(x: number, y: number): number;
};

type RecentClaim = {
  atMillis: number;
  playerIndex: number;
  x: number;
  y: number;
};

export function createGame(config: GameConfig): DueloGameInstance {
  return new DueloGame(config);
}

export function dueloReadyZones(playerCount: number): PlayerReadyZone[] {
  const count = clamp(Math.round(playerCount), manifest.players.min, manifest.players.max);
  const right = FLOOR_COLS - startPadSize;
  const bottom = FLOOR_ROWS - startPadSize;
  const centerX = Math.floor((FLOOR_COLS - startPadSize) / 2);
  const centerY = Math.floor((FLOOR_ROWS - startPadSize) / 2);
  const origins = count === 2
    ? [[0, centerY], [right, centerY]]
    : count === 3
      ? [[0, 0], [right, 0], [centerX, bottom]]
      : [
          [0, 0],
          [right, bottom],
          [0, bottom],
          [right, 0],
          [0, centerY],
          [right, centerY],
          [centerX, 0],
          [centerX, bottom]
        ].slice(0, count);

  return origins.map(([x = 0, y = 0]) => ({
    minX: x,
    maxX: x + startPadSize - 1,
    minY: y,
    maxY: y + startPadSize - 1
  }));
}

class DueloGame implements DueloGameInstance {
  private claimed = new Uint8Array(FRAME_SIZE);
  private claimedAt = new Float64Array(FRAME_SIZE);
  private claims: number[] = [];
  private config: NormalizedGameConfig;
  private fillPercent = 60;
  private finishAtMillis = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private motionEventId = 0;
  private nowMillis = 0;
  private owners: Int16Array = new Int16Array(FRAME_SIZE).fill(-1);
  private phase: DueloPhase = "waiting";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private readyZones: PlayerReadyZone[] = [];
  private recentClaim: RecentClaim | null = null;
  private rng: SeededRng;
  private startedAtMillis = 0;
  private targets: number[] = [];
  private winnerIndex = -1;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyZones = dueloReadyZones(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetGame(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetGame(nowMillis);
    this.lastEvent = gameEvent("ready", this.waitingMessage(), nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.recordEvents(this.applyReadyTransition(this.readyGate.update(event), event.atMillis));
    }
    if (this.phase !== "running" || !event.pressed || !inFloorBounds(event.x, event.y)) {
      return [];
    }

    const eventResult = this.claimTile(event.x, event.y, event.atMillis);
    return this.recordEvents(eventResult ? [eventResult] : []);
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.recordEvents(this.applyReadyTransition(
        this.readyGate.update({ ...event, pressed: false }),
        event.atMillis
      ));
    }
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.recordEvents(this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis));
    }
    if (this.phase === "finished" && event.atMillis - this.finishAtMillis >= winAnimationMillis) {
      this.resetGame(event.atMillis);
      return this.recordEvents([gameEvent("ready", "Nuevo duelo", event.atMillis)]);
    }
    return [];
  }

  render(): Frame {
    const frame = createFrame(idleColor);
    if (this.phase === "waiting") {
      this.drawWaiting(frame);
    } else if (this.phase === "starting") {
      this.drawStarting(frame);
    } else if (this.phase === "running") {
      this.drawBoard(frame);
    } else {
      this.drawVictory(frame);
    }
    return frame;
  }

  snapshot(): DueloSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const progress = this.playerProgress();
    const leadingPlayer = progress.reduce<DueloPlayerProgress | undefined>((best, player) => {
      if (!best || player.progress > best.progress || (player.progress === best.progress && player.index < best.index)) {
        return player;
      }
      return best;
    }, undefined);
    const leader = leadingPlayer && progress.filter((player) => player.progress === leadingPlayer.progress).length === 1
      ? leadingPlayer
      : undefined;
    const claimedTargets = this.claims.reduce((sum, value) => sum + value, 0);
    const totalTargets = this.targets.reduce((sum, value) => sum + value, 0);
    const winner = this.players[this.winnerIndex];
    const elapsedEnd = this.phase === "finished" ? this.finishAtMillis : this.nowMillis;
    const recentClaimAge = this.recentClaim ? this.nowMillis - this.recentClaim.atMillis : Number.POSITIVE_INFINITY;

    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players.map((player, index) => ({ ...player, score: this.claims[index] ?? 0 })),
      score: Math.max(0, ...this.claims),
      lives: -1,
      elapsedMillis: this.phase === "waiting" || this.phase === "starting"
        ? 0
        : Math.max(0, elapsedEnd - this.startedAtMillis),
      remainingMillis: this.phase === "finished"
        ? Math.max(0, this.finishAtMillis + winAnimationMillis - this.nowMillis)
        : 0,
      activeTargets: totalTargets - claimedTargets,
      success: this.winnerIndex >= 0,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: Math.max(0, ...this.targets),
      claimedTargets,
      fillPercent: this.fillPercent,
      leaderIndex: leader?.index ?? -1,
      leaderLabel: leader?.label ?? "-",
      motionEventId: this.motionEventId,
      playerProgress: progress,
      readyPlayerIndices: this.players
        .filter((_, index) => this.readyGate.zoneReady(index, this.nowMillis))
        .map((player) => player.index),
      recentClaim: this.recentClaim && recentClaimAge < recentClaimMillis
        ? {
            playerIndex: this.recentClaim.playerIndex,
            remainingMillis: recentClaimMillis - recentClaimAge,
            x: this.recentClaim.x,
            y: this.recentClaim.y
          }
        : null,
      remainingTargets: totalTargets - claimedTargets,
      totalTargets,
      winnerIndex: this.winnerIndex,
      winnerLabel: winner?.label ?? ""
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyZones = dueloReadyZones(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetGame(this.config.nowMillis);
    this.lastEvent = gameEvent("ready", this.waitingMessage(), this.config.nowMillis);
  }

  playerReadyZones(): PlayerReadyZone[] {
    return this.readyZones.map((zone) => ({ ...zone }));
  }

  targetOwner(x: number, y: number): number {
    return inFloorBounds(x, y) ? this.owners[y * FLOOR_COLS + x] ?? -1 : -1;
  }

  private resetGame(nowMillis: number): void {
    this.nowMillis = nowMillis;
    this.startedAtMillis = nowMillis;
    this.finishAtMillis = 0;
    this.phase = "waiting";
    this.winnerIndex = -1;
    this.motionEventId = 1;
    this.recentClaim = null;
    this.claimed.fill(0);
    this.claimedAt.fill(0);
    this.readyGate.reset(nowMillis);
    this.players = this.createPlayers();
    this.fillPercent = this.readFillPercent();
    this.rng = createSeededRng(this.config.seed);
    const board = generateBalancedBoard(this.config.playerCount, this.fillPercent, this.rng);
    this.owners = board.owners;
    this.targets = board.targets;
    this.claims = Array.from({ length: this.config.playerCount }, () => 0);
    this.lastEvent = gameEvent("ready", this.waitingMessage(), nowMillis);
  }

  private createPlayers(): GamePlayer[] {
    return Array.from({ length: this.config.playerCount }, (_, index) => {
      const configured = this.config.players[index];
      const fallbackColor = dueloPlayerPalette[index] ?? dueloPlayerPalette[0];
      const configuredColor = configured?.color;
      const color = configuredColor && /^#[0-9a-f]{6}$/i.test(configuredColor)
        ? configuredColor
        : fallbackColor;
      const label = String(configured?.label || configured?.name || `Jugador ${index + 1}`).trim();
      return {
        index,
        label: label || `Jugador ${index + 1}`,
        color,
        score: 0,
        lives: -1
      };
    });
  }

  private readFillPercent(): number {
    const base = readGameConfigOption(this.config.options, dueloConfigVars.baseFillPercent);
    if (this.config.difficulty !== "hard") {
      return Math.round(base);
    }
    const multiplier = readGameConfigOption(this.config.options, dueloConfigVars.hardFillMultiplier);
    return Math.round(clamp(base * multiplier, 1, 100));
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.motionEventId += 1;
      return [gameEvent("start", "Todos en posición", nowMillis)];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.motionEventId += 1;
      return [gameEvent("ready", "Vuelve a tu zona iluminada", nowMillis)];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.motionEventId += 1;
      return [gameEvent("start", "Reclama todas las baldosas de tu color", nowMillis)];
    }
    return [];
  }

  private claimTile(x: number, y: number, nowMillis: number): GameEvent | undefined {
    const index = y * FLOOR_COLS + x;
    const owner = this.owners[index] ?? -1;
    if (owner < 0 || owner >= this.players.length || this.claimed[index] === 1) {
      return undefined;
    }

    this.claimed[index] = 1;
    this.claimedAt[index] = nowMillis;
    this.claims[owner] = (this.claims[owner] ?? 0) + 1;
    this.recentClaim = { atMillis: nowMillis, playerIndex: owner, x, y };
    this.motionEventId += 1;
    const remaining = Math.max(0, (this.targets[owner] ?? 0) - (this.claims[owner] ?? 0));
    const label = this.players[owner]?.label ?? `Jugador ${owner + 1}`;

    if (remaining === 0) {
      this.phase = "finished";
      this.finishAtMillis = nowMillis;
      this.winnerIndex = owner;
      return gameEvent("win", `${label} gana el duelo`, nowMillis);
    }
    return gameEvent("coin", `${label}: ${remaining} por reclamar`, nowMillis);
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    const last = events.at(-1);
    if (last) this.lastEvent = last;
    return events;
  }

  private waitingMessage(): string {
    return `Duelo espera a ${this.config.playerCount} jugadores`;
  }

  private playerProgress(): DueloPlayerProgress[] {
    return this.players.map((player, index) => {
      const target = this.targets[index] ?? 0;
      const claimed = this.claims[index] ?? 0;
      return {
        claimed,
        color: player.color,
        index,
        label: player.label,
        progress: target > 0 ? claimed / target : 0,
        remaining: Math.max(0, target - claimed),
        target
      };
    });
  }

  private drawWaiting(frame: Frame): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.nowMillis / 310);
    this.readyZones.forEach((zone, index) => {
      const ready = this.readyGate.zoneReady(index, this.nowMillis);
      this.drawReadyZone(frame, zone, this.players[index]?.color ?? dueloPlayerPalette[0], ready, pulse);
    });
    paintDiamondRing(frame, {
      color: "#13263a",
      radius: 2 + Math.floor(this.nowMillis / 180) % 20,
      thickness: 0.35
    });
  }

  private drawStarting(frame: Frame): void {
    const step = Math.floor(this.nowMillis / 110);
    paintDiamondWave(frame, {
      bandWidth: 2,
      period: 8,
      step,
      color: ({ distance }) => {
        const player = this.players[Math.floor(distance) % this.players.length];
        return dimColor(player?.color ?? dueloPlayerPalette[0], 58);
      }
    });
    this.readyZones.forEach((zone, index) => {
      this.drawReadyZone(frame, zone, this.players[index]?.color ?? dueloPlayerPalette[0], true, 1);
    });
  }

  private drawReadyZone(
    frame: Frame,
    zone: PlayerReadyZone,
    color: HexColor,
    ready: boolean,
    pulse: number
  ): void {
    for (let y = zone.minY; y <= zone.maxY; y += 1) {
      for (let x = zone.minX; x <= zone.maxX; x += 1) {
        const edge = x === zone.minX || x === zone.maxX || y === zone.minY || y === zone.maxY;
        const intensity = ready ? (edge ? 100 : 78) : edge ? 26 + pulse * 24 : 12 + pulse * 12;
        paintFrameCell(frame, x, y, dimColor(color, intensity));
      }
    }
  }

  private drawBoard(frame: Frame): void {
    const progress = this.playerProgress();
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const owner = this.owners[index] ?? -1;
      if (owner < 0) continue;
      const x = index % FLOOR_COLS;
      const y = Math.floor(index / FLOOR_COLS);
      const color = this.players[owner]?.color ?? dueloPlayerPalette[0];
      if (this.claimed[index] === 1) {
        const age = this.nowMillis - (this.claimedAt[index] ?? 0);
        if (age < claimFlashMillis) {
          const flash = 1 - age / claimFlashMillis;
          paintFrameCell(frame, x, y, mixWithWhite(color, 35 + flash * 65));
        } else {
          paintFrameCell(frame, x, y, dimColor(color, 12));
        }
        continue;
      }

      const urgency = (progress[owner]?.progress ?? 0) >= 0.88 ? 16 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(this.nowMillis / 360 + x * 0.74 + y * 0.18 + owner);
      paintFrameCell(frame, x, y, dimColor(color, 58 + urgency + pulse * 24));
    }

    if (this.recentClaim && this.nowMillis - this.recentClaim.atMillis < recentClaimMillis) {
      const ownerColor = this.players[this.recentClaim.playerIndex]?.color ?? dueloPlayerPalette[0];
      const radius = 1 + Math.floor((this.nowMillis - this.recentClaim.atMillis) / 160);
      paintDiamondRing(frame, {
        centerX: this.recentClaim.x,
        centerY: this.recentClaim.y,
        color: dimColor(ownerColor, 44),
        radius,
        thickness: 0.25
      });
    }
  }

  private drawVictory(frame: Frame): void {
    const winnerColor = this.players[this.winnerIndex]?.color ?? dueloPlayerPalette[0];
    const winnerRgb = parseHexColor(winnerColor);
    const elapsed = Math.max(0, this.nowMillis - this.finishAtMillis);
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const shimmer = 0.5 + 0.5 * Math.sin(elapsed / 170 + x * 0.58 + y * 0.19);
        const glow = addRgb(scaleRgb(winnerRgb, 48 + shimmer * 42), scaleRgb(white, shimmer * 16));
        paintFrameCell(frame, x, y, rgbToHex(glow));
      }
    }
    paintDiamondWave(frame, {
      bandWidth: 2,
      period: 9,
      step: Math.floor(elapsed / 90),
      color: "#ffffff"
    });
  }
}

type GeneratedBoard = {
  owners: Int16Array;
  targets: number[];
};

function generateBalancedBoard(playerCount: number, fillPercent: number, rng: SeededRng): GeneratedBoard {
  const requestedTargets = Math.round((FRAME_SIZE * fillPercent) / 100);
  const targetsPerPlayer = Math.max(1, Math.floor(requestedTargets / playerCount));
  const targets = Array.from({ length: playerCount }, () => targetsPerPlayer);
  let bestOwners: Int16Array = new Int16Array(FRAME_SIZE).fill(-1);
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < boardCandidateCount; attempt += 1) {
    const candidate = generateBoardCandidate(targets, rng);
    const penalty = boardOrganicPenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestOwners = candidate;
    }
  }
  return { owners: bestOwners, targets };
}

function generateBoardCandidate(targets: number[], rng: SeededRng): Int16Array {
  const owners = new Int16Array(FRAME_SIZE).fill(-1);
  const counts = Array.from({ length: targets.length }, () => 0);
  const order = Array.from({ length: FRAME_SIZE }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex] ?? 0, order[index] ?? 0];
  }

  for (const tileIndex of order) {
    const x = tileIndex % FLOOR_COLS;
    const y = Math.floor(tileIndex / FLOOR_COLS);
    let bestPlayer = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let player = 0; player < targets.length; player += 1) {
      const target = targets[player] ?? 0;
      if ((counts[player] ?? 0) >= target) continue;
      const sameOrthogonal = sameOrthogonalNeighbors(owners, x, y, player);
      const sameDiagonal = sameDiagonalNeighbors(owners, x, y, player);
      const score = localAdjacencyPenalty(sameOrthogonal)
        + sameDiagonal * 0.12
        + ((counts[player] ?? 0) / Math.max(target, 1)) * 0.2
        + rng.next() * 1.35;
      if (score < bestScore) {
        bestScore = score;
        bestPlayer = player;
      }
    }
    if (bestPlayer >= 0) {
      owners[tileIndex] = bestPlayer;
      counts[bestPlayer] = (counts[bestPlayer] ?? 0) + 1;
    }
  }
  return owners;
}

function boardOrganicPenalty(owners: Int16Array): number {
  let penalty = 0;
  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    let runOwner = -2;
    let runLength = 0;
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      const owner = owners[y * FLOOR_COLS + x] ?? -1;
      if (owner >= 0) {
        const same = sameOrthogonalNeighbors(owners, x, y, owner);
        penalty += localAdjacencyPenalty(same) + (same >= 3 ? 6 : 0);
      }
      if (owner === runOwner && owner >= 0) runLength += 1;
      else {
        runOwner = owner;
        runLength = 1;
      }
      if (runOwner >= 0 && runLength > 5) penalty += (runLength - 5) * 7;
    }
  }
  for (let x = 0; x < FLOOR_COLS; x += 1) {
    let runOwner = -2;
    let runLength = 0;
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      const owner = owners[y * FLOOR_COLS + x] ?? -1;
      if (owner === runOwner && owner >= 0) runLength += 1;
      else {
        runOwner = owner;
        runLength = 1;
      }
      if (runOwner >= 0 && runLength > 5) penalty += (runLength - 5) * 7;
    }
  }
  return penalty;
}

function sameOrthogonalNeighbors(owners: Int16Array, x: number, y: number, player: number): number {
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ].filter(([nextX = -1, nextY = -1]) => (
    inFloorBounds(nextX, nextY) && owners[nextY * FLOOR_COLS + nextX] === player
  )).length;
}

function sameDiagonalNeighbors(owners: Int16Array, x: number, y: number, player: number): number {
  return [
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x - 1, y + 1],
    [x + 1, y + 1]
  ].filter(([nextX = -1, nextY = -1]) => (
    inFloorBounds(nextX, nextY) && owners[nextY * FLOOR_COLS + nextX] === player
  )).length;
}

function localAdjacencyPenalty(sameOrthogonal: number): number {
  if (sameOrthogonal === 0) return 0.85;
  if (sameOrthogonal === 1) return 0;
  if (sameOrthogonal === 2) return 0.45;
  return 4.5;
}

function parseHexColor(color: HexColor): RgbColor {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return white;
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  };
}

function dimColor(color: HexColor, percent: number): HexColor {
  return rgbToHex(scaleRgb(parseHexColor(color), percent));
}

function mixWithWhite(color: HexColor, whitePercent: number): HexColor {
  const ratio = clamp(whitePercent, 0, 100);
  return rgbToHex(addRgb(
    scaleRgb(parseHexColor(color), 100 - ratio),
    scaleRgb(white, ratio)
  ));
}
