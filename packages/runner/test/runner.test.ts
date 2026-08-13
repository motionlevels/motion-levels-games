import assert from "node:assert/strict";
import test from "node:test";
import { fallbackContent as parkourContent, parkourGameId } from "@motion-levels-games/parkour";
import { runnerProtocolVersion } from "../src/protocol.ts";
import { gameCatalog } from "../src/registry.ts";
import { RunnerSession } from "../src/session.ts";
import { RunnerTelemetryCollector } from "../src/telemetry.ts";

test("runner protocol initializes, accepts input, and returns a fixed floor frame", () => {
  const session = new RunnerSession();
  const initialized = session.handle({
    version: runnerProtocolVersion,
    id: "init",
    method: "init",
    params: { gameId: "ping-pong", playerCount: 0, difficulty: "medium", seed: 137 }
  });
  assert.equal(initialized.frame.width, 16);
  assert.equal(initialized.frame.height, 32);
  assert.equal(initialized.frame.colors.length, 512);
  assert.equal(initialized.snapshot.currentGame, "ping-pong");

  const pressed = session.handle({
    version: runnerProtocolVersion,
    id: "press",
    method: "input",
    params: { x: 7, y: 3, pressed: true }
  });
  assert.equal(pressed.snapshot.readyPlayers, 1);
});

test("production runner rejects development-only games", () => {
  const session = new RunnerSession();
  assert.throws(() => session.handle({
    version: runnerProtocolVersion,
    id: "init",
    method: "init",
    params: { gameId: "hello-world", playerCount: 1 }
  }), /not production eligible/);
  const productionGameIds = gameCatalog.filter((game) => game.availability.production).map((game) => game.id);
  for (const baselineGame of ["arkanoid", "duelo", "ping-pong"]) {
    assert.ok(productionGameIds.includes(baselineGame), `${baselineGame} must remain production eligible`);
  }
});

test("production runner initializes TypeScript Duelo with its strict roster", () => {
  const session = new RunnerSession();
  const initialized = session.handle({
    version: runnerProtocolVersion,
    id: "init-duelo",
    method: "init",
    params: { gameId: "duelo", playerCount: 8, difficulty: "hard", seed: 137 }
  });
  assert.equal(initialized.snapshot.currentGame, "duelo");
  assert.equal(initialized.snapshot.phase, "waiting");
  assert.equal(initialized.snapshot.players.length, 8);
  assert.equal(initialized.snapshot.requiredPlayers, 8);
  assert.equal(initialized.frame.colors.length, 512);
});

test("published-level games resolve aliases to UUID authority and retain live content on reset", () => {
  const session = new RunnerSession();
  const initialized = session.handle({
    version: runnerProtocolVersion,
    id: "init-parkour",
    method: "init",
    params: {
      gameId: "PARKOUR",
      playerCount: 1,
      difficulty: "medium",
      seed: 137,
      content: parkourContent
    }
  });
  assert.equal(initialized.snapshot.currentGame, parkourGameId);
  assert.equal(initialized.snapshot.phase, "countdown");

  const reset = session.handle({
    version: runnerProtocolVersion,
    id: "reset-parkour",
    method: "control",
    params: { action: "reset" }
  });
  assert.deepEqual(reset.snapshot, initialized.snapshot);
  assert.deepEqual(reset.frame, initialized.frame);
});

test("published-level games reject malformed host content instead of silently using fixtures", () => {
  const session = new RunnerSession();
  assert.throws(() => session.handle({
    version: runnerProtocolVersion,
    id: "invalid-parkour-content",
    method: "init",
    params: {
      gameId: parkourGameId,
      playerCount: 1,
      content: { schema: "motion-levels-published-level-content-v1", gameId: parkourGameId }
    }
  }), /content|levels/iu);
});

test("runner telemetry stays bounded and reports process health", () => {
  const telemetry = new RunnerTelemetryCollector();
  const first = telemetry.observe("init", performance.now());
  const second = telemetry.observe("tick", performance.now());
  const failed = telemetry.observe("invalid", performance.now(), true);

  assert.equal(first.requestsTotal, 1);
  assert.equal(second.initTotal, 1);
  assert.equal(second.tickTotal, 1);
  assert.equal(failed.requestsTotal, 3);
  assert.equal(failed.errorsTotal, 1);
  assert.equal(failed.lastMethod, "invalid");
  assert.ok(failed.rssBytes > 0);
  assert.ok(failed.heapUsedBytes > 0);
  assert.ok(failed.lastRequestDurationMicros >= 0);
});
