import {
  FLOOR_COLS,
  FLOOR_ROWS,
  clamp,
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

export const ballColor: HexColor = "#ffffff";
export const paddleColor: HexColor = "#35d7ff";
export const brickColors: HexColor[] = ["#ff3151", "#ff8a2a", "#ffd45f", "#74e58d"];

const backgroundColor: HexColor = "#03070c";
const controlZoneColor: HexColor = "#06101d";
const controlMarkerColor: HexColor = "#145cff";
const missLineColor: HexColor = "#37101a";
const paddleMissColor: HexColor = "#ff3151";
const successColor: HexColor = "#74e58d";
const trailColors: HexColor[] = ["#9ddfff", "#4b91b8", "#21445b"];
const brickRows = 4;
const brickWidth = 2;
const brickStartY = 3;
const paddleWidth = 5;
const paddleY = 29;
const controlZoneStartY = 24;
const startingLives = 3;
const maxCatchUpMoves = 12;

export type ArkanoidPosition = {
  x: number;
  y: number;
};

export type ArkanoidBall = ArkanoidPosition & {
  dx: -1 | 1;
  dy: -1 | 1;
};

export type ArkanoidSnapshot = GameSnapshot & {
  ball: ArkanoidBall;
  ballMoves: number;
  ballSpeed: number;
  bricksRemaining: number;
  launched: boolean;
  paddleWidth: number;
  paddleX: number;
  totalBricks: number;
};

export type ArkanoidGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): ArkanoidSnapshot;
};

type Brick = {
  alive: boolean;
  color: HexColor;
  id: number;
  width: number;
  x: number;
  y: number;
};

export function createGame(config: GameConfig): ArkanoidGameInstance {
  return new ArkanoidGame(config);
}

