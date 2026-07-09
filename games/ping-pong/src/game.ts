import {
  FLOOR_COLS,
  FLOOR_ROWS,
  addRgb,
  clamp,
  createFrame,
  createSeededRng,
  fillFrameRect,
  gameEvent,
  normalizeGameConfig,
  paintFrameCell,
  readClampedIntegerOption,
  rgbToHex,
  scaleRgb,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GamePlayer,
  type GameRoundSnapshot,
  type GameSnapshot,
  type HexColor,
  type NormalizedGameConfig,
  type PressEvent,
  type RgbColor,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest } from "./manifest.ts";

export const redColor: HexColor = "#ff1c28";
export const blueColor: HexColor = "#145cff";
export const ballColor: HexColor = "#ffffff";

const idleColor: HexColor = "#05070a";
const redRgb: RgbColor = { r: 255, g: 28, b: 40 };
const blueRgb: RgbColor = { r: 20, g: 92, b: 255 };
const whiteRgb: RgbColor = { r: 255, g: 255, b: 255 };

const defaultWinningScore = 5;
const readyAnimationMillis = 2000;
const startGraceMillis = 1000;
const postPointPauseMillis = 900;
const winAnimationMillis = 3000;
const paddleYRed = 2;
const paddleYBlue = 29;
const paddleWidth = 5;
const serveX = Math.floor(FLOOR_COLS / 2);
const serveY = Math.floor(FLOOR_ROWS / 2);
const speedStepMillis = 4.5;

type PingPongPhase = "waiting" | "starting" | "running" | "finished";
type TeamIndex = 0 | 1;

export type PingPongSnapshot = GameSnapshot & {
  phase: PingPongPhase;
  countdownMillis: number;
  matchTarget: number;
  roundHits: number;
  lastRoundHits: number;
  lastRoundWinner: string;
  rounds: GameRoundSnapshot[];
};

type Ball = {
  x: number;
  y: number;
  dx: -1 | 1;
  dy: -1 | 1;
};

type SpeedSettings = {
  initialMillis: number;
  minimumMillis: number;
};

export function createGame(config: GameConfig): GameInstance {
  return new PingPongGame(config);
}

