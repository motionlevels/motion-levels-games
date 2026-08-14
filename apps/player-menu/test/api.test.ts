import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { controlGame, friendlyRequestError, localPlaygroundEnabled, localPlaygroundLaunchURL, postVenueSession, requestJSON, RequestError, selectGame } from "../src/api.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("kiosk API requests", () => {
  it("maps a kiosk selection into a loopback-only full-playthrough route", () => {
    const target = localPlaygroundLaunchURL({
      game: "motion-levels-games:ping-pong",
      engineGame: "motion-levels-games:ping-pong",
      playerCount: 2,
      difficulty: "hard",
      config: { points: 7 },
    }, "4104", {
      hostname: "127.0.0.1",
      host: "127.0.0.1:4103",
      protocol: "http:",
    } as Location, true);
    const url = new URL(target!);
    assert.equal(url.origin, "http://127.0.0.1:4104");
    assert.equal(url.searchParams.get("journey"), "1");
    assert.equal(url.searchParams.get("game"), "ping-pong");
    assert.equal(url.searchParams.get("players"), "2");
    assert.equal(url.searchParams.get("difficulty"), "hard");
    assert.equal(url.searchParams.get("options"), JSON.stringify({ points: 7 }));
    assert.equal(url.searchParams.get("return"), "http://127.0.0.1:4103/");
  });

  it("never sends a local playthrough launch to a non-loopback host", () => {
    assert.equal(localPlaygroundLaunchURL({ game: "ping-pong", playerCount: 2 }, "4104", {
      hostname: "venue.example.com",
      host: "venue.example.com",
      protocol: "https:",
    } as Location), undefined);
    assert.equal(localPlaygroundEnabled("4104", {
      hostname: "venue.example.com",
    } as Location), false);
  });

  it("returns an embedded menu launch to its current playground", () => {
    const target = localPlaygroundLaunchURL({
      game: "motion-levels-games:ping-pong",
      playerCount: 2,
      difficulty: "medium",
    }, undefined, {
      hostname: "127.0.0.1",
      host: "127.0.0.1:4104",
      origin: "http://127.0.0.1:4104",
      pathname: "/player-menu/",
      protocol: "http:",
      search: "?embed=playground",
    } as Location, true);

    const url = new URL(target!);
    assert.equal(url.origin, "http://127.0.0.1:4104");
    assert.equal(url.searchParams.get("return"), "http://127.0.0.1:4104/?screen=menu");
  });

  it("returns a hosted menu launch to the canonical platform playground path", () => {
    const target = localPlaygroundLaunchURL({
      game: "motion-levels-games:ping-pong",
      playerCount: 2,
      difficulty: "hard",
    }, undefined, {
      hostname: "platform.motionlevels.obis.dev",
      host: "platform.motionlevels.obis.dev",
      origin: "https://platform.motionlevels.obis.dev",
      pathname: "/games/play/player-menu/",
      protocol: "https:",
      search: "?embed=playground",
    } as Location, true);

    const url = new URL(target!);
    assert.equal(url.pathname, "/games/play/");
    assert.equal(url.searchParams.get("return"), "https://platform.motionlevels.obis.dev/games/play/?screen=menu");
  });

  it("ignores embedded playground parameters outside development", () => {
    assert.equal(localPlaygroundLaunchURL({
      game: "motion-levels-games:ping-pong",
      playerCount: 2,
    }, undefined, {
      hostname: "127.0.0.1",
      host: "127.0.0.1:4104",
      origin: "http://127.0.0.1:4104",
      pathname: "/player-menu/",
      protocol: "http:",
      search: "?embed=playground",
    } as Location, false), undefined);
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
