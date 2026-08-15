import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  type SessionHistoryVisit
} from "@motion-levels-games/session-history";
import { sessionHistoryEventCacheLimit, SessionHistoryStore } from "../src/sessionHistoryStore.ts";

function temporaryRoot(context: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "motion-levels-session-history-"));
  context.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function visit(id: string, at: number): SessionHistoryVisit {
  return {
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id,
    status: "active",
    startedAtUnixMillis: at,
    updatedAtUnixMillis: at,
    teamName: "Equipo",
    players: [],
    recordingPolicy: { scope: "run" },
    selections: [],
    recordings: [],
    lastSequence: 0
  };
}

function addOpenRun(value: SessionHistoryVisit): void {
  value.activeSelectionId = "selection-1";
  value.activeRunId = "run-1";
  value.selections.push({
    id: "selection-1",
    ordinal: 1,
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    manifestId: "ping-pong",
    label: "Ping pong",
    sourceKind: "motion_levels_games",
    sourceRevision: "1".repeat(40),
    difficulty: "medium",
    durationMillis: 60_000,
    config: {},
    teamName: "Equipo",
    players: [],
    selectedAtUnixMillis: value.startedAtUnixMillis,
    runs: [{
      id: "run-1",
      ordinal: 1,
      reason: "initial",
      status: "running",
      startedAtUnixMillis: value.startedAtUnixMillis,
      engineElapsedMillis: 500,
      gameplayElapsedMillis: 400,
      pausedMillis: 0,
      phaseDurations: { running: 500 },
      score: 0,
      lives: 3,
      players: [],
      rounds: []
    }]
  });
}

test("persists atomic manifests, stable events, and paginated summaries", (context) => {
  let now = 1_000;
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => now);
  store.createVisit(visit("visit-a", now));
  store.appendEvent("visit-a", {
    kind: "visit.started",
    occurredAtUnixMillis: now,
    payload: {}
  });
  now = 2_000;
  store.createVisit(visit("visit-b", now));

  const first = store.listVisits({ limit: 1 });
  assert.deepEqual(first.sessions.map((item) => item.id), ["visit-b"]);
  assert.ok(first.nextCursor);
  const second = store.listVisits({ limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.sessions.map((item) => item.id), ["visit-a"]);

  const events = store.listEvents("visit-a");
  assert.equal(events.events[0]?.id, "visit-a:000000000001");
  assert.equal(
    (JSON.parse(readFileSync(join(directory, "visit-a", "manifest.json"), "utf8")) as { lastSequence: number }).lastSequence,
    0,
    "event appends must not rewrite the manifest"
  );
  assert.equal(new SessionHistoryStore(directory).getVisit("visit-a").lastSequence, 1);
  assert.equal(readdirSync(join(directory, "visit-a")).some((name) => name.endsWith(".tmp")), false);
});

test("journal-first visit transition repairs the manifest exactly once after an after_journal crash", (context) => {
  const directory = temporaryRoot(context);
  let fail = true;
  const store = new SessionHistoryStore(directory, () => 2_000, {
    onTransitionStage(stage) {
      if (stage === "after_journal" && fail) {
        fail = false;
        throw new Error("simulated crash after journal");
      }
    }
  });
  const initial = visit("visit-wal-after-journal", 1_000);
  store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
  const ended = store.getVisit(initial.id);
  ended.status = "ended";
  ended.endedAtUnixMillis = 2_000;
  ended.endReason = "completed";
  ended.updatedAtUnixMillis = 2_000;
  assert.throws(() => store.commitTransition(ended, [{
    kind: "visit.ended",
    occurredAtUnixMillis: 2_000,
    payload: { reason: "completed" }
  }]), /simulated crash after journal/u);

  const firstRecovery = new SessionHistoryStore(directory, () => 3_000);
  assert.equal(firstRecovery.getVisit(initial.id).status, "ended");
  assert.deepEqual(firstRecovery.listEvents(initial.id).events.map((event) => event.kind), [
    "visit.started",
    "visit.ended"
  ]);
  assert.equal(firstRecovery.health().healthy, true);
  const secondRecovery = new SessionHistoryStore(directory, () => 4_000);
  assert.equal(secondRecovery.getVisit(initial.id).status, "ended");
  assert.equal(secondRecovery.listEvents(initial.id).events.length, 2);
  assert.equal(secondRecovery.appendEvent(initial.id, {
    kind: "menu.event",
    occurredAtUnixMillis: 4_000,
    payload: { name: "after_recovery" }
  }).sequence, 3);
});

