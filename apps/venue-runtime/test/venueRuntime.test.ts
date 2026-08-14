import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FLOOR_COLS, FLOOR_ROWS, gameEvent, type Frame } from "@motion-levels-games/game-sdk";
import { fallbackContent as parkourContent, parkourGameId } from "@motion-levels-games/parkour";
import type { GameSessionState } from "@motion-levels-games/runtime";
import type { RecordingBoundary } from "@motion-levels-games/session-history";
import { temporada1GameId } from "@motion-levels-games/temporada1-niveles/manifest";
import { floorHeight, floorRgbBytes, floorWidth, pressureBitsetBytes, type PresentedFrame } from "../src/controllerProtocol.ts";
import {
  floorOutputTestDurationMillis,
  floorOutputTestRgb,
  frameToRgb,
  outputTestResultRetentionMillis,
  resolveRuntimeContentPlatformUrl,
  RevisionMismatchError,
  VenueRuntime
} from "../src/venueRuntime.ts";

const revision = "1".repeat(40);
const roomControllerId = "01234567-89ab-4def-8123-456789abcdef";

test("venue runtime runs the revisioned TypeScript screensaver while remaining idle", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    controllerId: roomControllerId
  });
  const status = runtime.status();
  assert.equal(status.contractVersion, 1);
  assert.equal(status.revision, 1);
  assert.match(status.runId, /^[0-9a-f-]{36}$/u);
  assert.equal(status.lifecycle, "idle");
  assert.deepEqual(status.allowedControls, []);
  assert.equal(status.currentGame, "salvapantallas");
  assert.equal(status.phase, "ambient");
  assert.equal(status.sourceKind, "motion_levels_games");
  assert.equal(status.sourceRevision, revision);
  assert.equal(status.sessionId, "");
  assert.equal(status.venueSessionId, "");
  assert.equal(status.audioEnabled, false);
  assert.equal(status.pressureStreamConnected, false);
  assert.equal(status.controllerId, roomControllerId);
  assert.equal(status.roomControllerId, roomControllerId);
  assert.equal(status.floorAdapter.revision, "");
  assert.equal(runtime.health().controllerProtocolVersion, 2);

  const display = runtime.display();
  const frame = display.frame as Frame;
  const snapshot = display.gameSnapshot as Record<string, unknown>;
  assert.equal(frame.cells.length, FLOOR_COLS * FLOOR_ROWS);
  assert.ok(frameToRgb(frame, 1).some((channel) => channel > 0), "the idle floor must not be black");
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.rotationSize, 24);
});

test("configured TV audio is controllable while idle and reports display output health", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    controllerId: roomControllerId,
    audioEnabled: true,
  });

  assert.equal(runtime.status().audioEnabled, true);
  assert.equal(runtime.status().audioMuted, false);
  assert.equal(runtime.status().audioOutputState, "checking");

  assert.equal(runtime.control("mute").audioMuted, true);
  assert.equal(runtime.control("toggle_mute").audioMuted, false);
  assert.equal(runtime.control("unmute").audioMuted, false);

  runtime.updateDisplayClient({
    clientId: "player-display",
    currentGame: "salvapantallas",
    expectedRevision: revision,
    loadedRevision: revision,
    renderStatus: "ready",
    connected: true,
    feedTransport: "eventsource",
    lastFeedUnixMillis: Date.now(),
    audioOutputState: "ready",
  });
  assert.equal(runtime.status().audioOutputState, "ready");
  assert.equal(runtime.health().audioOutputState, "ready");
});

test("audio output test starts pending on a healthy display and accepts only its matching lifecycle", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  assert.equal(runtime.status().audioOutputState, "ready");

  const pending = runtime.runOutputTest("audio").outputTest;
  assert.match(pending?.id ?? "", /^[0-9a-f-]{36}$/u);
  assert.equal(pending?.target, "audio");
  assert.equal(pending?.sequence, 1);
  assert.equal(pending?.state, "pending");
  assert.equal(typeof pending?.startedUnixMillis, "number");
  assert.equal(pending?.finishedUnixMillis, undefined);

  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 2, outputTestState: "playing" }));
  assert.equal(runtime.status().outputTest?.state, "pending", "a report for another sequence must be ignored");
  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: "00000000-0000-4000-8000-000000000000", outputTestSequence: 1, outputTestState: "playing" }));
  assert.equal(runtime.status().outputTest?.state, "pending", "a report for another test id must be ignored");
  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 1, outputTestState: "ready" }));
  assert.equal(runtime.status().outputTest?.state, "pending", "an unknown lifecycle state must be ignored");

  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 1, outputTestState: "playing" }));
  const playing = runtime.status().outputTest;
  assert.equal(playing?.state, "playing");
  assert.equal(playing?.startedUnixMillis, pending?.startedUnixMillis);
  assert.equal(playing?.finishedUnixMillis, undefined);
  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 9, outputTestState: "passed" }));
  assert.equal(runtime.status().outputTest?.state, "playing", "a terminal report for another sequence must be ignored");

  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 1, outputTestState: "passed" }));
  const passed = runtime.status().outputTest;
  assert.equal(passed?.target, "audio");
  assert.equal(passed?.sequence, 1);
  assert.equal(passed?.state, "passed");
  assert.equal(passed?.error, undefined);
  assert.ok((passed?.finishedUnixMillis ?? 0) >= (passed?.startedUnixMillis ?? Number.POSITIVE_INFINITY));
});

test("audio output test exposes a matching display playback failure", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  const pending = runtime.runOutputTest("audio").outputTest;

  runtime.updateDisplayClient(readyDisplayReport({ outputTestId: pending?.id, outputTestSequence: 1, outputTestState: "failed" }));

  const failed = runtime.status().outputTest;
  assert.equal(failed?.target, "audio");
  assert.equal(failed?.sequence, 1);
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.startedUnixMillis, pending?.startedUnixMillis);
  assert.equal(failed?.error, "La pantalla no pudo reproducir la prueba de audio");
  assert.ok((failed?.finishedUnixMillis ?? 0) >= (failed?.startedUnixMillis ?? Number.POSITIVE_INFINITY));
});

