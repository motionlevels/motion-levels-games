import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  type RecordingBoundary,
  type RecordingClient,
  type SessionHistoryVisit
} from "@motion-levels-games/session-history";
import type { GameSessionState } from "@motion-levels-games/runtime";
import { SessionHistoryRecorder } from "../src/sessionHistoryRecorder.ts";
import { SessionHistoryStore } from "../src/sessionHistoryStore.ts";

function temporaryStore(context: TestContext, now: () => number): SessionHistoryStore {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-recorder-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return new SessionHistoryStore(directory, now);
}

function state(
  clockMillis: number,
  elapsedMillis: number,
  score = 0,
  events: GameSessionState["events"] = []
): GameSessionState {
  return {
    gameId: "ping-pong",
    clockMillis,
    paused: false,
    frame: { width: 16, height: 32, cells: [] },
    snapshot: {
      currentGame: "ping-pong",
      label: "Ping pong",
      phase: "running",
      playerCount: 1,
      players: [{ index: 0, label: "Ada", color: "#ff0000", score, lives: 3 }],
      score,
      lives: 3,
      elapsedMillis,
      remainingMillis: 60_000 - elapsedMillis,
      activeTargets: 0,
      success: false,
      lastEventCue: "none",
      lastEventMessage: "",
      rounds: []
    },
    events
  };
}

function startSelection(recorder: SessionHistoryRecorder, runId = "run-1") {
  return recorder.startSelection({
    id: "selection-1",
    runId,
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    manifestId: "ping-pong",
    label: "Ping pong",
    sourceKind: "motion_levels_games",
    sourceRevision: "1".repeat(40),
    difficulty: "medium",
    players: [{ id: "player-1", name: "Ada" }]
  }, state(0, 0));
}

async function waitFor(predicate: () => boolean, timeoutMillis = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for recorder state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("keeps elapsed clocks in memory and flushes the last tick when a run ends", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-duration", recordingPolicy: { scope: "off" } });
  startSelection(recorder);
  const checkpointsBefore = store.listEvents("visit-duration").events.filter((event) => event.kind === "run.checkpoint").length;

  now = 10_900;
  recorder.observeState(state(9_876, 8_765));
  assert.equal(
    store.listEvents("visit-duration").events.filter((event) => event.kind === "run.checkpoint").length,
    checkpointsBefore,
    "elapsed-only ticks must not add journal checkpoints"
  );

  now = 11_000;
  recorder.endSelection("exit");
  const run = store.getVisit("visit-duration").selections[0]?.runs[0];
  assert.equal(run?.engineElapsedMillis, 9_876);
  assert.equal(run?.gameplayElapsedMillis, 8_765);
});

test("retains the complete game-specific snapshot at clean run end", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-full-snapshot", recordingPolicy: { scope: "off" } });
  startSelection(recorder);
  const detailed = state(4_000, 3_500, 7);
  detailed.snapshot = {
    ...detailed.snapshot,
    winner: "Ada",
    precision: 0.875,
    combo: 4,
    progress: { targets: 8, completed: 7 }
  } as typeof detailed.snapshot;
  recorder.observeState(detailed);
  now = 5_000;
  recorder.endSelection("exit");

  const snapshot = store.getVisit("visit-full-snapshot").selections[0]?.runs[0]?.finalSnapshot;
  assert.equal(snapshot?.winner, "Ada");
  assert.equal(snapshot?.precision, 0.875);
  assert.equal(snapshot?.combo, 4);
  assert.deepEqual(snapshot?.progress, { targets: 8, completed: 7 });
});

test("periodically flushes elapsed clocks without adding checkpoints so crash recovery keeps duration", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-clock-recovery", recordingPolicy: { scope: "off" } });
  startSelection(recorder);
  const checkpoints = store.listEvents("visit-clock-recovery").events.filter((event) => event.kind === "run.checkpoint").length;

  now = 6_100;
  recorder.observeState(state(5_100, 5_000));
  assert.equal(
    store.listEvents("visit-clock-recovery").events.filter((event) => event.kind === "run.checkpoint").length,
    checkpoints
  );

  now = 7_000;
  const recovered = new SessionHistoryStore(store.rootDir, () => now).recoverOpenVisit();
  assert.equal(recovered?.selections[0]?.runs[0]?.status, "interrupted");
  assert.equal(recovered?.selections[0]?.runs[0]?.engineElapsedMillis, 5_100);
  assert.equal(recovered?.selections[0]?.runs[0]?.gameplayElapsedMillis, 5_000);
});

test("writes one journal batch for a material checkpoint with multiple game events", (context) => {
  let now = 1_000;
  const batches: number[] = [];
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-recorder-batch-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new SessionHistoryStore(directory, () => now, {
    onJournalBatch: (eventCount) => batches.push(eventCount)
  });
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-batch", recordingPolicy: { scope: "off" } });
  startSelection(recorder);
  batches.length = 0;

  now = 2_000;
  recorder.observeState(state(1_000, 900, 1, [
    { cue: "hit", message: "Primer impacto", atMillis: 800 },
    { cue: "win", message: "Punto", atMillis: 900 }
  ]));
  assert.deepEqual(batches, [3], "checkpoint and both GameEvents share one fdatasync batch");
});

