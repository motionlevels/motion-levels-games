import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  createPlayerReadyGate,
  fillFrameRect,
  gameEvent,
  inFloorBounds,
  normalizeGameConfig,
  paintFrameCell,
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
  type PlayerReadyZone,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing, paintDiamondWave } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const redColor: HexColor = "#ff1c28";
export const blueColor: HexColor = "#145cff";
export const redFieldColor: HexColor = "#720c17";
export const blueFieldColor: HexColor = "#0b3189";
export const centerLineColor: HexColor = "#ff9f1c";
export const ropeColor: HexColor = "#f4c56a";
export const knotColor: HexColor = "#fff7d6";

export const totalRounds = 5;
export const roundsToWin = 3;
export const ropeLimit = 6;
export const roundWinAnimationMillis = 1_800;
export const gameWinAnimationMillis = 5_000;
export const roundTransitionMillis = roundWinAnimationMillis;
export const redFieldLastRow = 14;
export const blueFieldFirstRow = 17;

type TeamIndex = 0 | 1;
type TiraSogaPhase = "waiting" | "starting" | "running" | "finished";

export type TiraSogaSnapshot = GameSnapshot & {
  phase: TiraSogaPhase;
  difficulty: string;
  difficultyLabel: string;
  pressesPerAdvance: number;
  ropePosition: number;
  ropeLimit: number;
  redPresses: number;
  bluePresses: number;
  redProgress: number;
  blueProgress: number;
  currentRound: number;
  totalRounds: number;
  rounds: GameRoundSnapshot[];
  roundWinnerIndex: number;
  roundTransitionMillis: number;
  winnerIndex: number;
  motionEventId: number;
};

export type TiraSogaGameInstance = Omit<GameInstance, "snapshot"> & {
  playerReadyZones(): PlayerReadyZone[];
  snapshot(): TiraSogaSnapshot;
};

const difficultyPresses: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3
};

const difficultyLabels: Record<string, string> = {
  easy: "Fácil",
  medium: "Medio",
  hard: "Difícil"
};

export function createGame(config: GameConfig): TiraSogaGameInstance {
  return new TiraSogaGame(config);
}

export function tiraSogaReadyZones(): PlayerReadyZone[] {
  return [
    { minX: 0, maxX: FLOOR_COLS - 1, minY: 0, maxY: redFieldLastRow },
    { minX: 0, maxX: FLOOR_COLS - 1, minY: blueFieldFirstRow, maxY: FLOOR_ROWS - 1 }
  ];
}

