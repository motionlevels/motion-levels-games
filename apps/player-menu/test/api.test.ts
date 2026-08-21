import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { controlGame, friendlyRequestError, postVenueSession, requestJSON, RequestError, selectGame, testOutput } from "../src/api.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("kiosk API requests", () => {
  it("uses the canonical runtime select endpoint for every menu launch", async () => {
    let requestURL = "";
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url, init) => {
      requestURL = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ revision: 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    await selectGame({ game: "motion-levels-games:ping-pong", playerCount: 2, sourceKind: "motion_levels_games" });
    assert.equal(new URL(requestURL).pathname, "/api/select");
    assert.equal(requestBody.game, "motion-levels-games:ping-pong");
    assert.match(String(requestBody.commandId), /^[0-9a-f-]{36}$/u);
  });

  it("returns decoded JSON and forwards request options", async () => {
    let method = "";
    globalThis.fetch = (async (_url, init) => {
      method = init?.method || "GET";
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    assert.deepEqual(await requestJSON<{ ok: boolean }>("https://example.invalid/status", { method: "POST" }, 100), { ok: true });
    assert.equal(method, "POST");
  });

  it("aborts hung requests at the kiosk deadline", async () => {
    globalThis.fetch = ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })) as typeof fetch;

    await assert.rejects(
      requestJSON("https://example.invalid/status", {}, 5),
      (error: unknown) => error instanceof RequestError && error.kind === "timeout",
    );
  });

  it("classifies network and malformed-response failures", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(
      requestJSON("https://example.invalid/status", {}, 100),
      (error: unknown) => error instanceof RequestError && error.kind === "network",
    );

    globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await assert.rejects(
      requestJSON("https://example.invalid/status", {}, 100),
      (error: unknown) => error instanceof RequestError && error.kind === "response",
    );
  });

  it("never exposes raw transport or server text to players", () => {
    assert.equal(
      friendlyRequestError(new RequestError("network", "internal socket detail"), "No se pudo iniciar"),
      "Sin conexión con el motor. Comprueba la conexión e inténtalo de nuevo.",
    );
    assert.equal(
      friendlyRequestError(new RequestError("response", "database stack trace", { status: 500 }), "No se pudo iniciar"),
      "No se pudo iniciar",
    );
  });

  it("serializes the sole menu command stream", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const requests: string[] = [];
    globalThis.fetch = (async (url) => {
      requests.push(String(url));
      if (requests.length === 1) await first;
      return new Response(JSON.stringify({ revision: requests.length }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    const selected = selectGame({ game: "ping-pong", playerCount: 2 });
    const controlled = controlGame("pause");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    releaseFirst();
    await Promise.all([selected, controlled]);
    assert.deepEqual(requests.map((url) => new URL(url).pathname), ["/api/select", "/api/control"]);
  });

  it("sends hardware output tests through the ordered command stream", async () => {
    const requests: Array<{ body: { commandId?: string; target?: string }; path: string }> = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as { commandId?: string; target?: string },
        path: new URL(String(url)).pathname,
      });
      return new Response(JSON.stringify({ revision: requests.length }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    await testOutput("audio");

    assert.equal(requests[0]?.path, "/api/output-test");
    assert.equal(requests[0]?.body.target, "audio");
    assert.match(requests[0]?.body.commandId ?? "", /^[0-9a-f-]{36}$/u);
  });

  it("correlates recording gate decisions with the authoritative gate id", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ revision: 2 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    await controlGame("recording_retry", { recordingGateId: " gate-2 " });
    assert.equal(body.action, "recording_retry");
    assert.equal(body.recordingGateId, "gate-2");
    assert.match(String(body.commandId), /^[0-9a-f-]{36}$/u);
    await assert.rejects(controlGame("recording_cancel"), /recordingGateId is required/u);
  });

  it("serializes venue-session mutations in request order", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const bodies: Array<{ recordingPolicy?: { scope?: string } }> = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as { recordingPolicy?: { scope?: string } });
      if (bodies.length === 1) await first;
      return new Response(JSON.stringify({ revision: bodies.length }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    const firstUpdate = postVenueSession({
      action: "start",
      venueSessionId: "venue-session-a",
      recordingPolicy: { scope: "selection" },
    });
    const secondUpdate = postVenueSession({
      action: "start",
      venueSessionId: "venue-session-a",
      recordingPolicy: { scope: "run" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(bodies.length, 1);
    releaseFirst();
    await Promise.all([firstUpdate, secondUpdate]);
    assert.deepEqual(bodies.map((body) => body.recordingPolicy?.scope), ["selection", "run"]);
  });

  it("continues the venue-session queue after a rejected mutation", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        await first;
        return new Response("failed", { status: 500 });
      }
      return new Response(JSON.stringify({ revision: requestCount }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    const failedUpdate = postVenueSession({
      action: "start",
      venueSessionId: "venue-session-a",
      recordingPolicy: { scope: "off" },
    });
    const nextUpdate = postVenueSession({
      action: "start",
      venueSessionId: "venue-session-a",
      recordingPolicy: { scope: "visit" },
    });
    const rejection = assert.rejects(
      failedUpdate,
      (error: unknown) => error instanceof RequestError && error.kind === "response",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requestCount, 1);
    releaseFirst();
    await Promise.all([rejection, nextUpdate]);
    assert.equal(requestCount, 2);
  });

  it("retries a lost command response with the same id", async () => {
    const bodies: Array<{ commandId: string }> = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as { commandId: string });
      if (bodies.length === 1) throw new TypeError("lost response");
      return new Response(JSON.stringify({ revision: 2 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    await controlGame("restart");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].commandId, bodies[1].commandId);
  });
});