test("restart creates a second run under the same selection", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-restart", recordingPolicy: { scope: "off" } });
  startSelection(recorder);
  now = 2_000;
  recorder.restartRun("run-2", state(0, 0));
  const selection = store.getVisit("visit-restart").selections[0];
  assert.equal(selection?.runs.length, 2);
  assert.equal(selection?.runs[0]?.status, "abandoned");
  assert.equal(selection?.runs[0]?.outcome, "restarted");
  assert.equal(selection?.runs[1]?.reason, "restart");
});

test("finishing a run clears the active run before a later recording policy change", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({ id: "visit-finished-run", recordingPolicy: { scope: "off" } });
  startSelection(recorder);

  now = 2_000;
  const terminal = state(1_000, 900);
  terminal.snapshot = { ...terminal.snapshot, phase: "finished", success: true };
  recorder.observeState(terminal);

  let visit = store.getVisit("visit-finished-run");
  assert.equal(visit.selections[0]?.runs[0]?.status, "finished");
  assert.equal(visit.activeRunId, undefined);

  recorder.startVisit({ id: visit.id, recordingPolicy: { scope: "run" } });
  visit = store.getVisit(visit.id);
  assert.equal(visit.recordingPolicy.scope, "run");
  assert.deepEqual(visit.recordings, [], "an ended run must not acquire a new run-scoped capture");
});

test("updates visit roster and team from every selection while preserving prior selection snapshots", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({
    id: "visit-roster",
    teamName: "Equipo inicial",
    players: [{ id: "player-1", name: "Ada" }],
    recordingPolicy: { scope: "off" }
  });
  startSelection(recorder);
  now = 2_000;
  recorder.startSelection({
    id: "selection-2",
    runId: "run-2",
    gameId: "lava",
    engineGame: "motion-levels-games:lava",
    manifestId: "lava",
    label: "Lava",
    sourceKind: "motion_levels_games",
    sourceRevision: "1".repeat(40),
    difficulty: "easy",
    teamName: "Equipo nuevo",
    players: [{ id: "player-2", name: "Berta" }]
  }, state(0, 0));

  const visit = store.getVisit("visit-roster");
  assert.equal(visit.teamName, "Equipo nuevo");
  assert.deepEqual(visit.players.map((player) => player.name), ["Berta"]);
  assert.deepEqual(visit.selections[0]?.players.map((player) => player.name), ["Ada"]);
  assert.deepEqual(visit.selections[1]?.players.map((player) => player.name), ["Berta"]);
});

test("serializes run capture boundaries globally even while camera start is pending", async (context) => {
  let resolveFirstStart: (() => void) | undefined;
  const firstStartGate = new Promise<void>((resolve) => { resolveFirstStart = resolve; });
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    async onBoundary(boundary) {
      calls.push(boundary);
      if (calls.length === 1) await firstStartGate;
      return {
        ...boundary.recording,
        status: boundary.type === "start" ? "recording" : "complete"
      };
    }
  };
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now, recordingClient: client });
  recorder.startVisit({ id: "visit-queue", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await Promise.resolve();
  now = 2_000;
  recorder.restartRun("run-2", state(0, 0));

  await Promise.resolve();
  assert.deepEqual(calls.map(({ type, runId }) => `${type}:${runId}`), ["start:run-1"]);
  resolveFirstStart?.();
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-2"));
  await recorder.stop();
  assert.deepEqual(calls.map(({ type, runId }) => `${type}:${runId}`), [
    "start:run-1",
    "stop:run-1",
    "start:run-2",
    "stop:run-2"
  ]);
});

test("never starts a queued capture after its run was revoked", async (context) => {
  let releaseFirstStart = () => {};
  const firstStartGate = new Promise<void>((resolve) => { releaseFirstStart = resolve; });
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    async onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "start" && boundary.runId === "run-1") await firstStartGate;
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({ id: "visit-revoked-queued-start", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await Promise.resolve();
  recorder.restartRun("run-2", state(0, 0));
  const drain = recorder.stop();
  releaseFirstStart();
  await drain;

  assert.equal(calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-2"), false);
  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.runId}`), [
    "start:run-1",
    "stop:run-1",
    "stop:run-2"
  ]);
});

test("a run that finishes on its first state still starts before its queued stop", async (context) => {
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({ id: "visit-terminal-queued-start", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await waitFor(() => calls.length === 1);

  const terminal = state(0, 0);
  terminal.snapshot = { ...terminal.snapshot, phase: "finished", success: false };
  recorder.restartRun("run-2", terminal);
  await waitFor(() => calls.length === 4);

  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.runId}`), [
    "start:run-1",
    "stop:run-1",
    "start:run-2",
    "stop:run-2"
  ]);
  const recording = store.getVisit("visit-terminal-queued-start").recordings.find((candidate) => candidate.runId === "run-2");
  assert.equal(recording?.status, "complete");
});