class TiraSogaGame implements TiraSogaGameInstance {
  private config: NormalizedGameConfig;
  private phase: TiraSogaPhase = "waiting";
  private startedAtMillis = 0;
  private nowMillis = 0;
  private ropePosition = 0;
  private teamScore: [number, number] = [0, 0];
  private teamPresses: [number, number] = [0, 0];
  private teamProgress: [number, number] = [0, 0];
  private rounds: GameRoundSnapshot[] = [];
  private roundWinnerIndex: TeamIndex | -1 = -1;
  private winnerIndex: TeamIndex | -1 = -1;
  private roundWonAtMillis = 0;
  private roundPauseUntilMillis = 0;
  private finishAtMillis = 0;
  private motionEventId = 0;
  private readyZones = tiraSogaReadyZones();
  private readyGate: PlayerReadyGate;
  private heldTiles = Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, () => false);
  private flashUntil = Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, () => 0);
  private lastEvent: GameEvent = gameEvent("none", "Listos para tirar", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetMatch(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.resetMatch(nowMillis);
    this.lastEvent = gameEvent("ready", "Tira-Soga espera a rojo y azul", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const readyTransition = this.readyGate.update(event);

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.recordEvents(this.applyReadyTransition(readyTransition, event.atMillis));
    }
    if (!event.pressed || this.phase !== "running" || this.roundWinnerIndex !== -1) {
      return [];
    }

    const tileIndex = this.tileIndex(event.x, event.y);
    const team = teamForTile(event.x, event.y);
    if (tileIndex === -1 || team === -1 || this.heldTiles[tileIndex]) {
      return [];
    }

    this.heldTiles[tileIndex] = true;
    this.flashUntil[tileIndex] = event.atMillis + 220;
    this.teamPresses[team] += 1;
    this.teamProgress[team] += 1;

    const threshold = this.pressesPerAdvance();
    if (this.teamProgress[team] < threshold) {
      return this.recordEvents([
        gameEvent(
          "hit",
          `${teamLabel(team)} suma ${this.teamProgress[team]} de ${threshold}`,
          event.atMillis
        )
      ]);
    }

    this.teamProgress[team] = 0;
    this.ropePosition += team === 0 ? -1 : 1;
    if (Math.abs(this.ropePosition) >= ropeLimit) {
      return this.recordEvents([this.finishRound(team, event.atMillis)]);
    }

    return this.recordEvents([
      gameEvent("hit", `${teamLabel(team)} tira de la soga`, event.atMillis)
    ]);
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const tileIndex = this.tileIndex(event.x, event.y);
    if (tileIndex !== -1) {
      this.heldTiles[tileIndex] = false;
    }

    const readyTransition = this.readyGate.update({ ...event, pressed: false });
    if (this.phase === "waiting" || this.phase === "starting") {
      return this.recordEvents(this.applyReadyTransition(readyTransition, event.atMillis));
    }
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    const events = this.updateLifecycle(event.atMillis, this.readyGate.tick(event.atMillis));

    if (
      this.phase === "running" &&
      this.roundWinnerIndex !== -1 &&
      event.atMillis >= this.roundPauseUntilMillis
    ) {
      this.startNextRound();
      events.push(gameEvent("start", `Ronda ${this.currentRound()}: ¡a tirar!`, event.atMillis));
    }

    return this.recordEvents(events);
  }

  render(): Frame {
    const frame = createFrame("#05070a");

    if (this.phase === "waiting") {
      this.drawWaiting(frame);
      return frame;
    }
    if (this.phase === "starting") {
      this.drawStarting(frame);
      return frame;
    }
    if (this.phase === "finished") {
      this.drawGameWin(frame);
      return frame;
    }

    this.drawArena(frame);
    if (this.roundWinnerIndex !== -1) {
      this.drawRoundWin(frame);
    }
    return frame;
  }

  snapshot(): TiraSogaSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    const players = this.scoredPlayers();
    const roundRemaining = Math.max(0, this.roundPauseUntilMillis - this.nowMillis);
    const gameRemaining = this.phase === "finished"
      ? Math.max(0, this.finishAtMillis + gameWinAnimationMillis - this.nowMillis)
      : 0;

    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players,
      score: Math.max(...this.teamScore),
      lives: -1,
      elapsedMillis: this.phase === "waiting" || this.phase === "starting"
        ? 0
        : Math.max(0, (this.phase === "finished" ? this.finishAtMillis : this.nowMillis) - this.startedAtMillis),
      remainingMillis: gameRemaining || roundRemaining,
      activeTargets: this.phase === "running" && this.roundWinnerIndex === -1 ? 2 : 0,
      success: this.phase === "finished",
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: roundsToWin,
      roundHits: this.teamPresses[0] + this.teamPresses[1],
      lastRoundHits: this.rounds.at(-1)?.hits ?? 0,
      lastRoundWinner: this.rounds.at(-1)?.winnerLabel ?? "",
      difficulty: this.config.difficulty,
      difficultyLabel: difficultyLabels[this.config.difficulty] ?? "Medio",
      pressesPerAdvance: this.pressesPerAdvance(),
      ropePosition: this.ropePosition,
      ropeLimit,
      redPresses: this.teamPresses[0],
      bluePresses: this.teamPresses[1],
      redProgress: this.teamProgress[0],
      blueProgress: this.teamProgress[1],
      currentRound: this.currentRound(),
      totalRounds,
      rounds: this.rounds.map((round) => ({ ...round })),
      roundWinnerIndex: this.roundWinnerIndex,
      roundTransitionMillis: roundRemaining,
      winnerIndex: this.winnerIndex,
      motionEventId: this.motionEventId
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig(
      {
        ...this.config,
        ...config,
        options: { ...this.config.options, ...config.options }
      },
      manifest
    );
    this.readyZones = tiraSogaReadyZones();
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetMatch(this.config.nowMillis);
    this.lastEvent = gameEvent("ready", "Tira-Soga espera a rojo y azul", this.config.nowMillis);
  }

  playerReadyZones(): PlayerReadyZone[] {
    return this.readyZones.map((zone) => ({ ...zone }));
  }

  private updateLifecycle(
    nowMillis: number,
    readyTransition: PlayerReadyTransition
  ): GameEvent[] {
    if (this.phase === "finished") {
      if (nowMillis - this.finishAtMillis >= gameWinAnimationMillis) {
        this.resetMatch(nowMillis);
        return [gameEvent("ready", "Nueva partida", nowMillis)];
      }
      return [];
    }
    return this.applyReadyTransition(readyTransition, nowMillis);
  }

  private applyReadyTransition(
    transition: PlayerReadyTransition,
    nowMillis: number
  ): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.motionEventId += 1;
      return [gameEvent("start", "Rojo y azul listos", nowMillis)];
    }
    if (transition === "players-left") {
      this.phase = "waiting";
      this.motionEventId += 1;
      return [gameEvent("ready", "Vuelve a tu campo iluminado", nowMillis)];
    }
    if (transition === "started") {
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.motionEventId += 1;
      return [gameEvent("start", "Ronda 1: ¡a tirar!", nowMillis)];
    }
    return [];
  }

  private finishRound(team: TeamIndex, atMillis: number): GameEvent {
    const round = this.currentRound();
    const hits = this.teamPresses[0] + this.teamPresses[1];
    this.teamScore[team] += 1;
    this.roundWinnerIndex = team;
    this.roundWonAtMillis = atMillis;
    this.rounds.push({
      index: round,
      winnerIndex: team,
      winnerLabel: teamLabel(team),
      hits
    });
    this.motionEventId += 1;

    if (this.rounds.length >= totalRounds) {
      this.phase = "finished";
      this.finishAtMillis = atMillis;
      this.winnerIndex = this.teamScore[0] > this.teamScore[1] ? 0 : 1;
      return gameEvent("win", `${teamLabel(this.winnerIndex)} gana Tira-Soga`, atMillis);
    }

    this.roundPauseUntilMillis = atMillis + roundWinAnimationMillis;
    return gameEvent("hit", `Ronda ${round} para ${teamLabel(team).toLowerCase()}`, atMillis);
  }

  private startNextRound(): void {
    this.ropePosition = 0;
    this.teamPresses = [0, 0];
    this.teamProgress = [0, 0];
    this.roundWinnerIndex = -1;
    this.roundWonAtMillis = 0;
    this.roundPauseUntilMillis = 0;
    this.heldTiles.fill(false);
    this.flashUntil.fill(0);
    this.motionEventId += 1;
  }

  private resetMatch(nowMillis: number): void {
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.startedAtMillis = nowMillis;
    this.nowMillis = nowMillis;
    this.ropePosition = 0;
    this.teamScore = [0, 0];
    this.teamPresses = [0, 0];
    this.teamProgress = [0, 0];
    this.rounds = [];
    this.roundWinnerIndex = -1;
    this.winnerIndex = -1;
    this.roundWonAtMillis = 0;
    this.roundPauseUntilMillis = 0;
    this.finishAtMillis = 0;
    this.heldTiles.fill(false);
    this.flashUntil.fill(0);
    this.motionEventId = 0;
    this.motionEventId += 1;
  }

  private currentRound(): number {
    return Math.min(totalRounds, this.rounds.length + (this.roundWinnerIndex === -1 ? 1 : 0));
  }

  private pressesPerAdvance(): number {
    return difficultyPresses[this.config.difficulty] ?? 2;
  }

  private ropeTileY(position = this.ropePosition): number {
    const normalized = (position + ropeLimit) / (ropeLimit * 2);
    return Math.round(normalized * (FLOOR_ROWS - 1));
  }

  private scoredPlayers(): GamePlayer[] {
    return [
      { index: 0, label: "Rojo", color: redColor, score: this.teamScore[0], lives: -1 },
      { index: 1, label: "Azul", color: blueColor, score: this.teamScore[1], lives: -1 }
    ];
  }

  private tileIndex(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inFloorBounds(x, y)) {
      return -1;
    }
    return y * FLOOR_COLS + x;
  }

  private recordEvents(events: GameEvent[]): GameEvent[] {
    const last = events.at(-1);
    if (last) {
      this.lastEvent = last;
    }
    return events;
  }

  private drawWaiting(frame: Frame): void {
    this.drawBaseFields(frame, "#410912", "#071f5a");
    const step = Math.floor(this.nowMillis / 180);
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      const team = teamForTile(0, y);
      if (team === -1 || (y + step) % 5 !== 0) {
        continue;
      }
      fillFrameRect(frame, 0, y, FLOOR_COLS, 1, team === 0 ? redFieldColor : blueFieldColor);
    }
    this.drawRope(frame, 0);
  }

  private drawStarting(frame: Frame): void {
    this.drawBaseFields(frame, redFieldColor, blueFieldColor);
    paintDiamondWave(frame, {
      bandWidth: 2,
      period: 7,
      step: Math.floor(this.nowMillis / 90),
      color: ({ y }) => y < FLOOR_ROWS / 2 ? "#ff7b84" : "#79a0ff"
    });
    this.drawRope(frame, 0);
  }

  private drawArena(frame: Frame): void {
    const highlightedTeam = this.roundWinnerIndex;
    this.drawBaseFields(
      frame,
      highlightedTeam === 0 ? redColor : redFieldColor,
      highlightedTeam === 1 ? blueColor : blueFieldColor
    );
    this.drawRope(frame, this.ropePosition);

    for (let index = 0; index < this.flashUntil.length; index += 1) {
      if ((this.flashUntil[index] ?? 0) <= this.nowMillis) {
        continue;
      }
      const x = index % FLOOR_COLS;
      const y = Math.floor(index / FLOOR_COLS);
      const team = teamForTile(x, y);
      if (team !== -1) {
        paintFrameCell(frame, x, y, team === 0 ? "#ff8a92" : "#73a0ff");
      }
    }
  }

  private drawRoundWin(frame: Frame): void {
    const winner = this.roundWinnerIndex;
    if (winner === -1) {
      return;
    }
    const elapsed = Math.max(0, this.nowMillis - this.roundWonAtMillis);
    const centerY = winner === 0 ? 0 : FLOOR_ROWS - 1;
    paintDiamondRing(frame, {
      centerX: (FLOOR_COLS - 1) / 2,
      centerY,
      color: knotColor,
      radius: (elapsed / 80) % 24,
      thickness: 1.4
    });
    paintDiamondRing(frame, {
      centerX: (FLOOR_COLS - 1) / 2,
      centerY,
      color: centerLineColor,
      radius: (elapsed / 80 + 7) % 24,
      thickness: 1
    });
  }

  private drawGameWin(frame: Frame): void {
    const winnerColor = this.winnerIndex === 0 ? redColor : blueColor;
    fillFrameRect(frame, 0, 0, FLOOR_COLS, FLOOR_ROWS, winnerColor);
    const elapsed = Math.max(0, this.nowMillis - this.finishAtMillis);
    paintDiamondWave(frame, {
      bandWidth: 2,
      period: 9,
      step: Math.floor(elapsed / 80),
      color: centerLineColor
    });
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        if ((x * 17 + y * 11 + Math.floor(elapsed / 120)) % 37 === 0) {
          paintFrameCell(frame, x, y, knotColor);
        }
      }
    }
  }

  private drawBaseFields(frame: Frame, red: HexColor, blue: HexColor): void {
    fillFrameRect(frame, 0, 0, FLOOR_COLS, redFieldLastRow + 1, red);
    fillFrameRect(
      frame,
      0,
      blueFieldFirstRow,
      FLOOR_COLS,
      FLOOR_ROWS - blueFieldFirstRow,
      blue
    );
    fillFrameRect(frame, 0, 15, FLOOR_COLS, 2, centerLineColor);
  }

  private drawRope(frame: Frame, position: number): void {
    fillFrameRect(frame, 7, 0, 2, FLOOR_ROWS, ropeColor);
    const knotY = this.ropeTileY(position);
    fillFrameRect(frame, 5, knotY, 6, 1, knotColor);
    if (knotY > 0) {
      fillFrameRect(frame, 7, knotY - 1, 2, 1, knotColor);
    }
    if (knotY < FLOOR_ROWS - 1) {
      fillFrameRect(frame, 7, knotY + 1, 2, 1, knotColor);
    }
  }
}

export function teamForTile(x: number, y: number): TeamIndex | -1 {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inFloorBounds(x, y)) {
    return -1;
  }
  if (y <= redFieldLastRow) {
    return 0;
  }
  if (y >= blueFieldFirstRow) {
    return 1;
  }
  return -1;
}

export function teamLabel(team: TeamIndex): "Rojo" | "Azul" {
  return team === 0 ? "Rojo" : "Azul";
}

export function onRedTilePressed(
  game: TiraSogaGameInstance,
  atMillis: number,
  x = 4,
  y = 8
): GameEvent[] {
  const events = game.press({ x, y, pressed: true, atMillis });
  game.release({ x, y, pressed: false, atMillis: atMillis + 1 });
  return events;
}

export function onBlueTilePressed(
  game: TiraSogaGameInstance,
  atMillis: number,
  x = 11,
  y = 24
): GameEvent[] {
  const events = game.press({ x, y, pressed: true, atMillis });
  game.release({ x, y, pressed: false, atMillis: atMillis + 1 });
  return events;
}