class ArkanoidGame implements ArkanoidGameInstance {
  private ball: ArkanoidBall = { x: 7, y: paddleY - 1, dx: 1, dy: -1 };
  private ballMoves = 0;
  private ballTrail: ArkanoidPosition[] = [];
  private bricks: Brick[] = [];
  private config: NormalizedGameConfig;
  private lastControlX = 7;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);
  private lastMoveMillis = 0;
  private lives = startingLives;
  private nowMillis = 0;
  private paddleX = Math.floor((FLOOR_COLS - paddleWidth) / 2);
  private phase: GamePhase = "ready";
  private players: GamePlayer[] = [];
  private rng: SeededRng;
  private readyGate: PlayerReadyGate;
  private score = 0;
  private startedAtMillis = 0;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyGate = createPlayerReadyGate(manifest.start, [{
      minX: 0,
      maxX: FLOOR_COLS - 1,
      minY: controlZoneStartY,
      maxY: FLOOR_ROWS - 1
    }], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.nowMillis = nowMillis;
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.attachBall();
    this.lastEvent = gameEvent("ready", "Esperando jugador abajo", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (event.y < controlZoneStartY || event.y >= FLOOR_ROWS) {
      return [];
    }

    if (event.pressed) {
      this.movePaddle(event.x);
    }
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }
    if (this.phase === "ready" && event.pressed) {
      return this.launchBall(event.atMillis);
    }
    return [];
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
    if (this.phase !== "running") {
      return [];
    }

    const events: GameEvent[] = [];
    const interval = moveIntervalForDifficulty(this.config.difficulty);
    for (let moves = 0; moves < maxCatchUpMoves; moves += 1) {
      if (event.atMillis - this.lastMoveMillis < interval) {
        break;
      }

      this.lastMoveMillis += interval;
      const nextEvent = this.moveBall(this.lastMoveMillis);
      if (nextEvent) {
        events.push(nextEvent);
      }
      if (this.phase !== "running") {
        break;
      }
    }

    return this.recordEvents(events);
  }

  render(): Frame {
    const frame = createFrame(backgroundColor);
    fillFrameRect(frame, 0, controlZoneStartY, FLOOR_COLS, FLOOR_ROWS - controlZoneStartY, controlZoneColor);
    fillFrameRect(frame, 0, FLOOR_ROWS - 1, FLOOR_COLS, 1, missLineColor);

    for (const brick of this.bricks) {
      if (brick.alive) {
        fillFrameRect(frame, brick.x, brick.y, brick.width, 1, brick.color);
      }
    }

    if (this.phase === "waiting" || this.phase === "starting") {
      this.drawPlayerStart(frame);
    }

    if (this.phase === "finished" && this.score === this.bricks.length) {
      drawSuccessFrame(frame);
    }

    this.ballTrail.forEach((position, index) => {
      const color = trailColors[index];
      if (color) {
        paintFrameCell(frame, position.x, position.y, color);
      }
    });

    if (this.phase !== "finished" || this.lives > 0) {
      paintFrameCell(frame, this.ball.x, this.ball.y, ballColor);
    }
    fillFrameRect(
      frame,
      this.paddleX,
      paddleY,
      paddleWidth,
      1,
      this.phase === "finished" && this.lives === 0 ? paddleMissColor : paddleColor
    );
    paintFrameCell(frame, this.lastControlX, FLOOR_ROWS - 1, controlMarkerColor);
    return frame;
  }

  snapshot(): ArkanoidSnapshot {
    const remaining = this.bricksRemaining();
    const readyState = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.score,
      lives: this.lives,
      elapsedMillis: Math.max(0, this.nowMillis - this.startedAtMillis),
      remainingMillis: 0,
      activeTargets: remaining,
      success: remaining === 0,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: this.bricks.length,
      ball: { ...this.ball },
      ballMoves: this.ballMoves,
      ballSpeed: 1000 / moveIntervalForDifficulty(this.config.difficulty),
      bricksRemaining: remaining,
      launched: this.phase === "running",
      paddleWidth,
      paddleX: this.paddleX,
      totalBricks: this.bricks.length
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.resetState(this.config.nowMillis);
  }

  private applyReadyTransition(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.lastEvent = gameEvent("ready", "Jugador listo", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.lastEvent = gameEvent("ready", "Vuelve a la zona iluminada", nowMillis);
      return [this.lastEvent];
    }
    if (transition === "started") {
      return this.launchBall(nowMillis);
    }
    return [];
  }

  private launchBall(nowMillis: number): GameEvent[] {
    const firstLaunch = this.phase === "waiting" || this.phase === "starting";
    this.phase = "running";
    if (firstLaunch) {
      this.startedAtMillis = nowMillis;
    }
    this.ball = {
      x: this.paddleCenter(),
      y: paddleY - 1,
      dx: this.rng.next() < 0.5 ? -1 : 1,
      dy: -1
    };
    this.ballTrail = [];
    this.lastMoveMillis = nowMillis;
    this.lastEvent = gameEvent("start", "Pelota en juego", nowMillis);
    return [this.lastEvent];
  }

  private attachBall(): void {
    this.ball = { x: this.paddleCenter(), y: paddleY - 1, dx: this.ball.dx, dy: -1 };
    this.ballTrail = [];
  }

  private brickAt(x: number, y: number): Brick | undefined {
    return this.bricks.find((brick) => brick.alive && brick.y === y && x >= brick.x && x < brick.x + brick.width);
  }

  private bricksRemaining(): number {
    return this.bricks.reduce((count, brick) => count + Number(brick.alive), 0);
  }

  private commitBall(next: ArkanoidBall): void {
    this.ballTrail = [{ x: this.ball.x, y: this.ball.y }, ...this.ballTrail].slice(0, trailColors.length);
    this.ball = next;
    this.ballMoves += 1;
  }

  private loseLife(nowMillis: number): GameEvent {
    this.lives -= 1;
    this.players = this.scoredPlayers();
    this.ballTrail = [];
    if (this.lives <= 0) {
      this.phase = "finished";
      return gameEvent("fail", "Sin vidas", nowMillis);
    }

    this.phase = "ready";
    this.attachBall();
    return gameEvent("fail", "Vida perdida, pisa abajo para lanzar", nowMillis);
  }

  private moveBall(nowMillis: number): GameEvent | undefined {
    let dx = this.ball.dx;
    let dy = this.ball.dy;
    let nextX = this.ball.x + dx;
    let nextY = this.ball.y + dy;

    if (nextX < 0 || nextX >= FLOOR_COLS) {
      dx = dx === 1 ? -1 : 1;
      nextX = this.ball.x + dx;
    }
    if (nextY < 1) {
      dy = 1;
      nextY = this.ball.y + dy;
    }

    const brick = this.brickAt(nextX, nextY);
    if (brick) {
      brick.alive = false;
      this.score += 1;
      this.players = this.scoredPlayers();
      this.ball = { ...this.ball, dx, dy: dy === 1 ? -1 : 1 };
      this.ballMoves += 1;
      if (this.bricksRemaining() === 0) {
        this.phase = "finished";
        return gameEvent("win", "Muro completado", nowMillis);
      }
      return gameEvent("hit", `Bloque ${this.score} de ${this.bricks.length}`, nowMillis);
    }

    if (dy > 0 && nextY === paddleY) {
      if (nextX >= this.paddleX && nextX < this.paddleX + paddleWidth) {
        const offset = nextX - this.paddleCenter();
        if (offset < 0) {
          dx = -1;
        } else if (offset > 0) {
          dx = 1;
        } else {
          dx = this.rng.next() < 0.5 ? -1 : 1;
        }
        if (Math.abs(offset) === 1 && this.rng.next() < 0.35) {
          dx = dx === 1 ? -1 : 1;
        }
        this.commitBall({ x: nextX, y: paddleY - 1, dx, dy: -1 });
        return gameEvent("coin", "Rebote", nowMillis);
      }
    }

    if (nextY >= FLOOR_ROWS) {
      return this.loseLife(nowMillis);
    }

    this.commitBall({ x: nextX, y: nextY, dx, dy });
    return undefined;
  }

  private movePaddle(x: number): void {
    const half = Math.floor(paddleWidth / 2);
    const center = clamp(Math.round(x), half, FLOOR_COLS - 1 - half);
    this.paddleX = center - half;
    this.lastControlX = clamp(Math.round(x), 0, FLOOR_COLS - 1);
    if (this.phase === "ready" || this.phase === "waiting" || this.phase === "starting") {
      this.attachBall();
    }
  }

  private drawPlayerStart(frame: Frame): void {
    if (this.phase === "waiting") {
      const scanY = controlZoneStartY + Math.floor(this.nowMillis / 150) % (FLOOR_ROWS - controlZoneStartY);
      for (let y = controlZoneStartY; y < FLOOR_ROWS; y += 1) {
        for (let x = 0; x < FLOOR_COLS; x += 1) {
          if (y === scanY || x === 0 || x === FLOOR_COLS - 1) {
            paintFrameCell(frame, x, y, y === scanY ? "#35d7ff" : "#0b4260");
          }
        }
      }
      return;
    }

    const pulse = Math.floor(this.nowMillis / 125) % 4;
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        if ((Math.abs(x - this.paddleCenter()) + Math.abs(y - paddleY) + pulse) % 6 === 0) {
          paintFrameCell(frame, x, y, y >= controlZoneStartY ? "#ffe176" : "#176783");
        }
      }
    }
  }

  private paddleCenter(): number {
    return this.paddleX + Math.floor(paddleWidth / 2);
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    if (events.length > 0) {
      this.lastEvent = events[events.length - 1];
    }
    return events;
  }

  private resetState(nowMillis: number): void {
    this.bricks = createBricks();
    this.lives = startingLives;
    this.nowMillis = nowMillis;
    this.startedAtMillis = nowMillis;
    this.lastMoveMillis = nowMillis;
    this.paddleX = Math.floor((FLOOR_COLS - paddleWidth) / 2);
    this.lastControlX = this.paddleCenter();
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.score = 0;
    this.ballMoves = 0;
    this.ball = { x: this.paddleCenter(), y: paddleY - 1, dx: 1, dy: -1 };
    this.ballTrail = [];
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent("ready", "Esperando jugador abajo", nowMillis);
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      lives: this.lives,
      score: this.score
    }));
  }
}

