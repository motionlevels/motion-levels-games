import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as duelo from "@motion-levels-games/duelo";
import type { GameContentSelection, GameEntry, RegisteredGame } from "../src/contracts.ts";
import type { SessionOptions } from "../src/core/session.ts";
import { jugarRunFinishedPayload, loadGameEntry } from "../src/MinigameApp.tsx";

const canonicalLevelId = "33333333-3333-4333-8333-333333333307";
const selection = {
  difficulty: "medium",
  levelId: canonicalLevelId,
  mode: "free"
} satisfies GameContentSelection;

const registeredGame: RegisteredGame = {
  manifest: duelo.manifest,
  createGame: duelo.createGame,
  PlayerDisplay: () => null
};

test("host-authored content is loaded alongside the selected game module", async () => {
  const calls: GameContentSelection[] = [];
  const entry: GameEntry = {
    manifest: duelo.manifest,
    load: async () => registeredGame,
    contentSource: {
      list: async () => [{ id: canonicalLevelId, label: "Nivel 7" }],
      load: async (nextSelection) => {
        calls.push(nextSelection);
        return { schema: "motion-levels-test-content-v1", marker: "live-editor-content" };
      }
    }
  };

  const loaded = await loadGameEntry(entry, {
    playerCount: 2,
    difficulty: "medium",
    contentSelection: selection
  });

  assert.equal(loaded.game, registeredGame);
  assert.deepEqual(calls, [selection]);
  assert.deepEqual(loaded.options.gameContent, {
    schema: "motion-levels-test-content-v1",
    marker: "live-editor-content"
  });
  assert.deepEqual(loaded.options.contentSelection, selection);
});

test("regular games do not acquire a parallel content-loading path", async () => {
  const entry: GameEntry = { manifest: duelo.manifest, load: async () => registeredGame };
  const options: SessionOptions = { playerCount: 2, difficulty: "hard" };
  const loaded = await loadGameEntry(entry, options);
  assert.equal(loaded.options, options);
  assert.equal(loaded.options.gameContent, undefined);
});

test("content-backed games fail explicitly when no level was selected", async () => {
  const entry: GameEntry = {
    manifest: duelo.manifest,
    load: async () => registeredGame,
    contentSource: {
      list: async () => [],
      load: async () => ({ schema: "unreachable" })
    }
  };
  await assert.rejects(() => loadGameEntry(entry, { playerCount: 2 }), /Falta la selección del nivel/u);
});

test("picker exposes difficulty-bound live levels and blocks play while they load", async () => {
  const source = await readFile(new URL("../src/ui/GamePicker.tsx", import.meta.url), "utf8");
  assert.match(source, /source\.list\(\{ difficulty/u);
  assert.match(source, /setLevelId\(\(current\)/u);
  assert.match(source, /disabled=\{!contentReady\}/u);
  assert.match(source, /contentSelection:/u);
  assert.match(source, /No hay niveles publicados/u);
  assert.match(source, /Reintentar/u);
});

test("run completion reports the authoritative level UUID after automatic progression", () => {
  const finished = jugarRunFinishedPayload(
    "4773837e-3565-49d7-8953-3b40f59fca7b",
    selection,
    {
      score: 42,
      success: true,
      level: "22222222-2222-4222-8222-222222222208"
    }
  );
  assert.deepEqual(finished, {
    gameId: "4773837e-3565-49d7-8953-3b40f59fca7b",
    levelId: "22222222-2222-4222-8222-222222222208",
    mode: "free",
    score: 42,
    success: true
  });
});