test("after_manifest fault reopens to the same transition without duplicate events", (context) => {
  const directory = temporaryRoot(context);
  let fail = true;
  const store = new SessionHistoryStore(directory, () => 2_000, {
    onTransitionStage(stage) {
      if (stage === "after_manifest" && fail) {
        fail = false;
        throw new Error("simulated crash after manifest");
      }
    }
  });
  const initial = visit("visit-wal-after-manifest", 1_000);
  store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
  const ended = store.getVisit(initial.id);
  ended.status = "ended";
  ended.endedAtUnixMillis = 2_000;
  ended.updatedAtUnixMillis = 2_000;
  assert.throws(() => store.commitTransition(ended, [{
    kind: "visit.ended",
    occurredAtUnixMillis: 2_000,
    payload: { reason: "completed" }
  }]), /simulated crash after manifest/u);
  for (let reopen = 0; reopen < 2; reopen += 1) {
    const recovered = new SessionHistoryStore(directory);
    assert.equal(recovered.getVisit(initial.id).status, "ended");
    assert.deepEqual(recovered.listEvents(initial.id).events.map((event) => event.kind), [
      "visit.started",
      "visit.ended"
    ]);
  }
});

test("writes every multi-event transition as one transactional journal record", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 2_000);
  const initial = visit("visit-wal-transaction-record", 1_000);
  store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
  const ended = store.getVisit(initial.id);
  ended.status = "ended";
  ended.endedAtUnixMillis = 2_000;
  ended.endReason = "completed";
  ended.updatedAtUnixMillis = 2_000;
  store.commitTransition(ended, [{
    kind: "visit.updated",
    occurredAtUnixMillis: 1_900,
    payload: { reason: "finishing" }
  }, {
    kind: "visit.ended",
    occurredAtUnixMillis: 2_000,
    payload: { reason: "completed" }
  }]);

  const records = readFileSync(join(directory, initial.id, "events.ndjson"), "utf8").trimEnd().split("\n");
  assert.equal(records.length, 2);
  const transition = JSON.parse(records[1] ?? "{}") as {
    journalBatchVersion?: number;
    events?: Array<{ kind?: string }>;
  };
  assert.equal(transition.journalBatchVersion, 1);
  assert.deepEqual(transition.events?.map((event) => event.kind), ["visit.updated", "visit.ended"]);
  assert.deepEqual(store.listEvents(initial.id).events.map((event) => event.kind), [
    "visit.started",
    "visit.updated",
    "visit.ended"
  ]);
});

test("keeps legacy one-event journal lines readable", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 1_000);
  const initial = visit("visit-legacy-journal", 1_000);
  store.createVisit(initial);
  appendFileSync(join(directory, initial.id, "events.ndjson"), `${JSON.stringify({
    id: `${initial.id}:000000000001`,
    sequence: 1,
    sessionId: initial.id,
    kind: "menu.event",
    occurredAtUnixMillis: 1_000,
    payload: { name: "legacy_menu_event" }
  })}\n`);

  const reopened = new SessionHistoryStore(directory);
  assert.equal(reopened.health().healthy, true);
  assert.deepEqual(reopened.listEvents(initial.id).events.map((event) => event.kind), ["menu.event"]);
  assert.equal(reopened.getVisit(initial.id).lastSequence, 1);
});

