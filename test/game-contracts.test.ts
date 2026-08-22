import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import { livesSnapshotContractProblems } from "../scripts/lib/lives-snapshot-contract.ts";
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
type LoadedGameModule = Partial<RequiredGameModule> & Record<string, unknown>;

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gamesRoot = path.join(repoRoot, "games");
const gameIds = (await readdir(gamesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(gameIds.length > 0, "expected at least one discovered game");

test("lives snapshots distinguish games with lives from the no-lives sentinel", () => {
  assert.deepEqual(livesSnapshotContractProblems({ lives: -1 }), []);
  assert.deepEqual(livesSnapshotContractProblems({ lives: 0, maxLives: 3 }), []);
  assert.deepEqual(livesSnapshotContractProblems({ lives: 3, maxLives: 3 }), []);

  assert.match(
    livesSnapshotContractProblems({ lives: -1, maxLives: 3 }, "fixture").join("\n"),
    /fixture\.maxLives must be omitted when lives is -1/
  );
  assert.match(
    livesSnapshotContractProblems({ lives: 2 }, "fixture").join("\n"),
    /fixture\.maxLives is required and must be a finite integer/
  );
  assert.match(
    livesSnapshotContractProblems({ lives: 3, maxLives: 2 }, "fixture").join("\n"),
    /fixture\.maxLives must be greater than or equal to lives \(3\)/
  );
  assert.match(
    livesSnapshotContractProblems({ lives: 1, maxLives: Number.NaN }, "fixture").join("\n"),
    /received NaN/
  );
});

for (const gameId of gameIds) {
  test(`${gameId} satisfies the executable game contract`, async () => {
    const moduleUrl = pathToFileURL(path.join(gamesRoot, gameId, "src/index.ts")).href;
    const gameModule = await import(moduleUrl) as LoadedGameModule;
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
    assertDisplayLivesMarkup(liveMarkup, first.snapshot(), `${gameId} initial display`);
    if (first.snapshot().lives >= 0) {
      const maxLives = first.snapshot().maxLives!;
      for (const lives of new Set([maxLives, Math.floor(maxLives / 2), 0])) {
        const stateMarkup = renderToStaticMarkup(React.createElement(display, {
          frame: first.render(),
          snapshot: { ...first.snapshot(), lives }
        }));
        assertDisplayLivesMarkup(stateMarkup, { ...first.snapshot(), lives }, `${gameId} display at ${lives} lives`);
        assert.ok(
          stateMarkup.includes(`${lives} de ${maxLives} vidas restantes`),
          `${gameId} display must announce the full lives state at ${lives}/${maxLives}`
        );
      }
    }

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

    const maximumPlayerCount = Math.max(...playerCounts.filter((playerCount) => playerCount > 0));
    const stressConfig = normalizeGameConfig({
      difficulty: difficulties.at(-1),
      playerCount: maximumPlayerCount,
      players: Array.from({ length: maximumPlayerCount }, (_, index) => ({
        color: stressPlayerColors[index % stressPlayerColors.length]!,
        name: stressPlayerNames[index % stressPlayerNames.length]!
      })),
      seed: 137
    }, manifest);
    const stressGame = createGame(stressConfig);
    stressGame.init(0);
    const stressSnapshot = stressGame.snapshot();
    assertSnapshot(stressSnapshot, manifest.id, manifest.label);
    const stressMarkup = renderToStaticMarkup(React.createElement(display, {
      frame: stressGame.render(),
      snapshot: {
        ...stressSnapshot,
        lastEventMessage: "Transferencia completada por el equipo internacional",
        players: stressSnapshot.players.map((player, index) => ({
          ...player,
          label: stressPlayerNames[index % stressPlayerNames.length]!,
          score: 999_999 - index
        })),
        remainingMillis: 3_599_999,
        score: 999_999
      }
    }));
    assert.ok(stressMarkup.includes("data-display-root="), "the display must expose its geometry root contract");
    assertDisplayLivesMarkup(stressMarkup, stressSnapshot, `${gameId} maximum-player display`);

    for (const [exportName, value] of Object.entries(gameModule)) {
      if (!exportName.endsWith("Snapshot") || !isGameSnapshot(value)) continue;
      assertSnapshot(value, manifest.id, manifest.label, `${gameId}.${exportName}`);
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

function assertSnapshot(snapshot: GameSnapshot, gameId: string, label: string, context = `${gameId} snapshot`): void {
  assert.equal(snapshot.currentGame, gameId);
  assert.equal(snapshot.label, label);
  assert.ok(snapshot.phase.length > 0);
  assert.ok(Number.isFinite(snapshot.score));
  assert.ok(Number.isFinite(snapshot.elapsedMillis) && snapshot.elapsedMillis >= 0);
  assert.ok(Number.isFinite(snapshot.remainingMillis) && snapshot.remainingMillis >= 0);
  assert.ok(Number.isInteger(snapshot.activeTargets) && snapshot.activeTargets >= 0);
  assert.deepEqual(livesSnapshotContractProblems(snapshot, context), []);
  assert.doesNotMatch(snapshot.lastEventMessage, /\.$/, "snapshot messages must not end in periods");

  for (const player of snapshot.players) {
    assert.ok(Number.isInteger(player.index) && player.index >= 0);
    assert.ok(player.label.trim().length > 0);
    assert.match(player.color, /^#[0-9a-f]{6}$/i);
    assert.ok(Number.isFinite(player.score));
    assert.ok(Number.isInteger(player.lives) && player.lives >= -1);
  }
}

function assertDisplayLivesMarkup(markup: string, snapshot: GameSnapshot, context: string): void {
  const meterCount = countOccurrences(markup, "data-lives-meter=");
  const slotCount = countOccurrences(markup, "data-life-slot=");
  if (snapshot.lives === -1) {
    assert.equal(meterCount, 0, `${context} must not render a lives meter when lives is -1`);
    assert.equal(slotCount, 0, `${context} must not render heart slots when lives is -1`);
    return;
  }

  assert.equal(meterCount, 1, `${context} must render exactly one shared lives meter`);
  if (markup.includes("data-life-mode=\"compact\"")) {
    assert.equal(slotCount, 0, `${context} compact lives mode must not create an unbounded heart grid`);
    assert.ok(markup.includes("data-life-summary="), `${context} compact lives mode must render an explicit count`);
    return;
  }
  assert.equal(slotCount, snapshot.maxLives, `${context} must preserve exactly maxLives heart slots`);
}

function countOccurrences(value: string, fragment: string): number {
  return value.split(fragment).length - 1;
}

function isGameSnapshot(value: unknown): value is GameSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<GameSnapshot>;
  return typeof candidate.currentGame === "string"
    && typeof candidate.label === "string"
    && typeof candidate.lives === "number"
    && Array.isArray(candidate.players);
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

const stressPlayerNames = [
  "Alejandra del Equipo Relámpago",
  "Bruno de la Torre Internacional",
  "Carolina del Valle del Norte",
  "Diego de la Escuadra Galáctica",
  "Elena de los Exploradores",
  "Fernando del Equipo Esmeralda",
  "Gabriela de la Estación Central",
  "Hugo del Comando Ultravioleta"
] as const;

const stressPlayerColors = [
  "#ff3048",
  "#24d9ff",
  "#42e879",
  "#ff4fd8",
  "#376bff",
  "#ffd84d",
  "#a66cff",
  "#ff8a3d"
] as const;