function createBricks(): Brick[] {
  const bricks: Brick[] = [];
  let id = 0;
  for (let row = 0; row < brickRows; row += 1) {
    for (let x = 0; x < FLOOR_COLS; x += brickWidth) {
      bricks.push({
        alive: true,
        color: brickColors[row] ?? brickColors[0],
        id,
        width: brickWidth,
        x,
        y: brickStartY + row
      });
      id += 1;
    }
  }
  return bricks;
}

function drawSuccessFrame(frame: Frame): void {
  fillFrameRect(frame, 2, 13, FLOOR_COLS - 4, 1, successColor);
  fillFrameRect(frame, 2, 19, FLOOR_COLS - 4, 1, successColor);
  fillFrameRect(frame, 2, 13, 1, 7, successColor);
  fillFrameRect(frame, FLOOR_COLS - 3, 13, 1, 7, successColor);
  paintFrameCell(frame, 5, 16, successColor);
  paintFrameCell(frame, 6, 17, successColor);
  paintFrameCell(frame, 7, 18, successColor);
  paintFrameCell(frame, 8, 17, successColor);
  paintFrameCell(frame, 9, 16, successColor);
  paintFrameCell(frame, 10, 15, successColor);
}

function moveIntervalForDifficulty(difficulty: string): number {
  switch (difficulty) {
    case "easy":
      return 240;
    case "hard":
      return 150;
    case "expert":
      return 120;
    default:
      return 190;
  }
}
