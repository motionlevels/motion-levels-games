import assert from "node:assert/strict";
import test from "node:test";
import { isPlaygroundPaused, updatePauseLocks } from "../src/pausePolicy.ts";
import {
  readStoredSelectedGameId,
  selectedGameStorageKey,
  storeSelectedGameId
} from "../src/playgroundPreferences.ts";

test("selected game preference accepts only currently available games", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };

  storeSelectedGameId("arkanoid", storage);
  assert.equal(values.get(selectedGameStorageKey), "arkanoid");
  assert.equal(readStoredSelectedGameId(["ping-pong-v2", "arkanoid"], storage), "arkanoid");
  assert.equal(readStoredSelectedGameId(["ping-pong-v2"], storage), undefined);
});

test("selected game preference tolerates unavailable browser storage", () => {
  const unavailableStorage = {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    }
  };

  assert.equal(readStoredSelectedGameId(["ping-pong-v2"], unavailableStorage), undefined);
  assert.doesNotThrow(() => storeSelectedGameId("ping-pong-v2", unavailableStorage));
});

test("temporary pause locks preserve manual pause and compose safely", () => {
  let locks = updatePauseLocks(new Set(), "settings-dialog", true);
  locks = updatePauseLocks(locks, "difficulty-select", true);

  assert.equal(isPlaygroundPaused(false, locks), true);
  locks = updatePauseLocks(locks, "settings-dialog", false);
  assert.equal(isPlaygroundPaused(false, locks), true);
  locks = updatePauseLocks(locks, "difficulty-select", false);
  assert.equal(isPlaygroundPaused(false, locks), false);
  assert.equal(isPlaygroundPaused(true, locks), true);
});
