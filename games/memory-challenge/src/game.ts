import {
  FLOOR_COLS,
  FLOOR_ROWS,
  clamp,
  createFrame,
  createPlayerReadyGate,
  createSeededRng,
  defaultPlayers,
  gameEvent,
  normalizeGameConfig,
  paintFrameCell,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
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
import { manifest } from "./manifest.ts";

const memorizeMillis = 2_800;
const retryRevealMillis = 1_500;
const winAnimationMillis = 4_000;
const startRows = 2;
const lavaDark: HexColor = "#120301";
const lavaBright: HexColor = "#8f1a08";
const failColor: HexColor = "#ff6b22";
const white: HexColor = "#ffffff";

export type MemoryPoint = { x: number; y: number };
export type MemoryPlayerStatus = "memorizing" | "recalling" | "failed" | "finished";
export type MemoryPlayerProgress = {
  index: number;
  label: string;
  color: HexColor;
  progress: number;
  bestProgress: number;
  pathLength: number;
  status: MemoryPlayerStatus;
};
export type MemoryChallengeSnapshot = GameSnapshot & {
  phase: "waiting" | "starting" | "running" | "finished";
  memoryStage: "memorize" | "recall" | "game-win" | "game-loss";
  stageMillis: number;
  winnerIndex: number;
  winnerLabel: string;
  playerProgress: MemoryPlayerProgress[];
  paths: MemoryPoint[][];
  readyPlayerIndices: number[];
  motionEventId: number;
};
export type MemoryChallengeGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): MemoryChallengeSnapshot;
  pathForPlayer(index: number): MemoryPoint[];
  playerReadyZones(): PlayerReadyZone[];
};

type Lane = { x: number; width: number };
type RuntimePlayer = MemoryPlayerProgress & { path: MemoryPoint[]; revealUntilMillis: number };

export function createGame(config: GameConfig): MemoryChallengeGameInstance {
  return new MemoryChallengeGame(config);
}

