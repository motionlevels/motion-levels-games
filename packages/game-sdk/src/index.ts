export const FLOOR_COLS = 16;
export const FLOOR_ROWS = 32;
export const FRAME_SIZE = FLOOR_COLS * FLOOR_ROWS;

export type HexColor = `#${string}`;
export type RgbColor = {
  r: number;
  g: number;
  b: number;
};
export type TileColor = HexColor | RgbColor;

export type FrameCell = {
  x: number;
  y: number;
  color: HexColor;
};

export type Frame = {
  width: typeof FLOOR_COLS;
  height: typeof FLOOR_ROWS;
  cells: FrameCell[];
};

export type GamePhase = "ready" | "running" | "paused" | "finished";

export type GamePlayer = {
  index: number;
  label: string;
  color: HexColor;
  score: number;
  lives: number;
};

export type GameRoundSnapshot = {
  index: number;
  winnerIndex: number;
  winnerLabel: string;
  hits: number;
};

export type GameEventCue =
  | "none"
  | "start"
  | "hit"
  | "miss"
  | "win"
  | "fail"
  | string;

export type GameEvent = {
  cue: GameEventCue;
  message: string;
  atMillis: number;
};

export type GameSnapshot = {
  currentGame: string;
  label: string;
  phase: GamePhase | string;
  playerCount: number;
  players: GamePlayer[];
  score: number;
  lives: number;
  elapsedMillis: number;
  remainingMillis: number;
  activeTargets: number;
  success: boolean;
  lastEventCue: GameEventCue;
  lastEventMessage: string;
  countdownMillis?: number;
  matchTarget?: number;
  roundHits?: number;
  lastRoundHits?: number;
  lastRoundWinner?: string;
  rounds?: GameRoundSnapshot[];
};

export type GameManifest = {
  id: string;
  label: string;
  description?: string;
  players: {
    min: number;
    max: number;
  };
  defaultDurationMillis: number;
  defaultSeed: number;
  display: {
    entry: string;
  };
  tags?: string[];
};

export type GameConfig = {
  seed: number;
  playerCount: number;
  durationMillis?: number;
  nowMillis?: number;
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
};

export type GameConfigOptions = Record<string, unknown>;
export type GameDifficulty = "easy" | "medium" | "hard" | "expert" | string;

export type NormalizedGameConfig = {
  seed: number;
  playerCount: number;
  durationMillis: number;
  nowMillis: number;
  difficulty: GameDifficulty;
  options: GameConfigOptions;
};

export type PressEvent = {
  x: number;
  y: number;
  pressed: boolean;
  atMillis: number;
};

export type TickEvent = {
  atMillis: number;
};

export type GameInstance = {
  init(nowMillis: number): GameEvent[];
  press(event: PressEvent): GameEvent[];
  release(event: PressEvent): GameEvent[];
  tick(event: TickEvent): GameEvent[];
  render(): Frame;
  snapshot(): GameSnapshot;
  reset(config?: Partial<GameConfig>): void;
};

export const DEFAULT_ENGINE_FPS = 30;
export const DEFAULT_ENGINE_FRAME_MILLIS = 1000 / DEFAULT_ENGINE_FPS;
export const DEFAULT_ENGINE_MAX_CATCH_UP_STEPS = 5;

export type GameEngineOptions = {
  fps?: number;
  initialEvents?: GameEvent[];
  nowMillis?: number;
};

export type GameEngineState = {
  clockMillis: number;
  events: GameEvent[];
  fps: number;
  frame: Frame;
  frameMillis: number;
  snapshot: GameSnapshot;
};

export type GameEngine = {
  readonly clockMillis: number;
  readonly fps: number;
  readonly frameMillis: number;
  readonly state: GameEngineState;
  press(x: number, y: number, atMillis?: number): GameEngineState;
  refresh(events?: GameEvent[]): GameEngineState;
  release(x: number, y: number, atMillis?: number): GameEngineState;
  replaceGame(game: GameInstance, options?: GameEngineOptions): GameEngineState;
  step(deltaMillis?: number): GameEngineState;
  tickTo(atMillis: number): GameEngineState;
};