test("rejects an overlapping journal batch as a whole instead of inserting its new suffix", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 1_000);
  const initial = visit("visit-overlap-batch", 1_000);
  store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
  const journalPath = join(directory, initial.id, "events.ndjson");
  const firstRecord = JSON.parse(readFileSync(journalPath, "utf8").trim()) as {
    events: Array<Record<string, unknown>>;
  };
  appendFileSync(journalPath, `${JSON.stringify({
    journalBatchVersion: 1,
    events: [firstRecord.events[0], {
      id: `${initial.id}:000000000002`,
      sequence: 2,
      sessionId: initial.id,
      kind: "visit.ended",
      occurredAtUnixMillis: 2_000,
      payload: { reason: "corrupt_overlap" }
    }]
  })}\n`);

  const reopened = new SessionHistoryStore(directory);
  assert.equal(reopened.health().healthy, false);
  assert.deepEqual(reopened.listEvents(initial.id).events.map((event) => event.sequence), [1]);
  assert.equal(reopened.getVisit(initial.id).status, "active");
});

test("discards a whole transactional transition when its journal record is missing or torn", (context) => {
  for (const cut of ["before", "middle"] as const) {
    const directory = temporaryRoot(context);
    const id = `visit-wal-torn-batch-${cut}`;
    const store = new SessionHistoryStore(directory, () => 2_000);
    const initial = visit(id, 1_000);
    store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
    const manifestPath = join(directory, id, "manifest.json");
    const journalPath = join(directory, id, "events.ndjson");
    const manifestBefore = readFileSync(manifestPath, "utf8");
    const ended = store.getVisit(id);
    ended.status = "ended";
    ended.endedAtUnixMillis = 2_000;
    ended.endReason = "completed";
    ended.updatedAtUnixMillis = 2_000;
    store.commitTransition(ended, [{
      kind: "visit.updated",
      occurredAtUnixMillis: 1_900,
      payload: { reason: "finishing" }
    }, {
      kind: "visit.ended",
      occurredAtUnixMillis: 2_000,
      payload: { reason: "completed" }
    }]);

    const records = readFileSync(journalPath, "utf8").trimEnd().split("\n");
    const durablePrefix = `${records[0]}\n`;
    const transition = records[1] ?? "";
    const partialTransition = cut === "before" ? "" : transition.slice(0, Math.floor(transition.length / 2));
    writeFileSync(manifestPath, manifestBefore);
    writeFileSync(journalPath, `${durablePrefix}${partialTransition}`);

    const firstRecovery = new SessionHistoryStore(directory, () => 3_000);
    assert.equal(firstRecovery.getVisit(id).status, "active", cut);
    assert.deepEqual(firstRecovery.listEvents(id).events.map((event) => event.kind), ["visit.started"], cut);
    const secondRecovery = new SessionHistoryStore(directory, () => 4_000);
    assert.equal(secondRecovery.getVisit(id).status, "active", cut);
    assert.deepEqual(secondRecovery.listEvents(id).events.map((event) => event.kind), ["visit.started"], cut);
    assert.equal(readFileSync(journalPath, "utf8"), durablePrefix, `${cut} tail must be durably removed`);
  }
});

test("lifecycle replay crosses menu events and materializes the referenced selection", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 2_000);
  const initial = visit("visit-wal-menu", 1_000);
  store.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);
  store.appendEvent(initial.id, {
    kind: "menu.event",
    occurredAtUnixMillis: 1_500,
    payload: { name: "game_selected" }
  });
  const desired = store.getVisit(initial.id);
  addOpenRun(desired);
  desired.updatedAtUnixMillis = 2_000;
  store.commitTransition(desired, [{
    selectionId: "selection-1",
    kind: "selection.started",
    occurredAtUnixMillis: 2_000,
    payload: { gameId: "ping-pong" }
  }]);
  const recovered = new SessionHistoryStore(directory);
  assert.equal(recovered.getVisit(initial.id).activeSelectionId, "selection-1");
  assert.equal(recovered.getVisit(initial.id).selections[0]?.runs[0]?.id, "run-1");
  assert.deepEqual(recovered.listEvents(initial.id).events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal("historyTransitionState" in (recovered.listEvents(initial.id).events[2]?.payload ?? {}), false);
});

