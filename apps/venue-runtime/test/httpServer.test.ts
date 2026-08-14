import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fallbackContent as parkourContent, parkourGameId } from "@motion-levels-games/parkour";
import { RecordingStartRejectedError, type RecordingBoundary } from "@motion-levels-games/session-history";
import {
  authorizeEngineRequest,
  beginVenueHttpShutdown,
  createLatestSseWriter,
  createVenueHttpServer,
  engineTokenHeader
} from "../src/httpServer.ts";
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

test("shutdown closes SSE, waits for in-flight commands, then drains runtime", async () => {
  const revision = "1".repeat(40);
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const order: string[] = [];
  let releaseSelect = () => {};
  const selectReleased = new Promise<void>((resolve) => { releaseSelect = resolve; });
  let selectEntered = () => {};
  const entered = new Promise<void>((resolve) => { selectEntered = resolve; });
  runtime.select = async () => {
    order.push("select:start");
    selectEntered();
    await selectReleased;
    order.push("select:end");
    return runtime.status();
  };
  const originalStop = runtime.stop.bind(runtime);
  runtime.stop = async () => {
    order.push("runtime:stop");
    await originalStop();
  };
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const stream = await fetch(`${base}/api/player-state/events`);
  const reader = stream.body?.getReader();
  assert.ok(reader);
  assert.equal((await reader.read()).done, false);

  const select = fetch(`${base}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId: "99999999-9999-4999-8999-999999999999" })
  });
  await entered;
  let closed = false;
  const shutdown = beginVenueHttpShutdown(server);
  void shutdown.serverClosed.then(() => { closed = true; });
  let mutationsDrained = false;
  void shutdown.mutationsDrained.then(() => { mutationsDrained = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closed, false, "ordinary command must remain connected during shutdown");
  assert.equal(mutationsDrained, false, "runtime drain must wait for the accepted mutation");
  releaseSelect();
  assert.equal((await select).status, 200);
  await shutdown.mutationsDrained;
  await runtime.stop();
  await shutdown.serverClosed;
  assert.deepEqual(order, ["select:start", "select:end", "runtime:stop"]);
});

test("shutdown drains an ambiguous camera start through a physically confirmed stop", async (context) => {
  const revision = "1".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-http-shutdown-camera-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let releaseStart = () => {};
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  let observeStart = () => {};
  const startObserved = new Promise<void>((resolve) => { observeStart = resolve; });
  let releaseStop = () => {};
  const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
  let observeStop = () => {};
  const stopObserved = new Promise<void>((resolve) => { observeStop = resolve; });
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      async onBoundary(boundary) {
        if (boundary.type === "start") {
          observeStart();
          await startGate;
          return { ...boundary.recording, status: "recording" };
        }
        observeStop();
        await stopGate;
        return {
          ...boundary.recording,
          status: "complete",
          metadata: { ...(boundary.recording.metadata ?? {}), stopConfirmed: true }
        };
      }
    }
  });
  const venueSessionId = "visit-http-shutdown-camera";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "run" } });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: "98989898-9898-4989-8989-989898989898",
      game: "motion-levels-games:ping-pong",
      engineGame: "motion-levels-games:ping-pong",
      sourceKind: "motion_levels_games",
      sourceRevision: revision,
      venueSessionId,
      recordingPolicy: { scope: "run" },
      playerCount: 0,
      allowAnyPlayers: true,
      players: []
    })
  });
  assert.equal(response.status, 200);
  await startObserved;

  const shutdown = beginVenueHttpShutdown(server);
  await shutdown.mutationsDrained;
  let runtimeDrained = false;
  const runtimeDrain = runtime.stop().then(() => { runtimeDrained = true; });
  await Promise.resolve();
  assert.equal(runtimeDrained, false);
  releaseStart();
  await stopObserved;
  assert.equal(runtimeDrained, false, "shutdown must await physical stop confirmation");
  releaseStop();
  await runtimeDrain;
  await shutdown.serverClosed;
  assert.equal(runtime.historySession(venueSessionId).session.recordings[0]?.status, "complete");
});

test("direct select cannot hide a visit camera stop behind ungated gameplay", async (context) => {
  const revision = "1".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-http-select-stop-barrier-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let releaseStop = () => {};
  const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
  let observeStop = () => {};
  const stopObserved = new Promise<void>((resolve) => { observeStop = resolve; });
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      async onBoundary(boundary) {
        if (boundary.type === "start") return { ...boundary.recording, status: "recording" };
        observeStop();
        await stopGate;
        return {
          ...boundary.recording,
          status: "complete",
          metadata: { ...(boundary.recording.metadata ?? {}), stopConfirmed: true }
        };
      }
    }
  });
  const firstVenueSessionId = "visit-http-direct-select-a";
  const secondVenueSessionId = "visit-http-direct-select-b";
  runtime.updateVenueSession({
    action: "start",
    venueSessionId: firstVenueSessionId,
    recordingPolicy: { scope: "visit" }
  });
  await waitFor(() => runtime.historySession(firstVenueSessionId).session.recordings[0]?.status === "recording");
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    releaseStop();
    await runtime.stop();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const selection = (commandId: string) => ({
    commandId,
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId: secondVenueSessionId,
    recordingPolicy: { scope: "off" },
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  const select = (commandId: string) => fetch(`${base}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection(commandId))
  });

  const direct = await select("97979797-9797-4979-8979-979797979791");
  assert.equal(direct.status, 409);
  assert.match(await direct.text(), /must stop the active camera/u);
  assert.equal(runtime.status().lifecycle, "idle");
  assert.equal(runtime.status().venueSessionId, firstVenueSessionId);

  const transitioned = await fetch(`${base}/api/venue-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      venueSessionId: secondVenueSessionId,
      recordingPolicy: { scope: "off" }
    })
  });
  assert.equal(transitioned.status, 200);
  await stopObserved;
  const whileStopping = await select("97979797-9797-4979-8979-979797979792");
  assert.equal(whileStopping.status, 409);
  assert.match(await whileStopping.text(), /physically confirmed/u);
  assert.equal(runtime.status().lifecycle, "idle");

  releaseStop();
  await waitFor(() => runtime.historySession(firstVenueSessionId).session.recordings[0]?.status === "complete");
  const afterStop = await select("97979797-9797-4979-8979-979797979793");
  assert.equal(afterStop.status, 200);
  assert.notEqual(runtime.status().lifecycle, "idle");
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

test("recording gate controls require and route the current gate id", async (context) => {
  const revision = "1".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-http-recording-gate-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        if (boundary.type === "start") throw new RecordingStartRejectedError("camera rejected start");
        return { ...boundary.recording, status: "complete" };
      }
    }
  });
  context.after(async () => { await runtime.stop(); });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const post = (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId: "visit-http-recording-gate",
    recordingPolicy: { scope: "run" }
  })).status, 200);
  const selected = await post("/api/select", {
    commandId: "70000000-0000-4000-8000-000000000001",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(selected.status, 200);
  await waitFor(() => runtime.status().recordingGate?.state === "timed_out");
  const gate = runtime.status().recordingGate;
  assert.ok(gate);

  const missing = await post("/api/control", {
    action: "recording_retry",
    commandId: "70000000-0000-4000-8000-000000000002"
  });
  assert.equal(missing.status, 409);
  const stale = await post("/api/control", {
    action: "recording_retry",
    recordingGateId: "stale-gate",
    commandId: "70000000-0000-4000-8000-000000000003"
  });
  assert.equal(stale.status, 409);
  const retried = await post("/api/control", {
    action: "recording_retry",
    recordingGateId: gate.id,
    commandId: "70000000-0000-4000-8000-000000000004"
  });
  assert.equal(retried.status, 200);
  const retriedBody = await retried.json() as Record<string, unknown>;
  const retriedGate = retriedBody.recordingGate as Record<string, unknown>;
  assert.notEqual(retriedGate.id, gate.id);
  assert.equal(retriedGate.captureId, gate.captureId);
  assert.equal(retriedGate.attempt, 2);
});

test("retrying a conflicted select command cannot restore a stale venue recording policy", async (context) => {
  const revision = "1".repeat(40);
  const canonicalGameId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let releaseContent = () => {};
  let observeContentRequest = () => {};
  const contentGate = new Promise<void>((resolve) => { releaseContent = resolve; });
  const contentRequested = new Promise<void>((resolve) => { observeContentRequest = resolve; });
  const contentServer = createServer((_request, response) => {
    observeContentRequest();
    void contentGate.then(() => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        ...parkourContent,
        gameId: canonicalGameId,
        contentRevision: "d".repeat(64)
      }));
    });
  });
  contentServer.listen(0, "127.0.0.1");
  await once(contentServer, "listening");
  context.after(() => contentServer.close());
  const contentAddress = contentServer.address();
  assert.ok(contentAddress && typeof contentAddress === "object");

  const directory = mkdtempSync(join(tmpdir(), "motion-levels-http-select-command-conflict-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const cameraCalls: RecordingBoundary[] = [];
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${contentAddress.port}`,
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        cameraCalls.push(boundary);
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    await runtime.stop();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const venueSessionId = "visit-http-select-command-conflict";
  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId,
    recordingPolicy: { scope: "visit" }
  })).status, 200);
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "start"));

  const command = {
    commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
    game: canonicalGameId,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "platform_levels",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "visit" },
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  };
  const firstSelect = post("/api/select", command);
  await contentRequested;
  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId,
    recordingPolicy: { scope: "off" }
  })).status, 200);
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "stop"));
  releaseContent();

  const firstConflict = await firstSelect;
  assert.equal(firstConflict.status, 409);
  assert.match(await firstConflict.text(), /venue session changed while selecting/u);
  const retryConflict = await post("/api/select", command);
  assert.equal(retryConflict.status, 409);
  assert.match(await retryConflict.text(), /venue session changed while selecting/u);
  assert.deepEqual(runtime.status().venueSessionRecordingPolicy, { scope: "off" });
  assert.deepEqual(cameraCalls.map((boundary) => boundary.type), ["start", "stop"]);
  assert.deepEqual(runtime.historySession(venueSessionId).session.recordingPolicy, { scope: "off" });
});