test("mute cancels an audio output test and a late display ack cannot revive it", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  const pending = runtime.runOutputTest("audio").outputTest;

  const muted = runtime.control("mute");

  assert.equal(muted.audioMuted, true);
  assert.equal(muted.outputTest?.state, "failed");
  assert.equal(muted.outputTest?.error, "Prueba cancelada por otro control");
  runtime.updateDisplayClient(readyDisplayReport({
    outputTestId: pending?.id,
    outputTestSequence: pending?.sequence,
    outputTestState: "passed",
  }));
  assert.equal(runtime.status().outputTest?.state, "failed");
});

test("terminal output test results expire on the runtime clock", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  const pending = runtime.runOutputTest("audio").outputTest;
  runtime.updateDisplayClient(readyDisplayReport({
    outputTestId: pending?.id,
    outputTestSequence: pending?.sequence,
    outputTestState: "passed",
  }));
  const finishedUnixMillis = runtime.status().outputTest?.finishedUnixMillis ?? 0;
  const expire = (runtime as unknown as { expireOutputTestResult(nowUnixMillis: number): void })
    .expireOutputTestResult.bind(runtime);

  expire(finishedUnixMillis + outputTestResultRetentionMillis - 1);
  assert.equal(runtime.status().outputTest?.state, "passed");
  expire(finishedUnixMillis + outputTestResultRetentionMillis);
  assert.equal(runtime.status().outputTest, null);
});

test("audio output test fails when the display does not confirm it before the deadline", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  const pending = runtime.runOutputTest("audio").outputTest;
  assert.equal(pending?.state, "pending");
  const expire = (runtime as unknown as { expireAudioOutputTest(nowUnixMillis: number): void })
    .expireAudioOutputTest.bind(runtime);
  const startedUnixMillis = pending?.startedUnixMillis ?? 0;

  expire(startedUnixMillis + 6_999);
  assert.equal(runtime.status().outputTest?.state, "pending");
  expire(startedUnixMillis + 7_000);

  const failed = runtime.status().outputTest;
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.finishedUnixMillis, startedUnixMillis + 7_000);
  assert.equal(failed?.error, "La pantalla no confirmó la reproducción de audio");
});

test("configured audio becomes failed when the player-display heartbeat is stale", () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  runtime.updateDisplayClient(readyDisplayReport());
  assert.equal(runtime.status().audioOutputState, "ready");
  (runtime as unknown as { displayClientReceivedUnixMillis: number }).displayClientReceivedUnixMillis = Date.now() - 20_000;

  assert.equal(runtime.status().audioOutputState, "failed");
  assert.equal(runtime.health().audioOutputState, "failed");
  assert.equal(runtime.displayClientStatus().fresh, false);
});

test("game audio event identity remains stable across status reads and unrelated publishes", async () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  await selectPingPong(runtime);
  runtime.applyRemoteFloorInput({
    commandId: "90000000-0000-4000-8000-000000000001",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 1,
    changes: [
      { x: 0, y: 4, pressed: true },
      { x: 0, y: 27, pressed: true },
    ],
  });

  const first = runtime.status();
  assert.equal(first.lastEventCue, "start");
  assert.ok(Number(first.lastEventSequence) > 0);
  assert.ok(first.lastEventUnixNanos > 0);
  assert.equal(runtime.status().lastEventSequence, first.lastEventSequence);
  assert.equal(runtime.status().lastEventUnixNanos, first.lastEventUnixNanos);

  runtime.updateVenueSession({
    action: "start",
    venueSessionId: "audio-event-visit",
    recordingEnabled: false,
  });
  assert.equal(runtime.status().lastEventSequence, first.lastEventSequence);
  assert.equal(runtime.status().lastEventUnixNanos, first.lastEventUnixNanos);
});

test("tick audio survives a following empty tick before the display publishes", async () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    audioEnabled: true,
  });
  await selectPingPong(runtime);
  const beforeSequence = Number(runtime.status().lastEventSequence);
  const internals = runtime as unknown as {
    lastDisplayPublishedAt: number;
    session: { tick: (atMillis: number) => GameSessionState };
    state: GameSessionState;
    tick: (now: number) => void;
  };
  let ticks = 0;
  internals.session.tick = (atMillis) => ({
    ...internals.state,
    events: ticks++ === 0 ? [gameEvent("tick", "Pulso temporal", atMillis)] : [],
  });
  const now = performance.now() + 1_000;
  internals.lastDisplayPublishedAt = now;

  internals.tick(now);
  internals.tick(now + 1);

  const status = runtime.status();
  assert.equal(status.lastEventCue, "tick");
  assert.equal(status.lastEventMessage, "Pulso temporal");
  assert.equal(status.lastEventSequence, beforeSequence + 1);
});

test("idle display health requires the revisioned animations renderer", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4203" });
  runtime.updateDisplayClient({
    clientId: "player-display",
    currentGame: "salvapantallas",
    expectedRevision: revision,
    loadedRevision: revision,
    renderStatus: "ready",
    connected: false,
    feedTransport: "poll",
    lastFeedUnixMillis: Date.now(),
  });
  const status = runtime.displayClientStatus();
  assert.equal(status.fresh, true);
  assert.equal(status.revisionMatches, true);
  assert.equal(status.healthy, true);

  runtime.updateDisplayClient({
    clientId: "player-display",
    currentGame: "salvapantallas",
    expectedRevision: "",
    loadedRevision: "",
    renderStatus: "ready",
    connected: false,
    feedTransport: "poll",
    lastFeedUnixMillis: Date.now(),
  });
  assert.equal(runtime.displayClientStatus().revisionMatches, false);
  assert.equal(runtime.displayClientStatus().healthy, false);
});

test("publishes the renderer feed at 20 Hz without increasing the menu feed cadence", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const displays: number[] = [];
  const statuses: number[] = [];
  runtime.subscribeDisplay((display) => displays.push(Number(display.revision)));
  runtime.subscribeStatus((status) => statuses.push(Number(status.revision)));
  const tick = (runtime as unknown as { tick(now: number): void }).tick.bind(runtime);

  tick(49);
  for (const now of [50, 100, 150, 200, 250]) tick(now);

  assert.equal(displays.length, 5);
  assert.equal(statuses.length, 1);
  assert.deepEqual(displays, [...displays].sort((left, right) => left - right));
});