test("recovery resumes between run and selection transitions without duplicate interruption", (context) => {
  const directory = temporaryRoot(context);
  const initialStore = new SessionHistoryStore(directory, () => 1_000);
  const initial = visit("visit-wal-interrupted-recovery", 1_000);
  addOpenRun(initial);
  initialStore.createVisit(initial, [{ kind: "visit.started", occurredAtUnixMillis: 1_000, payload: {} }]);

  let fail = true;
  const crashing = new SessionHistoryStore(directory, () => 2_000, {
    onTransitionStage(stage) {
      if (stage === "after_journal" && fail) {
        fail = false;
        throw new Error("crash between recovered run and selection");
      }
    }
  });
  assert.throws(() => crashing.recoverOpenVisit(), /crash between recovered run and selection/u);

  const recovered = new SessionHistoryStore(directory, () => 3_000).recoverOpenVisit();
  assert.equal(recovered?.activeSelectionId, undefined);
  assert.equal(recovered?.selections[0]?.runs[0]?.status, "interrupted");
  const reopened = new SessionHistoryStore(directory, () => 4_000);
  const kinds = reopened.listEvents(initial.id).events.map((event) => event.kind);
  assert.equal(kinds.filter((kind) => kind === "run.interrupted").length, 1);
  assert.equal(kinds.filter((kind) => kind === "selection.ended").length, 1);
});

test("accepts a filesystem-safe 255-character session id and rejects 256 before mkdir", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context), () => 1_000);
  const sessionId = "a".repeat(255);
  store.createVisit(visit(sessionId, 1_000));
  const event = store.appendEvent(sessionId, {
    kind: "visit.started",
    occurredAtUnixMillis: 1_000,
    payload: {}
  });
  assert.equal(event.id.length, 268);
  assert.match(event.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}:[0-9]{12}$/u);
  assert.throws(() => store.createVisit(visit("b".repeat(256), 1_000)), /session id is invalid/u);
  assert.equal(readdirSync(store.rootDir).includes("b".repeat(256)), false);
});

test("atomically creates visits and safely recovers an empty orphan directory", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 1_000);
  mkdirSync(join(directory, "visit-orphan"), { mode: 0o700 });
  store.createVisit(visit("visit-orphan", 1_000));
  assert.equal(JSON.parse(readFileSync(join(directory, "visit-orphan", "manifest.json"), "utf8")).id, "visit-orphan");
  assert.equal(readdirSync(directory).some((name) => name.startsWith(".creating-")), false);
});

test("startup removes only abandoned private creating directories", (context) => {
  const directory = temporaryRoot(context);
  const abandoned = ".creating-4242-123e4567-e89b-42d3-a456-426614174000";
  const unrelated = ".creating-manual-backup";
  mkdirSync(join(directory, abandoned), { mode: 0o700 });
  writeFileSync(join(directory, abandoned, "manifest.json"), "{}\n");
  mkdirSync(join(directory, unrelated), { mode: 0o700 });
  writeFileSync(join(directory, unrelated, "notes.txt"), "keep\n");

  const store = new SessionHistoryStore(directory);
  assert.equal(store.health().healthy, true);
  assert.equal(readdirSync(directory).includes(abandoned), false);
  assert.equal(readdirSync(directory).includes(unrelated), true);
});

test("recovers an active visit and marks its open selection and run interrupted", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 2_000);
  const value = visit("visit-recovery", 1_000);
  addOpenRun(value);
  store.createVisit(value);

  const recovered = new SessionHistoryStore(directory, () => 2_000).recoverOpenVisit();
  assert.equal(recovered?.status, "active");
  assert.equal(recovered?.activeRunId, undefined);
  assert.equal(recovered?.selections[0]?.endReason, "runtime_interrupted");
  assert.equal(recovered?.selections[0]?.runs[0]?.status, "interrupted");
  assert.deepEqual(
    new SessionHistoryStore(directory).listEvents("visit-recovery").events.map((event) => event.kind),
    ["run.interrupted", "selection.ended", "visit.recovered"]
  );
});

