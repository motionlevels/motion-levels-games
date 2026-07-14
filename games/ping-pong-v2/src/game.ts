import {
  FLOOR_COLS,
  FLOOR_ROWS,
  addRgb,
  clamp,
  createFrame,
  createHorizontalPlayerReadyZones,
  createPlayerReadyGate,
  createSeededRng,
  fillFrameRect,
  gameEvent,
  gameStartCountdownMillis,
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
  type GameRoundSnapshot,
  type GameSnapshot,
  type HexColor,
  type NormalizedGameConfig,
  type PlayerReadyGate,
  type PlayerReadyTransition,
  type PressEvent,
  type RgbColor,
  type SeededRng,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest, pingPongV2ConfigVars } from "./manifest.ts";

export const redColor: HexColor = "#ff1c28";
export const blueColor: HexColor = "#145cff";
export const ballColor: HexColor = "#ffffff";

const idleColor: HexColor = "#05070a";
const redRgb: RgbColor = { r: 255, g: 28, b: 40 };
const blueRgb: RgbColor = { r: 20, g: 92, b: 255 };
const whiteRgb: RgbColor = { r: 255, g: 255, b: 255 };

const postPointPauseMillis = 900;
const winAnimationMillis = 3000;
const paddleYRed = 2;
const paddleYBlue = 29;
const paddleWidth = 5;
const serveX = Math.floor(FLOOR_COLS / 2);
const serveY = Math.floor(FLOOR_ROWS / 2);
const maximumSpeedRatio = 2.5;

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
  ball: PingPongBallSnapshot;
  ballTrail: PingPongBallPosition[];
  rallyPace: number;
  pointScorer: number;
  pointFlashMillis: number;
  winnerIndex: number;
  impact: PingPongImpactSnapshot | null;
  motionEventId: number;
  initialBallSpeed: number;
  ballSpeed: number;
  returnSpeedMultiplier: number;
  difficultySpeedFactor: number;
};

export type PingPongBallPosition = {
  x: number;
  y: number;
};

export type PingPongBallSnapshot = PingPongBallPosition & {
  dx: -1 | 1;
  dy: -1 | 1;
};

export type PingPongImpactSnapshot = PingPongBallPosition & {
  team: number;
  remainingMillis: number;
};

export type PingPongGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): PingPongSnapshot;
};

type SpeedSettings = {
  difficultyFactor: number;
  hitMultiplier: number;
  initialTilesPerSecond: number;
  initialMillis: number;
  minimumMillis: number;
};

export function createGame(config: GameConfig): PingPongGameInstance {
  return new PingPongGame(config);
}