test("idle screensaver keeps game state idle while tracking the venue session", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const before = (runtime.display().frame as Frame).cells.map((cell) => cell.color);
  runtime.applyPressure({ x: 8, y: 16, pressed: true, unixNanos: 1n, sequence: 1n });

  const display = runtime.display();
  assert.equal(runtime.status().activeTargets, 1);
  assert.equal((display.gameSnapshot as Record<string, unknown>).activeTargets, 1);
  assert.notDeepEqual((display.frame as Frame).cells.map((cell) => cell.color), before);

  const started = runtime.updateVenueSession({
    action: "start",
    venueSessionId: "venue-session-1",
    teamName: "Equipo prueba",
    recordingEnabled: false
  });
  assert.equal(started.lifecycle, "idle");
  assert.equal(started.venueSessionId, "venue-session-1");
  assert.equal(started.sessionId, "");
  assert.equal(started.teamName, "Equipo prueba");
  assert.equal(started.venueSessionRecordingEnabled, false);
  assert.ok(Number(started.venueSessionStartedUnix) > 0);

  const ended = runtime.updateVenueSession({ action: "end", venueSessionId: "venue-session-1" });
  assert.equal(ended.lifecycle, "idle");
  assert.equal(ended.venueSessionId, "");
  assert.equal(ended.teamName, "");
  assert.equal(ended.venueSessionStartedUnix, 0);
  assert.ok(Number(ended.revision) > Number(started.revision));
});

test("venue history preserves selections and restarts, then restores the active visit after restart", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-history-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory
  });
  first.updateVenueSession({
    action: "start",
    venueSessionId: "runtime-history-visit",
    teamName: "Equipo runtime",
    recordingPolicy: { scope: "run" }
  });
  await selectPingPong(first);
  first.control("restart");
  first.control("exit");
  await first.stop();

  const restored = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory
  });
  context.after(async () => { await restored.stop(); });
  assert.equal(restored.status().venueSessionId, "runtime-history-visit");
  assert.deepEqual(restored.status().venueSessionRecordingPolicy, { scope: "run" });
  const visit = restored.historySession("runtime-history-visit").session;
  assert.equal(visit.status, "active");
  assert.equal(visit.selections.length, 1);
  assert.equal(visit.selections[0]?.runs.length, 2);
  assert.equal(visit.selections[0]?.runs[0]?.status, "abandoned");
  assert.equal(visit.selections[0]?.runs[1]?.status, "abandoned");
  assert.ok(restored.historyEvents(visit.id).events.some((event) => event.kind === "visit.recovered"));
  restored.updateVenueSession({ action: "end", venueSessionId: visit.id });
});

for (const recordingCase of [
  { scope: "off", expected: [] },
  { scope: "visit", expected: ["start:visit", "stop:visit"] },
  { scope: "selection", expected: ["start:selection", "stop:selection"] },
  { scope: "run", expected: ["start:run", "stop:run", "start:run", "stop:run"] },
] as const) {
  test(`${recordingCase.scope} recording follows session, game, and attempt boundaries end to end`, async (context) => {
    const directory = mkdtempSync(join(tmpdir(), `motion-levels-recording-${recordingCase.scope}-`));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const cameraCalls: RecordingBoundary[] = [];
    const runtime = new VenueRuntime({
      sourceRevision: revision,
      controllerAddress: "127.0.0.1:4201",
      sessionHistoryDir: directory,
      recordingClient: {
        onBoundary(boundary) {
          cameraCalls.push(structuredClone(boundary));
          return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
        }
      }
    });
    context.after(async () => { await runtime.stop(); });
    const venueSessionId = `recording-mode-${recordingCase.scope}`;

    runtime.updateVenueSession({
      action: "start",
      venueSessionId,
      recordingPolicy: { scope: recordingCase.scope }
    });
    if (recordingCase.scope === "visit") await waitFor(() => cameraCalls.length === 1);
    await selectPingPong(runtime);
    if (recordingCase.scope === "selection" || recordingCase.scope === "run") {
      await waitFor(() => cameraCalls.length === 1);
    }
    runtime.control("restart");
    if (recordingCase.scope === "run") await waitFor(() => cameraCalls.length === 3);
    runtime.control("exit");
    if (recordingCase.scope === "selection" || recordingCase.scope === "run") {
      await waitFor(() => cameraCalls.length === recordingCase.expected.length);
    }
    runtime.updateVenueSession({ action: "end", venueSessionId });
    await waitFor(() => cameraCalls.length === recordingCase.expected.length);

    assert.deepEqual(
      cameraCalls.map((boundary) => `${boundary.type}:${boundary.scope}`),
      [...recordingCase.expected]
    );
    if (recordingCase.scope === "selection") {
      assert.equal(new Set(cameraCalls.map((boundary) => boundary.recording.captureId)).size, 1,
        "a same-game restart must remain inside one game capture");
    }
    if (recordingCase.scope === "run") {
      assert.equal(new Set(cameraCalls.map((boundary) => boundary.recording.captureId)).size, 2,
        "a restart must produce a second attempt capture");
    }
  });
}

test("history persistence failures degrade health without exposing local filesystem details", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-health-"));
  const invalidRoot = join(directory, "not-a-directory");
  writeFileSync(invalidRoot, "blocked");
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: invalidRoot
  });
  context.after(async () => { await runtime.stop(); });
  const health = runtime.health();
  assert.equal(health.status, "degraded");
  assert.deepEqual(health.sessionHistory, {
    configured: true,
    healthy: false,
    persistenceHealthy: false,
    recordingConfigured: false,
    recordingHealthy: true,
    activeSessionId: "",
    degradedReason: "persistence_unavailable"
  });
  assert.doesNotMatch(JSON.stringify(health), /not-a-directory/u);
});

test("recording is unavailable when its session association cannot be persisted", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-recording-persistence-"));
  const invalidRoot = join(directory, "not-a-directory");
  writeFileSync(invalidRoot, "blocked");
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: invalidRoot,
    recordingClient: {
      onBoundary: (boundary) => ({ ...boundary.recording, status: "recording" })
    }
  });
  context.after(async () => { await runtime.stop(); });
  const status = runtime.updateVenueSession({
    action: "start",
    venueSessionId: "visit-without-persistence",
    recordingPolicy: { scope: "visit" }
  });

  assert.equal(status.venueSessionRecordingConfigured, false);
  assert.equal(status.venueSessionRecordingAvailable, false);
  assert.equal(status.venueSessionRecordingEnabled, false);
  assert.equal((runtime.health().sessionHistory as { degradedReason?: string }).degradedReason, "persistence_unavailable");
});

