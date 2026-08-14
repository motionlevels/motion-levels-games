import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchDisplayStatus } from "../src/api.ts";
import { reportDisplayClient, type DisplayClientReport } from "../src/displayClient.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("player display network deadlines", () => {
  it("aborts a stalled fallback status request", async () => {
    globalThis.fetch = stalledFetch();
    await assert.rejects(fetchDisplayStatus(5), (error: unknown) => (
      error instanceof DOMException && error.name === "AbortError"
    ));
  });

  it("aborts a stalled display heartbeat", async () => {
    globalThis.fetch = stalledFetch();
    await assert.rejects(reportDisplayClient(displayReport(), 5), (error: unknown) => (
      error instanceof DOMException && error.name === "AbortError"
    ));
  });
});

function stalledFetch(): typeof fetch {
  return ((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
}

function displayReport(): DisplayClientReport {
  return {
    clientId: "player-display",
    currentGame: "salvapantallas",
    expectedRevision: "a".repeat(40),
    loadedRevision: "a".repeat(40),
    renderStatus: "ready",
    renderAttempt: 1,
    connected: true,
    feedTransport: "eventsource",
    lastFeedUnixMillis: Date.now(),
    lastPaintUnixMillis: Date.now(),
    pageLoadedUnixMillis: Date.now(),
    viewportWidth: 1920,
    viewportHeight: 1080,
    devicePixelRatio: 1,
    error: "",
    audioOutputState: "ready",
    outputTestId: "",
    outputTestSequence: 0,
    outputTestState: "idle",
  };
}
