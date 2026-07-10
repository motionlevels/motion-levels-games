import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scaffoldReadmeTemplate } from "./game-scaffold-readme.ts";

type CreateGameOptions = {
  force: boolean;
  gameId: string;
  label: string;
  root: string;
};

const args = process.argv.slice(2);

if (isCliEntry()) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  await createGameScaffold(options);

  console.log(`Created ${options.gameId} in ${path.relative(process.cwd(), gameRoot(options)) || "."}`);
  console.log("The playground discovers games from games/*/src/index.ts; restart is usually not needed while Vite is running.");
}

export async function createGameScaffold(options: CreateGameOptions): Promise<void> {
  validateGameId(options.gameId);

  const root = gameRoot(options);
  if (!options.force && await exists(root)) {
    throw new Error(`games/${options.gameId} already exists. Use --force to overwrite scaffold files.`);
  }

  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });

  const files = new Map<string, string>([
    ["README.md", scaffoldReadmeTemplate(options)],
    ["package.json", packageJsonTemplate(options)],
    ["tsconfig.json", tsconfigTemplate()],
    ["src/manifest.ts", manifestTemplate(options)],
    ["src/game.ts", gameTemplate(options)],
    ["src/display.tsx", displayTemplate()],
    ["src/fixtures.ts", fixturesTemplate()],
    ["src/index.ts", indexTemplate()],
    [`test/${options.gameId}.test.ts`, testTemplate(options)]
  ]);

  for (const [relativePath, contents] of files) {
    await writeFile(path.join(root, relativePath), contents);
  }
}

function parseArgs(rawArgs: string[]): CreateGameOptions {
  let force = false;
  let root = process.cwd();
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--force") {
      force = true;
    } else if (arg === "--root") {
      const value = rawArgs[index + 1];
      if (!value) {
        throw new Error("--root requires a value");
      }
      root = path.resolve(value);
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  const [gameId, ...labelParts] = positional;
  if (!gameId) {
    printHelp();
    throw new Error("missing game id");
  }

  return {
    force,
    gameId,
    label: labelParts.length > 0 ? labelParts.join(" ") : titleCase(gameId),
    root
  };
}

function validateGameId(gameId: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameId)) {
    throw new Error("game id must be lowercase kebab-case and match the games/<id> directory name");
  }
}