test("a lost failed select response is replayed without reexecuting its command", async (context) => {
  const revision = "1".repeat(40);
  const canonicalGameId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let releaseContent = () => {};
  let observeContentRequest = () => {};
  let contentRequests = 0;
  const contentGate = new Promise<void>((resolve) => { releaseContent = resolve; });
  const contentRequested = new Promise<void>((resolve) => { observeContentRequest = resolve; });
  const contentServer = createServer((_request, response) => {
    contentRequests += 1;
    observeContentRequest();
    void contentGate.then(() => {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end("temporarily unavailable");
    });
  });
  contentServer.listen(0, "127.0.0.1");
  await once(contentServer, "listening");
  context.after(() => contentServer.close());
  const contentAddress = contentServer.address();
  assert.ok(contentAddress && typeof contentAddress === "object");

  const directory = mkdtempSync(join(tmpdir(), "motion-levels-http-lost-select-failure-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const cameraCalls: RecordingBoundary[] = [];
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${contentAddress.port}`,
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        cameraCalls.push(boundary);
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    await runtime.stop();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: Record<string, unknown>, signal?: AbortSignal) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  const venueSessionId = "visit-http-lost-select-failure";
  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId,
    recordingPolicy: { scope: "visit" }
  })).status, 200);
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "start"));

  const command = {
    commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    game: canonicalGameId,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "platform_levels",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "visit" },
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  };
  const abort = new AbortController();
  const lostSelect = post("/api/select", command, abort.signal);
  await contentRequested;
  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId,
    recordingPolicy: { scope: "off" }
  })).status, 200);
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "stop"));
  abort.abort();
  await assert.rejects(lostSelect, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  releaseContent();

  const retry = await post("/api/select", command);
  assert.equal(retry.status, 400);
  assert.match(await retry.text(), /published level content returned HTTP 503/u);
  assert.equal(contentRequests, 1);
  assert.deepEqual(runtime.status().venueSessionRecordingPolicy, { scope: "off" });
  assert.equal(runtime.status().venueSessionRecordingEnabled, false);
  assert.deepEqual(cameraCalls.map((boundary) => boundary.type), ["start", "stop"]);
  assert.deepEqual(runtime.historySession(venueSessionId).session.recordingPolicy, { scope: "off" });
});

test("venue session lifecycle survives game exit and publishes remote close", async (context) => {
  const revision = "1".repeat(40);
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const venueSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => response.json() as Promise<Record<string, unknown>>);

  const started = await post("/api/venue-session", {
    action: "start",
    venueSessionId,
    teamName: "Equipo remoto",
    recordingEnabled: true
  });
  assert.equal(started.lifecycle, "idle");
  assert.equal(started.venueSessionId, venueSessionId);

  const selected = await post("/api/select", {
    commandId: "10000000-0000-4000-8000-000000000001",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId,
    teamName: "Equipo remoto",
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(selected.lifecycle, "waiting");
  assert.equal(selected.venueSessionId, venueSessionId);

  const exited = await post("/api/control", {
    action: "exit",
    commandId: "10000000-0000-4000-8000-000000000002"
  });
  assert.equal(exited.lifecycle, "idle");
  assert.equal(exited.venueSessionId, venueSessionId, "exiting a game must not close the venue visit");

  const ended = await post("/api/venue-session", { action: "end", venueSessionId });
  assert.equal(ended.lifecycle, "idle");
  assert.equal(ended.venueSessionId, "");
  assert.ok(Number(ended.revision) > Number(exited.revision));
});

test("history API lists visits, pages events, returns detail, and associates recordings", async (context) => {
  const revision = "1".repeat(40);
  const historyDirectory = mkdtempSync(join(tmpdir(), "motion-levels-http-history-"));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: historyDirectory
  });
  const historyToken = "history-secret";
  const server = createVenueHttpServer(runtime, historyToken);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    await runtime.stop();
    server.close();
    rmSync(historyDirectory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const visitId = "history-visit-1";
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [engineTokenHeader]: historyToken },
    body: JSON.stringify(body)
  });
  const historyGet = (path: string, token = historyToken) => fetch(`${base}${path}`, {
    headers: { [engineTokenHeader]: token }
  });

  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/status`)).status, 200, "non-history loopback APIs remain trusted");
  assert.equal((await fetch(`${base}/api/history/v1/sessions`)).status, 401);
  assert.equal((await historyGet("/api/history/v1/sessions", "wrong")).status, 401);

  const overlongSession = await post("/api/venue-session", {
    action: "start",
    venueSessionId: "x".repeat(256),
    teamName: "No debe persistirse"
  });
  assert.equal(overlongSession.status, 400);
  assert.equal(runtime.status().venueSessionId, "");

  const gameBeforeInvalidSelect = runtime.status().currentGame;
  const overlongSelect = await post("/api/select", {
    commandId: "70000000-0000-4000-8000-000000000000",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId: "x".repeat(256),
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(overlongSelect.status, 400);
  assert.equal(runtime.status().currentGame, gameBeforeInvalidSelect);
  assert.equal(runtime.status().sessionId, "");
  assert.equal(runtime.status().venueSessionId, "");

  assert.equal((await post("/api/venue-session", {
    action: "start",
    venueSessionId: visitId,
    teamName: "Equipo historia",
    recordingEnabled: true,
    recordingPolicy: { scope: "selection" }
  })).status, 200);
  assert.equal((await post("/api/select", {
    commandId: "70000000-0000-4000-8000-000000000001",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    gameLabel: "Ping pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId: visitId,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  })).status, 200);

  const list = await historyGet("/api/history/v1/sessions?status=active&limit=1").then((response) => response.json());
  assert.equal(list.schema, "motion-levels-session-history-v1");
  assert.equal(list.sessions[0]?.id, visitId);
  assert.equal(list.sessions[0]?.selectionCount, 1);
  const detail = await historyGet(`/api/history/v1/sessions/${visitId}`).then((response) => response.json());
  assert.equal(detail.session.recordingPolicy.scope, "selection");
  assert.equal(detail.session.selections[0]?.runs.length, 1);

  const firstEvents = await historyGet(`/api/history/v1/sessions/${visitId}/events?limit=1`).then((response) => response.json());
  assert.equal(firstEvents.events.length, 1);
  assert.ok(firstEvents.nextCursor);
  const nextEvents = await historyGet(`/api/history/v1/sessions/${visitId}/events?limit=20&cursor=${encodeURIComponent(firstEvents.nextCursor)}`).then((response) => response.json());
  assert.ok(nextEvents.events.length > 0);
  assert.ok(nextEvents.events[0].sequence > firstEvents.events[0].sequence);

  const recording = await post(`/api/history/v1/sessions/${visitId}/recordings`, {
    id: "uploaded-recording-1",
    captureId: "capture-1",
    scope: "selection",
    status: "complete",
    selectionId: detail.session.selections[0].id,
    linkedRunIds: [detail.session.selections[0].runs[0].id],
    remoteUrl: "https://recordings.example/history-visit-1.mp4",
    fileName: "history-visit-1.mp4",
    contentType: "video/mp4",
    byteSize: 1234
  }).then((response) => response.json());
  assert.equal(recording.recording.status, "complete");
  assert.equal(recording.recording.remoteUrl, "https://recordings.example/history-visit-1.mp4");

  const duplicateCapture = await post(`/api/history/v1/sessions/${visitId}/recordings`, {
    id: "uploaded-recording-duplicate",
    captureId: "capture-1",
    scope: "selection",
    status: "complete",
    selectionId: detail.session.selections[0].id,
    linkedRunIds: [detail.session.selections[0].runs[0].id]
  });
  assert.equal(duplicateCapture.status, 400);
  assert.match(await duplicateCapture.text(), /captureId already belongs to another asset/u);

  const runWithoutSelection = await post(`/api/history/v1/sessions/${visitId}/recordings`, {
    id: "uploaded-run-without-selection",
    captureId: "capture-invalid-run",
    scope: "run",
    status: "complete",
    runId: detail.session.selections[0].runs[0].id,
    linkedRunIds: [detail.session.selections[0].runs[0].id]
  });
  assert.equal(runWithoutSelection.status, 400);
  assert.match(await runWithoutSelection.text(), /requires selectionId and runId/u);

  assert.equal((await historyGet("/api/history/v1/sessions/missing")).status, 404);
  assert.equal((await historyGet("/api/history/v1/sessions?status=broken")).status, 400);

  assert.equal((await post("/api/venue-session", { action: "end", venueSessionId: visitId })).status, 200);
  const beforeConflict = runtime.status();
  const restartEnded = await post("/api/venue-session", {
    action: "start",
    venueSessionId: visitId,
    teamName: "No reabrir"
  });
  assert.equal(restartEnded.status, 409);
  assert.equal(runtime.status().venueSessionId, beforeConflict.venueSessionId);
  assert.equal(runtime.status().currentGame, beforeConflict.currentGame);
  const selectEnded = await post("/api/select", {
    commandId: "70000000-0000-4000-8000-000000000099",
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId: visitId,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(selectEnded.status, 409);
  assert.equal(runtime.status().sessionId, beforeConflict.sessionId);
  assert.equal(runtime.status().currentGame, beforeConflict.currentGame);
});

test("remote floor input is validated, idempotent, and recoverable through the venue API", async (context) => {
  const revision = "1".repeat(40);
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  await runtime.select({
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  const server = createVenueHttpServer(runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    await runtime.stop();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/floor-input`;
  const request = (body: Record<string, unknown>) => fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const invalid = await request({
    commandId: "40000000-0000-4000-8000-000000000001",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 1,
    changes: [
      { x: 0, y: 4, pressed: true },
      { x: 16, y: 4, pressed: true }
    ]
  });
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /changes\[1\]\.x/u);
  assert.equal(runtime.status().remoteFloorInput.activeClients, 0);

  const invalidClient = await request({
    commandId: "40000000-0000-4000-8000-000000000010",
    clientId: "browser-controller",
    clientSequence: 1,
    changes: []
  });
  assert.equal(invalidClient.status, 400);
  assert.match(await invalidClient.text(), /clientId must be a UUID/u);

  const invalidCommand = await request({
    commandId: "not-a-command-uuid",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 1,
    changes: []
  });
  assert.equal(invalidCommand.status, 400);
  assert.match(await invalidCommand.text(), /commandId must be a UUID/u);

  const commandId = "40000000-0000-4000-8000-000000000002";
  const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const firstResponse = await request({
    commandId,
    clientId,
    clientSequence: 1,
    changes: [{ x: 0, y: 4, pressed: true }]
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json() as Record<string, unknown>;
  assert.deepEqual(first.remoteFloorInput, { activeClients: 1, heldTiles: 1, leaseMillis: 5_000, trackedClients: 1 });
  assert.equal(first.applied, true);
  assert.equal(first.lastSequence, 1);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);

  const retryResponse = await request({
    commandId,
    clientId,
    clientSequence: 2,
    changes: [{ x: 0, y: 27, pressed: true }]
  });
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json() as Record<string, unknown>;
  assert.equal(retry.revision, first.revision);
  assert.equal(runtime.status().remoteFloorInput.heldTiles, 1);

  const released = await request({
    commandId: "40000000-0000-4000-8000-000000000003",
    clientId,
    clientSequence: 2,
    releaseAll: true
  });
  assert.equal(released.status, 200);
  const releasedBody = await released.json() as Record<string, unknown>;
  assert.deepEqual(releasedBody.remoteFloorInput, {
    activeClients: 0,
    heldTiles: 0,
    leaseMillis: 5_000,
    trackedClients: 1
  });
  assert.equal(releasedBody.applied, true);
  assert.equal(releasedBody.lastSequence, 2);
  runtime.control("restart");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 0);

  const stale = await request({
    commandId: "40000000-0000-4000-8000-000000000004",
    clientId,
    clientSequence: 1,
    changes: [{ x: 0, y: 27, pressed: true }]
  });
  assert.equal(stale.status, 200);
  const staleBody = await stale.json() as Record<string, unknown>;
  assert.equal(staleBody.applied, false);
  assert.equal(staleBody.lastSequence, 2);
  assert.equal(runtime.status().remoteFloorInput.heldTiles, 0);

  const missingCommandId = await request({ clientId, clientSequence: 3, changes: [] });
  assert.equal(missingCommandId.status, 400);
  assert.match(await missingCommandId.text(), /commandId is required/u);
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

async function waitFor(predicate: () => boolean, timeoutMillis = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met before timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
