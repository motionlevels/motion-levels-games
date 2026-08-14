import assert from "node:assert/strict";
import test from "node:test";
import {
  type RecordingBoundary,
  RecordingStartRejectedError
} from "@motion-levels-games/session-history";
import { HttpRecordingClient } from "../src/httpRecordingClient.ts";

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

test("sends exact epoch nanoseconds as a decimal string", async () => {
  let requestBody: Record<string, unknown> = {};
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ recording: true, backend: "fake" }), { status: 200 });
    }
  });

  const value = boundary("start", "run-1");
  const asset = await client.onBoundary(value);
  assert.equal(requestBody.startedUnixNanos, (BigInt(value.occurredAtUnixMillis) * 1_000_000n).toString());
  assert.equal(asset.status, "recording");
  assert.equal(asset.captureId, "capture-run-1");
});

test("persists and observes the camera's authoritative maxEndsAt", async () => {
  const maxEndsAt = "2027-01-15T08:00:00.000Z";
  const client = new HttpRecordingClient({
    baseUrl: "http://camera.test:8080",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/status") {
        return new Response(JSON.stringify({
          activeSessions: [{ venueSessionId: "capture-run-1", maxEndsAt }]
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
        return new Response(JSON.stringify({ stopping: true }), { status: 200 });
      }
      if (path === "/status") {
        statusRequest += 1;
        return new Response(JSON.stringify({
          activeSessions: statusRequest === 1 ? [{ venueSessionId: firstCaptureId }] : []
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ recording: true }), { status: 200 });
    }
  });

  const stopped = await client.onBoundary(boundary("stop", "run-1"));
  await client.onBoundary(boundary("start", "run-2"));
  assert.equal(stopped.status, "complete");
  assert.deepEqual(paths, [
    "/sessions/stop",
    "/status",
    "/status",
    "/sessions/start"
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