function gameRoot(options: Pick<CreateGameOptions, "gameId" | "root">): string {
  return path.join(options.root, "games", options.gameId);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function titleCase(gameId: string): string {
  return gameId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function packageJsonTemplate(options: CreateGameOptions): string {
  return `${JSON.stringify({
    name: `@motion-levels-games/${options.gameId}`,
    version: "0.1.0",
    private: true,
    type: "module",
    exports: {
      ".": "./src/index.ts",
      "./fixtures": "./src/fixtures.ts",
      "./manifest": "./src/manifest.ts"
    },
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "tsx --test test/*.test.ts",
      typecheck: "tsc -p tsconfig.json"
    },
    dependencies: {
      "@motion-levels-games/display-kit": "0.1.0",
      "@motion-levels-games/game-sdk": "0.1.0",
      react: "^19.2.7"
    },
    devDependencies: {
      "@types/react": "^19.2.17",
      "@types/react-dom": "^19.2.3",
      "react-dom": "^19.2.7"
    }
  }, null, 2)}\n`;
}

function tsconfigTemplate(): string {
  return `{
  "extends": "../../tsconfig.base.json",
  "include": [
    "src",
    "test"
  ]
}
`;
}

function manifestTemplate(options: CreateGameOptions): string {
  return `import type { GameManifest } from "@motion-levels-games/game-sdk";

export const manifest: GameManifest = {
  id: ${JSON.stringify(options.gameId)},
  label: ${JSON.stringify(options.label)},
  description: "Scaffolded Motion Levels game.",
  players: {
    allowAny: true,
    min: 1,
    max: 1
  },
  start: { mode: "player-ready" },
  defaultDurationMillis: 30_000,
  display: {
    entry: "./display"
  },
  tags: ["scaffold", "typescript"]
};
`;
}

function gameTemplate(_options: CreateGameOptions): string {
  return `import {
  createFrame,
  createHorizontalPlayerReadyZones,
  createPlayerReadyGate,
  defaultPlayers,
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
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { paintDiamondRing } from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

export const targetColor: HexColor = "#7ee787";
export const targetScore = 3;

type Target = {
  x: number;
  y: number;
};

const targetPath: Target[] = [
  { x: 4, y: 8 },
  { x: 11, y: 16 },
  { x: 4, y: 24 }
];

export function createGame(config: GameConfig): GameInstance {
  return new ScaffoldedGame(config);
}

class ScaffoldedGame implements GameInstance {
  private config: NormalizedGameConfig;
  private phase: GamePhase = "ready";
  private readyGate: PlayerReadyGate;
  private score = 0;
  private startedAtMillis = 0;
  private nowMillis = 0;
  private players: GamePlayer[];
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.readyGate = createPlayerReadyGate(manifest.start, createHorizontalPlayerReadyZones(1), this.config.nowMillis);
    this.players = this.scoredPlayers();
  }

  init(nowMillis: number): GameEvent[] {
    this.readyGate.reset(nowMillis);
    this.phase = "waiting";
    this.nowMillis = nowMillis;
    this.lastEvent = gameEvent("ready", "Esperando jugador", nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;

    if (this.phase === "waiting" || this.phase === "starting") {
      return this.applyReadyTransition(this.readyGate.update(event), event.atMillis);
    }

    if (this.phase !== "running" || !event.pressed) {
      return [];
    }

    const target = targetPath[this.score];
    if (!target || event.x !== target.x || event.y !== target.y) {
      return [];
    }

    this.score += 1;
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent(
      this.score >= targetScore ? "win" : "hit",
      this.score >= targetScore ? "Terminado" : "Acierto " + this.score,
      event.atMillis
    );

    if (this.score >= targetScore) {
      this.phase = "finished";
    }

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

    if (this.phase !== "running" || this.remainingMillis() > 0) {
      return [];
    }

    this.phase = "finished";
    this.lastEvent = gameEvent(this.score >= targetScore ? "win" : "fail", "Tiempo", event.atMillis);
    return [this.lastEvent];
  }

  render(): Frame {
    const frame = createFrame("#05070a");
    const target = targetPath[this.score];

    if (this.phase === "waiting" || this.phase === "starting") {
      const centerX = 8;
      const centerY = 16;
      const radius = 2 + Math.floor(this.nowMillis / 150) % 8;
      paintDiamondRing(frame, {
        centerX,
        centerY,
        color: this.phase === "starting" ? "#ffe176" : targetColor,
        radius
      });
      return frame;
    }

    if (this.phase === "running" && target) {
      paintFrameCell(frame, target.x, target.y, targetColor);
    }

    return frame;
  }

  snapshot(): GameSnapshot {
    const readyState = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: this.phase,
      playerCount: this.config.playerCount,
      players: this.players,
      score: this.score,
      lives: -1,
      elapsedMillis: this.elapsedMillis(),
      remainingMillis: this.remainingMillis(),
      activeTargets: this.phase === "running" ? 1 : 0,
      success: this.score >= targetScore,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? readyState.countdownMillis : 0,
      readyPlayers: readyState.readyPlayers,
      requiredPlayers: readyState.requiredPlayers,
      matchTarget: targetScore
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.readyGate.reset(this.config.nowMillis);
    this.phase = "waiting";
    this.score = 0;
    this.startedAtMillis = this.config.nowMillis;
    this.nowMillis = this.config.nowMillis;
    this.players = this.scoredPlayers();
    this.lastEvent = gameEvent("ready", "Esperando jugador", this.config.nowMillis);
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
      this.phase = "running";
      this.startedAtMillis = nowMillis;
      this.lastEvent = gameEvent("start", "Pisa la baldosa verde", nowMillis);
      return [this.lastEvent];
    }
    return [];
  }

  private elapsedMillis(): number {
    if (this.phase === "waiting" || this.phase === "starting") {
      return 0;
    }
    return Math.max(0, this.nowMillis - this.startedAtMillis);
  }

  private remainingMillis(): number {
    return Math.max(0, this.config.durationMillis - this.elapsedMillis());
  }

  private scoredPlayers(): GamePlayer[] {
    return defaultPlayers(this.config.playerCount, this.config.players).map((player) => ({
      ...player,
      score: this.score
    }));
  }
}

export function scaffoldTargets(): Target[] {
  return targetPath.map((target) => ({ ...target }));
}
`;
}

function displayTemplate(): string {
  return `/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type GameSnapshot } from "@motion-levels-games/game-sdk";

export function PlayerDisplay({
  snapshot,
  frame
}: {
  snapshot: GameSnapshot;
  frame?: Frame;
}) {
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Puntos" tone="green" value={snapshot.score} />
            <MetricPanel label="Objetivo" tone="yellow" value={snapshot.matchTarget ?? 3} />
            <MetricPanel label="Tiempo" tone="cyan" value={formatClock(snapshot.remainingMillis)} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Aviso" tone={snapshot.success ? "green" : "blue"} value={snapshot.lastEventMessage || "Listo"} />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Juego en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
`;
}

function fixturesTemplate(): string {
  return `import { createGame } from "./game.ts";
import { manifest } from "./manifest.ts";

const game = createGame({
  playerCount: manifest.players.min,
  durationMillis: manifest.defaultDurationMillis
});

export const initEvents = game.init(0);
game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
game.tick({ atMillis: 2_100 });
export const runningFrame = game.render();
export const runningSnapshot = game.snapshot();

game.press({ x: 4, y: 8, pressed: true, atMillis: 2_200 });
game.press({ x: 11, y: 16, pressed: true, atMillis: 2_300 });
game.press({ x: 4, y: 24, pressed: true, atMillis: 2_400 });

export const finishedFrame = game.render();
export const finishedSnapshot = game.snapshot();
`;
}

function indexTemplate(): string {
  return `export { PlayerDisplay } from "./display.tsx";
export { createGame, scaffoldTargets, targetColor, targetScore } from "./game.ts";
export { finishedFrame, finishedSnapshot, initEvents, runningFrame, runningSnapshot } from "./fixtures.ts";
export { manifest } from "./manifest.ts";
`;
}

function testTemplate(options: CreateGameOptions): string {
  return `import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameCell } from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  scaffoldTargets,
  targetColor,
  targetScore
} from "../src/index.ts";

test("manifest id matches the game directory", () => {
  assert.equal(manifest.id, ${JSON.stringify(options.gameId)});
});

test("game renders and completes the scaffolded path", () => {
  const game = createGame({ playerCount: manifest.players.min });
  game.init(0);
  assert.equal(game.snapshot().phase, "waiting");
  game.press({ x: 8, y: 16, pressed: true, atMillis: 100 });
  assert.equal(game.snapshot().phase, "starting");
  game.tick({ atMillis: 2_100 });

  const firstTarget = scaffoldTargets()[0];
  assert.equal(frameCell(game.render(), firstTarget.x, firstTarget.y)?.color, targetColor);

  scaffoldTargets().forEach((target, index) => {
    game.press({ ...target, pressed: true, atMillis: 2_200 + index * 100 });
  });

  assert.equal(game.snapshot().phase, "finished");
  assert.equal(game.snapshot().score, targetScore);
  assert.equal(game.snapshot().success, true);
});

test("fixtures and display render", () => {
  assert.equal(runningSnapshot.currentGame, manifest.id);
  assert.equal(finishedSnapshot.success, true);

  const html = renderToStaticMarkup(
    React.createElement(PlayerDisplay, {
      snapshot: runningSnapshot,
      frame: runningFrame
    })
  );

  assert.match(html, new RegExp(manifest.label));
  assert.match(html, /Puntos/);
});
`;
}

function printHelp(): void {
  console.log(`Usage:
  npm run create:game -- <game-id> [Display Name]

Options:
  --force        overwrite scaffold files
  --root <path>  create under a different repo-like root, useful for tests

Example:
  npm run create:game -- color-chase "Color Chase"`);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}