class PingPongGame implements GameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private players: GamePlayer[];
  private winningScore = defaultWinningScore;
  private speed: SpeedSettings;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private readyAtMillis = 0;
  private lastStepMillis = 0;
  private pauseUntilMillis = 0;
  private finishAtMillis = 0;
  private currentIntervalMillis = 140;
  private hitCount = 0;
  private redPaddleX = 0;
  private bluePaddleX = 0;
  private ball: Ball = { x: serveX, y: serveY, dx: 1, dy: 1 };
  private teamScore: [number, number] = [0, 0];
  private tileHeld = Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, () => false);
  private halfHeld: [number, number] = [0, 0];
  private halfGraceUntil: [number, number] = [0, 0];
  private rounds: GameRoundSnapshot[] = [];
  private lastRoundHits = 0;
  private lastRoundWinner = "";
  private phase: PingPongPhase = "waiting";
  private success = false;
  private scorer: TeamIndex | -1 = -1;
  private winner: TeamIndex | -1 = -1;
  private lastEvent: GameEvent = gameEvent("none", "Ready", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.players = this.createPlayers();
    this.winningScore = this.readWinningScore();
    this.speed = speedForDifficulty(this.config.difficulty);
    this.resetGame(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.startedAtMillis = nowMillis;
    this.nowMillis = nowMillis;
    this.resetGame(nowMillis);
    this.lastEvent = gameEvent("ready", "Ping Pong espera rojo y azul.", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupancy(event.x, event.y, event.pressed, event.atMillis);

    if (event.pressed) {
      this.movePaddle(event.x, event.y);
    }

    return this.recordEvents(this.updatePhase(event.atMillis));
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.updateOccupancy(event.x, event.y, false, event.atMillis);
    return this.recordEvents(this.updatePhase(event.atMillis));
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const events = this.updatePhase(event.atMillis);

    if (this.phase !== "running" || event.atMillis < this.pauseUntilMillis) {
      return this.recordEvents(events);
    }

    for (let steps = 0; steps < 8; steps += 1) {
      if (event.atMillis - this.lastStepMillis < this.currentIntervalMillis) {
        break;
      }

      this.lastStepMillis += this.currentIntervalMillis;
      const nextEvent = this.moveBall(this.lastStepMillis);
      if (nextEvent) {
        events.push(nextEvent);
      }
      if (this.phase !== "running" || this.lastStepMillis < this.pauseUntilMillis) {
        break;
      }
    }

    return this.recordEvents(events);
  }

  render(): Frame {
    const frame = createFrame(idleColor);

    if (this.phase === "waiting") {
      this.drawWaiting(frame);
      return frame;
    }
    if (this.phase === "starting") {
      this.drawReady(frame);
      return frame;
    }
    if (this.phase === "finished") {
      this.drawWin(frame);
      return frame;
    }

    this.drawScore(frame);
    this.drawPaddles(frame);
    if (this.nowMillis < this.pauseUntilMillis) {
      this.drawScoreFlash(frame);
    } else {
      paintFrameCell(frame, this.ball.x, this.ball.y, ballColor);
    }

    return frame;
  }

  snapshot(): PingPongSnapshot {
    this.recordEvents(this.updatePhase(this.nowMillis));
    const countdownMillis =
      this.phase === "starting" && this.nowMillis < this.readyAtMillis
        ? this.readyAtMillis - this.nowMillis
        : 0;
    const remainingMillis =
      this.phase === "finished" && this.nowMillis < this.finishAtMillis + winAnimationMillis
        ? this.finishAtMillis + winAnimationMillis - this.nowMillis
        : 0;

    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: [
        {
          index: 0,
          label: this.labelForTeam(0),
          color: redColor,
          score: this.teamScore[0],
          lives: this.winningScore - this.teamScore[0]
        },
        {
          index: 1,
          label: this.labelForTeam(1),
          color: blueColor,
          score: this.teamScore[1],
          lives: this.winningScore - this.teamScore[1]
        }
      ],
      score: this.teamScore[0] + this.teamScore[1],
      lives: -1,
      elapsedMillis: Math.max(0, this.nowMillis - this.startedAtMillis),
      remainingMillis,
      activeTargets: this.activeHalves(this.nowMillis),
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis,
      matchTarget: this.winningScore,
      roundHits: this.hitCount,
      lastRoundHits: this.lastRoundHits,
      lastRoundWinner: this.lastRoundWinner,
      rounds: this.rounds
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.players = this.createPlayers();
    this.winningScore = this.readWinningScore();
    this.speed = speedForDifficulty(this.config.difficulty);
    this.resetGame(this.config.nowMillis);
    this.lastEvent = gameEvent("none", "Ready", this.config.nowMillis);
  }

  private createPlayers(): GamePlayer[] {
    return [
      { index: 0, label: "Rojo", color: redColor, score: 0, lives: this.winningScore ?? defaultWinningScore },
      { index: 1, label: "Azul", color: blueColor, score: 0, lives: this.winningScore ?? defaultWinningScore }
    ];
  }

  private readWinningScore(): number {
    return readClampedIntegerOption(this.config.options, "points_to_win", defaultWinningScore, 1, 21);
  }

  private resetGame(nowMillis: number): void {
    this.tileHeld = this.tileHeld.map(() => false);
    this.halfHeld = [0, 0];
    this.halfGraceUntil = [0, 0];
    this.teamScore = [0, 0];
    this.rounds = [];
    this.lastRoundHits = 0;
    this.lastRoundWinner = "";
    this.redPaddleX = Math.floor((FLOOR_COLS - paddleWidth) / 2);
    this.bluePaddleX = this.redPaddleX;
    this.phase = "waiting";
    this.success = false;
    this.scorer = -1;
    this.winner = -1;
    this.startedAtMillis = nowMillis;
    this.readyAtMillis = 0;
    this.finishAtMillis = 0;
    this.resetBall();
    this.lastEvent = gameEvent("none", "Esperando a rojo arriba y azul abajo.", nowMillis);
  }

  private updatePhase(nowMillis: number): GameEvent[] {
    if (this.phase === "finished") {
      if (nowMillis - this.finishAtMillis >= winAnimationMillis) {
        this.resetGame(nowMillis);
        return [gameEvent("ready", "Nueva partida.", nowMillis)];
      }
      return [];
    }

    if (this.phase === "waiting" && this.halvesReady(nowMillis)) {
      this.phase = "starting";
      this.readyAtMillis = nowMillis + readyAnimationMillis;
      return [gameEvent("start", "Rojo y azul listos.", nowMillis)];
    }

    if (this.phase === "starting" && nowMillis >= this.readyAtMillis) {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastStepMillis = nowMillis;
      this.serve();
      return [gameEvent("start", "La pelota esta en juego.", nowMillis)];
    }

    return [];
  }

  private updateOccupancy(x: number, y: number, pressed: boolean, nowMillis: number): void {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= FLOOR_COLS || y < 0 || y >= FLOOR_ROWS) {
      return;
    }

    const index = y * FLOOR_COLS + x;
    if (this.tileHeld[index] === pressed) {
      return;
    }

    this.tileHeld[index] = pressed;
    const half = halfForY(y);
    if (pressed) {
      this.halfHeld[half] += 1;
      this.halfGraceUntil[half] = nowMillis + startGraceMillis;
    } else if (this.halfHeld[half] > 0) {
      this.halfHeld[half] -= 1;
      if (this.halfHeld[half] === 0) {
        this.halfGraceUntil[half] = nowMillis + startGraceMillis;
      }
    }
  }

  private movePaddle(x: number, y: number): void {
    const center = clamp(Math.round(x), Math.floor(paddleWidth / 2), FLOOR_COLS - 1 - Math.floor(paddleWidth / 2));
    const left = center - Math.floor(paddleWidth / 2);

    if (y < FLOOR_ROWS / 2) {
      this.redPaddleX = left;
    } else {
      this.bluePaddleX = left;
    }
  }

  private moveBall(nowMillis: number): GameEvent | undefined {
    let nextX = this.ball.x + this.ball.dx;
    const nextY = this.ball.y + this.ball.dy;

    if (nextX < 0) {
      nextX = 0;
      this.ball.dx = 1;
    }
    if (nextX >= FLOOR_COLS) {
      nextX = FLOOR_COLS - 1;
      this.ball.dx = -1;
    }

    if (this.ball.dy < 0 && nextY === paddleYRed && nextX >= this.redPaddleX && nextX < this.redPaddleX + paddleWidth) {
      this.reflectFromPaddle(nextX, this.redPaddleX);
      this.ball = { ...this.ball, x: nextX, y: paddleYRed + 1, dy: 1 };
      this.accelerate();
      return gameEvent("coin", "Rojo devuelve.", nowMillis);
    }

    if (this.ball.dy > 0 && nextY === paddleYBlue && nextX >= this.bluePaddleX && nextX < this.bluePaddleX + paddleWidth) {
      this.reflectFromPaddle(nextX, this.bluePaddleX);
      this.ball = { ...this.ball, x: nextX, y: paddleYBlue - 1, dy: -1 };
      this.accelerate();
      return gameEvent("coin", "Azul devuelve.", nowMillis);
    }

    if (nextY < 0) {
      this.scorePoint(1, nowMillis);
      return gameEvent("score", "Punto para azul.", nowMillis);
    }
    if (nextY >= FLOOR_ROWS) {
      this.scorePoint(0, nowMillis);
      return gameEvent("score", "Punto para rojo.", nowMillis);
    }

    this.ball = { ...this.ball, x: nextX, y: nextY };
    return undefined;
  }

  private scorePoint(team: TeamIndex, nowMillis: number): void {
    this.teamScore[team] += 1;
    this.scorer = team;
    this.recordRound(team);

    if (this.teamScore[team] >= this.winningScore) {
      this.phase = "finished";
      this.success = team === 1;
      this.winner = team;
      this.finishAtMillis = nowMillis;
      return;
    }

    this.resetBall();
    this.pauseUntilMillis = nowMillis + postPointPauseMillis;
    this.lastStepMillis = this.pauseUntilMillis;
  }

  private recordRound(team: TeamIndex): void {
    this.lastRoundHits = this.hitCount;
    this.lastRoundWinner = this.labelForTeam(team);
    this.rounds = [
      ...this.rounds,
      {
        index: this.rounds.length + 1,
        winnerIndex: team,
        winnerLabel: this.lastRoundWinner,
        hits: this.lastRoundHits
      }
    ];
  }

  private resetBall(): void {
    this.ball = { ...this.ball, x: serveX, y: serveY };
    this.currentIntervalMillis = this.speed.initialMillis;
    this.hitCount = 0;
    this.pauseUntilMillis = 0;
    this.serve();
  }

  private serve(): void {
    this.ball = {
      x: serveX,
      y: serveY,
      dy: this.rng.int(2) === 0 ? -1 : 1,
      dx: this.rng.int(2) === 0 ? -1 : 1
    };
  }

  private reflectFromPaddle(x: number, paddleX: number): void {
    const center = paddleX + Math.floor(paddleWidth / 2);
    if (x < center) {
      this.ball.dx = -1;
    } else if (x > center) {
      this.ball.dx = 1;
    } else {
      this.ball.dx = this.rng.int(2) === 0 ? -1 : 1;
    }
  }

  private accelerate(): void {
    this.hitCount += 1;
    this.currentIntervalMillis = Math.max(this.speed.minimumMillis, this.speed.initialMillis - this.hitCount * speedStepMillis);
  }

  private drawWaiting(frame: Frame): void {
    const pulse = Math.floor(this.nowMillis / 180) % 4;
    const redReady = this.halfReady(0, this.nowMillis);
    const blueReady = this.halfReady(1, this.nowMillis);

    this.drawWaitingHalf(frame, 0, redReady);
    this.drawWaitingHalf(frame, 1, blueReady);

    if (redReady) {
      this.drawSoftBar(frame, 3, 5, 10, redRgb);
    } else {
      this.drawOutline(frame, 2 + pulse, 4 + pulse, FLOOR_COLS - 4 - pulse * 2, 6, redColor);
    }
    if (blueReady) {
      this.drawSoftBar(frame, 3, 24, 10, blueRgb);
    } else {
      this.drawOutline(frame, 2 + pulse, 22 - pulse, FLOOR_COLS - 4 - pulse * 2, 6, blueColor);
    }
  }

  private drawReady(frame: Frame): void {
    const elapsed = Math.max(0, this.nowMillis - (this.readyAtMillis - readyAnimationMillis));
    const radius = clamp(Math.floor((elapsed * (FLOOR_COLS / 2)) / readyAnimationMillis), 1, FLOOR_COLS / 2);
    const wave = Math.floor(elapsed / 90);

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const dist = Math.abs(x - serveX) + Math.abs(y - serveY);
        const base = y >= FLOOR_ROWS / 2 ? blueRgb : redRgb;
        if (dist <= radius + 1) {
          const level = 35 + (radius - dist + 1) * 18;
          paintFrameCell(frame, x, y, mix(base, level, Math.max(0, 22 - dist * 3)));
        } else if ((dist + wave) % 7 === 0) {
          paintFrameCell(frame, x, y, tint(base, 24));
        }
      }
    }

    paintFrameCell(frame, serveX, serveY, ballColor);
  }

  private drawScoreFlash(frame: Frame): void {
    const base = this.scorer === 1 ? blueRgb : redRgb;
    const wave = Math.floor((this.pauseUntilMillis - this.nowMillis) / 90) % 5;

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const dist = Math.abs(y - serveY);
        if ((x + y + wave) % 5 === 0) {
          paintFrameCell(frame, x, y, mix(base, 38 + dist * 3, Math.max(0, 18 - dist)));
        } else if (dist < 4) {
          paintFrameCell(frame, x, y, tint(base, 14));
        }
      }
    }

    this.drawPaddles(frame);
  }

  private drawWin(frame: Frame): void {
    const base = this.winner === 1 ? blueRgb : redRgb;
    const phaseStep = Math.floor(this.nowMillis / 90) % 16;

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const dist = Math.abs(x - serveX) + Math.abs(y - serveY);
        const band = (dist + phaseStep) % 12;
        if (band < 5) {
          paintFrameCell(frame, x, y, mix(base, 28 + (5 - band) * 16, Math.max(0, 26 - band * 4)));
        } else if ((x + y + phaseStep) % 9 === 0) {
          paintFrameCell(frame, x, y, tint(base, 34));
        }
      }
    }

    fillFrameRect(frame, serveX - 1, serveY - 1, 3, 3, tint(whiteRgb, 85));
    paintFrameCell(frame, serveX, serveY, ballColor);
  }

  private drawScore(frame: Frame): void {
    for (let x = 0; x < this.teamScore[0] && x < FLOOR_COLS; x += 1) {
      paintFrameCell(frame, x, 0, redColor);
    }
    for (let x = 0; x < this.teamScore[1] && x < FLOOR_COLS; x += 1) {
      paintFrameCell(frame, x, FLOOR_ROWS - 1, blueColor);
    }
  }

  private drawPaddles(frame: Frame): void {
    this.drawPaddle(frame, this.redPaddleX, paddleYRed, redRgb);
    this.drawPaddle(frame, this.bluePaddleX, paddleYBlue, blueRgb);
  }

  private drawWaitingHalf(frame: Frame, half: TeamIndex, ready: boolean): void {
    const startY = half === 1 ? FLOOR_ROWS / 2 : 0;
    const base = half === 1 ? blueRgb : redRgb;
    const pulse = Math.floor(this.nowMillis / 120) % 10;

    for (let y = startY; y < startY + FLOOR_ROWS / 2; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        let level = 0;
        if (ready) {
          level = 18 + ((x + y + pulse) % 6) * 6;
        } else if ((x + y + pulse) % 7 === 0) {
          level = 22;
        }
        if (level > 0) {
          paintFrameCell(frame, x, y, tint(base, level));
        }
      }
    }
  }

  private drawSoftBar(frame: Frame, x: number, y: number, width: number, base: RgbColor): void {
    const pulse = Math.floor(this.nowMillis / 100) % 6;

    for (let offset = 0; offset < width; offset += 1) {
      const level = offset === pulse || offset === width - 1 - pulse ? 112 : 58 + offset * 4;
      paintFrameCell(frame, x + offset, y, tint(base, level));
      paintFrameCell(frame, x + offset, y + 1, mix(base, level - 8, 10));
      paintFrameCell(frame, x + offset, y + 2, tint(base, Math.max(18, level - 28)));
    }
  }

  private drawPaddle(frame: Frame, x: number, y: number, base: RgbColor): void {
    for (let offset = 0; offset < paddleWidth; offset += 1) {
      const level = offset === Math.floor(paddleWidth / 2) ? 118 : 74;
      paintFrameCell(frame, x + offset, y, mix(base, level, 18));
    }
  }

  private drawOutline(frame: Frame, x: number, y: number, width: number, height: number, color: HexColor): void {
    const safeWidth = Math.max(2, Math.round(width));
    const safeHeight = Math.max(2, Math.round(height));

    fillFrameRect(frame, x, y, safeWidth, 1, color);
    fillFrameRect(frame, x, y + safeHeight - 1, safeWidth, 1, color);
    fillFrameRect(frame, x, y, 1, safeHeight, color);
    fillFrameRect(frame, x + safeWidth - 1, y, 1, safeHeight, color);
  }

  private halvesReady(nowMillis: number): boolean {
    return this.halfReady(0, nowMillis) && this.halfReady(1, nowMillis);
  }

  private halfReady(half: TeamIndex, nowMillis: number): boolean {
    return this.halfHeld[half] > 0 || (this.halfGraceUntil[half] > 0 && nowMillis <= this.halfGraceUntil[half]);
  }

  private activeHalves(nowMillis: number): number {
    return Number(this.halfReady(0, nowMillis)) + Number(this.halfReady(1, nowMillis));
  }

  private labelForTeam(team: TeamIndex): string {
    return this.players[team]?.label || (team === 0 ? "Rojo" : "Azul");
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    if (events.length > 0) {
      this.lastEvent = events[events.length - 1];
    }
    return events;
  }
}

function halfForY(y: number): TeamIndex {
  return y < FLOOR_ROWS / 2 ? 0 : 1;
}

function speedForDifficulty(value: string): SpeedSettings {
  switch (value) {
    case "easy":
      return { initialMillis: 180, minimumMillis: 72 };
    case "hard":
    case "expert":
      return { initialMillis: 105, minimumMillis: 42 };
    default:
      return { initialMillis: 140, minimumMillis: 56 };
  }
}

function tint(color: RgbColor, percent: number): HexColor {
  return rgbToHex(scaleRgb(color, percent));
}

function mix(color: RgbColor, colorPercent: number, whitePercent: number): HexColor {
  return rgbToHex(addRgb(scaleRgb(color, colorPercent), scaleRgb(whiteRgb, whitePercent)));
}
