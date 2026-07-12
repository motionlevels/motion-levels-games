import assert from "node:assert/strict";
import test from "node:test";
import { runnerProtocolVersion } from "../src/protocol.ts";
import { gameCatalog } from "../src/registry.ts";
import { RunnerSession } from "../src/session.ts";

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
  assert.deepEqual(gameCatalog.filter((game) => game.availability.production).map((game) => game.id), ["arkanoid", "duelo", "ping-pong"]);
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