class PingPongGame implements PingPongGameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private players: GamePlayer[];
  private winningScore: number;
  private speed: SpeedSettings;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private readyGate: PlayerReadyGate;
  private lastStepMillis = 0;
  private pauseUntilMillis = 0;
  private finishAtMillis = 0;
  private currentIntervalMillis = 140;
  private hitCount = 0;
  private redPaddleX = 0;
  private bluePaddleX = 0;
  private ball: PingPongBallSnapshot = { x: serveX, y: serveY, dx: 1, dy: 1 };
  private ballTrail: PingPongBallPosition[] = [];
  private teamScore: [number, number] = [0, 0];
  private rounds: GameRoundSnapshot[] = [];
  private lastRoundHits = 0;
  private lastRoundWinner = "";
  private phase: PingPongPhase = "waiting";
  private success = false;
  private scorer: TeamIndex | -1 = -1;
  private winner: TeamIndex | -1 = -1;
  private pointAtMillis = 0;
  private lastImpactAtMillis = 0;
  private lastImpact: (PingPongBallPosition & { team: TeamIndex }) | null = null;
  private motionEventId = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyGate = createPlayerReadyGate(manifest.start, createHorizontalPlayerReadyZones(2), this.config.nowMillis);
    this.winningScore = this.readWinningScore();
    this.players = this.createPlayers();
    this.speed = speedForConfig(this.config);
    this.resetGame(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.startedAtMillis = nowMillis;
    this.nowMillis = nowMillis;
    this.resetGame(nowMillis);
    this.lastEvent = gameEvent("ready", "Ping Pong espera rojo y azul", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const readyTransition = this.readyGate.update(event);

    if (event.pressed) {
      this.movePaddle(event.x, event.y);
    }

    return this.recordEvents(this.updatePhase(event.atMillis, readyTransition));
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const readyTransition = this.readyGate.update({ ...event, pressed: false });
    return this.recordEvents(this.updatePhase(event.atMillis, readyTransition));
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const events = this.updatePhase(event.atMillis, this.readyGate.tick(event.atMillis));

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

    this.drawArena(frame);
    this.drawScore(frame);
    if (this.nowMillis < this.pauseUntilMillis) {
      this.drawScoreFlash(frame);
    } else {
      this.drawBallTrail(frame);
      this.drawImpact(frame);
      this.drawPaddles(frame);
      this.drawBallGlow(frame);
      paintFrameCell(frame, this.ball.x, this.ball.y, ballColor);
    }

    return frame;
  }

  snapshot(): PingPongSnapshot {
    this.recordEvents(this.updatePhase(this.nowMillis));
    const readyState = this.readyGate.state(this.nowMillis);
    const countdownMillis = this.phase === "starting" ? readyState.countdownMillis : 0;
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
          lives: -1
        },
        {
          index: 1,
          label: this.labelForTeam(1),
          color: blueColor,
          score: this.teamScore[1],
          lives: -1
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
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: this.winningScore,
      roundHits: this.hitCount,
      lastRoundHits: this.lastRoundHits,
      lastRoundWinner: this.lastRoundWinner,
      rounds: this.rounds,
      ball: { ...this.ball },
      ballTrail: this.ballTrail.map((position) => ({ ...position })),
      rallyPace: this.speed.initialMillis === this.speed.minimumMillis
        ? 1
        : clamp(
            (this.speed.initialMillis - this.currentIntervalMillis) /
              (this.speed.initialMillis - this.speed.minimumMillis),
            0,
            1
          ),
      pointScorer: this.scorer,
      pointFlashMillis: Math.max(0, this.pauseUntilMillis - this.nowMillis),
      winnerIndex: this.winner,
      impact: this.lastImpact && this.nowMillis - this.lastImpactAtMillis < 480
        ? {
            ...this.lastImpact,
            remainingMillis: 480 - (this.nowMillis - this.lastImpactAtMillis)
          }
        : null,
      motionEventId: this.motionEventId,
      initialBallSpeed: this.speed.initialTilesPerSecond,
      ballSpeed: 1000 / this.currentIntervalMillis,
      returnSpeedMultiplier: this.speed.hitMultiplier,
      difficultySpeedFactor: this.speed.difficultyFactor
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.winningScore = this.readWinningScore();
    this.players = this.createPlayers();
    this.speed = speedForConfig(this.config);
    this.motionEventId = 0;
    this.resetGame(this.config.nowMillis);
    this.lastEvent = gameEvent("none", "Listo", this.config.nowMillis);
  }

  private createPlayers(): GamePlayer[] {
    return [
      { index: 0, label: "Rojo", color: redColor, score: 0, lives: -1 },
      { index: 1, label: "Azul", color: blueColor, score: 0, lives: -1 }
    ];
  }

  private readWinningScore(): number {
    return readGameConfigOption(this.config.options, pingPongV2ConfigVars.pointsToWin);
  }

  private resetGame(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
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
    this.pointAtMillis = 0;
    this.lastImpactAtMillis = 0;
    this.lastImpact = null;
    this.motionEventId += 1;
    this.startedAtMillis = nowMillis;
    this.finishAtMillis = 0;
    this.resetBall();
    this.lastEvent = gameEvent("none", "Esperando a rojo arriba y azul abajo", nowMillis);
  }

  private updatePhase(nowMillis: number, readyTransition: PlayerReadyTransition = this.readyGate.tick(nowMillis)): GameEvent[] {
    if (this.phase === "finished") {
      if (nowMillis - this.finishAtMillis >= winAnimationMillis) {
        this.resetGame(nowMillis);
        return [gameEvent("ready", "Nueva partida", nowMillis)];
      }
      return [];
    }

    if (readyTransition === "players-ready") {
      this.phase = "starting";
      this.motionEventId += 1;
      return [gameEvent("start", "Rojo y azul listos", nowMillis)];
    }

    if (readyTransition === "players-left") {
      this.phase = "waiting";
      this.motionEventId += 1;
      return [gameEvent("ready", "Vuelve a las zonas roja y azul", nowMillis)];
    }

    if (readyTransition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastStepMillis = nowMillis;
      this.serve();
      this.motionEventId += 1;
      return [gameEvent("start", "La pelota esta en juego", nowMillis)];
    }

    return [];
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
      this.commitBall({ ...this.ball, x: nextX, y: paddleYRed + 1, dy: 1 });
      this.recordImpact(0, nextX, paddleYRed);
      this.accelerate();
      return gameEvent("coin", "Rojo devuelve", nowMillis);
    }

    if (this.ball.dy > 0 && nextY === paddleYBlue && nextX >= this.bluePaddleX && nextX < this.bluePaddleX + paddleWidth) {
      this.reflectFromPaddle(nextX, this.bluePaddleX);
      this.commitBall({ ...this.ball, x: nextX, y: paddleYBlue - 1, dy: -1 });
      this.recordImpact(1, nextX, paddleYBlue);
      this.accelerate();
      return gameEvent("coin", "Azul devuelve", nowMillis);
    }

    if (nextY < 0) {
      this.scorePoint(1, nowMillis);
      return gameEvent("score", "Punto para azul", nowMillis);
    }
    if (nextY >= FLOOR_ROWS) {
      this.scorePoint(0, nowMillis);
      return gameEvent("score", "Punto para rojo", nowMillis);
    }

    this.commitBall({ ...this.ball, x: nextX, y: nextY });
    return undefined;
  }

  private scorePoint(team: TeamIndex, nowMillis: number): void {
    this.teamScore[team] += 1;
    this.scorer = team;
    this.pointAtMillis = nowMillis;
    this.motionEventId += 1;
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
    this.ballTrail = [];
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
    this.currentIntervalMillis = Math.max(
      this.speed.minimumMillis,
      this.currentIntervalMillis / this.speed.hitMultiplier
    );
  }

  private commitBall(nextBall: PingPongBallSnapshot): void {
    this.ballTrail = [
      { x: this.ball.x, y: this.ball.y },
      ...this.ballTrail.filter((position) => position.x !== this.ball.x || position.y !== this.ball.y)
    ].slice(0, 5);
    this.ball = nextBall;
  }

  private recordImpact(team: TeamIndex, x: number, y: number): void {
    this.lastImpact = { team, x, y };
    this.lastImpactAtMillis = this.nowMillis;
    this.motionEventId += 1;
  }

  private drawWaiting(frame: Frame): void {
    const redReady = this.halfReady(0, this.nowMillis);
    const blueReady = this.halfReady(1, this.nowMillis);

    this.drawWaitingHalf(frame, 0, redReady);
    this.drawWaitingHalf(frame, 1, blueReady);

    if (redReady) {
      this.drawSoftBar(frame, 3, 5, 10, redRgb);
    } else {
      this.drawBreathingOutline(frame, 0, redRgb);
    }
    if (blueReady) {
      this.drawSoftBar(frame, 3, 24, 10, blueRgb);
    } else {
      this.drawBreathingOutline(frame, 1, blueRgb);
    }
  }

  private drawReady(frame: Frame): void {
    const countdownDuration = gameStartCountdownMillis(manifest.start);
    const elapsed = Math.max(0, countdownDuration - this.readyGate.state(this.nowMillis).countdownMillis);
    const progress = clamp(elapsed / countdownDuration, 0, 1);
    const radius = progress * (FLOOR_ROWS * 0.7);
    const pulse = 0.5 + Math.sin(elapsed / 86) * 0.5;

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const dist = Math.abs(x - serveX) + Math.abs(y - serveY);
        const base = y >= FLOOR_ROWS / 2 ? blueRgb : redRgb;
        const waveDistance = Math.abs(dist - radius);
        const wake = Math.max(0, 1 - waveDistance / 3.2);
        const ambient = 7 + (Math.sin(x * 0.82 + y * 0.38 - elapsed / 120) + 1) * 4;
        if (wake > 0) {
          paintFrameCell(frame, x, y, mix(base, 28 + wake * 74, wake * 24));
        } else if (dist < radius) {
          paintFrameCell(frame, x, y, tint(base, ambient + pulse * 10));
        }
      }
    }

    this.drawCenterLine(frame, 18 + pulse * 20);
    this.drawBallGlow(frame);
    paintFrameCell(frame, serveX, serveY, ballColor);
  }

  private drawScoreFlash(frame: Frame): void {
    const base = this.scorer === 1 ? blueRgb : redRgb;
    const elapsed = Math.max(0, this.nowMillis - this.pointAtMillis);
    const progress = clamp(elapsed / postPointPauseMillis, 0, 1);
    const originY = this.scorer === 0 ? FLOOR_ROWS - 1 : 0;
    const radius = progress * (FLOOR_ROWS + 8);

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const dist = Math.hypot((x - serveX) * 1.35, y - originY);
        const ring = Math.max(0, 1 - Math.abs(dist - radius) / 3.4);
        const spark = Math.sin(x * 12.13 + y * 7.71 + elapsed / 38) > 0.9 ? 1 : 0;
        const fade = 1 - progress;
        if (ring > 0) {
          paintFrameCell(frame, x, y, mix(base, 28 + ring * 82, ring * 34));
        } else if (spark > 0 && fade > 0.18) {
          paintFrameCell(frame, x, y, mix(base, 22 + fade * 44, fade * 12));
        }
      }
    }

    this.drawCenterLine(frame, 12 + (1 - progress) * 24);
    this.drawPaddles(frame);
  }

  private drawWin(frame: Frame): void {
    const base = this.winner === 1 ? blueRgb : redRgb;
    const elapsed = Math.max(0, this.nowMillis - this.finishAtMillis);
    const sweep = elapsed / 92;
    const pulse = 0.5 + Math.sin(elapsed / 110) * 0.5;

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const directionY = this.winner === 0 ? FLOOR_ROWS - 1 - y : y;
        const ribbon = (directionY + x * 0.72 - sweep + FLOOR_ROWS * 4) % 11;
        const sparkle = Math.sin(x * 17.17 + y * 11.31 + elapsed / 55);
        if (ribbon < 3.8) {
          paintFrameCell(frame, x, y, mix(base, 38 + (3.8 - ribbon) * 15 + pulse * 12, 12 + pulse * 18));
        } else if (sparkle > 0.91) {
          paintFrameCell(frame, x, y, mix(base, 48, 32));
        }
      }
    }

    const coreLevel = 64 + pulse * 26;
    fillFrameRect(frame, serveX - 1, serveY - 1, 3, 3, tint(whiteRgb, coreLevel));
    paintFrameCell(frame, serveX, serveY, ballColor);
  }

  private drawArena(frame: Frame): void {
    const flow = this.nowMillis / 185;
    for (let y = 1; y < FLOOR_ROWS - 1; y += 1) {
      const base = y < FLOOR_ROWS / 2 ? redRgb : blueRgb;
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        const wave = (Math.sin(x * 0.78 + y * 0.31 - flow) + 1) * 0.5;
        const lane = (x + y) % 3 === 0 ? 4 : 0;
        paintFrameCell(frame, x, y, tint(base, 4 + wave * 7 + lane));
      }
    }
    this.drawCenterLine(frame, 18 + (Math.sin(this.nowMillis / 140) + 1) * 5);
  }

  private drawCenterLine(frame: Frame, level: number): void {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      if ((x + Math.floor(this.nowMillis / 120)) % 3 !== 0) {
        continue;
      }
      paintFrameCell(frame, x, serveY - 1, mix(whiteRgb, level, 0));
      paintFrameCell(frame, x, serveY, mix(whiteRgb, level * 0.72, 0));
    }
  }

  private drawBallTrail(frame: Frame): void {
    this.ballTrail.forEach((position, index) => {
      const level = Math.max(10, 46 - index * 8);
      paintFrameCell(frame, position.x, position.y, tint(whiteRgb, level));
    });
  }

  private drawBallGlow(frame: Frame): void {
    const glow = 20 + (Math.sin(this.nowMillis / 70) + 1) * 7;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      paintFrameCell(frame, this.ball.x + dx, this.ball.y + dy, tint(whiteRgb, glow));
    }
  }

  private drawImpact(frame: Frame): void {
    if (!this.lastImpact) {
      return;
    }
    const elapsed = this.nowMillis - this.lastImpactAtMillis;
    if (elapsed < 0 || elapsed >= 480) {
      return;
    }
    const progress = elapsed / 480;
    const radius = 1 + progress * 5.5;
    const base = this.lastImpact.team === 0 ? redRgb : blueRgb;
    for (let y = Math.max(0, this.lastImpact.y - 7); y <= Math.min(FLOOR_ROWS - 1, this.lastImpact.y + 7); y += 1) {
      for (let x = Math.max(0, this.lastImpact.x - 7); x <= Math.min(FLOOR_COLS - 1, this.lastImpact.x + 7); x += 1) {
        const dist = Math.hypot(x - this.lastImpact.x, y - this.lastImpact.y);
        const ring = Math.max(0, 1 - Math.abs(dist - radius) / 1.45);
        if (ring > 0) {
          paintFrameCell(frame, x, y, mix(base, 30 + ring * 52, ring * 28 * (1 - progress)));
        }
      }
    }
  }

  private drawBreathingOutline(frame: Frame, team: TeamIndex, base: RgbColor): void {
    const phase = (this.nowMillis / 900 + team * 0.5) % 1;
    const breath = 0.5 - Math.cos(phase * Math.PI * 2) * 0.5;
    const inset = Math.round(1 + breath * 2);
    const y = team === 0 ? 3 + inset : 21 - inset;
    const level = 48 + breath * 48;
    this.drawOutline(frame, inset, y, FLOOR_COLS - inset * 2, 8, tint(base, level));
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

  private halfReady(half: TeamIndex, nowMillis: number): boolean {
    return this.readyGate.zoneReady(half, nowMillis);
  }

  private activeHalves(nowMillis: number): number {
    return this.readyGate.state(nowMillis).readyPlayers;
  }

  private labelForTeam(team: TeamIndex): string {
    return this.players[team]?.label || (team === 0 ? "Rojo" : "Azul");
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    const latestEvent = events.at(-1);
    if (latestEvent) {
      this.lastEvent = latestEvent;
    }
    return events;
  }
}

