import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrame,
  createGameEngine,
  DEFAULT_ENGINE_FPS,
  gameEvent,
  normalizeGameConfig,
  paintFrameCell,
  type GameInstance,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { gamePackageRegistry } from "../../../packages/runtime/src/gameplayRegistry.ts";
import { collectPreviewFrames } from "../src/previewCapture.ts";

test("every authored game preview contains visible movement", () => {
  for (const game of gamePackageRegistry.values()) {
    const preview = game.manifest.preview;
    const config = normalizeGameConfig({
      difficulty: preview.difficulty,
      options: preview.options,
      playerCount: preview.playerCount,
      seed: preview.seed
    }, game.manifest);
    const instance = game.createGame({
      ...config,
      durationMillis: game.manifest.defaultDurationMillis,
      nowMillis: 0
    });
    const engine = createGameEngine(instance, {
      fps: DEFAULT_ENGINE_FPS,
      initialEvents: instance.init(0)
    });
    const frames = collectPreviewFrames(engine, preview);
    const uniqueFrames = new Set(frames.map((frame) => frame.display.frame.cells.map((cell) => cell.color).join("")));

    assert.ok(uniqueFrames.size > 1, `${game.manifest.id} preview must contain visible movement`);
  }
});

test("preview capture applies actions in order between captured frames", () => {
  const held = new Set<string>();
  const ticks: number[] = [];
  const presses: string[] = [];
  const releases: string[] = [];
  const game: GameInstance = {
    init: (atMillis) => [gameEvent("ready", "Ready", atMillis)],
    press(event: PressEvent) {
      const key = `${event.x},${event.y}`;
      held.add(key);
      presses.push(`${key}@${event.atMillis}`);
      return [];
    },
    release(event: PressEvent) {
      const key = `${event.x},${event.y}`;
      held.delete(key);
      releases.push(`${key}@${event.atMillis}`);
      return [];
    },
    tick(event: TickEvent) {
      ticks.push(event.atMillis);
      return [];
    },
    render() {
      const frame = createFrame("#000000");
      for (const key of held) {
        const [x, y] = key.split(",").map(Number);
        paintFrameCell(frame, x!, y!, "#ffffff");
      }
      return frame;
    },
    snapshot() {
      return {
        activeTargets: held.size,
        currentGame: "preview-test",
        elapsedMillis: ticks.at(-1) ?? 0,
        label: "Preview test",
        lastEventCue: "none",
        lastEventMessage: [...held].sort().join(" "),
        lives: -1,
        phase: "running",
        playerCount: 1,
        players: [],
        remainingMillis: 0,
        score: 0,
        success: false
      };
    },
    reset() {
      held.clear();
    }
  };
  const engine = createGameEngine(game);

  const frames = collectPreviewFrames(engine, {
    seed: 137,
    playerCount: 1,
    actions: [
      { atMillis: 350, type: "press", x: 3, y: 3 },
      { atMillis: 150, type: "release", x: 1, y: 1 },
      { atMillis: 50, type: "press", x: 1, y: 1 },
      { atMillis: 150, type: "press", x: 2, y: 2 }
    ],
    captureStartMillis: 100,
    frameCount: 3,
    frameIntervalMillis: 100
  });

  assert.deepEqual(frames.map((frame) => frame.display.snapshot.lastEventMessage), ["1,1", "2,2", "2,2"]);
  assert.deepEqual(ticks, [50, 100, 150, 150, 200, 300]);
  assert.deepEqual(presses, ["1,1@50", "2,2@150"]);
  assert.deepEqual(releases, ["1,1@150"]);
});
