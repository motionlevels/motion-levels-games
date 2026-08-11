import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { FLOOR_COLS, FLOOR_ROWS, type Frame } from "@motion-levels-games/game-sdk";
import { fallbackContent as parkourContent, parkourGameId } from "@motion-levels-games/parkour";
import { temporada1GameId } from "@motion-levels-games/temporada1-niveles/manifest";
import { frameToRgb, resolveRuntimeContentPlatformUrl, RevisionMismatchError, VenueRuntime } from "../src/venueRuntime.ts";

const revision = "1".repeat(40);

test("venue runtime exposes an honest idle status and audio capability", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  assert.equal(runtime.status().currentGame, "salvapantallas");
  assert.equal(runtime.status().audioEnabled, false);
  assert.equal(runtime.status().pressureStreamConnected, false);
  assert.equal(runtime.health().controllerProtocolVersion, 2);
});

test("selection fails closed on bundle revision mismatch", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  await assert.rejects(runtime.select({
    game: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: "2".repeat(40),
    playerCount: 0,
    players: []
  }), RevisionMismatchError);
});

test("allow-any TypeScript games accept zero players and produce JSON-safe status", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const status = await runtime.select({
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(status.currentGame, "motion-levels-games:ping-pong");
  assert.doesNotThrow(() => JSON.stringify(status));
});

test("fixed-player games require a complete roster", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  await assert.rejects(runtime.select({
    game: "motion-levels-games:duelo",
    engineGame: "motion-levels-games:duelo",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 8,
    allowAnyPlayers: false,
    players: []
  }), /roster must contain exactly 8/);
});

test("held pressure is applied when a game is selected and restarted", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  runtime.applyPressure({ x: 7, y: 3, pressed: true, unixNanos: 1n, sequence: 1n });
  await runtime.select({
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);
  runtime.control("restart");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);
});

test("published levels resolve the TS product from engineGame and fetch canonical request.game content", async (context) => {
  const canonicalGameId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let responseGameId = parkourGameId;
  let requestedPath = "";
  const server = createServer((request, response) => {
    requestedPath = request.url ?? "";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...parkourContent, gameId: responseGameId, contentRevision: "a".repeat(64) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${address.port}`
  });
  const selection: Parameters<VenueRuntime["select"]>[0] = {
    game: canonicalGameId,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "platform_levels",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  };
  await assert.rejects(runtime.select(selection), /content identity mismatch/);
  responseGameId = canonicalGameId;
  await assert.rejects(runtime.select({
    ...selection,
    engineGame: `motion-levels-games:${temporada1GameId}`,
    playerCount: 1,
    allowAnyPlayers: false,
    players: [{ index: 0, label: "Equipo", color: { r: 255, g: 0, b: 0 } }]
  }), /engine product mismatch/);
  const status = await runtime.select(selection);
  assert.match(requestedPath, new RegExp(`/api/level-games/${canonicalGameId}/runtime-content`));
  assert.equal(status.currentGame, canonicalGameId);
  assert.equal(status.engineGame, `motion-levels-games:${parkourGameId}`);
  assert.equal(status.sourceKind, "platform_levels");
  assert.equal(runtime.display().sourceKind, "motion_levels_games");
});

test("published-level products use bundled fallback content for direct TypeScript selections", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const status = await runtime.select({
    game: `motion-levels-games:${parkourGameId}`,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(status.currentGame, `motion-levels-games:${parkourGameId}`);
});

test("frame conversion is always one 16x32 RGB frame", () => {
  const frame: Frame = {
    width: FLOOR_COLS,
    height: FLOOR_ROWS,
    cells: Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, index) => ({
      x: index % FLOOR_COLS,
      y: Math.floor(index / FLOOR_COLS),
      color: "#000000"
    }))
  };
  const rgb = frameToRgb(frame, 1);
  assert.equal(rgb.byteLength, 1536);
  assert.ok(rgb.every((channel) => channel === 0));
});

test("runtime content cannot redirect production fetches to a request-controlled origin", () => {
  assert.equal(
    resolveRuntimeContentPlatformUrl("https://platform.motionlevels.example/base", "https://attacker.example")?.origin,
    "https://platform.motionlevels.example"
  );
  assert.equal(resolveRuntimeContentPlatformUrl(undefined, "https://attacker.example"), null);
  assert.equal(resolveRuntimeContentPlatformUrl(undefined, "http://127.0.0.1:3000")?.origin, "http://127.0.0.1:3000");
});