class MemoryChallengeGame implements MemoryChallengeGameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private lanes: Lane[] = [];
  private readyZones: PlayerReadyZone[] = [];
  private readyGate: PlayerReadyGate;
  private players: RuntimePlayer[] = [];
  private phase: MemoryChallengeSnapshot["phase"] = "waiting";
  private memoryStage: MemoryChallengeSnapshot["memoryStage"] = "memorize";
  private nowMillis = 0;
  private startedAtMillis = 0;
  private stageEndsAtMillis = 0;
  private finishAtMillis = 0;
  private winnerIndex = -1;
  private motionEventId = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.rebuildBoard();
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    this.lastEvent = gameEvent("ready", "Busca tu salida iluminada", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.record(this.applyReadyTransition(this.readyGate.update(event), event.atMillis));
    }
    if (this.phase !== "running" || !event.pressed) return [];

    const playerIndex = this.playerForPoint(event.x, event.y);
    if (playerIndex < 0) return [];
    const player = this.players[playerIndex];
    if (!player) return [];

    if (player.status === "failed") {
      if (this.contains(this.readyZones[playerIndex], event.x, event.y)) {
        player.status = "memorizing";
        player.progress = 0;
        player.revealUntilMillis = event.atMillis + retryRevealMillis;
        this.motionEventId += 1;
        return this.record([gameEvent("start", `${player.label} vuelve a memorizar`, event.atMillis)]);
      }
      return [];
    }
    if (player.status === "finished" || this.memoryStage === "memorize") return [];

    const expected = player.path[player.progress];
    if (expected?.x === event.x && expected.y === event.y) {
      player.progress += 1;
      player.bestProgress = Math.max(player.bestProgress, player.progress);
      player.status = "recalling";
      this.motionEventId += 1;
      if (player.progress >= player.pathLength) return this.finishWin(playerIndex, event.atMillis);
      const cue = player.progress === 1 || player.progress % 5 === 0 ? "coin" : "hit";
      return this.record([gameEvent(cue, `${player.label}: ${player.progress} de ${player.pathLength}`, event.atMillis)]);
    }

    if (player.path.slice(0, player.progress).some((point) => point.x === event.x && point.y === event.y)) return [];
    player.status = "failed";
    player.progress = 0;
    player.revealUntilMillis = 0;
    this.motionEventId += 1;
    return this.record([gameEvent("damage", `${player.label} pisó la lava`, event.atMillis)]);
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.record(this.applyReadyTransition(this.readyGate.update({ ...event, pressed: false }), event.atMillis));
    }
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.record(this.applyReadyTransition(this.readyGate.tick(event.atMillis), event.atMillis));
    }
    if (this.phase === "finished") {
      if (event.atMillis - this.finishAtMillis >= winAnimationMillis) {
        this.resetState(event.atMillis);
        return this.record([gameEvent("ready", "Nueva carrera de memoria", event.atMillis)]);
      }
      return [];
    }
    if (this.memoryStage === "memorize" && event.atMillis >= this.stageEndsAtMillis) {
      this.memoryStage = "recall";
      for (const player of this.players) player.status = "recalling";
      this.motionEventId += 1;
      return this.record([gameEvent("start", "Los caminos se han ocultado", event.atMillis)]);
    }
    if (this.remainingMillis() <= 0) return this.finishLoss(event.atMillis);
    return [];
  }

  render(): Frame {
    const frame = createFrame("#05070a");
    this.drawLava(frame);
    this.drawLaneBorders(frame);
    if (this.phase === "waiting" || this.phase === "starting") {
      this.drawReadiness(frame);
      return frame;
    }
    if (this.phase === "finished") {
      this.drawFinished(frame);
      return frame;
    }
    for (const player of this.players) {
      this.drawStart(frame, player);
      const reveal = this.memoryStage === "memorize" || player.status === "failed" || this.nowMillis < player.revealUntilMillis;
      player.path.forEach((point, index) => {
        if (index < player.progress || reveal) {
          paintFrameCell(frame, point.x, point.y, player.status === "failed" ? failColor : player.color);
        }
      });
      const next = player.path[player.progress];
      if (next && player.status === "recalling" && !reveal && Math.floor(this.nowMillis / 220) % 2 === 0) {
        paintFrameCell(frame, next.x, next.y, "#211008");
      }
    }
    return frame;
  }

  snapshot(): MemoryChallengeSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const readyPlayerIndices = this.readyZones.flatMap((_, index) => this.readyGate.zoneReady(index, this.nowMillis) ? [index] : []);
    const best = Math.max(0, ...this.players.map((player) => player.bestProgress));
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players.map((player) => ({ index: player.index, label: player.label, color: player.color, score: player.bestProgress, lives: -1 })),
      score: best,
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.phase === "finished" ? Math.max(0, this.finishAtMillis + winAnimationMillis - this.nowMillis) : this.remainingMillis(),
      activeTargets: this.phase === "running" ? this.players.filter((player) => player.status !== "finished").length : 0,
      success: this.winnerIndex >= 0,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: Math.max(0, ...this.players.map((player) => player.pathLength)),
      memoryStage: this.memoryStage,
      stageMillis: this.memoryStage === "memorize" ? Math.max(0, this.stageEndsAtMillis - this.nowMillis) : 0,
      winnerIndex: this.winnerIndex,
      winnerLabel: this.players[this.winnerIndex]?.label ?? "",
      playerProgress: this.players.map(({ revealUntilMillis: _reveal, path: _path, ...player }) => ({ ...player })),
      paths: this.players.map((player) => player.path.map((point) => ({ ...point }))),
      readyPlayerIndices,
      motionEventId: this.motionEventId
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.rebuildBoard();
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  pathForPlayer(index: number): MemoryPoint[] { return this.players[index]?.path.map((point) => ({ ...point })) ?? []; }
  playerReadyZones(): PlayerReadyZone[] { return this.readyZones.map((zone) => ({ ...zone })); }

  private rebuildBoard(): void {
    this.lanes = laneLayout(this.config.playerCount);
    this.readyZones = this.lanes.map((lane) => {
      const width = Math.min(4, lane.width);
      const minX = lane.x + Math.floor((lane.width - width) / 2);
      return { minX, maxX: minX + width - 1, minY: 0, maxY: startRows - 1 };
    });
    const roster = defaultPlayers(this.config.playerCount, this.config.players);
    this.players = roster.map((player, index) => {
      const path = generatePath(this.rng, this.lanes[index]!, this.readyZones[index]!);
      const label = player.label === `Player ${index + 1}` ? `Jugador ${index + 1}` : player.label;
      return { index, label, color: player.color, progress: 0, bestProgress: 0, pathLength: path.length, status: "memorizing", path, revealUntilMillis: 0 };
    });
  }

  private resetState(nowMillis: number): void {
    this.rng = createSeededRng(this.config.seed);
    this.rebuildBoard();
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.memoryStage = "memorize";
    this.nowMillis = nowMillis;
    this.startedAtMillis = nowMillis;
    this.stageEndsAtMillis = 0;
    this.finishAtMillis = 0;
    this.winnerIndex = -1;
    this.motionEventId = 0;
    this.lastEvent = gameEvent("ready", "Busca tu salida iluminada", nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.motionEventId += 1;
      return [gameEvent("ready", "Todos los jugadores listos", nowMillis)];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.motionEventId += 1;
      return [gameEvent("ready", "Vuelve a tu salida", nowMillis)];
    }
    if (transition === "started") {
      this.phase = "running";
      this.memoryStage = "memorize";
      this.startedAtMillis = nowMillis;
      this.stageEndsAtMillis = nowMillis + memorizeMillis;
      this.players.forEach((player) => { player.status = "memorizing"; });
      this.motionEventId += 1;
      return [gameEvent("start", "Memoriza tu camino", nowMillis)];
    }
    return [];
  }

  private finishWin(index: number, atMillis: number): GameEvent[] {
    const player = this.players[index]!;
    player.status = "finished";
    this.phase = "finished";
    this.memoryStage = "game-win";
    this.winnerIndex = index;
    this.finishAtMillis = atMillis;
    this.motionEventId += 1;
    return this.record([gameEvent("win", `¡${player.label} completa el camino!`, atMillis)]);
  }

  private finishLoss(atMillis: number): GameEvent[] {
    this.phase = "finished";
    this.memoryStage = "game-loss";
    this.finishAtMillis = atMillis;
    this.motionEventId += 1;
    return this.record([gameEvent("fail", "Se acabó el tiempo", atMillis)]);
  }

  private elapsedMillis(): number { return this.phase === "waiting" || this.phase === "starting" ? 0 : Math.max(0, this.nowMillis - this.startedAtMillis); }
  private remainingMillis(): number { return Math.max(0, this.config.durationMillis - this.elapsedMillis()); }
  private playerForPoint(x: number, y: number): number { return this.lanes.findIndex((lane) => x >= lane.x && x < lane.x + lane.width && y >= 0 && y < FLOOR_ROWS); }
  private contains(zone: PlayerReadyZone | undefined, x: number, y: number): boolean { return Boolean(zone && x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY); }
  private record(events: GameEvent[]): GameEvent[] { const latest = events.at(-1); if (latest) this.lastEvent = latest; return events; }

  private drawLava(frame: Frame): void {
    const step = Math.floor(this.nowMillis / 140);
    for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = 0; x < FLOOR_COLS; x += 1) {
      if ((x * 5 + y * 3 + step) % 13 < 2) paintFrameCell(frame, x, y, lavaBright);
      else if ((x + y + step) % 4 === 0) paintFrameCell(frame, x, y, lavaDark);
    }
  }

  private drawLaneBorders(frame: Frame): void {
    for (const lane of this.lanes.slice(1)) for (let y = 0; y < FLOOR_ROWS; y += 1) paintFrameCell(frame, lane.x - 1, y, "#2b2f3a");
  }

  private drawReadiness(frame: Frame): void {
    this.players.forEach((player, index) => {
      const ready = this.readyGate.zoneReady(index, this.nowMillis);
      const zone = this.readyZones[index]!;
      for (let y = zone.minY; y <= zone.maxY; y += 1) for (let x = zone.minX; x <= zone.maxX; x += 1) {
        const pulse = (x + y + Math.floor(this.nowMillis / 130)) % 4;
        if (ready || pulse < 2) paintFrameCell(frame, x, y, ready ? white : player.color);
      }
      if (this.phase === "starting") player.path.forEach((point, pathIndex) => {
        if ((pathIndex + Math.floor(this.nowMillis / 90)) % 5 < 3) paintFrameCell(frame, point.x, point.y, player.color);
      });
    });
  }

  private drawStart(frame: Frame, player: RuntimePlayer): void {
    const zone = this.readyZones[player.index]!;
    for (let y = zone.minY; y <= zone.maxY; y += 1) for (let x = zone.minX; x <= zone.maxX; x += 1) paintFrameCell(frame, x, y, player.color);
  }

  private drawFinished(frame: Frame): void {
    const wave = Math.floor((this.nowMillis - this.finishAtMillis) / 90);
    if (this.winnerIndex < 0) {
      for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = 0; x < FLOOR_COLS; x += 1) if ((x + y + wave) % 5 < 2) paintFrameCell(frame, x, y, failColor);
      return;
    }
    const winner = this.players[this.winnerIndex]!;
    for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = 0; x < FLOOR_COLS; x += 1) {
      const lane = this.lanes[this.winnerIndex]!;
      if (x >= lane.x && x < lane.x + lane.width && (x + y + wave) % 4 < 3) paintFrameCell(frame, x, y, winner.color);
    }
    winner.path.forEach((point, index) => paintFrameCell(frame, point.x, point.y, (index + wave) % winner.pathLength === 0 ? white : winner.color));
  }
}

