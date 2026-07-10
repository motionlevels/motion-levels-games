export const FLOOR_COLS = 16;
export const FLOOR_ROWS = 32;
export const DEFAULT_GAME_SEED = 137;
export const MIN_GAME_SEED = 0;
export const MAX_GAME_SEED = 0xffff_ffff;
export const FRAME_SIZE = FLOOR_COLS * FLOOR_ROWS;
export const DEFAULT_START_COUNTDOWN_MILLIS = 2_000;
export const DEFAULT_PLAYER_RELEASE_GRACE_MILLIS = 650;

export {
  paintDiamondRing,
  paintDiamondWave,
  type DiamondRingOptions,
  type DiamondWaveOptions,
  type FloorEffectCell,
  type FloorEffectColor
} from "./effects.ts";

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

export type GamePhase = "waiting" | "starting" | "ready" | "running" | "paused" | "finished";

export type GameStartPolicy =
  | {
      mode: "player-ready";
      countdownMillis?: number;
      releaseGraceMillis?: number;
    }
  | {
      mode: "immediate";
      countdownMillis?: never;
      releaseGraceMillis?: never;
    };

export type PlayerReadyZone = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type PlayerReadyPhase = "waiting" | "starting" | "running";

export type PlayerReadyTransition = "none" | "players-ready" | "players-left" | "started";

export type PlayerReadyGateState = {
  phase: PlayerReadyPhase;
  readyPlayers: number;
  requiredPlayers: number;
  countdownMillis: number;
};

export type PlayerReadyGate = {
  reset(nowMillis?: number): PlayerReadyGateState;
  update(event: PressEvent): PlayerReadyTransition;
  tick(nowMillis: number): PlayerReadyTransition;
  state(nowMillis: number): PlayerReadyGateState;
  zoneReady(index: number, nowMillis: number): boolean;
};

export type GamePlayer = {
  index: number;
  label: string;
  color: HexColor;
  score: number;
  lives: number;
};

export type GameConfigPlayer = {
  index?: number;
  id?: string;
  label?: string;
  name?: string;
  color?: HexColor;
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
  maxLives?: number;
  countdownMillis?: number;
  readyPlayers?: number;
  requiredPlayers?: number;
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
  availability: {
    development: boolean;
    production: boolean;
  };
  catalog: {
    category: "team" | "versus" | "individual" | "arcade";
    color: HexColor;
    durationLabel: string;
    modeLabel: string;
    audioLabel: string;
    rules: readonly string[];
  };
  players: {
    allowAny: boolean;
    min: number;
    max: number;
  };
  start: GameStartPolicy;
  config?: GameManifestConfig;
  defaultDurationMillis: number;
  display: {
    entry: string;
  };
  preview: GamePreviewScenario;
  tags?: string[];
};

export type GamePreviewAction = {
  atMillis: number;
  type: "press" | "release";
  x: number;
  y: number;
};

export type GamePreviewScenario = {
  seed: number;
  playerCount: number;
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
  actions: readonly GamePreviewAction[];
  captureStartMillis: number;
  frameCount: number;
  frameIntervalMillis: number;
};

export type GameManifestConfig = {
  difficulty?: {
    default?: GameDifficulty;
    options?: GameDifficulty[];
  };
  vars?: GameConfigVar[];
};

export type GameConfigVarType = "int" | "float" | "bool" | "enum";

type GameConfigVarBase = {
  key: string;
  label: string;
  playerFacing: boolean;
  description?: string;
};

export type GameConfigVar =
  | (GameConfigVarBase & {
      type: "int" | "float";
      default: number;
      min?: number;
      max?: number;
      step?: number;
      options?: never;
    })
  | (GameConfigVarBase & {
      type: "bool";
      default: boolean;
      min?: never;
      max?: never;
      step?: never;
      options?: never;
    })
  | (GameConfigVarBase & {
      type: "enum";
      default: string;
      options: Array<{ value: string; label?: string }>;
      min?: never;
      max?: never;
      step?: never;
    });

export type GameConfigValue<T extends GameConfigVar = GameConfigVar> =
  T extends { type: "int" | "float" }
    ? number
    : T extends { type: "bool" }
      ? boolean
      : string;

export type GameConfig = {
  seed?: number;
  playerCount?: number;
  players?: GameConfigPlayer[];
  durationMillis?: number;
  nowMillis?: number;
  difficulty?: GameDifficulty;
  options?: GameConfigOptions;
};

export type GameConfigOptions = Record<string, unknown>;
export type GameDifficulty = "easy" | "medium" | "hard" | "expert" | string;

export const DEFAULT_GAME_DIFFICULTIES: readonly GameDifficulty[] = ["easy", "medium", "hard", "expert"];

export type NormalizedGameConfig = {
  seed: number;
  playerCount: number;
  players: GameConfigPlayer[];
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

export const DEFAULT_ENGINE_FPS = 50;
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
    seed: normalizeGameSeed(config.seed),
    playerCount: normalizePlayerCount(config.playerCount, manifest),
    players: Array.isArray(config.players) ? config.players : [],
    durationMillis: normalizeNonNegativeNumber(config.durationMillis, manifest.defaultDurationMillis),
    nowMillis: normalizeNonNegativeNumber(config.nowMillis, 0),
    difficulty: normalizeGameDifficulty(config.difficulty, manifest),
    options: normalizeGameConfigOptions(config.options, manifest)
  };
}

