import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { venueApiProtocolVersion } from "./apiProtocol.ts";
import { SerializedCommandExecutor } from "./commandExecutor.ts";
import { RequestValidationError, RevisionMismatchError, type ObservedFloorFrame, type VenueRuntime, type VenueRuntimeStatus } from "./venueRuntime.ts";

export { venueApiProtocolVersion };

/** Local adapter. Loopback is trusted for development; venue-network peers
 * authenticate with the shared engine token injected by the gateway. */
export const engineTokenHeader = "x-motion-levels-engine-token" as const;

export function createVenueHttpServer(runtime: VenueRuntime, engineToken = ""): Server {
  const commands = new SerializedCommandExecutor<VenueRuntimeStatus>();
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://venue-runtime.local");
    if (url.pathname !== "/api/health" && !authorizeEngineRequest(
      request.socket.remoteAddress,
      engineToken,
      request.headers[engineTokenHeader]
    )) {
      response.writeHead(401).end("engine token required");
      return;
    }
    applyLoopbackCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    try {
      await route(runtime, commands, request, response);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error instanceof RevisionMismatchError ? 409
        : error instanceof RequestValidationError || error instanceof SyntaxError || error instanceof TypeError ? 400
          : 500;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
}

async function route(
  runtime: VenueRuntime,
  commands: SerializedCommandExecutor<VenueRuntimeStatus>,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://venue-runtime.local");
  if (url.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    json(response, runtime.health(), request.method === "HEAD");
    return;
  }
  if (url.pathname === "/api/status" && request.method === "GET") {
    json(response, runtime.status());
    return;
  }
  if (url.pathname === "/api/player-state" && request.method === "GET") {
    json(response, runtime.status());
    return;
  }
  if (url.pathname === "/api/display" && request.method === "GET") {
    json(response, runtime.display());
    return;
  }
  if (url.pathname === "/api/display/events" && request.method === "GET") {
    sse(response, request, "display", runtime.display(), (listener) => runtime.subscribeDisplay(listener));
    return;
  }
  if (url.pathname === "/api/live-floor/events" && request.method === "GET") {
    sseOptional<ObservedFloorFrame>(
      response,
      request,
      "live-floor",
      null,
      (listener) => runtime.subscribeObservedFloor(listener)
    );
    return;
  }
  if (url.pathname === "/api/player-state/events" && request.method === "GET") {
    sse(response, request, "player-state", runtime.status(), (listener) => runtime.subscribeStatus(listener));
    return;
  }
  if (url.pathname === "/api/select" && request.method === "POST") {
    const body = await readJson(request) as Parameters<VenueRuntime["select"]>[0];
    json(response, await commands.execute(String(body.commandId ?? ""), () => runtime.select(body)));
    return;
  }
  if (url.pathname === "/api/control" && request.method === "POST") {
    const body = await readJson(request);
    json(response, await commands.execute(String(body.commandId ?? ""), () => runtime.control(body.action)));
    return;
  }
  if (url.pathname === "/api/floor-input" && request.method === "POST") {
    const body = await readJson(request) as Parameters<VenueRuntime["applyRemoteFloorInput"]>[0];
    if (typeof body.commandId !== "string" || !body.commandId.trim()) {
      throw new RequestValidationError("commandId is required");
    }
    json(response, await commands.execute(
      body.commandId,
      () => runtime.applyRemoteFloorInput(body)
    ));
    return;
  }
  if (url.pathname === "/api/menu-state") {
    if (request.method === "GET") {
      json(response, runtime.getMenuState());
      return;
    }
    if (request.method === "PUT" || request.method === "POST") {
      const body = await readJson(request, 1_050_000);
      json(response, runtime.putMenuState(body.kioskId, body.snapshot));
      return;
    }
  }
  if (url.pathname === "/api/menu-state/events" && request.method === "GET") {
    sse(response, request, "menu-state", runtime.getMenuState(), (listener) => runtime.subscribeMenuState(listener));
    return;
  }
  if (url.pathname === "/api/venue-session" && request.method === "POST") {
    json(response, runtime.updateVenueSession(await readJson(request)));
    return;
  }
  if (url.pathname === "/api/menu-event" && request.method === "POST") {
    json(response, runtime.recordMenuEvent(await readJson(request)));
    return;
  }
  if (url.pathname === "/api/display-client") {
    if (request.method === "GET") {
      json(response, runtime.displayClientStatus());
      return;
    }
    if (request.method === "POST") {
      json(response, runtime.updateDisplayClient(await readJson(request, 16_384)));
      return;
    }
  }
  if ([
    "/api/health", "/api/status", "/api/player-state", "/api/player-state/events", "/api/display", "/api/display/events", "/api/live-floor/events", "/api/select", "/api/control", "/api/floor-input",
    "/api/menu-state", "/api/menu-state/events", "/api/venue-session", "/api/menu-event", "/api/display-client"
  ].includes(url.pathname)) {
    response.writeHead(405, { Allow: "GET, HEAD, POST, PUT, OPTIONS" }).end("method not allowed");
    return;
  }
  response.writeHead(404).end("not found");
}

async function readJson(request: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > limit) throw new RequestValidationError("request body is too large");
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("request body must be a JSON object");
  return value as Record<string, unknown>;
}

function json(response: ServerResponse, value: unknown, head = false): void {
  const body = JSON.stringify(value);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(head ? undefined : body);
}

function sse<T>(
  response: ServerResponse,
  request: IncomingMessage,
  event: string,
  initial: T,
  subscribe: (listener: (value: T) => void) => () => void
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();
  const write = (value: T) => response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  write(initial);
  const unsubscribe = subscribe(write);
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
  heartbeat.unref();
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function sseOptional<T>(
  response: ServerResponse,
  request: IncomingMessage,
  event: string,
  initial: T | null,
  subscribe: (listener: (value: T) => void) => () => void
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();
  const writer = createLatestSseWriter<T>(response, event);
  if (initial !== null) writer.write(initial);
  const unsubscribe = subscribe(writer.write);
  const heartbeat = setInterval(writer.heartbeat, 15_000);
  heartbeat.unref();
  request.on("close", () => {
    clearInterval(heartbeat);
    writer.close();
    unsubscribe();
  });
}

type SseWritable = {
  write(chunk: string): boolean;
  on(event: "drain", listener: () => void): unknown;
  off(event: "drain", listener: () => void): unknown;
};

/** Keep at most one unsent event while an HTTP client applies backpressure. */
export function createLatestSseWriter<T>(response: SseWritable, event: string) {
  let blocked = false;
  let pending: T | null = null;
  const writeNow = (value: T) => {
    blocked = !response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  };
  const write = (value: T) => {
    if (blocked) {
      pending = value;
      return;
    }
    writeNow(value);
  };
  const drain = () => {
    blocked = false;
    const latest = pending;
    pending = null;
    if (latest !== null) writeNow(latest);
  };
  response.on("drain", drain);
  return {
    write,
    heartbeat: () => {
      if (!blocked) blocked = !response.write(": keepalive\n\n");
    },
    close: () => {
      pending = null;
      response.off("drain", drain);
    }
  };
}

function applyLoopbackCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (origin && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Motion-Levels-Engine-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, OPTIONS");
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function authorizeEngineRequest(
  remoteAddress: string | undefined,
  expectedToken: string,
  providedToken: string | string[] | undefined
): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  if (!expectedToken || typeof providedToken !== "string") return false;
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.byteLength === provided.byteLength && timingSafeEqual(expected, provided);
}
