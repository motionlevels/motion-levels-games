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

export const roundsToWin = 2;
export const roundWinAnimationMillis = 1_800;
export const gameWinAnimationMillis = 3_200;

export type TrailCell = { x: number; y: number; playerIndex: number };
export type EstelaPlayerProgress = {
  index: number;
  label: string;
  color: HexColor;
  alive: boolean;
  roundWins: number;
  trailLength: number;
};
export type EstelaSnapshot = GameSnapshot & {
  arenaInset: number;
  currentRound: number;
  gameWinnerIndex: number;
  playerProgress: EstelaPlayerProgress[];
  roundWinnerIndex: number;
  roundsToWin: number;
  startPositions: Array<{ x: number; y: number }>;
  trailCells: TrailCell[];
  roundWinMillis: number;
  gameWinMillis: number;
};
export type EstelaGameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): EstelaSnapshot };
type EstelaPhase = GamePhase | "round-win";

const playerColors = ["#ff365c", "#26d9ff", "#66ff9a", "#ffe176", "#d85cff", "#ff8a36", "#ffffff", "#3d73ff"] as const satisfies readonly HexColor[];
const allStartPositions = [
  { x: 2, y: 2 }, { x: 13, y: 29 }, { x: 13, y: 2 }, { x: 2, y: 29 },
  { x: 7, y: 2 }, { x: 8, y: 29 }, { x: 2, y: 15 }, { x: 13, y: 16 }
] as const;
const shrinkIntervals: Record<string, number> = { easy: 18_000, medium: 13_000, hard: 9_000 };

export function createGame(config: GameConfig): EstelaGameInstance {
  return new EstelaGame(config);
}

export function estelaStartPositions(count: number): Array<{ x: number; y: number }> {
  return allStartPositions.slice(0, count).map((position) => ({ ...position }));
}