test("continues after a torn final journal line and associates recordings", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 1_000);
  const value = visit("visit-torn", 1_000);
  addOpenRun(value);
  store.createVisit(value);
  store.appendEvent(value.id, {
    kind: "visit.started",
    occurredAtUnixMillis: 1_000,
    payload: {}
  });
  appendFileSync(join(directory, value.id, "events.ndjson"), "{\"broken\":");

  const loaded = new SessionHistoryStore(directory, () => 2_000);
  assert.equal(loaded.health().healthy, false);
  assert.equal(loaded.appendEvent(value.id, {
    kind: "menu.event",
    occurredAtUnixMillis: 2_000,
    payload: { name: "game_restarted" }
  }).sequence, 2);
  loaded.upsertRecording(value.id, {
    id: "recording-1",
    captureId: "recording-1",
    scope: "run",
    status: "recording",
    selectionId: "selection-1",
    runId: "run-1",
    linkedRunIds: ["run-1"],
    metadata: {}
  });
  assert.equal(loaded.getVisit(value.id).recordings[0]?.runId, "run-1");
  assert.deepEqual(loaded.listEvents(value.id).events.map((event) => event.sequence), [1, 2, 3]);
});

test("replays a complete recording asset when the journal is newer than its manifest", (context) => {
  const directory = temporaryRoot(context);
  const store = new SessionHistoryStore(directory, () => 2_000);
  const value = visit("visit-recording-replay", 1_000);
  addOpenRun(value);
  store.createVisit(value);
  store.upsertRecording(value.id, {
    id: "recording-replay-1",
    captureId: "capture-replay-1",
    scope: "run",
    status: "recording",
    selectionId: "selection-1",
    runId: "run-1",
    linkedRunIds: ["run-1"],
    metadata: { cameraId: "main" }
  });
  const manifestPath = join(directory, value.id, "manifest.json");
  const manifestBeforeFinalUpdate = readFileSync(manifestPath, "utf8");

  store.upsertRecording(value.id, {
    id: "recording-replay-1",
    captureId: "capture-replay-1",
    scope: "run",
    status: "complete",
    selectionId: "selection-1",
    runId: "run-1",
    linkedRunIds: ["run-1"],
    remoteUrl: "https://recordings.example/capture-replay-1.mp4",
    fileName: "capture-replay-1.mp4",
    contentType: "video/mp4",
    byteSize: 4_096,
    sha256: "a".repeat(64),
    metadata: { cameraId: "main", uploaded: true }
  });
  // Model power loss after the fdatasync'd journal append but before the
  // atomic manifest replacement becomes durable.
  writeFileSync(manifestPath, manifestBeforeFinalUpdate);

  const recoveredStore = new SessionHistoryStore(directory, () => 3_000);
  const recovered = recoveredStore.getVisit(value.id);
  assert.equal(recovered.recordings[0]?.status, "complete");
  assert.equal(recovered.recordings[0]?.remoteUrl, "https://recordings.example/capture-replay-1.mp4");
  assert.equal(recovered.recordings[0]?.byteSize, 4_096);
  assert.deepEqual(recovered.recordings[0]?.metadata, { cameraId: "main", uploaded: true });
  assert.equal(recovered.lastSequence, 2);
  assert.equal(recoveredStore.appendEvent(value.id, {
    kind: "menu.event",
    occurredAtUnixMillis: 3_000,
    payload: { name: "after_recovery" }
  }).sequence, 3);
});

test("rejects a captureId reused by another asset anywhere in the local store", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context), () => 1_000);
  store.createVisit(visit("visit-capture-owner-a", 1_000));
  store.createVisit(visit("visit-capture-owner-b", 1_000));
  store.upsertRecording("visit-capture-owner-a", {
    id: "recording-owner-a",
    captureId: "shared-capture",
    scope: "visit",
    status: "recording",
    linkedRunIds: []
  });

  assert.throws(() => store.upsertRecording("visit-capture-owner-b", {
    id: "recording-owner-b",
    captureId: "shared-capture",
    scope: "visit",
    status: "recording",
    linkedRunIds: []
  }), /captureId already belongs to another asset/u);
  assert.equal(store.health().healthy, true, "identity validation is not an I/O health failure");
});