export function laneLayout(count: number): Lane[] {
  const safe = clamp(Math.trunc(count), 1, 4);
  if (safe === 1) return [{ x: 0, width: FLOOR_COLS }];
  if (safe === 2) return [{ x: 0, width: 8 }, { x: 8, width: 8 }];
  if (safe === 3) return [{ x: 0, width: 4 }, { x: 6, width: 4 }, { x: 12, width: 4 }];
  return Array.from({ length: 4 }, (_, index) => ({ x: index * 4, width: 4 }));
}

function generatePath(rng: SeededRng, lane: Lane, start: PlayerReadyZone): MemoryPoint[] {
  const path: MemoryPoint[] = [];
  let x = start.minX + rng.int(start.maxX - start.minX + 1);
  let segment = 3 + rng.int(4);
  for (let y = startRows; y < FLOOR_ROWS; y += 1) {
    path.push({ x, y });
    segment -= 1;
    if (segment > 0 || y >= FLOOR_ROWS - 2) continue;
    const direction = rng.int(2) === 0 ? -1 : 1;
    const nextX = clamp(x + direction, lane.x, lane.x + lane.width - 1);
    if (nextX !== x) {
      x = nextX;
      path.push({ x, y });
    }
    segment = 3 + rng.int(5);
  }
  return path;
}
