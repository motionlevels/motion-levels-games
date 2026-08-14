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

test("GameSession holds a published attempt boundary and advances it on the frozen engine clock", () => {
  const session = new GameSession();
  session.select({
    gameId: parkourGameId,
    playerCount: 0,
    difficulty: "medium",
    seed: 137,
    content: parkourContent
  });
  assert.equal(session.setAutomaticAttemptTransitionsBlocked(true), true);
  const running = session.tick(4_000);
  const lives = Number(running.snapshot.lives);
  const lava = running.frame.cells.filter((cell) => {
    const red = Number.parseInt(cell.color.slice(1, 3), 16);
    const green = Number.parseInt(cell.color.slice(3, 5), 16);
    const blue = Number.parseInt(cell.color.slice(5, 7), 16);
    return red > green * 1.5 && red > blue * 1.5;
  }).slice(0, lives);
  assert.equal(lava.length, lives);
  for (const cell of lava) session.press(cell.x, cell.y, 4_000);
  assert.equal(session.state().snapshot.phase, "finished");

  const held = session.tick(7_000);
  assert.equal(held.snapshot.phase, "finished");
  assert.equal(session.pendingAutomaticAttemptTransition()?.kind, "retry");
  const advanced = session.advanceAutomaticAttemptTransition();
  assert.equal(advanced.clockMillis, held.clockMillis);
  assert.equal(advanced.snapshot.phase, "running");
  assert.ok("attemptCreatedMillis" in advanced.snapshot);
  assert.equal(advanced.snapshot.attemptCreatedMillis, held.clockMillis);
  assert.equal(advanced.snapshot.lives, lives);
});
