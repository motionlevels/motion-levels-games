import {
  FLOOR_COLS, FLOOR_ROWS, clamp, createFrame, createPlayerReadyGate, createSeededRng,
  defaultPlayers, gameEvent, normalizeGameConfig, paintFrameCell, readGameConfigOption,
  type Frame, type GameConfig, type GameEvent, type GameInstance, type GameSnapshot,
  type HexColor, type NormalizedGameConfig, type PlayerReadyGate, type PlayerReadyTransition,
  type PressEvent, type SeededRng, type TickEvent
} from "@motion-levels-games/game-sdk";
import { manifest, tetrisConfigVars } from "./manifest.ts";

const boardX = 3;
const boardWidth = 10;
const finishMillis = 4_000;
const rotateCooldownMillis = 180;
const palette: HexColor[] = ["#36d9ff", "#ffd166", "#ff52c8", "#34c759", "#ff7a1a", "#0a84ff", "#ff3b30"];
const lineScores = [0, 100, 300, 500, 800];
type Cell = readonly [number, number];
const shapes: Cell[][][] = [
  [[[0,0],[1,0],[2,0],[3,0]],[[0,0],[0,1],[0,2],[0,3]],[[0,0],[1,0],[2,0],[3,0]],[[0,0],[0,1],[0,2],[0,3]]],
  [[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]]],
  [[[1,0],[0,1],[1,1],[2,1]],[[0,0],[0,1],[1,1],[0,2]],[[0,0],[1,0],[2,0],[1,1]],[[1,0],[0,1],[1,1],[1,2]]],
  [[[1,0],[2,0],[0,1],[1,1]],[[0,0],[0,1],[1,1],[1,2]],[[1,0],[2,0],[0,1],[1,1]],[[0,0],[0,1],[1,1],[1,2]]],
  [[[0,0],[1,0],[1,1],[2,1]],[[1,0],[0,1],[1,1],[0,2]],[[0,0],[1,0],[1,1],[2,1]],[[1,0],[0,1],[1,1],[0,2]]],
  [[[0,0],[0,1],[1,1],[2,1]],[[0,0],[1,0],[0,1],[0,2]],[[0,0],[1,0],[2,0],[2,1]],[[1,0],[1,1],[0,2],[1,2]]],
  [[[2,0],[0,1],[1,1],[2,1]],[[0,0],[0,1],[0,2],[1,2]],[[0,0],[1,0],[2,0],[0,1]],[[0,0],[1,0],[1,1],[1,2]]]
];

export type TetrisPieceSnapshot = { shape: number; rotation: number; x: number; y: number; color: HexColor; cells: Cell[] };
export type TetrisSnapshot = GameSnapshot & {
  phase: "waiting" | "starting" | "running" | "finished";
  result: "playing" | "line-clear" | "game-win" | "game-loss";
  lines: number; level: number; linesTarget: number; winnerLabel: string;
  activePiece: TetrisPieceSnapshot; nextPiece: TetrisPieceSnapshot;
  board: Array<Array<HexColor | null>>; guideX: number; guideY: number;
  lastClearCount: number; lineFlashMillis: number; motionEventId: number;
};
export type TetrisGameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): TetrisSnapshot };
type Piece = { shape: number; rotation: number; x: number; y: number; color: HexColor };

export function createGame(config: GameConfig): TetrisGameInstance { return new TetrisGame(config); }

