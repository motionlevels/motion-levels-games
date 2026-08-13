import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import { authorizeEngineRequest, createLatestSseWriter, createVenueHttpServer, engineTokenHeader } from "../src/httpServer.ts";
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

test("live floor SSE backpressure retains only the latest pending event", () => {
  class FakeResponse extends EventEmitter {
    writes: string[] = [];
    blocked = true;

    write(chunk: string): boolean {
      this.writes.push(chunk);
      return !this.blocked;
    }
  }
  const response = new FakeResponse();
  const writer = createLatestSseWriter<{ sequence: number }>(response, "live-floor");

  writer.write({ sequence: 1 });
  writer.write({ sequence: 2 });
  writer.write({ sequence: 3 });
  assert.equal(response.writes.length, 1);

  response.blocked = false;
  response.emit("drain");
  assert.equal(response.writes.length, 2);
  assert.match(response.writes[1] ?? "", /"sequence":3/u);
  assert.doesNotMatch(response.writes[1] ?? "", /"sequence":2/u);

  writer.close();
  assert.equal(response.listenerCount("drain"), 0);
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

test("observed floor SSE starts empty and streams only controller-owned MLF1 envelopes", async (context) => {
  const runtime = new VenueRuntime({ sourceRevision: "1".repeat(40), controllerAddress: "127.0.0.1:4201" });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const controller = new AbortController();
  context.after(() => controller.abort());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/live-floor/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
  const reader = response.body?.getReader();
  assert.ok(reader);

  runtime.observePresentedFrame({
    presentationSequence: 9n,
    desiredSequence: 8n,
    presentedUnixNanos: 123n,
    width: 16,
    height: 32,
    rgb: new Uint8Array(16 * 32 * 3),
    pressureBits: new Uint8Array(16 * 32 / 8),
    fadeRatio: 0
  });
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const text = new TextDecoder().decode(chunk.value);
  assert.match(text, /event: live-floor/u);
  assert.match(text, /"sequence":9/u);
  assert.match(text, /"frameBase64":"TUxGMQ/u);
});

test("observed floor SSE sends the current snapshot immediately on reconnect", async (context) => {
  const runtime = new VenueRuntime({ sourceRevision: "1".repeat(40), controllerAddress: "127.0.0.1:4201" });
  runtime.observePresentedFrame({
    presentationSequence: 27n,
    desiredSequence: 26n,
    presentedUnixNanos: 456n,
    width: 16,
    height: 32,
    rgb: new Uint8Array(16 * 32 * 3),
    pressureBits: new Uint8Array(16 * 32 / 8),
    fadeRatio: 0
  });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const controller = new AbortController();
  context.after(() => controller.abort());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/live-floor/events`, { signal: controller.signal });
  const reader = response.body?.getReader();
  assert.ok(reader);
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const text = new TextDecoder().decode(chunk.value);
  assert.match(text, /event: live-floor/u);
  assert.match(text, /"sequence":27/u);
});
