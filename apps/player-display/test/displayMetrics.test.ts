import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heartMeterSlotCount, levelDisplayLives, levelDisplayTimeLabel, levelDisplayTimeMillis, levelHeartMeterModel } from "../src/displayMetrics.ts";

describe("levelDisplayTimeMillis", () => {
  it("uses whole-challenge remaining time for challenge-mode level games", () => {
    assert.equal(levelDisplayTimeMillis({
      levelMode: "challenge",
      remainingMillis: 12000,
      sessionRemainingMillis: 551400,
      challengeElapsedMillis: 174000,
      elapsedMillis: 48600,
      sessionElapsedMillis: 48600,
    }), 551400);
  });

  it("falls back to the engine remaining clock instead of elapsed time on older payloads", () => {
    assert.equal(levelDisplayTimeMillis({
      levelMode: "challenge",
      remainingMillis: 12000,
      challengeElapsedMillis: 174000,
      elapsedMillis: 48600,
      sessionElapsedMillis: 48600,
    }), 12000);
  });

  it("shows elapsed time when challenge mode has no configured time limit", () => {
    const status = {
      levelMode: "challenge",
      remainingMillis: 0,
      challengeElapsedMillis: 174000,
      elapsedMillis: 48600,
      sessionElapsedMillis: 48600,
    };
    assert.equal(levelDisplayTimeMillis(status), 222600);
    assert.equal(levelDisplayTimeLabel(status), "Tiempo transcurrido");
  });
});

describe("levelDisplayLives", () => {
  it("shows configured starting lives on the completed-level result screen", () => {
    assert.equal(levelDisplayLives({ phase: "finished", lives: 3, livesStart: 7 }), 7);
  });

  it("shows current lives while the level is running", () => {
    assert.equal(levelDisplayLives({ phase: "running", lives: 3, livesStart: 7 }), 3);
  });
});

describe("heartMeterSlotCount", () => {
  it("uses the real finite life count instead of padding to five hearts", () => {
    assert.equal(heartMeterSlotCount(1), 1);
    assert.equal(heartMeterSlotCount(3), 3);
    assert.equal(heartMeterSlotCount(5), 5);
  });
});

describe("levelHeartMeterModel", () => {
  it("keeps starting life slots visible when lives are lost", () => {
    assert.deepEqual(levelHeartMeterModel({ phase: "running", lives: 2, livesStart: 3 }), { lives: 2, slots: 3 });
  });

  it("uses current lives when no starting life count is available", () => {
    assert.deepEqual(levelHeartMeterModel({ phase: "running", lives: 2, livesStart: undefined }), { lives: 2, slots: 2 });
  });

  it("preserves unlimited lives", () => {
    assert.deepEqual(levelHeartMeterModel({ phase: "running", lives: -1, livesStart: undefined }), { lives: -1, slots: 0 });
  });
});