class EstelaGame implements EstelaGameInstance {
  private alive: boolean[] = [];
  private config: NormalizedGameConfig;
  private currentPositions: Array<{ x: number; y: number }> = [];
  private currentRound = 1;
  private finishedAtMillis: number | undefined;
  private gameWinnerIndex = -1;
  private lastEvent: GameEvent = gameEvent("none", "Busca tu plataforma", 0);
  private nowMillis = 0;
  private phase: EstelaPhase = "ready";
  private players: GamePlayer[] = [];
  private readyGate: PlayerReadyGate;
  private roundStartedAtMillis = 0;
  private roundTransitionAtMillis = 0;
  private roundWinnerIndex = -1;
  private roundWins: number[] = [];
  private startPositions: Array<{ x: number; y: number }> = [];
  private trails = new Map<string, number>();

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.startPositions = estelaStartPositions(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones(), this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetState(nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase !== "running" || !event.pressed) return [];

    const playerIndex = this.nearestAlivePlayer(event.x, event.y);
    if (playerIndex < 0) return [];
    if (!this.inArena(event.x, event.y) || this.trails.has(tileKey(event.x, event.y))) {
      return this.eliminate(playerIndex, event.atMillis);
    }

    this.currentPositions[playerIndex] = { x: event.x, y: event.y };
    this.trails.set(tileKey(event.x, event.y), playerIndex);
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent("move", `${this.playerLabel(playerIndex)} extiende su estela`, event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
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
    if (this.phase === "round-win" && event.atMillis - this.roundTransitionAtMillis >= roundWinAnimationMillis) {
      if ((this.roundWins[this.roundWinnerIndex] ?? 0) >= roundsToWin) {
        this.phase = "finished";
        this.gameWinnerIndex = this.roundWinnerIndex;
        this.finishedAtMillis = event.atMillis;
        this.lastEvent = gameEvent("win", `¡Gana ${this.playerLabel(this.gameWinnerIndex)}!`, event.atMillis);
      } else {
        this.currentRound += 1;
        this.resetRound(event.atMillis);
        this.phase = "running";
        this.lastEvent = gameEvent("start", `Ronda ${this.currentRound}`, event.atMillis);
      }
      return [this.lastEvent];
    }
    if (this.phase !== "running") return [];

    const events: GameEvent[] = [];
    for (const [index, position] of this.currentPositions.entries()) {
      if (this.alive[index] && !this.inArena(position.x, position.y)) events.push(...this.eliminate(index, event.atMillis));
      if (this.phase !== "running") break;
    }
    return events;
  }

  render(): Frame {
    const frame = createFrame("#02030a");
    if (this.phase === "waiting" || this.phase === "starting") {
      this.startPositions.forEach((position, index) => {
        const step = Math.floor(this.nowMillis / (this.phase === "starting" ? 100 : 180));
        paintDiamondRing(frame, { centerX: position.x, centerY: position.y, radius: 1 + step % 3, color: playerColors[index] ?? "#ffffff" });
        paintFrameCell(frame, position.x, position.y, playerColors[index] ?? "#ffffff");
      });
      return frame;
    }
    if (this.phase === "finished") {
      const step = Math.floor((this.nowMillis - (this.finishedAtMillis ?? this.nowMillis)) / 110);
      paintDiamondWave(frame, {
        color: ({ distance }) => playerColors[(distance + step) % playerColors.length] ?? "#ffffff",
        step
      });
      return frame;
    }
    if (this.phase === "round-win") {
      const winnerColor = playerColors[this.roundWinnerIndex] ?? "#ffffff";
      fillFrameRect(frame, 0, 0, FLOOR_COLS, FLOOR_ROWS, "#050812");
      const step = Math.floor((this.nowMillis - this.roundTransitionAtMillis) / 130);
      paintDiamondWave(frame, { color: winnerColor, step });
      return frame;
    }

    const inset = this.arenaInset();
    for (let border = 0; border < inset; border += 1) {
      fillFrameRect(frame, border, border, FLOOR_COLS - border * 2, 1, "#ff244d");
      fillFrameRect(frame, border, FLOOR_ROWS - border - 1, FLOOR_COLS - border * 2, 1, "#ff244d");
      fillFrameRect(frame, border, border, 1, FLOOR_ROWS - border * 2, "#ff244d");
      fillFrameRect(frame, FLOOR_COLS - border - 1, border, 1, FLOOR_ROWS - border * 2, "#ff244d");
    }
    for (const [key, owner] of this.trails) {
      const [x, y] = parseTile(key);
      paintFrameCell(frame, x, y, playerColors[owner] ?? "#ffffff");
    }
    this.currentPositions.forEach((position, index) => {
      if (this.alive[index]) paintFrameCell(frame, position.x, position.y, "#ffffff");
    });
    return frame;
  }

  snapshot(): EstelaSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: Math.max(...this.roundWins, 0),
      lives: -1,
      elapsedMillis: this.phase === "waiting" || this.phase === "starting" ? 0 : Math.max(0, this.nowMillis - this.roundStartedAtMillis),
      remainingMillis: 0,
      activeTargets: this.alive.filter(Boolean).length,
      success: this.phase === "finished",
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0,
      readyPlayers: ready.readyPlayers,
      requiredPlayers: ready.requiredPlayers,
      matchTarget: roundsToWin,
      arenaInset: this.arenaInset(),
      currentRound: this.currentRound,
      gameWinnerIndex: this.gameWinnerIndex,
      playerProgress: this.progress(),
      roundWinnerIndex: this.roundWinnerIndex,
      roundsToWin,
      startPositions: this.startPositions.map((position) => ({ ...position })),
      trailCells: [...this.trails].map(([key, playerIndex]) => {
        const [x, y] = parseTile(key);
        return { x, y, playerIndex };
      }),
      roundWinMillis: this.phase === "round-win" ? Math.max(0, roundWinAnimationMillis - (this.nowMillis - this.roundTransitionAtMillis)) : 0,
      gameWinMillis: this.phase === "finished" ? Math.min(gameWinAnimationMillis, Math.max(0, this.nowMillis - (this.finishedAtMillis ?? this.nowMillis))) : 0
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.startPositions = estelaStartPositions(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones(), this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Todos en posición", nowMillis);
    } else if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a tu color", nowMillis);
    } else if (transition === "started") {
      this.phase = "running";
      this.resetRound(nowMillis);
      this.lastEvent = gameEvent("start", "¡Deja tu estela!", nowMillis);
    } else return [];
    return [this.lastEvent];
  }

  private arenaInset(): number {
    if (this.phase !== "running") return 0;
    const interval = shrinkIntervals[this.config.difficulty] ?? shrinkIntervals.medium!;
    return Math.min(4, Math.floor(Math.max(0, this.nowMillis - this.roundStartedAtMillis) / interval));
  }

  private eliminate(playerIndex: number, atMillis: number): GameEvent[] {
    if (!this.alive[playerIndex]) return [];
    this.alive[playerIndex] = false;
    const event = gameEvent("miss", `${this.playerLabel(playerIndex)} queda fuera`, atMillis);
    this.lastEvent = event;
    if (this.alive.filter(Boolean).length <= 1) {
      const winnerIndex = this.alive.findIndex(Boolean);
      if (winnerIndex >= 0) {
        this.roundWinnerIndex = winnerIndex;
        this.roundWins[winnerIndex] = (this.roundWins[winnerIndex] ?? 0) + 1;
        this.players = this.scoredPlayers();
        this.phase = "round-win";
        this.roundTransitionAtMillis = atMillis;
        this.lastEvent = gameEvent("round-win", `Ronda para ${this.playerLabel(winnerIndex)}`, atMillis);
        return [event, this.lastEvent];
      }
    }
    this.players = this.scoredPlayers();
    return [event];
  }

  private inArena(x: number, y: number): boolean {
    const inset = this.arenaInset();
    return x >= inset && x < FLOOR_COLS - inset && y >= inset && y < FLOOR_ROWS - inset;
  }

  private nearestAlivePlayer(x: number, y: number): number {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.currentPositions.forEach((position, index) => {
      if (!this.alive[index]) return;
      const distance = Math.abs(position.x - x) + Math.abs(position.y - y);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  private playerLabel(index: number): string {
    return this.players[index]?.label ?? `Jugador ${index + 1}`;
  }

  private progress(): EstelaPlayerProgress[] {
    return this.players.map((player, index) => ({
      index,
      label: player.label,
      color: player.color,
      alive: this.alive[index] ?? false,
      roundWins: this.roundWins[index] ?? 0,
      trailLength: [...this.trails.values()].filter((owner) => owner === index).length
    }));
  }

  private readyZones(): PlayerReadyZone[] {
    return this.startPositions.map(({ x, y }) => ({
      minX: Math.max(0, x - 1), maxX: Math.min(FLOOR_COLS - 1, x + 1),
      minY: Math.max(0, y - 1), maxY: Math.min(FLOOR_ROWS - 1, y + 1)
    }));
  }

  private resetRound(nowMillis: number): void {
    this.alive = this.startPositions.map(() => true);
    this.currentPositions = this.startPositions.map((position) => ({ ...position }));
    this.roundStartedAtMillis = nowMillis;
    this.roundWinnerIndex = -1;
    this.trails.clear();
    this.startPositions.forEach((position, index) => this.trails.set(tileKey(position.x, position.y), index));
    this.players = this.scoredPlayers();
  }

  private resetState(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.currentRound = 1;
    this.finishedAtMillis = undefined;
    this.gameWinnerIndex = -1;
    this.lastEvent = gameEvent("ready", "Busca tu plataforma de color", nowMillis);
    this.nowMillis = nowMillis;
    this.phase = "waiting";
    this.roundTransitionAtMillis = 0;
    this.roundWins = this.startPositions.map(() => 0);
    this.players = defaultPlayers(this.config.playerCount, this.config.players).map((player, index) => ({
      ...player,
      label: this.config.players[index]?.label || this.config.players[index]?.name || `Jugador ${index + 1}`,
      color: this.config.players[index]?.color ?? playerColors[index] ?? "#ffffff",
      lives: -1,
      score: 0
    }));
    this.resetRound(nowMillis);
  }

  private scoredPlayers(): GamePlayer[] {
    return this.players.map((player, index) => ({ ...player, score: this.roundWins[index] ?? 0, lives: -1 }));
  }
}

function tileKey(x: number, y: number): string { return `${x},${y}`; }
function parseTile(key: string): [number, number] {
  const [x = "0", y = "0"] = key.split(",");
  return [Number(x), Number(y)];
}