export type GameModule<TSnapshot extends GameSnapshot = GameSnapshot> = {
  manifest: GameManifest;
  createGame(config: GameConfig): GameInstance;
  PlayerDisplay?: (props: PlayerDisplayProps<TSnapshot>) => unknown;
};

export type PlayerDisplayProps<TSnapshot extends GameSnapshot = GameSnapshot> = {
  snapshot: TSnapshot;
  frame?: Frame;
};

export type SeededRng = {
  next(): number;
  int(maxExclusive: number): number;
  range(minInclusive: number, maxInclusive: number): number;
};

export function inFloorBounds(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < FLOOR_COLS &&
    y >= 0 &&
    y < FLOOR_ROWS
  );
}

export function normalizeGameConfig(config: GameConfig, manifest: GameManifest): NormalizedGameConfig {
  return {
    seed: Number.isFinite(config.seed) ? Math.trunc(config.seed) : manifest.defaultSeed,
    playerCount: clamp(Math.round(config.playerCount), manifest.players.min, manifest.players.max),
    durationMillis: config.durationMillis ?? manifest.defaultDurationMillis,
    nowMillis: config.nowMillis ?? 0,
    difficulty: config.difficulty ?? "medium",
    options: config.options ?? {}
  };
}

export function createFrame(fill: HexColor = "#05070a"): Frame {
  const cells: FrameCell[] = [];

  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      cells.push({ x, y, color: fill });
    }
  }

  return {
    width: FLOOR_COLS,
    height: FLOOR_ROWS,
    cells
  };
}

export function paintFrameCell(frame: Frame, x: number, y: number, color: HexColor): void {
  if (!inFloorBounds(x, y)) {
    return;
  }

  frame.cells[y * frame.width + x] = { x, y, color };
}

export function frameCell(frame: Frame, x: number, y: number): FrameCell | undefined {
  if (!inFloorBounds(x, y)) {
    return undefined;
  }

  return frame.cells[y * frame.width + x];
}

export function fillFrameRect(frame: Frame, x: number, y: number, width: number, height: number, color: HexColor): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      paintFrameCell(frame, xx, yy, color);
    }
  }
}

export function setFrameCell(frame: Frame, x: number, y: number, color: HexColor): Frame {
  if (!inFloorBounds(x, y)) {
    return frame;
  }

  const index = y * frame.width + x;
  const cells = frame.cells.slice();
  cells[index] = { x, y, color };
  return {
    ...frame,
    cells
  };
}

export function gameEvent(cue: GameEventCue, message: string, atMillis: number): GameEvent {
  return { cue, message, atMillis };
}