test("requested recording is reported unavailable when no camera adapter is configured", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-camera-unavailable-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory
  });
  context.after(async () => { await runtime.stop(); });
  const status = runtime.updateVenueSession({
    action: "start",
    venueSessionId: "visit-camera-unavailable",
    recordingPolicy: { scope: "visit" }
  });
  assert.equal(status.venueSessionRecordingConfigured, false);
  assert.equal(status.venueSessionRecordingEnabled, false);
  assert.equal(status.venueSessionRecordingAvailable, false);
  assert.deepEqual(status.venueSessionRecordingPolicy, { scope: "visit" });
  assert.deepEqual(runtime.health().sessionHistory, {
    configured: true,
    healthy: false,
    persistenceHealthy: true,
    recordingConfigured: false,
    recordingHealthy: true,
    activeSessionId: "visit-camera-unavailable",
    degradedReason: "recording_unavailable"
  });
});

test("camera failures degrade recording health without degrading persistence", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-camera-unhealthy-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        if (boundary.type === "start") return Promise.reject(new Error("camera offline"));
        return { ...boundary.recording, status: "complete" };
      }
    }
  });
  runtime.updateVenueSession({
    action: "start",
    venueSessionId: "visit-camera-unhealthy",
    recordingPolicy: { scope: "visit" }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await runtime.stop();

  const status = runtime.status();
  assert.equal(status.venueSessionRecordingConfigured, true);
  assert.equal(status.venueSessionRecordingEnabled, false);
  assert.equal(status.venueSessionRecordingAvailable, false);
  assert.deepEqual(runtime.health().sessionHistory, {
    configured: true,
    healthy: false,
    persistenceHealthy: true,
    recordingConfigured: true,
    recordingHealthy: false,
    activeSessionId: "visit-camera-unhealthy",
    degradedReason: "recording_unhealthy"
  });
});

test("configured degraded recording can be retried without reporting it active before confirmation", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-camera-retry-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let releaseSecondStart = () => {};
  const secondStartGate = new Promise<void>((resolve) => { releaseSecondStart = resolve; });
  const calls: RecordingBoundary[] = [];
  let startAttempts = 0;
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      async onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "start") {
          startAttempts += 1;
          if (startAttempts === 1) throw new Error("camera start failed");
          await secondStartGate;
          return { ...boundary.recording, status: "recording" };
        }
        return { ...boundary.recording, status: "complete" };
      }
    }
  });
  const venueSessionId = "visit-camera-explicit-retry";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "visit" } });
  await waitFor(() => runtime.status().venueSessionRecordingAvailable === false);
  assert.equal(runtime.status().venueSessionRecordingConfigured, true);
  assert.equal(runtime.status().venueSessionRecordingEnabled, false);

  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "off" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "stop"));
  assert.equal(runtime.status().venueSessionRecordingAvailable, false);
  const retryStatus = runtime.updateVenueSession({
    action: "start",
    venueSessionId,
    recordingPolicy: { scope: "visit" }
  });
  assert.equal(retryStatus.venueSessionRecordingConfigured, true);
  assert.equal(retryStatus.venueSessionRecordingAvailable, false);
  assert.equal(retryStatus.venueSessionRecordingEnabled, false);
  await waitFor(() => startAttempts === 2);
  assert.equal(runtime.status().venueSessionRecordingAvailable, false);
  assert.equal(runtime.status().venueSessionRecordingEnabled, false);

  releaseSecondStart();
  await waitFor(() => runtime.status().venueSessionRecordingAvailable === true);
  assert.equal(runtime.status().venueSessionRecordingEnabled, true);
  assert.notEqual(calls[0]?.recording.captureId, calls[2]?.recording.captureId);
  await runtime.stop();
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
  assert.equal(status.contractVersion, 1);
  assert.equal(status.lifecycle, "waiting");
  assert.ok(status.allowedControls.includes("pause"));
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

  const idle = runtime.control("exit");
  assert.equal(idle.lifecycle, "idle");
  assert.equal(idle.currentGame, "salvapantallas");
  assert.equal(idle.phase, "ambient");
  assert.equal(idle.sessionId, "");
  assert.equal(idle.venueSessionId, "");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).activeTargets, 1);
  assert.ok(frameToRgb(runtime.display().frame as Frame, 1).some((channel) => channel > 0));
});

test("remote floor clients are isolated and cannot release physical pressure", async (context) => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  context.after(async () => { await runtime.stop(); });
  await selectPingPong(runtime);
  const firstClient = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondClient = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const topReadyTile = { x: 0, y: 4, pressed: true };

  runtime.applyRemoteFloorInput({
    commandId: "10000000-0000-4000-8000-000000000001",
    clientId: firstClient,
    clientSequence: 1,
    changes: [topReadyTile]
  });
  runtime.applyRemoteFloorInput({
    commandId: "10000000-0000-4000-8000-000000000002",
    clientId: secondClient,
    clientSequence: 1,
    changes: [topReadyTile]
  });
  assert.deepEqual(runtime.status().remoteFloorInput, {
    activeClients: 2,
    heldTiles: 1,
    leaseMillis: 5_000,
    trackedClients: 2
  });
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);

  runtime.applyRemoteFloorInput({
    commandId: "10000000-0000-4000-8000-000000000003",
    clientId: firstClient,
    clientSequence: 2,
    releaseAll: true
  });
  runtime.control("restart");
  assert.equal(runtime.status().remoteFloorInput.activeClients, 1);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);

  runtime.applyPressure({ x: 0, y: 4, pressed: true, unixNanos: 1n, sequence: 1n });
  runtime.applyRemoteFloorInput({
    commandId: "10000000-0000-4000-8000-000000000004",
    clientId: secondClient,
    clientSequence: 2,
    releaseAll: true
  });
  runtime.control("restart");
  assert.equal(runtime.status().remoteFloorInput.activeClients, 0);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);

  runtime.applyPressure({ x: 0, y: 4, pressed: false, unixNanos: 2n, sequence: 2n });
  runtime.control("restart");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 0);
});

