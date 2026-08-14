import assert from "node:assert/strict";
import test from "node:test";
import {
  type RecordingBoundary,
  RecordingStartRejectedError
} from "@motion-levels-games/session-history";
import {
  HttpRecordingClient,
  recordingShutdownDrainBudgetMillis
} from "../src/httpRecordingClient.ts";

function boundary(
  type: "start" | "stop",
  runId: string,
  occurredAtUnixMillis = 1_800_000_000_123
): RecordingBoundary {
  const id = `capture-${runId}`;
  return {
    type,
    scope: "run",
    sessionId: "visit-1",
    selectionId: "selection-1",
    runId,
    occurredAtUnixMillis,
    policy: { scope: "run", cameraIds: ["main"], includeAudio: true },
    recording: {
      id,
      captureId: id,
      scope: "run",
      status: type === "start" ? "requested" : "finalizing",
      selectionId: "selection-1",
      runId,
      linkedRunIds: [runId]
    }
  };
}

test("shutdown budget covers an ambiguous start and a confirmed stop retry", () => {
  assert.equal(recordingShutdownDrainBudgetMillis({}), 130_000);
  assert.equal(recordingShutdownDrainBudgetMillis({
    MOTION_LEVELS_CAMERA_RECORDER_TIMEOUT: "2s",
    MOTION_LEVELS_CAMERA_RECORDER_START_CONFIRM_TIMEOUT: "3s"
  }), 35_000);
});

test("sends exact epoch nanoseconds as a decimal string", async () => {
  let requestBody: Record<string, unknown> = {};
  const startedAt = "2027-01-15T08:00:00.500Z";
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/status") {
        return jsonResponse({
          activeSessions: [{
            venueSessionId: "capture-run-1",
            recordingState: "recording",
            currentSegmentStartedAt: startedAt
          }]
        });
      }
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ recording: true, backend: "fake" });
    }
  });

  const value = boundary("start", "run-1");
  const asset = await client.onBoundary(value);
  assert.equal(requestBody.startedUnixNanos, (BigInt(value.occurredAtUnixMillis) * 1_000_000n).toString());
  assert.equal(asset.status, "recording");
  assert.equal(asset.captureId, "capture-run-1");
  assert.equal(asset.startedAtUnixMillis, Date.parse(startedAt));
});

test("waits for scheduled and starting states before reporting a physical start", async () => {
  const value = boundary("start", "run-1");
  const startedAtUnixMillis = value.occurredAtUnixMillis + 1_234;
  const startedAt = new Date(startedAtUnixMillis).toISOString();
  const paths: string[] = [];
  let statusRequest = 0;
  const cameraResponse = { recording: true, backend: "gopro", maxEndsAt: "2027-01-15T09:00:00.000Z" };
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    startConfirmTimeoutMillis: 1_000,
    stopPollIntervalMillis: 10,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/sessions/start") return jsonResponse(cameraResponse);
      statusRequest += 1;
      const recordingState = statusRequest === 1 ? "scheduled" : statusRequest === 2 ? "starting" : "recording-segment";
      return jsonResponse({
        activeSessions: [{
          venueSessionId: "capture-run-1",
          recordingState,
          currentSegmentStartedAt: statusRequest < 3 ? null : startedAt,
          currentSegmentExpectedStopAt: "2027-01-15T08:05:00.000Z"
        }]
      });
    }
  });

  const asset = await client.onBoundary(value);
  assert.equal(asset.status, "recording");
  assert.equal(asset.startedAtUnixMillis, startedAtUnixMillis);
  assert.equal(asset.metadata?.cameraStartedAtUnixMillis, startedAtUnixMillis);
  assert.equal(asset.metadata?.cameraStartupMillis, 1_234);
  assert.deepEqual(asset.metadata?.cameraResponse, cameraResponse);
  assert.deepEqual(asset.metadata?.cameraStatus, {
    venueSessionId: "capture-run-1",
    recordingState: "recording-segment",
    currentSegmentStartedAt: startedAt,
    currentSegmentExpectedStopAt: "2027-01-15T08:05:00.000Z"
  });
  assert.deepEqual(paths, ["/sessions/start", "/status", "/status", "/status"]);
});

