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

export function frameCell(frame: Frame, x: number, y: number): FrameCell | undefined {
  if (!inFloorBounds(x, y)) {
    return undefined;
  }

  return frame.cells[y * frame.width + x];
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

export function formatClock(ms: number): string {
  const safeMs = Math.max(0, Math.ceil(ms));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

