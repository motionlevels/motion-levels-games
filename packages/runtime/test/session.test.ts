import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GameManifest,
  type GameSnapshot,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { GameSession, buildGameplayRegistry, type GameplayModule } from "../src/index.ts";

const productionModule = gameModule("test-game", true);
const developmentModule = gameModule("development-game", false);
const failingModule: GameplayModule = {
  ...gameModule("failing-game", true),
  createGame: () => { throw new Error("invalid authored content"); }
};
const registry = buildGameplayRegistry([productionModule, developmentModule, failingModule]);

test("GameSession resolves an injected game without knowing the concrete catalog", () => {
  const session = new GameSession(registry);
  const initialized = session.select({ gameId: "OLD-TEST-GAME", playerCount: 1, seed: 137 });
  assert.equal(initialized.frame.width, FLOOR_COLS);
  assert.equal(initialized.frame.height, FLOOR_ROWS);
  assert.equal(initialized.frame.cells.length, FLOOR_COLS * FLOOR_ROWS);
  assert.equal(initialized.snapshot.currentGame, "test-game");
  assert.equal(session.press(7, 3).snapshot.score, 1);
});

test("GameSession rejects development-only games unless the host opts in", () => {
  const session = new GameSession(registry);
  assert.throws(() => session.select({ gameId: "development-game", playerCount: 1 }), /not production eligible/u);
  assert.equal(
    session.select({ gameId: "development-game", playerCount: 1, development: true }).gameId,
    "development-game"
  );
});

test("GameSession restarts with the normalized initial configuration", () => {
  const session = new GameSession(registry);
  const initial = session.select({ gameId: "test-game", playerCount: 2, seed: 137 });
  session.press(1, 1);
  const restarted = session.restart();
  assert.deepEqual(restarted.snapshot, initial.snapshot);
  assert.deepEqual(restarted.frame, initial.frame);
});

test("failed selections leave the active session and restart configuration intact", () => {
  const session = new GameSession(registry);
  session.select({ gameId: "test-game", playerCount: 1, seed: 137 });
  assert.throws(() => session.select({ gameId: "failing-game", playerCount: 1 }), /invalid authored content/u);
  assert.equal(session.state().snapshot.currentGame, "test-game");
  assert.equal(session.restart().snapshot.currentGame, "test-game");
});

test("pause blocks time and input while restart clears held input", () => {
  const session = new GameSession(registry, { fps: 25 });
  session.select({ gameId: "test-game", playerCount: 1 });
  session.press(2, 2, 10);
  const paused = session.pause(20);
  assert.equal(paused.paused, true);
  assert.equal(session.tick(2_000).clockMillis, 20);
  assert.equal(session.press(3, 3, 2_000).snapshot.score, 1);
  assert.equal(session.frameMillis, 40);
  assert.equal(session.step().clockMillis, 60);
  assert.equal(session.restart().snapshot.score, 0);
});

function gameModule(id: string, production: boolean): GameplayModule {
  const manifest: GameManifest = {
    id,
    aliases: id === "test-game" ? ["old-test-game"] : [],
    label: id,
    availability: { development: true, production },
    catalog: {
      category: "arcade",
      color: "#112233",
      durationLabel: "1 min",
      modeLabel: "Test",
      audioLabel: "Test",
      rules: []
    },
    players: { allowAny: true, min: 1, max: 4 },
    start: { mode: "immediate" },
    defaultDurationMillis: 60_000,
    display: { entry: "./display.tsx" },
    preview: {
      seed: 137,
      playerCount: 1,
      actions: [],
      captureStartMillis: 0,
      frameCount: 1,
      frameIntervalMillis: 20
    }
  };
  return { manifest, createGame: (config) => new FakeGame(id, config) };
}

class FakeGame implements GameInstance {
  private nowMillis = 0;
  private score = 0;

  constructor(private readonly id: string, private readonly config: GameConfig) {}

  init(nowMillis: number): GameEvent[] {
    this.nowMillis = nowMillis;
    return [];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.score += 1;
    return [];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  render(): Frame {
    return {
      width: FLOOR_COLS,
      height: FLOOR_ROWS,
      cells: Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, index) => ({
        x: index % FLOOR_COLS,
        y: Math.floor(index / FLOOR_COLS),
        color: "#000000"
      }))
    };
  }

  snapshot(): GameSnapshot {
    return {
      currentGame: this.id,
      label: this.id,
      phase: "running",
      playerCount: this.config.playerCount ?? 1,
      players: [],
      score: this.score,
      lives: -1,
      elapsedMillis: this.nowMillis,
      remainingMillis: 60_000 - this.nowMillis,
      activeTargets: 0,
      success: false,
      lastEventCue: "none",
      lastEventMessage: ""
    };
  }

  reset(): void {
    this.nowMillis = 0;
    this.score = 0;
  }
}