test("remote floor batches validate atomically before changing the game", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  assert.throws(() => runtime.applyRemoteFloorInput({
    commandId: "20000000-0000-4000-8000-000000000001",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 1,
    changes: [
      { x: 8, y: 16, pressed: true },
      { x: FLOOR_COLS, y: 16, pressed: true }
    ]
  }), /changes\[1\]\.x must be 0\.\.15/u);
  assert.equal(runtime.status().remoteFloorInput.activeClients, 0);
  assert.equal(runtime.status().remoteFloorInput.heldTiles, 0);
  assert.equal(runtime.status().activeTargets, 0);
});

test("remote floor heartbeats renew leases and abandoned input is released", async (context) => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    remoteFloorInputLeaseMillis: 200
  });
  context.after(async () => { await runtime.stop(); });
  await selectPingPong(runtime);
  runtime.applyRemoteFloorInput({
    commandId: "30000000-0000-4000-8000-000000000001",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 1,
    changes: [{ x: 0, y: 4, pressed: true }]
  });
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 1);

  await new Promise((resolve) => setTimeout(resolve, 120));
  runtime.applyRemoteFloorInput({
    commandId: "30000000-0000-4000-8000-000000000002",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSequence: 2,
    changes: []
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(runtime.status().remoteFloorInput.activeClients, 1);

  await waitFor(() => runtime.status().remoteFloorInput.activeClients === 0);
  runtime.control("restart");
  assert.equal(runtime.status().remoteFloorInput.heldTiles, 0);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).readyPlayers, 0);
});

test("remote floor sequence tombstones expire after their safety horizon", async (context) => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    remoteFloorInputTombstoneMillis: 100
  });
  context.after(async () => { await runtime.stop(); });
  const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  runtime.applyRemoteFloorInput({
    commandId: "31000000-0000-4000-8000-000000000001",
    clientId,
    clientSequence: 1,
    changes: [{ x: 8, y: 16, pressed: true }]
  });
  runtime.applyRemoteFloorInput({
    commandId: "31000000-0000-4000-8000-000000000002",
    clientId,
    clientSequence: 2,
    releaseAll: true
  });
  assert.equal(runtime.status().remoteFloorInput.trackedClients, 1);

  await waitFor(() => runtime.status().remoteFloorInput.trackedClients === 0);
  const reused = runtime.applyRemoteFloorInput({
    commandId: "31000000-0000-4000-8000-000000000003",
    clientId,
    clientSequence: 1,
    changes: []
  });
  assert.equal(reused.applied, true);
  assert.equal(reused.lastSequence, 1);
});

test("selecting salvapantallas stays an idle rotation without a gameplay session", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const status = await runtime.select({
    game: "salvapantallas",
    engineGame: "salvapantallas",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    durationSeconds: 5,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(status.lifecycle, "idle");
  assert.equal(status.phase, "ambient");
  assert.equal(status.sessionId, "");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).rotationSize, 24);
  assert.throws(() => runtime.control("pause"), /no active game/);
});

test("screensaver uses and retains the last good platform rotation", async (context) => {
  let fail = false;
  let authorization = "";
  const contentRevision = "a".repeat(64);
  const server = createServer((request, response) => {
    authorization = String(request.headers.authorization ?? "");
    if (fail) {
      response.writeHead(503).end("unavailable");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      schema: "motion-levels-animation-content-v1",
      contentRevision,
      selectedAnimationId: "aurora",
      rotationIds: ["aurora", "prism-tunnel"],
      rotationSeconds: 5
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${address.port}`,
    platformToken: "platform-token"
  });

  assert.equal(await runtime.refreshScreensaverContent(), true);
  assert.equal(authorization, "Bearer platform-token");
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).contentRevision, contentRevision);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).rotationSize, 2);

  fail = true;
  assert.equal(await runtime.refreshScreensaverContent(), false);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).contentRevision, contentRevision);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).rotationSize, 2);
});

test("canonical animation selection remains an idle screensaver and requests platform duration", async (context) => {
  let requestedUrl = "";
  const server = createServer((request, response) => {
    requestedUrl = request.url ?? "";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      schema: "motion-levels-animation-content-v1",
      contentRevision: "b".repeat(64),
      selectedAnimationId: "aurora",
      rotationIds: ["aurora"],
      rotationSeconds: 35
    }));
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
  const status = await runtime.select({
    game: "a861f0dc-3e2e-4fe9-b487-33194af75b68",
    engineGame: "motion-levels-games:a861f0dc-3e2e-4fe9-b487-33194af75b68",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    durationSeconds: 35,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  assert.equal(status.lifecycle, "idle");
  assert.match(requestedUrl, /\/api\/level-games\/salvapantallas\/runtime-content\?rotationSeconds=35/u);
  assert.equal((runtime.display().gameSnapshot as Record<string, unknown>).rotationSize, 1);
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

test("ending a venue session while published content loads aborts selection before mutation", async (context) => {
  const canonicalGameId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let releaseResponse = () => {};
  let observeRequest = () => {};
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const requestObserved = new Promise<void>((resolve) => { observeRequest = resolve; });
  const server = createServer((_request, response) => {
    observeRequest();
    void responseGate.then(() => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...parkourContent, gameId: canonicalGameId, contentRevision: "b".repeat(64) }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-select-end-race-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${address.port}`,
    sessionHistoryDir: directory
  });
  const venueSessionId = "visit-select-end-race";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "off" } });
  const selection = runtime.select({
    game: canonicalGameId,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "platform_levels",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "off" },
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  await requestObserved;
  runtime.updateVenueSession({ action: "end", venueSessionId, reason: "remote_end" });
  releaseResponse();

  await assert.rejects(selection, /venue session changed while selecting/u);
  const status = runtime.status();
  assert.equal(status.lifecycle, "idle");
  assert.equal(status.currentGame, "salvapantallas");
  assert.equal(status.venueSessionId, "");
  assert.equal(runtime.historySession(venueSessionId).session.status, "ended");
  await runtime.stop();
});