function speedForConfig(config: NormalizedGameConfig): SpeedSettings {
  const baseInitialSpeed = readGameConfigOption(config.options, pingPongV2ConfigVars.initialBallSpeed);
  const baseHitMultiplier = readGameConfigOption(config.options, pingPongV2ConfigVars.returnSpeedMultiplier);
  const difficultyStep = readGameConfigOption(config.options, pingPongV2ConfigVars.difficultyMultiplier);
  const difficultyFactor = difficultyStep ** difficultyIndex(config.difficulty);
  const initialTilesPerSecond = baseInitialSpeed * difficultyFactor;
  // Scale only the acceleration above 1x. Multiplying the full return factor
  // would make higher difficulties explode in speed after only a few hits.
  const hitMultiplier = 1 + (baseHitMultiplier - 1) * difficultyFactor;
  const maximumTilesPerSecond = initialTilesPerSecond * maximumSpeedRatio;

  return {
    difficultyFactor,
    hitMultiplier,
    initialTilesPerSecond,
    initialMillis: 1000 / initialTilesPerSecond,
    minimumMillis: 1000 / maximumTilesPerSecond
  };
}

function difficultyIndex(value: string): number {
  switch (value) {
    case "medium":
      return 1;
    case "hard":
      return 2;
    case "expert":
      return 3;
    default:
      return 0;
  }
}

function tint(color: RgbColor, percent: number): HexColor {
  return rgbToHex(scaleRgb(color, percent));
}

function mix(color: RgbColor, colorPercent: number, whitePercent: number): HexColor {
  return rgbToHex(addRgb(scaleRgb(color, colorPercent), scaleRgb(whiteRgb, whitePercent)));
}