class TetrisGame implements TetrisGameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private readyGate: PlayerReadyGate;
  private board: Array<Array<HexColor | null>> = [];
  private active!: Piece;
  private next!: Piece;
  private phase: TetrisSnapshot["phase"] = "waiting";
  private result: TetrisSnapshot["result"] = "playing";
  private nowMillis = 0; private startedAtMillis = 0; private lastFallMillis = 0; private lastRotateMillis = -1_000;
  private finishAtMillis = 0; private lastClearMillis = 0; private lastClearCount = 0;
  private score = 0; private lines = 0; private level = 1; private guideX = boardX + 5; private guideY = FLOOR_ROWS - 1; private motionEventId = 0;
  private players = defaultPlayers(1); private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest); this.rng = createSeededRng(this.config.seed);
    this.readyGate = createPlayerReadyGate(manifest.start, [{ minX: 5, maxX: 10, minY: 28, maxY: 31 }], this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); this.lastEvent = gameEvent("ready", "Entra en la zona de control", nowMillis); return [this.lastEvent]; }
  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update(event), event.atMillis));
    if (this.phase !== "running" || !event.pressed) return [];
    if (event.y === this.guideY - 1 && event.x === this.guideX - 1) return this.rotate(-1, event.atMillis);
    if (event.y === this.guideY - 1 && event.x === this.guideX + 1) return this.rotate(1, event.atMillis);
    if (event.x < boardX || event.x >= boardX + boardWidth) return [];
    this.guideX = clamp(event.x, boardX + 1, boardX + boardWidth - 2); this.guideY = clamp(event.y, 1, FLOOR_ROWS - 1);
    const desiredX = clamp(event.x - Math.floor(pieceWidth(this.active) / 2), boardX, boardX + boardWidth - pieceWidth(this.active));
    if (!this.collides(this.active, desiredX, this.active.y, this.active.rotation)) this.active.x = desiredX;
    if (event.y >= FLOOR_ROWS - 2) return this.hardDrop(event.atMillis);
    return [];
  }
  release(event: PressEvent): GameEvent[] { this.nowMillis = event.atMillis; if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update({ ...event, pressed: false }), event.atMillis)); return []; }
  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.tick(event.atMillis), event.atMillis));
    if (this.phase === "finished") { if (event.atMillis - this.finishAtMillis >= finishMillis) { this.resetState(event.atMillis); return this.record([gameEvent("ready", "Nueva partida", event.atMillis)]); } return []; }
    if (this.result === "line-clear" && event.atMillis - this.lastClearMillis >= 550) this.result = "playing";
    const interval = gravityInterval(this.level, this.config.difficulty, this.guideY > this.active.y + 5);
    let steps = 0;
    while (event.atMillis - this.lastFallMillis >= interval && steps < 4 && this.phase === "running") {
      if (this.collides(this.active, this.active.x, this.active.y + 1, this.active.rotation)) return this.lockPiece(event.atMillis);
      this.active.y += 1; this.lastFallMillis += interval; steps += 1;
    }
    return [];
  }
  render(): Frame {
    const frame = createFrame("#05070a");
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      paintFrameCell(frame, boardX - 1, y, this.phase === "finished" ? "#67151f" : "#06131a"); paintFrameCell(frame, boardX + boardWidth, y, this.phase === "finished" ? "#67151f" : "#06131a");
      for (let x = 0; x < boardWidth; x += 1) paintFrameCell(frame, boardX + x, y, this.board[y]?.[x] ?? "#020609");
    }
    if (this.phase === "waiting" || this.phase === "starting") { this.drawReady(frame); return frame; }
    if (this.phase === "finished") { this.drawFinish(frame); return frame; }
    this.drawPiece(frame, this.ghostPiece(), "#17404a"); this.drawPiece(frame, this.active, this.active.color);
    if (this.board[this.guideY]?.[this.guideX - boardX] === null) paintFrameCell(frame, this.guideX, this.guideY, "#12303a");
    paintFrameCell(frame, this.guideX - 1, this.guideY - 1, "#7a1f61"); paintFrameCell(frame, this.guideX + 1, this.guideY - 1, "#7a5f1f");
    if (this.lastClearCount > 0 && this.nowMillis - this.lastClearMillis < 350) for (let x = boardX; x < boardX + boardWidth; x += 1) paintFrameCell(frame, x, FLOOR_ROWS - 1, "#ffffff");
    for (let y = FLOOR_ROWS - Math.min(FLOOR_ROWS, this.lines); y < FLOOR_ROWS; y += 1) { paintFrameCell(frame, 0, y, "#ffd166"); paintFrameCell(frame, FLOOR_COLS - 1, y, "#36d9ff"); }
    return frame;
  }
  snapshot(): TetrisSnapshot {
    const ready = this.readyGate.state(this.nowMillis); const player = this.players[0]!;
    return {
      currentGame: manifest.id, label: manifest.label, phase: this.phase, playerCount: this.config.playerCount,
      players: [{ index: 0, label: player.label, color: player.color, score: this.score, lives: -1 }], score: this.score, lives: -1,
      elapsedMillis: this.phase === "waiting" || this.phase === "starting" ? 0 : Math.max(0, this.nowMillis - this.startedAtMillis), remainingMillis: this.phase === "finished" ? Math.max(0, this.finishAtMillis + finishMillis - this.nowMillis) : 0,
      activeTargets: this.phase === "running" ? 1 : 0, success: this.result === "game-win", lastEventCue: this.lastEvent.cue, lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0, readyPlayers: ready.readyPlayers, requiredPlayers: ready.requiredPlayers,
      result: this.result, lines: this.lines, level: this.level, linesTarget: this.linesToWin(), winnerLabel: player.label,
      activePiece: snapshotPiece(this.active), nextPiece: snapshotPiece(this.next), board: this.board.map((row) => [...row]), guideX: this.guideX, guideY: this.guideY,
      lastClearCount: this.lastClearCount, lineFlashMillis: Math.max(0, this.lastClearMillis + 550 - this.nowMillis), motionEventId: this.motionEventId
    };
  }
  reset(config: Partial<GameConfig> = {}): void { this.config = normalizeGameConfig({ ...this.config, ...config }, manifest); this.rng = createSeededRng(this.config.seed); this.readyGate.reset(this.config.nowMillis); this.resetState(this.config.nowMillis); }

  private resetState(nowMillis: number): void {
    this.rng = createSeededRng(this.config.seed); this.readyGate.reset(nowMillis); this.board = Array.from({ length: FLOOR_ROWS }, () => Array<HexColor | null>(boardWidth).fill(null));
    this.active = this.randomPiece(); this.next = this.randomPiece(); this.phase = "waiting"; this.result = "playing"; this.nowMillis = nowMillis; this.startedAtMillis = nowMillis; this.lastFallMillis = nowMillis;
    this.finishAtMillis = 0; this.lastClearMillis = 0; this.lastClearCount = 0; this.lastRotateMillis = -1_000; this.score = 0; this.lines = 0; this.level = 1; this.guideX = boardX + 5; this.guideY = FLOOR_ROWS - 1; this.motionEventId = 0;
    const roster = defaultPlayers(Math.max(1, this.config.playerCount), this.config.players); const first = roster[0]!; this.players = [{ ...first, label: first.label === "Player 1" ? "Jugador" : first.label }]; this.lastEvent = gameEvent("ready", "Entra en la zona de control", nowMillis);
  }
  private applyReady(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") { this.phase = "starting"; this.motionEventId += 1; return [gameEvent("ready", "Control preparado", nowMillis)]; }
    if (transition === "players-left") { this.phase = "waiting"; this.motionEventId += 1; return [gameEvent("ready", "Vuelve a la zona de control", nowMillis)]; }
    if (transition === "started") { this.phase = "running"; this.startedAtMillis = nowMillis; this.lastFallMillis = nowMillis; this.motionEventId += 1; return [gameEvent("start", "Tetris en marcha", nowMillis)]; }
    return [];
  }
  private randomPiece(): Piece { const shape = this.rng.int(shapes.length); const piece = { shape, rotation: 0, x: 0, y: 0, color: palette[shape]! }; piece.x = boardX + Math.floor((boardWidth - pieceWidth(piece)) / 2); return piece; }
  private rotate(direction: number, nowMillis: number): GameEvent[] { if (nowMillis - this.lastRotateMillis < rotateCooldownMillis) return []; const rotation = (this.active.rotation + direction + 4) % 4; for (const kick of [0,-1,1,-2,2]) if (!this.collides(this.active, this.active.x + kick, this.active.y, rotation)) { this.active.x += kick; this.active.rotation = rotation; this.lastRotateMillis = nowMillis; this.motionEventId += 1; return this.record([gameEvent("tick", direction < 0 ? "Rotación izquierda" : "Rotación derecha", nowMillis)]); } return []; }
  private hardDrop(nowMillis: number): GameEvent[] { while (!this.collides(this.active, this.active.x, this.active.y + 1, this.active.rotation)) this.active.y += 1; return this.lockPiece(nowMillis); }
  private lockPiece(nowMillis: number): GameEvent[] {
    for (const [dx,dy] of pieceCells(this.active)) { const x = this.active.x + dx - boardX; const y = this.active.y + dy; if (y >= 0 && y < FLOOR_ROWS && x >= 0 && x < boardWidth) this.board[y]![x] = this.active.color; }
    const cleared = this.clearLines(); this.lastClearCount = cleared;
    if (cleared > 0) { this.lastClearMillis = nowMillis; this.lines += cleared; this.level = Math.floor(this.lines / 10) + 1; this.score += (lineScores[cleared] ?? 0) * this.level; this.result = "line-clear"; this.motionEventId += 1; if (this.lines >= this.linesToWin()) return this.finish(true, nowMillis); }
    this.active = this.next; this.active.x = boardX + Math.floor((boardWidth - pieceWidth(this.active)) / 2); this.active.y = 0; this.next = this.randomPiece(); this.guideX = this.active.x + Math.floor(pieceWidth(this.active) / 2); this.guideY = FLOOR_ROWS - 1; this.lastFallMillis = nowMillis;
    if (this.collides(this.active, this.active.x, this.active.y, this.active.rotation)) return this.finish(false, nowMillis);
    return cleared > 0 ? this.record([gameEvent("win", `${cleared === 1 ? "Línea" : `${cleared} líneas`} +${(lineScores[cleared] ?? 0) * this.level}`, nowMillis)]) : [];
  }
  private clearLines(): number { let cleared = 0; for (let y = FLOOR_ROWS - 1; y >= 0; y -= 1) if (this.board[y]!.every(Boolean)) { this.board.splice(y, 1); this.board.unshift(Array<HexColor | null>(boardWidth).fill(null)); cleared += 1; y += 1; } return cleared; }
  private finish(success: boolean, nowMillis: number): GameEvent[] { this.phase = "finished"; this.result = success ? "game-win" : "game-loss"; this.finishAtMillis = nowMillis; this.motionEventId += 1; const target = this.linesToWin(); return this.record([gameEvent(success ? "win" : "fail", success ? `¡Objetivo de ${target} ${target === 1 ? "línea completado" : "líneas completado"}!` : "Las piezas llegaron arriba", nowMillis)]); }
  private collides(piece: Piece, x: number, y: number, rotation: number): boolean { return (shapes[piece.shape]?.[rotation] ?? []).some(([dx,dy]) => { const bx = x + dx - boardX; const by = y + dy; return bx < 0 || bx >= boardWidth || by >= FLOOR_ROWS || (by >= 0 && this.board[by]?.[bx] !== null); }); }
  private ghostPiece(): Piece { const ghost = { ...this.active }; while (!this.collides(ghost, ghost.x, ghost.y + 1, ghost.rotation)) ghost.y += 1; return ghost; }
  private drawPiece(frame: Frame, piece: Piece, color: HexColor): void { for (const [dx,dy] of pieceCells(piece)) paintFrameCell(frame, piece.x + dx, piece.y + dy, color); }
  private drawReady(frame: Frame): void { const ready = this.readyGate.zoneReady(0, this.nowMillis); for (let y = 28; y < 32; y += 1) for (let x = 5; x <= 10; x += 1) if (ready || (x + y + Math.floor(this.nowMillis / 110)) % 4 < 2) paintFrameCell(frame, x, y, ready ? "#ffffff" : "#36d9ff"); }
  private drawFinish(frame: Frame): void { const step = Math.floor((this.nowMillis - this.finishAtMillis) / 90); const color = this.result === "game-win" ? "#36d9ff" : "#ff3b30"; for (let y = 0; y < FLOOR_ROWS; y += 1) for (let x = boardX; x < boardX + boardWidth; x += 1) if ((x + y + step) % 5 < 2) paintFrameCell(frame, x, y, color); }
  private linesToWin(): number { return readGameConfigOption(this.config.options, tetrisConfigVars.linesToWin); }
  private record(events: GameEvent[]): GameEvent[] { const latest = events.at(-1); if (latest) this.lastEvent = latest; return events; }
}

function pieceCells(piece: Piece): Cell[] { return shapes[piece.shape]?.[piece.rotation] ?? []; }
function pieceWidth(piece: Piece): number { const xs = pieceCells(piece).map(([x]) => x); return Math.max(...xs) - Math.min(...xs) + 1; }
function snapshotPiece(piece: Piece): TetrisPieceSnapshot { return { shape: piece.shape, rotation: piece.rotation, x: piece.x, y: piece.y, color: piece.color, cells: pieceCells(piece).map((cell) => [...cell] as unknown as Cell) }; }
function gravityInterval(level: number, difficulty: string, fast: boolean): number { const base = Math.max(100, 720 - (level - 1) * 45); const factor = difficulty === "easy" ? 1.25 : difficulty === "hard" ? 0.78 : 1; return Math.max(70, base * factor / (fast ? 3 : 1)); }