test("revoking a terminal run still cancels its preserved queued start", async (context) => {
  let releaseFirstStart = () => {};
  const firstStartGate = new Promise<void>((resolve) => { releaseFirstStart = resolve; });
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    async onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "start" && boundary.runId === "run-1") await firstStartGate;
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({ id: "visit-revoked-terminal-start", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await waitFor(() => calls.length === 1);

  const terminal = state(0, 0);
  terminal.snapshot = { ...terminal.snapshot, phase: "finished", success: false };
  recorder.restartRun("run-2", terminal);
  const drain = recorder.stop();
  releaseFirstStart();
  await drain;

  assert.equal(calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-2"), false);
  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.runId}`), [
    "start:run-1",
    "stop:run-1",
    "stop:run-2"
  ]);
});

test("restarts an active visit capture idempotently with its persisted capture id", async (context) => {
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return {
        ...boundary.recording,
        status: boundary.type === "start" ? "recording" : "complete"
      };
    }
  };
  const store = temporaryStore(context, () => 2_000);
  store.createVisit({
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id: "visit-resume-capture",
    status: "active",
    startedAtUnixMillis: 1_000,
    updatedAtUnixMillis: 1_500,
    teamName: "Equipo",
    players: [],
    recordingPolicy: { scope: "visit" },
    selections: [],
    recordings: [{
      id: "recording-existing",
      captureId: "capture-existing",
      scope: "visit",
      status: "recording",
      linkedRunIds: [],
      startedAtUnixMillis: 1_000
    }],
    lastSequence: 0
  });

  const recorder = new SessionHistoryRecorder(store, { now: () => 2_000, recordingClient: client });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  await recorder.stop();

  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.recording.captureId}`), [
    "start:capture-existing",
    "stop:capture-existing"
  ]);
  assert.equal(store.getVisit("visit-resume-capture").recordings.length, 1);
  assert.equal(store.getVisit("visit-resume-capture").recordings[0]?.status, "complete");
});