test("persists and observes the camera's authoritative maxEndsAt", async () => {
  const maxEndsAt = "2027-01-15T08:00:00.000Z";
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/status") {
        return new Response(JSON.stringify({
          activeSessions: [{
            venueSessionId: "capture-run-1",
            recordingState: "recording-segment",
            currentSegmentStartedAt: "2027-01-15T07:55:00.000Z",
            maxEndsAt
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ recording: true, maxEndsAt }), { status: 200 });
    }
  });
  const asset = await client.onBoundary(boundary("start", "run-1"));
  assert.equal(asset.metadata?.cameraMaxEndsAtUnixMillis, Date.parse(maxEndsAt));
  const observation = await client.observe(asset);
  assert.equal(observation.active, true);
  assert.equal(observation.maxEndsAtUnixMillis, Date.parse(maxEndsAt));
});

test("waits for a stopped capture to disappear before the next start", async () => {
  const paths: string[] = [];
  let statusRequest = 0;
  const firstCaptureId = "capture-run-1";
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    timeoutMillis: 1_000,
    stopPollIntervalMillis: 10,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/sessions/stop") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (path === "/status") {
        statusRequest += 1;
        return new Response(JSON.stringify({
          activeSessions: statusRequest === 1
            ? [{ venueSessionId: firstCaptureId }]
            : statusRequest === 2
              ? []
              : [{
                  venueSessionId: "capture-run-2",
                  recordingState: "recording-segment",
                  currentSegmentStartedAt: "2027-01-15T08:00:00.000Z"
                }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ recording: true }), { status: 200 });
    }
  });

  const stopped = await client.onBoundary(boundary("stop", "run-1"));
  await client.onBoundary(boundary("start", "run-2"));
  assert.equal(stopped.status, "complete");
  assert.equal(stopped.metadata?.stopConfirmed, true);
  assert.deepEqual(paths, [
    "/sessions/stop",
    "/status",
    "/status",
    "/sessions/start",
    "/status"
  ]);
});

test("rejects a successful HTTP response when the camera did not start", async () => {
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    fetch: async () => new Response(JSON.stringify({
      recording: false,
      error: "camera is not ready"
    }), { status: 200 })
  });

  await assert.rejects(client.onBoundary(boundary("start", "run-1")), (error) => {
    assert.ok(error instanceof RecordingStartRejectedError);
    assert.match(error.message, /did not start capture capture-run-1: camera is not ready/u);
    return true;
  });
});

test("times out without physical confirmation as an uncertain start failure", async () => {
  let statusRequests = 0;
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    startConfirmTimeoutMillis: 100,
    stopPollIntervalMillis: 10,
    fetch: async (input) => {
      if (new URL(String(input)).pathname === "/sessions/start") {
        return jsonResponse({ recording: true });
      }
      statusRequests += 1;
      return jsonResponse({
        activeSessions: [{
          venueSessionId: "capture-run-1",
          recordingState: "starting",
          currentSegmentStartedAt: null
        }]
      });
    }
  });

  await assert.rejects(client.onBoundary(boundary("start", "run-1")), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof RecordingStartRejectedError));
    assert.match(error.message, /did not confirm physical start/u);
    return true;
  });
  assert.ok(statusRequests >= 1);
});

test("never treats a status payload without activeSessions as a completed stop", async () => {
  const paths: string[] = [];
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    timeoutMillis: 1_000,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return new Response(JSON.stringify(path === "/sessions/stop" ? { stopping: true } : { healthy: true }), {
        status: 200
      });
    }
  });

  await assert.rejects(client.onBoundary(boundary("stop", "run-1")), /requires activeSessions/u);
  assert.deepEqual(paths, ["/sessions/stop", "/status"]);
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}
