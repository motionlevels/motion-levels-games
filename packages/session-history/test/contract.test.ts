import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_RECORDING_POLICY,
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  normalizeRecordingPolicy,
  type RecordingAsset,
  type RecordingBoundary,
  type RecordingClient,
  type SessionDetailResponse,
  type SessionEventsResponse,
  type SessionHistoryVisit,
  type SessionListResponse
} from "../src/index.ts";

const now = 1_800_000_000_000;

const recording = {
  id: "recording-1",
  captureId: "capture-1",
  scope: "run",
  status: "recording",
  selectionId: "selection-1",
  runId: "run-1",
  linkedRunIds: ["run-1"],
  startedAtUnixMillis: now,
  cameraId: "camera-main",
  metadata: { source: "camera-service" }
} satisfies RecordingAsset;

test("exports the stable visit and response envelopes", () => {
  const visit = {
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id: "session-1",
    status: "active",
    origin: "kiosk",
    startedAtUnixMillis: now,
    teamName: "Equipo azul",
    players: [{ id: "player-1", name: "Ada" }],
    recordingPolicy: { scope: "run" },
    selections: [],
    recordings: [recording],
    lastSequence: 0,
    updatedAtUnixMillis: now
  } satisfies SessionHistoryVisit;
  const detail = { schema: SESSION_HISTORY_SCHEMA, session: visit } satisfies SessionDetailResponse;
  const list = { schema: SESSION_HISTORY_SCHEMA, sessions: [], nextCursor: null } satisfies SessionListResponse;
  const events = {
    schema: SESSION_HISTORY_SCHEMA,
    sessionId: visit.id,
    events: [],
    nextCursor: null
  } satisfies SessionEventsResponse;

  assert.doesNotThrow(() => JSON.stringify({ detail, list, events }));
  assert.equal(detail.session.recordings[0]?.status, "recording");
});

test("normalizes legacy booleans, scopes, and structured policies", () => {
  assert.deepEqual(DEFAULT_RECORDING_POLICY, { scope: "off" });
  assert.deepEqual(normalizeRecordingPolicy(undefined), { scope: "off" });
  assert.deepEqual(normalizeRecordingPolicy(null), { scope: "off" });
  assert.deepEqual(normalizeRecordingPolicy(false), { scope: "off" });
  assert.deepEqual(normalizeRecordingPolicy(true), { scope: "visit" });
  assert.deepEqual(normalizeRecordingPolicy("selection"), { scope: "selection" });
  assert.deepEqual(normalizeRecordingPolicy("invalid"), { scope: "off" });
  assert.deepEqual(normalizeRecordingPolicy({
    scope: "run",
    cameraIds: [" main ", "main", "", 42],
    includeAudio: true,
    preRollMillis: 1_500,
    postRollMillis: -1
  }), {
    scope: "run",
    cameraIds: ["main"],
    includeAudio: true,
    preRollMillis: 1_500
  });
});

test("recording clients receive the correlated asset on every boundary", async () => {
  const boundary = {
    type: "start",
    scope: "run",
    sessionId: "session-1",
    selectionId: "selection-1",
    runId: "run-1",
    occurredAtUnixMillis: now,
    policy: { scope: "run", cameraIds: ["camera-main"] },
    recording
  } satisfies RecordingBoundary;
  const synchronous: RecordingClient = { onBoundary: (value) => value.recording };
  const asynchronous: RecordingClient = { onBoundary: async () => null };

  assert.equal(synchronous.onBoundary(boundary), recording);
  assert.equal(await asynchronous.onBoundary(boundary), null);
});

test("schema publishes visits, recordings, timeline events, and all envelopes", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../schema/session-history-v1.schema.json", import.meta.url), "utf8")
  ) as {
    $ref?: string;
    $defs?: Record<string, {
      maxLength?: number;
      pattern?: string;
      properties?: Record<string, { const?: unknown; enum?: unknown[] }>;
      required?: string[];
    }>;
  };

  assert.equal(schema.$ref, "#/$defs/visit");
  assert.equal(schema.$defs?.visit?.properties?.schema?.const, SESSION_HISTORY_SCHEMA);
  assert.equal(schema.$defs?.visit?.properties?.contractVersion?.const, SESSION_HISTORY_CONTRACT_VERSION);
  assert.deepEqual(
    schema.$defs?.recordingPolicy?.properties?.scope?.enum,
    ["off", "visit", "selection", "run"]
  );
  assert.ok(schema.$defs?.recordingBoundary?.required?.includes("recording"));
  assert.equal(schema.$defs?.sessionId?.maxLength, 255);
  assert.equal(schema.$defs?.eventId?.maxLength, 268);
  assert.equal(schema.$defs?.eventId?.pattern, "^[A-Za-z0-9][A-Za-z0-9._-]{0,254}:[0-9]{12}$");
  assert.ok(schema.$defs?.sessionsEnvelope);
  assert.ok(schema.$defs?.sessionEnvelope);
  assert.ok(schema.$defs?.eventsEnvelope);
  assert.ok(schema.$defs?.recordingEnvelope);
});
