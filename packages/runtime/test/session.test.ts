import assert from "node:assert/strict";
import test from "node:test";
import { fallbackContent as parkourContent, parkourGameId } from "@motion-levels-games/parkour";
import { GameSession, gameCatalog } from "../src/index.ts";

test("GameSession owns a TypeScript game directly", () => {
  const session = new GameSession();
  const initialized = session.select({ gameId: "ping-pong", playerCount: 0, difficulty: "medium", seed: 137 });
  assert.equal(initialized.frame.width, 16);
  assert.equal(initialized.frame.height, 32);
  assert.equal(initialized.frame.cells.length, 512);
  assert.equal(initialized.snapshot.currentGame, "ping-pong");
  assert.equal(session.press(7, 3).snapshot.readyPlayers, 1);
});

test("GameSession rejects development-only games in production", () => {
  const session = new GameSession();
  assert.throws(() => session.select({ gameId: "hello-world", playerCount: 1 }), /not production eligible/);
  const ids = gameCatalog.filter((game) => game.availability.production).map((game) => game.id);
  for (const id of ["arkanoid", "duelo", "ping-pong"]) assert.ok(ids.includes(id));
});

test("GameSession retains authored content on restart", () => {
  const session = new GameSession();
  const initial = session.select({
    gameId: "PARKOUR",
    playerCount: 1,
    difficulty: "medium",
    seed: 137,
    content: parkourContent
  });
  assert.equal(initial.snapshot.currentGame, parkourGameId);
  const restarted = session.restart();
  assert.deepEqual(restarted.snapshot, initial.snapshot);
  assert.deepEqual(restarted.frame, initial.frame);
});

test("failed selections leave the current session and restart config intact", () => {
  const session = new GameSession();
  session.select({ gameId: "ping-pong", playerCount: 0, difficulty: "medium", seed: 137 });
  assert.throws(() => session.select({
    gameId: parkourGameId,
    playerCount: 0,
    content: { schema: "invalid" } as never
  }), /Expected motion-levels-published-level-content-v1/);
  assert.equal(session.state().snapshot.currentGame, "ping-pong");
  assert.equal(session.restart().snapshot.currentGame, "ping-pong");
});