test("turning recording off while published content loads cannot restore stale policy or restart camera", async (context) => {
  const canonicalGameId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let releaseResponse = () => {};
  let observeRequest = () => {};
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const requestObserved = new Promise<void>((resolve) => { observeRequest = resolve; });
  const server = createServer((_request, response) => {
    observeRequest();
    void responseGate.then(() => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...parkourContent, gameId: canonicalGameId, contentRevision: "c".repeat(64) }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-select-off-race-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const cameraCalls: RecordingBoundary[] = [];
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    platformUrl: `http://127.0.0.1:${address.port}`,
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        cameraCalls.push(boundary);
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  const venueSessionId = "visit-select-off-race";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "visit" } });
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "start"));
  const selection = runtime.select({
    game: canonicalGameId,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "platform_levels",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "visit" },
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  await requestObserved;
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "off" } });
  await waitFor(() => cameraCalls.some((boundary) => boundary.type === "stop"));
  releaseResponse();

  await assert.rejects(selection, /venue session changed while selecting/u);
  assert.deepEqual(runtime.status().venueSessionRecordingPolicy, { scope: "off" });
  assert.deepEqual(cameraCalls.map((boundary) => boundary.type), ["start", "stop"]);
  assert.deepEqual(runtime.historySession(venueSessionId).session.recordingPolicy, { scope: "off" });
  await runtime.stop();
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

test("failed published-level attempts create a new run and run-scoped recording automatically", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-auto-attempt-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const cameraCalls: RecordingBoundary[] = [];
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        cameraCalls.push(structuredClone(boundary));
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  context.after(async () => { await runtime.stop(); });
  const venueSessionId = "visit-auto-attempt";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "run" } });
  const selected = await runtime.select({
    game: `motion-levels-games:${parkourGameId}`,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "run" },
    difficulty: "medium",
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  await waitFor(() => cameraCalls.length === 1);
  const initialRunId = selected.sessionId;
  const internal = runtime as unknown as { gameStartedAt: number; tick(now: number): void };
  const base = performance.now();
  internal.gameStartedAt = base - 4_000;
  internal.tick(base);
  const lava = (runtime.display().frame as Frame).cells.filter((cell) => {
    const red = Number.parseInt(cell.color.slice(1, 3), 16);
    const green = Number.parseInt(cell.color.slice(3, 5), 16);
    const blue = Number.parseInt(cell.color.slice(5, 7), 16);
    return red > green * 1.5 && red > blue * 1.5;
  }).slice(0, 3);
  assert.equal(lava.length, 3, "Parkour must expose three lava tiles during the running attempt");
  let pressureSequence = 0n;
  for (const tile of lava) {
    pressureSequence += 1n;
    runtime.applyPressure({ x: tile.x, y: tile.y, pressed: true, unixNanos: pressureSequence, sequence: pressureSequence });
  }
  assert.equal(runtime.status().phase, "finished");

  const retryAt = performance.now() + 3_100;
  internal.tick(retryAt);
  const retryRunId = runtime.status().sessionId;
  assert.notEqual(retryRunId, initialRunId);
  assert.equal(runtime.status().phase, "running");
  internal.tick(retryAt + 20);
  assert.equal(runtime.status().phase, "finished");
  await waitFor(() => cameraCalls.length >= 4);
  assert.deepEqual(cameraCalls.slice(0, 4).map((boundary) => `${boundary.type}:${boundary.runId}`), [
    `start:${initialRunId}`,
    `stop:${initialRunId}`,
    `start:${retryRunId}`,
    `stop:${retryRunId}`
  ]);

  const visit = runtime.historySession(venueSessionId).session;
  assert.equal(visit.selections.length, 1);
  assert.deepEqual(visit.selections[0]?.runs.map((run) => [run.id, run.reason]), [
    [initialRunId, "initial"],
    [retryRunId, "restart"]
  ]);
  assert.ok((visit.selections[0]?.runs[1]?.engineElapsedMillis ?? Number.POSITIVE_INFINITY) < 1_000);
  assert.deepEqual(visit.recordings.map((recording) => recording.runId), [initialRunId, retryRunId]);
  const retryEvents = runtime.historyEvents(venueSessionId, { limit: 500 }).events
    .filter((event) => event.runId === retryRunId);
  assert.ok(retryEvents.length > 0);
  assert.ok(retryEvents.every((event) => event.engineAtMillis === undefined || event.engineAtMillis < 1_000));
  const retrySnapshot = visit.selections[0]?.runs[1]?.finalSnapshot;
  assert.equal(retrySnapshot?.attemptCreatedMillis, 0);
  assert.equal(retrySnapshot?.attemptStartedMillis, 0);
  assert.ok(Number(retrySnapshot?.lastEventMillis) < 1_000);
});

