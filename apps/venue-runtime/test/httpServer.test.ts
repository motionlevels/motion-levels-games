import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { authorizeEngineRequest, createVenueHttpServer, engineTokenHeader } from "../src/httpServer.ts";
import { VenueRuntime } from "../src/venueRuntime.ts";

test("loopback peers can use the engine adapter directly", () => {
  assert.equal(authorizeEngineRequest("127.0.0.1", "", undefined), true);
  assert.equal(authorizeEngineRequest("::1", "", undefined), true);
  assert.equal(authorizeEngineRequest("::ffff:127.0.0.1", "", undefined), true);
});

test("container peers require the exact shared engine token", () => {
  assert.equal(engineTokenHeader, "x-motion-levels-engine-token");
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", undefined), false);
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", "wrong"), false);
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", "secret"), true);
  assert.equal(authorizeEngineRequest("172.20.0.8", "", ""), false);
});

test("canonical player state and idempotent commands share the venue API", async (context) => {
  const revision = "1".repeat(40);
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const idle = await fetch(`${base}/api/player-state`).then((response) => response.json());
  assert.equal(idle.contractVersion, 1);
  assert.equal(idle.lifecycle, "idle");

  const body = {
    commandId: "11111111-1111-4111-8111-111111111111",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  };
  const select = () => fetch(`${base}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => response.json());
  const first = await select();
  const retry = await select();
  assert.equal(first.revision, retry.revision);
  assert.equal(first.runId, retry.runId);
  assert.equal(first.currentGame, body.game);
});