export function readNumberOption(options: GameConfigOptions, key: string, fallback: number): number {
  const value = options[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function readClampedIntegerOption(
  options: GameConfigOptions,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  return clamp(Math.round(readNumberOption(options, key, fallback)), min, max);
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  if (state === 0) {
    state = 1;
  }

  return {
    next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(maxExclusive: number) {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
        throw new Error("maxExclusive must be greater than zero");
      }

      return Math.floor(this.next() * maxExclusive);
    },
    range(minInclusive: number, maxInclusive: number) {
      if (maxInclusive < minInclusive) {
        throw new Error("maxInclusive must be greater than or equal to minInclusive");
      }

      return minInclusive + this.int(maxInclusive - minInclusive + 1);
    }
  };
}

export function defaultPlayers(count: number): GamePlayer[] {
  const colors: HexColor[] = ["#35d7ff", "#ff3bd7", "#ffe176", "#5fff9e"];

  return Array.from({ length: count }, (_, index) => ({
    index,
    label: `Player ${index + 1}`,
    color: colors[index % colors.length],
    score: 0,
    lives: -1
  }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createGameEngine(game: GameInstance, options: GameEngineOptions = {}): GameEngine {
  return new DefaultGameEngine(game, options);
}

function normalizeEngineFps(fps: number | undefined): number {
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) {
    return DEFAULT_ENGINE_FPS;
  }

  return fps;
}

function normalizeMillis(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

class DefaultGameEngine implements GameEngine {
  private currentClockMillis: number;
  private currentFps: number;
  private currentFrameMillis: number;
  private currentGame: GameInstance;
  private currentState: GameEngineState;

  constructor(game: GameInstance, options: GameEngineOptions) {
    this.currentGame = game;
    this.currentClockMillis = options.nowMillis ?? 0;
    this.currentFps = normalizeEngineFps(options.fps);
    this.currentFrameMillis = 1000 / this.currentFps;
    this.currentState = this.composeState(options.initialEvents ?? []);
  }

  get clockMillis(): number {
    return this.currentClockMillis;
  }

  get fps(): number {
    return this.currentFps;
  }

  get frameMillis(): number {
    return this.currentFrameMillis;
  }

  get state(): GameEngineState {
    return this.currentState;
  }

  press(x: number, y: number, atMillis = this.currentClockMillis): GameEngineState {
    this.currentClockMillis = Math.max(this.currentClockMillis, normalizeMillis(atMillis));
    return this.refresh(this.currentGame.press({
      x,
      y,
      pressed: true,
      atMillis: this.currentClockMillis
    }));
  }

  refresh(events: GameEvent[] = []): GameEngineState {
    this.currentState = this.composeState(events);
    return this.currentState;
  }

  release(x: number, y: number, atMillis = this.currentClockMillis): GameEngineState {
    this.currentClockMillis = Math.max(this.currentClockMillis, normalizeMillis(atMillis));
    return this.refresh(this.currentGame.release({
      x,
      y,
      pressed: false,
      atMillis: this.currentClockMillis
    }));
  }

  replaceGame(game: GameInstance, options: GameEngineOptions = {}): GameEngineState {
    this.currentGame = game;
    this.currentClockMillis = options.nowMillis ?? 0;
    this.currentFps = normalizeEngineFps(options.fps ?? this.currentFps);
    this.currentFrameMillis = 1000 / this.currentFps;
    return this.refresh(options.initialEvents ?? []);
  }

  step(deltaMillis = this.currentFrameMillis): GameEngineState {
    const safeDelta = Number.isFinite(deltaMillis) ? Math.max(0, deltaMillis) : this.currentFrameMillis;
    return this.tickTo(this.currentClockMillis + safeDelta);
  }

  tickTo(atMillis: number): GameEngineState {
    this.currentClockMillis = Math.max(this.currentClockMillis, normalizeMillis(atMillis));
    return this.refresh(this.currentGame.tick({ atMillis: this.currentClockMillis }));
  }

  private composeState(events: GameEvent[]): GameEngineState {
    const snapshot = this.currentGame.snapshot();

    return {
      clockMillis: this.currentClockMillis,
      events,
      fps: this.currentFps,
      frame: this.currentGame.render(),
      frameMillis: this.currentFrameMillis,
      snapshot
    };
  }
}

export function rgbToHex(color: RgbColor): HexColor {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

export function scaleRgb(color: RgbColor, percent: number): RgbColor {
  return {
    r: clamp(Math.round((color.r * percent) / 100), 0, 255),
    g: clamp(Math.round((color.g * percent) / 100), 0, 255),
    b: clamp(Math.round((color.b * percent) / 100), 0, 255)
  };
}

export function addRgb(left: RgbColor, right: RgbColor): RgbColor {
  return {
    r: clamp(left.r + right.r, 0, 255),
    g: clamp(left.g + right.g, 0, 255),
    b: clamp(left.b + right.b, 0, 255)
  };
}

function hexByte(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

export function formatClock(ms: number): string {
  const safeMs = Math.max(0, Math.ceil(ms));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