test("keeps an uncertain start requested and retries the same capture after restart", async (context) => {
  const store = temporaryStore(context, () => 1_000);
  const first = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: { onBoundary: () => Promise.reject(new Error("response timeout")) }
  });
  first.startVisit({ id: "visit-start-timeout", recordingPolicy: { scope: "visit" } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const uncertain = store.getVisit("visit-start-timeout").recordings[0];
  assert.equal(uncertain?.status, "requested");
  assert.equal(first.health().recordingHealthy, false);

  const calls: RecordingBoundary[] = [];
  const reopened = new SessionHistoryStore(store.rootDir, () => 2_000);
  const recovered = new SessionHistoryRecorder(reopened, {
    now: () => 2_000,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  await recovered.stop();

  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.recording.captureId}`), [
    `start:${uncertain?.captureId}`,
    `stop:${uncertain?.captureId}`
  ]);
  assert.equal(reopened.getVisit("visit-start-timeout").recordings.length, 1);
  assert.equal(recovered.health().recordingHealthy, true);
});

test("a later confirmed start recovers recording health", async (context) => {
  let call = 0;
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: {
      onBoundary(boundary) {
        call += 1;
        if (call === 1) return Promise.reject(new Error("temporary timeout"));
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  recorder.startVisit({
    id: "visit-health-recovery",
    recordingPolicy: { scope: "visit", includeAudio: false }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(recorder.health().recordingHealthy, false);

  recorder.startVisit({
    id: "visit-health-recovery",
    recordingPolicy: { scope: "visit", includeAudio: true }
  });
  await waitFor(() => recorder.health().recordingHealthy);
  await recorder.stop();
  assert.equal(recorder.health().recordingHealthy, true);
  assert.equal(recorder.health().recordingLastError, "");
});

test("retries an active failed start with the same capture id and recovers health", async (context) => {
  const calls: RecordingBoundary[] = [];
  let startAttempts = 0;
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingStartRetryMillis: 10,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "start" && startAttempts++ === 0) {
          throw new Error("temporary start timeout");
        }
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });

  recorder.startVisit({ id: "visit-start-auto-retry", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.filter((boundary) => boundary.type === "start").length === 2);

  const starts = calls.filter((boundary) => boundary.type === "start");
  assert.equal(starts[0]?.recording.captureId, starts[1]?.recording.captureId);
  assert.equal(store.getVisit("visit-start-auto-retry").recordings.length, 1);
  assert.equal(store.getVisit("visit-start-auto-retry").recordings[0]?.status, "recording");
  assert.equal(recorder.health().recordingHealthy, true);
  await recorder.stop();
});

test("run recording exposes a gated handle and retries only on the operator's same capture", async (context) => {
  const calls: RecordingBoundary[] = [];
  let startAttempts = 0;
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingStartRetryMillis: 10,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "start" && startAttempts++ === 0) {
          throw new Error("physical start remained unconfirmed");
        }
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  recorder.startVisit({ id: "visit-run-operator-retry", recordingPolicy: { scope: "run" } });
  const first = recorder.startSelection({
    id: "selection-run-operator-retry",
    runId: "run-operator-retry",
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    manifestId: "ping-pong",
    label: "Ping pong",
    sourceKind: "motion_levels_games",
    sourceRevision: "1".repeat(40),
    difficulty: "medium"
  }, state(0, 0), { recordingBlocked: true });
  assert.ok(first);
  const firstResult = await first.completion;
  assert.equal(firstResult.state, "failed");
  assert.equal(firstResult.reason, "start_unconfirmed");
  assert.equal(store.getVisit("visit-run-operator-retry").selections[0]?.runs[0]?.status, "starting");
  assert.equal(store.getVisit("visit-run-operator-retry").selections[0]?.runs[0]?.finalSnapshot?.phase, "recording_arming");

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.filter((boundary) => boundary.type === "start").length, 1, "run gates must not auto-backoff");
  const retried = recorder.retryRunRecording("run-operator-retry");
  assert.ok(retried);
  assert.equal(retried.recording.id, first.recording.id);
  assert.equal(retried.recording.captureId, first.recording.captureId);
  assert.equal((await retried.completion).state, "recording");
  assert.equal(calls.filter((boundary) => boundary.type === "start").length, 2);

  recorder.observeState(state(0, 0));
  assert.equal(store.getVisit("visit-run-operator-retry").selections[0]?.runs[0]?.status, "running");
  recorder.endSelection("exit");
  await recorder.stop();
});

test("run recording retry reattaches to an in-flight start and reuses a late physical confirmation", async (context) => {
  let releaseStart = () => {};
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  const calls: RecordingBoundary[] = [];
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: {
      async onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "start") await startGate;
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  recorder.startVisit({ id: "visit-run-inflight-retry", recordingPolicy: { scope: "run" } });
  const first = recorder.startSelection({
    id: "selection-run-inflight-retry",
    runId: "run-inflight-retry",
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    manifestId: "ping-pong",
    label: "Ping pong",
    sourceKind: "motion_levels_games",
    sourceRevision: "1".repeat(40),
    difficulty: "medium"
  }, state(0, 0), { recordingBlocked: true });
  assert.ok(first);
  await waitFor(() => calls.length === 1);

  const attached = recorder.retryRunRecording("run-inflight-retry");
  assert.ok(attached);
  assert.equal(attached.completion, first.completion);
  assert.equal(calls.length, 1);

  releaseStart();
  assert.equal((await attached.completion).state, "recording");
  const confirmed = recorder.retryRunRecording("run-inflight-retry");
  assert.ok(confirmed);
  assert.equal((await confirmed.completion).state, "recording");
  assert.equal(calls.filter((boundary) => boundary.type === "start").length, 1);
  recorder.endSelection("exit");
  await recorder.stop();
});

test("a non-terminal stop result remains uncertain and cannot complete skip", async (context) => {
  let stopAttempts = 0;
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingWatchIntervalMillis: 1_000,
    recordingClient: {
      onBoundary(boundary) {
        if (boundary.type === "start") return { ...boundary.recording, status: "recording" };
        stopAttempts += 1;
        return { ...boundary.recording, status: stopAttempts === 1 ? "recording" : "complete" };
      }
    }
  });
  recorder.startVisit({ id: "visit-run-stop-unconfirmed", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-stop-unconfirmed");
  await waitFor(() => store.getVisit("visit-run-stop-unconfirmed").recordings[0]?.status === "recording");

  await assert.rejects(
    recorder.skipRunRecording("run-stop-unconfirmed"),
    /did not confirm stopped capture/u
  );
  assert.equal(store.getVisit("visit-run-stop-unconfirmed").recordings[0]?.status, "finalizing");
  await recorder.skipRunRecording("run-stop-unconfirmed");
  assert.equal(store.getVisit("visit-run-stop-unconfirmed").recordings[0]?.status, "complete");
  await recorder.stop();
});

test("skip waits for every earlier uncertain stop before allowing gameplay", async (context) => {
  let runOneStopAttempts = 0;
  let releaseRunOneRetry = () => {};
  const runOneRetryGate = new Promise<void>((resolve) => { releaseRunOneRetry = resolve; });
  const calls: RecordingBoundary[] = [];
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingWatchIntervalMillis: 10,
    recordingClient: {
      async onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "stop" && boundary.runId === "run-prior-stop") {
          runOneStopAttempts += 1;
          if (runOneStopAttempts === 1) throw new Error("first run stop response was lost");
          await runOneRetryGate;
        }
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  recorder.startVisit({ id: "visit-run-global-stop-wait", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-prior-stop");
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  recorder.restartRun("run-current-skip", state(0, 0));
  await waitFor(() => runOneStopAttempts === 1);

  let skipSettled = false;
  const skipped = recorder.skipRunRecording("run-current-skip").then(() => { skipSettled = true; });
  await waitFor(() => runOneStopAttempts === 2);
  assert.equal(skipSettled, false, "the current run stop cannot clear an earlier capture's blocker");
  releaseRunOneRetry();
  await skipped;
  assert.equal(skipSettled, true);
  await recorder.stop();
});

test("cancels a failed start retry when recording is turned off or the visit ends", async (context) => {
  for (const cancellation of ["off", "end"] as const) {
    const calls: RecordingBoundary[] = [];
    const store = temporaryStore(context, () => 1_000);
    const recorder = new SessionHistoryRecorder(store, {
      now: () => 1_000,
      recordingStartRetryMillis: 100,
      recordingClient: {
        onBoundary(boundary) {
          calls.push(boundary);
          if (boundary.type === "start") throw new Error("camera unavailable");
          return { ...boundary.recording, status: "complete" };
        }
      }
    });
    const id = `visit-cancel-start-retry-${cancellation}`;
    recorder.startVisit({ id, recordingPolicy: { scope: "visit" } });
    await waitFor(() => !recorder.health().recordingHealthy);

    if (cancellation === "off") {
      recorder.startVisit({ id, recordingPolicy: { scope: "off" } });
    } else {
      recorder.endVisit("completed");
    }
    await recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(calls.filter((boundary) => boundary.type === "start").length, 1, cancellation);
  }
});

test("a successful stop for another capture does not heal a failed start", async (context) => {
  const calls: RecordingBoundary[] = [];
  let failedStartId = "";
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingStartRetryMillis: 1_000,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "start" && !failedStartId) {
          failedStartId = boundary.recording.id;
          throw new Error("first capture did not start");
        }
        return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
      }
    }
  });
  recorder.startVisit({ id: "visit-other-stop-health", recordingPolicy: { scope: "visit" } });
  await waitFor(() => !recorder.health().recordingHealthy);

  const otherRecording = store.upsertRecording("visit-other-stop-health", {
    id: "other-finalizing-recording",
    captureId: "other-finalizing-capture",
    scope: "visit",
    status: "finalizing",
    linkedRunIds: [],
    startedAtUnixMillis: 500,
    endedAtUnixMillis: 900,
    backend: "camera-recorder",
    metadata: {}
  });
  const recovery = recorder as unknown as {
    finishRecoveredRecording(visit: SessionHistoryVisit, asset: typeof otherRecording): void;
  };
  recovery.finishRecoveredRecording(store.getVisit("visit-other-stop-health"), otherRecording);
  await recorder.stop();

  const successfulStops = calls.filter((boundary) => boundary.type === "stop");
  assert.ok(successfulStops.some((boundary) => boundary.recording.id !== failedStartId));
  assert.equal(recorder.health().recordingHealthy, false);
});

test("persists a visit stop intent before marking the visit ended", async (context) => {
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  const client: RecordingClient = {
    async onBoundary(boundary) {
      if (boundary.type === "start") await startGate;
      return {
        ...boundary.recording,
        status: boundary.type === "start" ? "recording" : "complete"
      };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({ id: "visit-durable-stop", recordingPolicy: { scope: "visit" } });
  recorder.endVisit("completed");

  const onDisk = new SessionHistoryStore(store.rootDir, () => 1_000).getVisit("visit-durable-stop");
  assert.equal(onDisk.status, "ended");
  assert.equal(onDisk.recordings[0]?.status, "finalizing");
  assert.equal(onDisk.recordings[0]?.endedAtUnixMillis, 1_000);

  releaseStart?.();
  await recorder.stop();
  assert.equal(store.getVisit("visit-durable-stop").recordings[0]?.status, "complete");
});

test("keeps an uncertain stop finalizing and retries it after restart", async (context) => {
  const store = temporaryStore(context, () => 2_000);
  store.createVisit({
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id: "visit-retry-stop",
    status: "ended",
    startedAtUnixMillis: 1_000,
    endedAtUnixMillis: 1_500,
    updatedAtUnixMillis: 1_500,
    teamName: "Equipo",
    players: [],
    recordingPolicy: { scope: "visit" },
    selections: [],
    recordings: [{
      id: "recording-retry",
      captureId: "capture-retry",
      scope: "visit",
      status: "finalizing",
      linkedRunIds: [],
      endedAtUnixMillis: 1_500
    }],
    lastSequence: 0
  });
  let attempts = 0;
  const failing = new SessionHistoryRecorder(store, {
    now: () => 2_000,
    recordingClient: {
      onBoundary() {
        attempts += 1;
        if (attempts === 1) throw new Error("camera timeout");
        return new Promise(() => {});
      }
    }
  });
  void failing.stop();
  await waitFor(() => attempts === 2);
  assert.equal(store.getVisit("visit-retry-stop").recordings[0]?.status, "finalizing");
  assert.equal(failing.health().recordingHealthy, false);

  const retried: RecordingBoundary[] = [];
  const reopened = new SessionHistoryStore(store.rootDir, () => 3_000);
  const recovered = new SessionHistoryRecorder(reopened, {
    now: () => 3_000,
    recordingClient: {
      onBoundary(boundary) {
        retried.push(boundary);
        return { ...boundary.recording, status: "complete" };
      }
    }
  });
  await recovered.stop();
  assert.deepEqual(retried.map((boundary) => `${boundary.type}:${boundary.recording.captureId}`), [
    "stop:capture-retry"
  ]);
  assert.equal(reopened.getVisit("visit-retry-stop").recordings[0]?.status, "complete");
});

test("shutdown drain waits for a future stop retry and the durable completed asset", async (context) => {
  const calls: RecordingBoundary[] = [];
  let stopAttempts = 0;
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        if (boundary.type === "stop" && ++stopAttempts === 1) {
          throw new Error("first stop response was lost");
        }
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  recorder.startVisit({ id: "visit-shutdown-stop-drain", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));

  let drained = false;
  const drain = recorder.stop().then(() => { drained = true; });
  await waitFor(() => stopAttempts === 1);
  assert.equal(drained, false);
  assert.equal(store.getVisit("visit-shutdown-stop-drain").recordings[0]?.status, "finalizing");
  await drain;

  assert.equal(stopAttempts, 2);
  assert.equal(store.getVisit("visit-shutdown-stop-drain").recordings[0]?.status, "complete");
  assert.deepEqual(calls.map((boundary) => boundary.type), ["start", "stop", "stop"]);
});

test("graceful recorder shutdown stops visit capture but keeps the visit recoverable", async (context) => {
  const calls: RecordingBoundary[] = [];
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: {
      onBoundary(boundary) {
        calls.push(boundary);
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  recorder.startVisit({ id: "visit-graceful-shutdown", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  await recorder.stop();

  assert.deepEqual(calls.map(({ type, scope }) => `${type}:${scope}`), ["start:visit", "stop:visit"]);
  assert.equal(store.getVisit("visit-graceful-shutdown").status, "active");
  assert.equal(store.getVisit("visit-graceful-shutdown").recordings[0]?.status, "complete");

  const restartedCalls: RecordingBoundary[] = [];
  const reopened = new SessionHistoryStore(store.rootDir, () => 2_000);
  const restarted = new SessionHistoryRecorder(reopened, {
    now: () => 2_000,
    recordingClient: {
      onBoundary(boundary) {
        restartedCalls.push(boundary);
        return {
          ...boundary.recording,
          status: boundary.type === "start" ? "recording" : "complete"
        };
      }
    }
  });
  await waitFor(() => restartedCalls.some((boundary) => boundary.type === "start"));
  await restarted.stop();
  assert.deepEqual(restartedCalls.map(({ type, scope }) => `${type}:${scope}`), ["start:visit", "stop:visit"]);
  const recordings = reopened.getVisit("visit-graceful-shutdown").recordings;
  assert.equal(recordings.length, 2);
  assert.notEqual(recordings[0]?.captureId, recordings[1]?.captureId);
  assert.deepEqual(recordings.map((recording) => recording.status), ["complete", "complete"]);
});

test("changing recording scope closes the old capture before opening the current boundary", async (context) => {
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return {
        ...boundary.recording,
        status: boundary.type === "start" ? "recording" : "complete"
      };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({ id: "visit-policy", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.scope === "visit"));
  startSelection(recorder);
  recorder.startVisit({ id: "visit-policy", recordingPolicy: { scope: "run" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.scope === "run"));
  await recorder.stop();

  assert.deepEqual(calls.map(({ type, scope }) => `${type}:${scope}`), [
    "start:visit",
    "stop:visit",
    "start:run",
    "stop:run"
  ]);
});

for (const scope of ["visit", "selection"] as const) {
  test(`enabling ${scope} recording during a run links the current run immediately`, (context) => {
    const store = temporaryStore(context, () => 1_000);
    const recorder = new SessionHistoryRecorder(store, { now: () => 1_000 });
    recorder.startVisit({ id: `visit-seed-${scope}`, recordingPolicy: { scope: "off" } });
    startSelection(recorder);

    recorder.startVisit({ id: `visit-seed-${scope}`, recordingPolicy: { scope } });

    const recordings = store.getVisit(`visit-seed-${scope}`).recordings;
    assert.equal(recordings.length, 1);
    assert.equal(recordings[0]?.scope, scope);
    assert.deepEqual(recordings[0]?.linkedRunIds, ["run-1"]);
  });
}

test("new runs link only to the currently active asset for a recording scope", (context) => {
  let now = 1_000;
  const store = temporaryStore(context, () => now);
  const recorder = new SessionHistoryRecorder(store, { now: () => now });
  recorder.startVisit({
    id: "visit-current-recording",
    recordingPolicy: { scope: "visit", includeAudio: false }
  });
  startSelection(recorder);

  now = 2_000;
  recorder.startVisit({
    id: "visit-current-recording",
    recordingPolicy: { scope: "visit", includeAudio: true }
  });
  let assets = store.getVisit("visit-current-recording").recordings;
  const previous = assets.find((asset) => asset.endedAtUnixMillis !== undefined);
  const active = assets.find((asset) => asset.endedAtUnixMillis === undefined);
  assert.deepEqual(previous?.linkedRunIds, ["run-1"]);
  assert.deepEqual(active?.linkedRunIds, ["run-1"]);

  now = 3_000;
  recorder.restartRun("run-2", state(0, 0));
  assets = store.getVisit("visit-current-recording").recordings;
  assert.deepEqual(assets.find((asset) => asset.id === previous?.id)?.linkedRunIds, ["run-1"]);
  assert.deepEqual(assets.find((asset) => asset.id === active?.id)?.linkedRunIds, ["run-1", "run-2"]);
});

test("changing camera options within the same scope restarts the active capture", async (context) => {
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, { now: () => 1_000, recordingClient: client });
  recorder.startVisit({
    id: "visit-camera-policy",
    recordingPolicy: { scope: "visit", cameraIds: ["main"], includeAudio: false }
  });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  recorder.startVisit({
    id: "visit-camera-policy",
    recordingPolicy: { scope: "visit", cameraIds: ["main"], includeAudio: true }
  });
  await waitFor(() => calls.filter((boundary) => boundary.type === "start").length === 2);
  recorder.endVisit();
  await recorder.stop();

  assert.deepEqual(calls.map((boundary) => ({
    type: boundary.type,
    includeAudio: boundary.policy.includeAudio
  })), [
    { type: "start", includeAudio: false },
    { type: "stop", includeAudio: false },
    { type: "start", includeAudio: true },
    { type: "stop", includeAudio: true }
  ]);
});

test("rotates a visit capture before maxEndsAt without overlap and links the active run to both assets", async (context) => {
  const calls: RecordingBoundary[] = [];
  let starts = 0;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "start") {
        starts += 1;
        return {
          ...boundary.recording,
          status: "recording",
          metadata: {
            ...(boundary.recording.metadata ?? {}),
            cameraMaxEndsAtUnixMillis: starts === 1 ? 1_020 : 100_000
          }
        };
      }
      return { ...boundary.recording, status: "complete" };
    },
    observe(recording) {
      return {
        active: true,
        observedAtUnixMillis: starts === 1 ? 1_015 : 1_000,
        maxEndsAtUnixMillis: Number(recording.metadata?.cameraMaxEndsAtUnixMillis)
      };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 10,
    recordingRotationLeadMillis: 50
  });
  recorder.startVisit({ id: "visit-rotation", recordingPolicy: { scope: "visit" } });
  startSelection(recorder);
  await waitFor(() => calls.filter((boundary) => boundary.type === "start").length === 2);

  assert.deepEqual(calls.slice(0, 3).map((boundary) => boundary.type), ["start", "stop", "start"]);
  assert.notEqual(calls[0]?.recording.captureId, calls[2]?.recording.captureId);
  const assets = store.getVisit("visit-rotation").recordings;
  assert.equal(assets.length, 2);
  assert.deepEqual(assets.map((asset) => asset.status), ["complete", "recording"]);
  assert.deepEqual(assets.map((asset) => asset.linkedRunIds), [["run-1"], ["run-1"]]);
  await recorder.stop();
});

test("caps rotation lead below half of a short camera session lifetime", async (context) => {
  const calls: RecordingBoundary[] = [];
  let observations = 0;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return {
        ...boundary.recording,
        status: boundary.type === "start" ? "recording" : "complete",
        metadata: { ...(boundary.recording.metadata ?? {}), cameraMaxEndsAtUnixMillis: 61_000 }
      };
    },
    observe() {
      observations += 1;
      return { active: true, observedAtUnixMillis: 1_000, maxEndsAtUnixMillis: 61_000 };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 60_000
  });
  recorder.startVisit({ id: "visit-short-camera-limit", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(observations, 0, "a 60-second camera limit must not rotate immediately with the default lead");
  await recorder.stop();
});

test("retries an uncertain rotation stop before starting the next visit segment", async (context) => {
  const calls: RecordingBoundary[] = [];
  let stopAttempts = 0;
  let starts = 0;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "stop") {
        stopAttempts += 1;
        if (stopAttempts === 1) throw new Error("temporary stop timeout");
        return { ...boundary.recording, status: "complete" };
      }
      starts += 1;
      return {
        ...boundary.recording,
        status: "recording",
        metadata: { cameraMaxEndsAtUnixMillis: starts === 1 ? 1_020 : 100_000 }
      };
    },
    observe(recording) {
      return {
        active: true,
        observedAtUnixMillis: starts === 1 ? 1_015 : 1_000,
        maxEndsAtUnixMillis: Number(recording.metadata?.cameraMaxEndsAtUnixMillis)
      };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 10,
    recordingRotationLeadMillis: 50
  });
  recorder.startVisit({ id: "visit-rotation-retry", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.filter((boundary) => boundary.type === "start").length === 2);
  assert.deepEqual(calls.slice(0, 4).map((boundary) => boundary.type), ["start", "stop", "stop", "start"]);
  assert.equal(recorder.health().recordingHealthy, true);
  await recorder.stop();
});

test("retries a failed run stop before allowing the next run capture to start", async (context) => {
  const calls: RecordingBoundary[] = [];
  let failed = false;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "stop" && boundary.runId === "run-1" && !failed) {
        failed = true;
        throw new Error("run stop timeout");
      }
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 10
  });
  recorder.startVisit({ id: "visit-run-stop-retry", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-1"));
  recorder.restartRun("run-2", state(0, 0));
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-2"));
  assert.deepEqual(calls.slice(0, 4).map((boundary) => `${boundary.type}:${boundary.runId}`), [
    "start:run-1",
    "stop:run-1",
    "stop:run-1",
    "start:run-2"
  ]);
  await recorder.stop();
});

test("one successful stop cannot clear another capture's uncertain-stop blocker", async (context) => {
  const calls: RecordingBoundary[] = [];
  let failedRunOne = false;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "stop" && boundary.runId === "run-1" && !failedRunOne) {
        failedRunOne = true;
        throw new Error("run-1 stop timeout");
      }
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 20
  });
  recorder.startVisit({ id: "visit-independent-stop-blockers", recordingPolicy: { scope: "run" } });
  startSelection(recorder, "run-1");
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-1"));
  recorder.restartRun("run-2", state(0, 0));
  recorder.restartRun("run-3", state(0, 0));
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-3"));

  const runOneStopIndexes = calls.flatMap((boundary, index) => (
    boundary.type === "stop" && boundary.runId === "run-1" ? [index] : []
  ));
  const retryIndex = runOneStopIndexes[1] ?? -1;
  const runThreeStartIndex = calls.findIndex((boundary) => boundary.type === "start" && boundary.runId === "run-3");
  assert.ok(retryIndex >= 0 && runThreeStartIndex > retryIndex);
  assert.equal(calls.some((boundary) => boundary.type === "start" && boundary.runId === "run-2"), false);
  assert.equal(recorder.health().recordingHealthy, true);
  await recorder.stop();
});

test("clearing a stop blocker resumes requested recording in the superseding visit", async (context) => {
  const calls: RecordingBoundary[] = [];
  let failedVisitA = false;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "stop" && boundary.sessionId === "visit-blocked-a" && !failedVisitA) {
        failedVisitA = true;
        throw new Error("visit A stop timeout");
      }
      return { ...boundary.recording, status: boundary.type === "start" ? "recording" : "complete" };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 10
  });
  recorder.startVisit({ id: "visit-blocked-a", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.sessionId === "visit-blocked-a"));
  recorder.startVisit({ id: "visit-blocked-b", recordingPolicy: { scope: "visit" } });
  await waitFor(() => calls.some((boundary) => boundary.type === "start" && boundary.sessionId === "visit-blocked-b"));

  const secondStopA = calls.findIndex((boundary, index) => index > 1
    && boundary.type === "stop" && boundary.sessionId === "visit-blocked-a");
  const startB = calls.findIndex((boundary) => boundary.type === "start" && boundary.sessionId === "visit-blocked-b");
  assert.ok(secondStopA >= 0 && startB > secondStopA);
  assert.equal(recorder.health().recordingHealthy, true);
  await recorder.stop();
});

test("an early camera disappearance closes the old asset before starting a replacement", async (context) => {
  const calls: RecordingBoundary[] = [];
  let starts = 0;
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      if (boundary.type === "start") {
        starts += 1;
        return {
          ...boundary.recording,
          status: "recording",
          metadata: { cameraMaxEndsAtUnixMillis: 100_000 }
        };
      }
      return { ...boundary.recording, status: "complete" };
    },
    observe() {
      return { active: starts > 1, observedAtUnixMillis: 2_000, maxEndsAtUnixMillis: 100_000 };
    }
  };
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store, {
    now: () => 1_000,
    recordingClient: client,
    recordingWatchIntervalMillis: 10,
    recordingRotationLeadMillis: 50
  });
  recorder.startVisit({ id: "visit-disappeared", recordingPolicy: { scope: "visit" } });
  await waitFor(() => starts === 2);
  assert.deepEqual(store.getVisit("visit-disappeared").recordings.map((asset) => asset.status), ["partial", "recording"]);
  assert.deepEqual(calls.map((boundary) => boundary.type), ["start", "start"]);
  await recorder.stop();
});

test("startup reconciles requested and finalizing captures from an ended visit", async (context) => {
  const calls: RecordingBoundary[] = [];
  const client: RecordingClient = {
    onBoundary(boundary) {
      calls.push(boundary);
      return { ...boundary.recording, status: "complete" };
    }
  };
  const store = temporaryStore(context, () => 2_000);
  const endedVisit: SessionHistoryVisit = {
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id: "visit-ended-recordings",
    status: "ended",
    startedAtUnixMillis: 1_000,
    endedAtUnixMillis: 1_500,
    updatedAtUnixMillis: 1_500,
    teamName: "Equipo",
    players: [],
    recordingPolicy: { scope: "visit" },
    selections: [],
    recordings: [
      {
        id: "recording-requested",
        captureId: "capture-requested",
        scope: "visit",
        status: "requested",
        linkedRunIds: []
      },
      {
        id: "recording-finalizing",
        captureId: "capture-finalizing",
        scope: "visit",
        status: "finalizing",
        linkedRunIds: []
      }
    ],
    lastSequence: 0
  };
  store.createVisit(endedVisit);
  const recorder = new SessionHistoryRecorder(store, { now: () => 2_000, recordingClient: client });
  await recorder.stop();

  assert.deepEqual(calls.map((boundary) => `${boundary.type}:${boundary.recording.captureId}`), [
    "stop:capture-requested",
    "stop:capture-finalizing"
  ]);
  assert.deepEqual(store.getVisit(endedVisit.id).recordings.map((asset) => asset.status), ["complete", "complete"]);
});

test("ignores late menu events for unknown sessions without degrading persistence health", (context) => {
  const store = temporaryStore(context, () => 1_000);
  const recorder = new SessionHistoryRecorder(store);
  recorder.recordMenuEvent("unknown-visit", "game_opened", {});
  assert.equal(recorder.health().healthy, true);
  assert.equal(recorder.health().lastError, "");
});