test("successful published-level advances create a new run and expose the actual level", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-runtime-level-advance-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const cameraCalls: RecordingBoundary[] = [];
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    sessionHistoryDir: directory,
    recordingClient: {
      onBoundary(boundary) {
        cameraCalls.push(structuredClone(boundary));
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  context.after(async () => { await runtime.stop(); });
  const venueSessionId = "visit-level-advance";
  runtime.updateVenueSession({ action: "start", venueSessionId, recordingPolicy: { scope: "run" } });
  const selected = await runtime.select({
    game: `motion-levels-games:${parkourGameId}`,
    engineGame: `motion-levels-games:${parkourGameId}`,
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    venueSessionId,
    recordingPolicy: { scope: "run" },
    difficulty: "medium",
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
  await waitFor(() => cameraCalls.length === 1);
  const initialRunId = selected.sessionId;
  const initialLevel = selected.level;
  const internal = runtime as unknown as { gameStartedAt: number; tick(now: number): void };
  const base = performance.now();
  internal.gameStartedAt = base - 3_000;
  internal.tick(base);
  runtime.applyPressure({ x: 7, y: 5, pressed: true, unixNanos: 1n, sequence: 1n });
  assert.equal(runtime.status().phase, "finished");
  assert.equal(runtime.status().success, true);

  internal.tick(base + 1_400);
  await waitFor(() => cameraCalls.length >= 3);
  const advanced = runtime.status();
  const advancedRunId = advanced.sessionId;
  assert.notEqual(advancedRunId, initialRunId);
  assert.notEqual(advanced.level, initialLevel);
  assert.equal(advanced.phase, "countdown");
  assert.deepEqual(cameraCalls.slice(0, 3).map((boundary) => `${boundary.type}:${boundary.runId}`), [
    `start:${initialRunId}`,
    `stop:${initialRunId}`,
    `start:${advancedRunId}`
  ]);

  const visit = runtime.historySession(venueSessionId).session;
  assert.deepEqual(visit.selections[0]?.runs.map((run) => [run.id, run.reason]), [
    [initialRunId, "initial"],
    [advancedRunId, "restart"]
  ]);
  assert.equal(visit.selections[0]?.runs[0]?.finalSnapshot?.level, initialLevel);
  assert.equal(visit.selections[0]?.runs[1]?.finalSnapshot?.level, advanced.level);
  assert.deepEqual(visit.recordings.map((recording) => recording.runId), [initialRunId, advancedRunId]);
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

test("floor output test frames are bounded four-pulse 16x32 RGB output", () => {
  const dark = floorOutputTestRgb(0, 1);
  const firstPeak = floorOutputTestRgb(floorOutputTestDurationMillis / 8, 1);
  const secondPeak = floorOutputTestRgb(floorOutputTestDurationMillis * 3 / 8, 1);
  const halfBrightness = floorOutputTestRgb(floorOutputTestDurationMillis / 8, 0.5);

  assert.equal(dark.byteLength, floorRgbBytes);
  assert.ok(dark.every((channel) => channel === 0));
  assert.ok(firstPeak.some((channel) => channel > 0));
  assert.notDeepEqual(firstPeak.slice(0, 3), secondPeak.slice(0, 3));
  assert.ok(halfBrightness.every((channel, index) => channel <= Math.ceil((firstPeak[index] ?? 0) / 2)));
  assert.ok(floorOutputTestRgb(floorOutputTestDurationMillis / 8, 0).every((channel) => channel === 0));
  assert.ok(floorOutputTestRgb(floorOutputTestDurationMillis, 1).every((channel) => channel === 0));
  assert.ok(floorOutputTestRgb(floorOutputTestDurationMillis + 100, 1).every((channel) => channel === 0));
});

test("floor output test overlays only controller RGB and follows presented desired sequences", async () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    brightness: 0.5
  });
  await selectPingPong(runtime);
  runtime.control("pause");
  const beforeStatus = runtime.status();
  const beforeSnapshot = structuredClone(runtime.display().gameSnapshot);
  const beforeFrame = runtime.display().frame as Frame;
  const sent: Array<{ sequence: bigint; rgb: Uint8Array }> = [];
  const internals = runtime as unknown as {
    controller: { sendFrame(frame: { sequence: bigint; rgb: Uint8Array }): void };
    controllerConnected: boolean;
    floorOutputTestRun: { startedAtMillis: number } | null;
    tick(now: number): void;
  };
  internals.controllerConnected = true;
  internals.controller.sendFrame = (frame) => sent.push({ sequence: frame.sequence, rgb: frame.rgb.slice() });

  const pending = runtime.runOutputTest("floor");
  assert.equal(pending.outputTest?.target, "floor");
  assert.equal(pending.outputTest?.sequence, 1);
  assert.equal(pending.outputTest?.state, "pending");
  assert.equal(typeof pending.outputTest?.startedUnixMillis, "number");
  assert.equal(pending.outputTest?.finishedUnixMillis, undefined);
  assert.equal(pending.currentGame, beforeStatus.currentGame);
  assert.equal(pending.sessionId, beforeStatus.sessionId);
  assert.equal(pending.phase, beforeStatus.phase);
  const startedAtMillis = internals.floorOutputTestRun?.startedAtMillis;
  assert.equal(typeof startedAtMillis, "number");

  internals.tick((startedAtMillis ?? 0) + floorOutputTestDurationMillis / 8);
  const diagnostic = sent.at(-1);
  assert.ok(diagnostic);
  assert.deepEqual(
    diagnostic.rgb,
    floorOutputTestRgb(floorOutputTestDurationMillis / 8, 0.5)
  );
  runtime.observePresentedFrame({
    ...observedFrame(1n),
    desiredSequence: diagnostic.sequence,
    rgb: diagnostic.rgb
  });
  assert.equal(runtime.status().outputTest?.state, "playing");

  internals.tick((startedAtMillis ?? 0) + floorOutputTestDurationMillis + 1);
  const restored = sent.at(-1);
  assert.ok(restored);
  assert.deepEqual(restored.rgb, frameToRgb(beforeFrame, 0.5));
  runtime.observePresentedFrame({
    ...observedFrame(2n),
    desiredSequence: restored.sequence,
    rgb: restored.rgb
  });
  const passed = runtime.status().outputTest;
  assert.equal(passed?.target, "floor");
  assert.equal(passed?.sequence, 1);
  assert.equal(passed?.state, "passed");
  assert.ok((passed?.finishedUnixMillis ?? 0) >= (passed?.startedUnixMillis ?? Number.POSITIVE_INFINITY));
  assert.deepEqual(runtime.display().gameSnapshot, beforeSnapshot);
  assert.equal(runtime.status().currentGame, beforeStatus.currentGame);
  assert.equal(runtime.status().sessionId, beforeStatus.sessionId);
  await runtime.stop();
});

test("floor output test rejects a black diagnostic frame", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const internals = runtime as unknown as {
    controller: { sendFrame(frame: { sequence: bigint; rgb: Uint8Array }): void };
    controllerConnected: boolean;
    floorOutputTestRun: { startedAtMillis: number } | null;
    tick(now: number): void;
  };
  internals.controllerConnected = true;
  const sent: Array<{ sequence: bigint; rgb: Uint8Array }> = [];
  internals.controller.sendFrame = (frame) => sent.push({ sequence: frame.sequence, rgb: frame.rgb.slice() });
  runtime.runOutputTest("floor");
  const startedAtMillis = internals.floorOutputTestRun?.startedAtMillis ?? 0;
  internals.tick(startedAtMillis + floorOutputTestDurationMillis / 8);
  const diagnostic = sent.at(-1);
  assert.ok(diagnostic);
  runtime.observePresentedFrame({
    ...observedFrame(1n),
    desiredSequence: diagnostic.sequence,
    rgb: new Uint8Array(floorRgbBytes)
  });
  assert.equal(runtime.status().outputTest?.state, "pending", "a black presented frame is not a visible pulse");
  internals.tick(startedAtMillis + floorOutputTestDurationMillis + 1);
  const restored = sent.at(-1);
  assert.ok(restored);
  runtime.observePresentedFrame({
    ...observedFrame(2n),
    desiredSequence: restored.sequence,
    rgb: restored.rgb
  });
  const failed = runtime.status().outputTest;
  assert.equal(failed?.target, "floor");
  assert.equal(failed?.sequence, 1);
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.error, "El suelo no presentó la animación de prueba");
  assert.ok((failed?.finishedUnixMillis ?? 0) >= (failed?.startedUnixMillis ?? Number.POSITIVE_INFINITY));
});