test("keeps run and linked-run recording associations inside their declared selection", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context), () => 1_000);
  const value = visit("visit-recording-association", 1_000);
  addOpenRun(value);
  value.selections.push({
    ...structuredClone(value.selections[0]!),
    id: "selection-2",
    ordinal: 2,
    runs: [{
      ...structuredClone(value.selections[0]!.runs[0]!),
      id: "run-2",
      ordinal: 1
    }]
  });
  store.createVisit(value);

  assert.throws(() => store.upsertRecording(value.id, {
    id: "recording-cross-selection-run",
    scope: "run",
    status: "recording",
    selectionId: "selection-1",
    runId: "run-2",
    linkedRunIds: ["run-2"]
  }), /run does not belong to its selection/u);
  assert.throws(() => store.upsertRecording(value.id, {
    id: "recording-cross-selection-link",
    scope: "selection",
    status: "recording",
    selectionId: "selection-1",
    linkedRunIds: ["run-2"]
  }), /linked run does not belong to recording selection/u);
  assert.throws(() => store.upsertRecording(value.id, {
    id: "recording-run-without-selection",
    scope: "run",
    status: "recording",
    runId: "run-1",
    linkedRunIds: ["run-1"]
  }), /requires selectionId and runId/u);
});

test("rejects empty and non-canonical event cursors", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context));
  store.createVisit(visit("visit-cursor", 1_000));
  for (const cursor of ["", Buffer.from("01").toString("base64url"), "%%%%"]) {
    if (!cursor) continue;
    assert.throws(() => store.listEvents("visit-cursor", { cursor }), /invalid event cursor/u);
  }
});

test("afterSequence pages events exclusively and cannot be combined with cursor", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context));
  store.createVisit(visit("visit-after-sequence", 1_000));
  store.appendEvents("visit-after-sequence", Array.from({ length: 5 }, (_value, index) => ({
    kind: `event.${index + 1}`,
    occurredAtUnixMillis: 1_001 + index,
    payload: {}
  })));
  const page = store.listEvents("visit-after-sequence", { afterSequence: 2, limit: 2 });
  assert.deepEqual(page.events.map((event) => event.sequence), [3, 4]);
  assert.ok(page.nextCursor);
  assert.deepEqual(store.listEvents("visit-after-sequence", { afterSequence: 5 }).events, []);
  assert.deepEqual(store.listEvents("visit-after-sequence", { afterSequence: 999 }).events, []);
  assert.throws(() => store.listEvents("visit-after-sequence", {
    cursor: page.nextCursor!,
    afterSequence: 2
  }), /mutually exclusive/u);
  for (const afterSequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => store.listEvents("visit-after-sequence", { afterSequence }), /non-negative safe integer/u);
  }
});

test("event paging cache evicts old visits and reloads a complete journal after an uncached append", (context) => {
  const store = new SessionHistoryStore(temporaryRoot(context));
  for (let index = 0; index <= sessionHistoryEventCacheLimit; index += 1) {
    const id = `visit-cache-${String(index).padStart(2, "0")}`;
    store.createVisit(visit(id, 1_000 + index), [{
      kind: "visit.started",
      occurredAtUnixMillis: 1_000 + index,
      payload: { index }
    }]);
  }
  const evictedId = "visit-cache-00";
  store.appendEvent(evictedId, {
    kind: "menu.event",
    occurredAtUnixMillis: 2_000,
    payload: { name: "after_eviction" }
  });
  assert.deepEqual(store.listEvents(evictedId).events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(store.listEvents(evictedId, { afterSequence: 1 }).events.map((event) => event.kind), ["menu.event"]);
});
