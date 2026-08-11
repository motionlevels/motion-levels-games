import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  FRAME_SIZE,
  defaultGamePlayerCount,
  gameDifficultyOptions,
  gameManifestSlug,
  gamePlayerCountOptions,
  normalizeGameConfig,
  type Frame,
  type GameEvent,
  type GameModule,
  type GameSnapshot,
  type PlayerDisplayProps
} from "@motion-levels-games/game-sdk";

type RequiredGameModule = Required<Pick<GameModule, "PlayerDisplay" | "createGame" | "manifest">>;

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gamesRoot = path.join(repoRoot, "games");
const gameIds = (await readdir(gamesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(gameIds.length > 0, "expected at least one discovered game");

for (const gameId of gameIds) {
  test(`${gameId} satisfies the executable game contract`, async () => {
    const moduleUrl = pathToFileURL(path.join(gamesRoot, gameId, "src/index.ts")).href;
    const gameModule = await import(moduleUrl) as Partial<RequiredGameModule>;
    const { manifest, createGame, PlayerDisplay } = gameModule;

    assert.ok(manifest, "index.ts must export manifest");
    assert.ok(typeof createGame === "function", "index.ts must export createGame");
    assert.ok(typeof PlayerDisplay === "function", "index.ts must export PlayerDisplay");
    assert.equal(gameManifestSlug(manifest), gameId);

    const playerCounts = gamePlayerCountOptions(manifest);
    const difficulties = gameDifficultyOptions(manifest);
    assert.ok(playerCounts.length > 0);
    assert.equal(new Set(playerCounts).size, playerCounts.length, "player choices must be unique");
    assert.ok(difficulties.length > 0);
    assert.equal(new Set(difficulties).size, difficulties.length, "difficulty choices must be unique");

    const config = normalizeGameConfig({
      difficulty: difficulties[0],
      durationMillis: manifest.defaultDurationMillis,
      nowMillis: 0,
      playerCount: defaultGamePlayerCount(manifest),
      seed: 137
    }, manifest);
    const first = createGame(config);
    const second = createGame(config);
    const firstEvents = first.init(0);
    const secondEvents = second.init(0);

    assert.ok(firstEvents.length > 0, "initialization must explain the first player action");
    assert.deepEqual(firstEvents, secondEvents, "initial events must be deterministic");
    assert.deepEqual(first.snapshot(), second.snapshot(), "initial snapshots must be deterministic");
    assert.deepEqual(first.render(), second.render(), "initial floor frames must be deterministic");
    assertEvents(firstEvents);
    assertSnapshot(first.snapshot(), manifest.id, manifest.label);
    assertFrame(first.render());

    if (manifest.start.mode === "player-ready") {
      assert.equal(first.snapshot().phase, "waiting", "player-ready games must not autoplay");
      assert.equal(first.snapshot().readyPlayers, 0);
      assert.ok((first.snapshot().requiredPlayers ?? 0) > 0, "readiness must expose a required player count");
    }

    const firstTickEvents = first.tick({ atMillis: 333 });
    const secondTickEvents = second.tick({ atMillis: 333 });
    assert.deepEqual(firstTickEvents, secondTickEvents, "tick events must be deterministic");
    assert.deepEqual(first.snapshot(), second.snapshot(), "tick snapshots must be deterministic");
    assert.deepEqual(first.render(), second.render(), "tick frames must be deterministic");
    assertEvents(firstTickEvents);
    assertSnapshot(first.snapshot(), manifest.id, manifest.label);
    assertFrame(first.render());

    const display = PlayerDisplay as ComponentType<PlayerDisplayProps>;
    const liveMarkup = renderToStaticMarkup(React.createElement(display, {
      frame: first.render(),
      snapshot: first.snapshot()
    }));
    const pausedMarkup = renderToStaticMarkup(
      React.createElement(
        PlayerDisplayRuntimeProvider,
        { paused: true },
        React.createElement(display, { frame: first.render(), snapshot: first.snapshot() })
      )
    );
    assert.match(liveMarkup, new RegExp(escapeRegExp(manifest.label)));
    assert.match(pausedMarkup, /ml-status-paused/);
    assert.match(pausedMarkup, /En pausa/);

    for (const playerCount of playerCounts) {
      for (const difficulty of [difficulties[0], difficulties.at(-1)]) {
        assert.ok(difficulty);
        const candidateConfig = normalizeGameConfig({ difficulty, playerCount, seed: 137 }, manifest);
        const candidate = createGame(candidateConfig);
        candidate.init(0);
        if (playerCount === 0 && manifest.players.allowAny) {
          assert.ok(
            candidate.snapshot().playerCount === 0
              || (candidate.snapshot().playerCount >= manifest.players.min
                && candidate.snapshot().playerCount <= manifest.players.max),
            "Any mode must preserve the unconstrained roster or expose a valid effective roster"
          );
        } else {
          assert.equal(candidate.snapshot().playerCount, playerCount);
        }
        assertSnapshot(candidate.snapshot(), manifest.id, manifest.label);
        assertFrame(candidate.render());
      }
    }

    first.reset(config);
    const resetPeer = createGame(config);
    assert.deepEqual(first.init(0), firstEvents, "reset must restore deterministic initial events");
    resetPeer.init(0);
    assert.deepEqual(first.snapshot(), resetPeer.snapshot(), "reset must restore initial state");
    assert.deepEqual(first.render(), resetPeer.render(), "reset must restore the initial floor frame");
  });
}

function assertEvents(events: GameEvent[]): void {
  for (const event of events) {
    assert.ok(Number.isFinite(event.atMillis));
    assert.equal(event.message.trim(), event.message);
    assert.doesNotMatch(event.message, /\.$/, "event messages must not end in periods");
  }
}

function assertSnapshot(snapshot: GameSnapshot, gameId: string, label: string): void {
  assert.equal(snapshot.currentGame, gameId);
  assert.equal(snapshot.label, label);
  assert.ok(snapshot.phase.length > 0);
  assert.ok(Number.isFinite(snapshot.score));
  assert.ok(Number.isFinite(snapshot.elapsedMillis) && snapshot.elapsedMillis >= 0);
  assert.ok(Number.isFinite(snapshot.remainingMillis) && snapshot.remainingMillis >= 0);
  assert.ok(Number.isInteger(snapshot.activeTargets) && snapshot.activeTargets >= 0);
  assert.ok(Number.isInteger(snapshot.lives) && snapshot.lives >= -1);
  assert.doesNotMatch(snapshot.lastEventMessage, /\.$/, "snapshot messages must not end in periods");

  for (const player of snapshot.players) {
    assert.ok(Number.isInteger(player.index) && player.index >= 0);
    assert.ok(player.label.trim().length > 0);
    assert.match(player.color, /^#[0-9a-f]{6}$/i);
    assert.ok(Number.isFinite(player.score));
    assert.ok(Number.isFinite(player.lives));
  }
}

function assertFrame(frame: Frame): void {
  assert.equal(frame.width, FLOOR_COLS);
  assert.equal(frame.height, FLOOR_ROWS);
  assert.equal(frame.cells.length, FRAME_SIZE);

  const coordinates = new Set<string>();
  for (const cell of frame.cells) {
    assert.ok(Number.isInteger(cell.x) && cell.x >= 0 && cell.x < FLOOR_COLS);
    assert.ok(Number.isInteger(cell.y) && cell.y >= 0 && cell.y < FLOOR_ROWS);
    assert.match(cell.color, /^#[0-9a-f]{6}$/i);
    coordinates.add(`${cell.x}:${cell.y}`);
  }
  assert.equal(coordinates.size, FRAME_SIZE, "every physical floor coordinate must appear exactly once");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