test("floor output test times out without a presented frame", () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const internals = runtime as unknown as {
    controller: { sendFrame(frame: { sequence: bigint; rgb: Uint8Array }): void };
    controllerConnected: boolean;
    floorOutputTestRun: { startedAtMillis: number } | null;
    tick(now: number): void;
  };
  internals.controllerConnected = true;
  internals.controller.sendFrame = () => {};
  runtime.runOutputTest("floor");
  const startedAtMillis = internals.floorOutputTestRun?.startedAtMillis ?? 0;
  internals.tick(startedAtMillis + 1);
  internals.tick(startedAtMillis + 2_001);
  assert.equal(runtime.status().outputTest?.state, "failed");
  assert.equal(runtime.status().outputTest?.error, "El suelo no confirmó la animación de prueba");
});

test("output tests cannot obscure an active game and a new selection cancels an idle test", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const internals = runtime as unknown as {
    controllerConnected: boolean;
    floorOutputTestRun: unknown;
  };
  internals.controllerConnected = true;

  const pending = runtime.runOutputTest("floor").outputTest;
  assert.equal(pending?.state, "pending");
  await selectPingPong(runtime);
  assert.equal(runtime.status().outputTest?.state, "failed");
  assert.equal(runtime.status().outputTest?.error, "Prueba cancelada al iniciar la partida");
  assert.equal(internals.floorOutputTestRun, null);
  assert.throws(
    () => runtime.runOutputTest("floor"),
    /output tests require an idle or paused game/u
  );

  runtime.control("pause");
  const pausedTest = runtime.runOutputTest("floor").outputTest;
  assert.equal(pausedTest?.state, "pending");
  assert.throws(() => runtime.control("unknown"), /unknown control action/u);
  assert.equal(runtime.status().outputTest?.id, pausedTest?.id);
  assert.equal(runtime.status().outputTest?.state, "pending", "an invalid command must not cancel a running test");
  await runtime.stop();
});

test("local live floor is latest-value at a configured rate", async () => {
  const runtime = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    localLiveFloorFps: 10
  });
  const sequences: number[] = [];
  const unsubscribe = runtime.subscribeObservedFloor((frame) => sequences.push(frame.sequence));

  runtime.observePresentedFrame(observedFrame(1n));
  runtime.observePresentedFrame(observedFrame(2n));
  runtime.observePresentedFrame(observedFrame(3n));

  await waitFor(() => sequences.length === 2);
  assert.deepEqual(sequences, [1, 3]);
  unsubscribe();
  await runtime.stop();
});

test("local live floor defaults to 20 fps and is capped at 25 fps", () => {
  const defaults = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  const capped = new VenueRuntime({
    sourceRevision: revision,
    controllerAddress: "127.0.0.1:4201",
    localLiveFloorFps: 100
  });
  const defaultLiveFloor = defaults.health().liveFloor as Record<string, unknown>;
  const cappedLiveFloor = capped.health().liveFloor as Record<string, unknown>;
  assert.equal(defaultLiveFloor.localTargetFps, 20);
  assert.equal(cappedLiveFloor.localTargetFps, 25);
});

test("local live floor sends the current snapshot immediately to each new subscriber", async () => {
  const runtime = new VenueRuntime({ sourceRevision: revision, controllerAddress: "127.0.0.1:4201" });
  runtime.observePresentedFrame(observedFrame(7n));

  const first: number[] = [];
  const second: number[] = [];
  const unsubscribeFirst = runtime.subscribeObservedFloor((frame) => first.push(frame.sequence));
  const unsubscribeSecond = runtime.subscribeObservedFloor((frame) => second.push(frame.sequence));

  assert.deepEqual(first, [7]);
  assert.deepEqual(second, [7]);
  unsubscribeFirst();
  unsubscribeSecond();
  await runtime.stop();
});

test("runtime content cannot redirect production fetches to a request-controlled origin", () => {
  assert.equal(
    resolveRuntimeContentPlatformUrl("https://platform.motionlevels.example/base", "https://attacker.example")?.origin,
    "https://platform.motionlevels.example"
  );
  assert.equal(resolveRuntimeContentPlatformUrl(undefined, "https://attacker.example"), null);
  assert.equal(resolveRuntimeContentPlatformUrl(undefined, "http://127.0.0.1:3000")?.origin, "http://127.0.0.1:3000");
});

function observedFrame(sequence: bigint): PresentedFrame {
  return {
    presentationSequence: sequence,
    desiredSequence: sequence,
    presentedUnixNanos: sequence * 20_000_000n,
    width: floorWidth,
    height: floorHeight,
    rgb: new Uint8Array(floorRgbBytes),
    pressureBits: new Uint8Array(pressureBitsetBytes),
    fadeRatio: 0
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met");
}

async function selectPingPong(runtime: VenueRuntime): Promise<void> {
  await runtime.select({
    game: "motion-levels-games:ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceKind: "motion_levels_games",
    sourceRevision: revision,
    playerCount: 0,
    allowAnyPlayers: true,
    players: []
  });
}

function readyDisplayReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: "player-display",
    currentGame: "salvapantallas",
    expectedRevision: revision,
    loadedRevision: revision,
    renderStatus: "ready",
    connected: true,
    feedTransport: "eventsource",
    lastFeedUnixMillis: Date.now(),
    audioOutputState: "ready",
    ...overrides
  };
}