export function normalizeGameSeed(value: number | undefined): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_GAME_SEED;
  return clamp(candidate, MIN_GAME_SEED, MAX_GAME_SEED);
}

function normalizePlayerCount(value: number | undefined, manifest: GameManifest): number {
  const rounded = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : defaultGamePlayerCount(manifest);
  if (manifest.players.allowAny === true && rounded === 0) {
    return 0;
  }

  return clamp(rounded, manifest.players.min, manifest.players.max);
}

export function defaultGamePlayerCount(manifest: GameManifest): number {
  return manifest.players.allowAny ? 0 : manifest.players.min;
}

export function gamePlayerCountOptions(manifest: GameManifest): number[] {
  const declaredCounts = Array.from(
    { length: manifest.players.max - manifest.players.min + 1 },
    (_, index) => manifest.players.min + index
  );
  return manifest.players.allowAny ? [0, ...declaredCounts] : declaredCounts;
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function gameDifficultyOptions(manifest: GameManifest): GameDifficulty[] {
  const configured = manifest.config?.difficulty?.options;
  return configured?.length ? [...configured] : [...DEFAULT_GAME_DIFFICULTIES];
}

export function normalizeGameDifficulty(value: GameDifficulty | undefined, manifest: GameManifest): GameDifficulty {
  const options = gameDifficultyOptions(manifest);
  const configuredDefault = manifest.config?.difficulty?.default;
  const fallback = configuredDefault && options.includes(configuredDefault)
    ? configuredDefault
    : options.includes("medium")
      ? "medium"
      : options[0] ?? "medium";

  return value && options.includes(value) ? value : fallback;
}

export function normalizeGameConfigOptions(
  options: GameConfigOptions | undefined,
  manifest: GameManifest
): GameConfigOptions {
  const source = options ?? {};
  return Object.fromEntries(
    (manifest.config?.vars ?? []).map((configVar) => [
      configVar.key,
      normalizeGameConfigValue(configVar, source[configVar.key])
    ])
  );
}

export function normalizeGameConfigValue<T extends GameConfigVar>(
  configVar: T,
  value: unknown
): GameConfigValue<T> {
  if (configVar.type === "bool") {
    const normalized = value === true || value === "true"
      ? true
      : value === false || value === "false"
        ? false
        : configVar.default;
    return normalized as GameConfigValue<T>;
  }

  if (configVar.type === "enum") {
    const candidate = String(value ?? configVar.default);
    const normalized = configVar.options.some((option) => option.value === candidate)
      ? candidate
      : configVar.default;
    return normalized as GameConfigValue<T>;
  }

  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  const finite = Number.isFinite(numeric) ? numeric : configVar.default;
  const rounded = configVar.type === "int" ? Math.round(finite) : finite;
  const normalized = clamp(rounded, configVar.min ?? -Infinity, configVar.max ?? Infinity);
  return normalized as GameConfigValue<T>;
}

export function readGameConfigOption<T extends GameConfigVar>(
  options: GameConfigOptions,
  configVar: T
): GameConfigValue<T> {
  return normalizeGameConfigValue(configVar, options[configVar.key]);
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
  return { cue, message: message.trimEnd().replace(/\.+$/u, ""), atMillis };
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

export function defaultPlayers(count: number, players: GameConfigPlayer[] = []): GamePlayer[] {
  const colors = ["#35d7ff", "#ff3bd7", "#ffe176", "#5fff9e"] as const satisfies readonly HexColor[];

  return Array.from({ length: count }, (_, index) => ({
    index,
    label: players[index]?.label || players[index]?.name || `Player ${index + 1}`,
    color: players[index]?.color || colors[index % colors.length] || colors[0],
    score: 0,
    lives: -1
  }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createHorizontalPlayerReadyZones(
  count: number,
  bounds: Partial<PlayerReadyZone> = {}
): PlayerReadyZone[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("player ready zone count must be a positive integer");
  }

  const minX = clamp(Math.round(bounds.minX ?? 0), 0, FLOOR_COLS - 1);
  const maxX = clamp(Math.round(bounds.maxX ?? FLOOR_COLS - 1), minX, FLOOR_COLS - 1);
  const minY = clamp(Math.round(bounds.minY ?? 0), 0, FLOOR_ROWS - 1);
  const maxY = clamp(Math.round(bounds.maxY ?? FLOOR_ROWS - 1), minY, FLOOR_ROWS - 1);
  const height = maxY - minY + 1;

  if (count > height) {
    throw new Error("player ready zone count cannot exceed the available floor rows");
  }

  return Array.from({ length: count }, (_, index) => ({
    minX,
    maxX,
    minY: minY + Math.floor((height * index) / count),
    maxY: minY + Math.floor((height * (index + 1)) / count) - 1
  }));
}

export function createPlayerReadyGate(
  policy: GameStartPolicy,
  zones: PlayerReadyZone[],
  nowMillis = 0
): PlayerReadyGate {
  return new DefaultPlayerReadyGate(policy, zones, nowMillis);
}

export function gameStartCountdownMillis(policy: GameStartPolicy): number {
  return normalizePositiveMillis(
    policy.mode === "player-ready" ? policy.countdownMillis : undefined,
    DEFAULT_START_COUNTDOWN_MILLIS
  );
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

class DefaultPlayerReadyGate implements PlayerReadyGate {
  private readonly countdownDuration: number;
  private readonly releaseGraceMillis: number;
  private readonly tileZones = new Int16Array(FRAME_SIZE).fill(-1);
  private readonly tileHeld = new Uint8Array(FRAME_SIZE);
  private readonly zoneHeld: number[];
  private readonly zoneGraceUntil: number[];
  private phase: PlayerReadyPhase;
  private startAtMillis = 0;

  constructor(
    private readonly policy: GameStartPolicy,
    private readonly zones: PlayerReadyZone[],
    nowMillis: number
  ) {
    if (policy.mode === "player-ready" && zones.length === 0) {
      throw new Error("player-ready games require at least one presence zone");
    }

    this.countdownDuration = gameStartCountdownMillis(policy);
    this.releaseGraceMillis = normalizePositiveMillis(
      policy.mode === "player-ready" ? policy.releaseGraceMillis : undefined,
      DEFAULT_PLAYER_RELEASE_GRACE_MILLIS
    );
    this.zoneHeld = Array.from({ length: zones.length }, () => 0);
    this.zoneGraceUntil = Array.from({ length: zones.length }, () => 0);
    this.phase = policy.mode === "immediate" ? "running" : "waiting";

    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        this.tileZones[y * FLOOR_COLS + x] = zones.findIndex((zone) => pointInReadyZone(x, y, zone));
      }
    }

    this.reset(nowMillis);
  }

  reset(nowMillis = 0): PlayerReadyGateState {
    this.tileHeld.fill(0);
    this.zoneHeld.fill(0);
    this.zoneGraceUntil.fill(0);
    this.phase = this.policy.mode === "immediate" ? "running" : "waiting";
    this.startAtMillis = normalizeMillis(nowMillis);
    return this.state(nowMillis);
  }

  update(event: PressEvent): PlayerReadyTransition {
    if (!inFloorBounds(event.x, event.y)) {
      return this.tick(event.atMillis);
    }

    const tileIndex = event.y * FLOOR_COLS + event.x;
    const zoneIndex = this.tileZones[tileIndex] ?? -1;
    const held = this.tileHeld[tileIndex] === 1;
    if (zoneIndex >= 0 && held !== event.pressed) {
      this.tileHeld[tileIndex] = event.pressed ? 1 : 0;
      if (event.pressed) {
        this.zoneHeld[zoneIndex] = (this.zoneHeld[zoneIndex] ?? 0) + 1;
        this.zoneGraceUntil[zoneIndex] = 0;
      } else {
        this.zoneHeld[zoneIndex] = Math.max(0, (this.zoneHeld[zoneIndex] ?? 0) - 1);
        if (this.zoneHeld[zoneIndex] === 0) {
          this.zoneGraceUntil[zoneIndex] = normalizeMillis(event.atMillis) + this.releaseGraceMillis;
        }
      }
    }

    return this.tick(event.atMillis);
  }

  tick(nowMillis: number): PlayerReadyTransition {
    if (this.policy.mode === "immediate" || this.phase === "running") {
      return "none";
    }

    const now = normalizeMillis(nowMillis);
    const allReady = this.readyPlayerCount(now) === this.zones.length;
    if (this.phase === "waiting" && allReady) {
      this.phase = "starting";
      this.startAtMillis = now + this.countdownDuration;
      return "players-ready";
    }
    if (this.phase === "starting" && !allReady) {
      this.phase = "waiting";
      this.startAtMillis = 0;
      return "players-left";
    }
    if (this.phase === "starting" && now >= this.startAtMillis) {
      this.phase = "running";
      return "started";
    }
    return "none";
  }

  state(nowMillis: number): PlayerReadyGateState {
    const now = normalizeMillis(nowMillis);
    return {
      phase: this.phase,
      readyPlayers: this.readyPlayerCount(now),
      requiredPlayers: this.zones.length,
      countdownMillis: this.phase === "starting" ? Math.max(0, this.startAtMillis - now) : 0
    };
  }

  zoneReady(index: number, nowMillis: number): boolean {
    const graceUntil = this.zoneGraceUntil[index] ?? 0;
    return (this.zoneHeld[index] ?? 0) > 0 || (graceUntil > 0 && graceUntil >= normalizeMillis(nowMillis));
  }

  private readyPlayerCount(nowMillis: number): number {
    return this.zones.reduce((count, _zone, index) => count + Number(this.zoneReady(index, nowMillis)), 0);
  }
}

function normalizePositiveMillis(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function pointInReadyZone(x: number, y: number, zone: PlayerReadyZone): boolean {
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY;
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
