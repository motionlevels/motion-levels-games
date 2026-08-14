import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RecordingAsset } from "@motion-levels-games/session-history";
import { venueApiProtocolVersion } from "./apiProtocol.ts";
import { SerializedCommandExecutor } from "./commandExecutor.ts";
import {
  SessionHistoryConflictError,
  SessionHistoryNotFoundError,
  SessionHistoryValidationError
} from "./sessionHistoryStore.ts";
import { RequestValidationError, RevisionMismatchError, type ObservedFloorFrame, type VenueRuntime, type VenueRuntimeStatus } from "./venueRuntime.ts";

export { venueApiProtocolVersion };

/** Local adapter. Loopback is trusted for development; venue-network peers
 * authenticate with the shared engine token injected by the gateway. */
export const engineTokenHeader = "x-motion-levels-engine-token" as const;
const venueServerSseResponses = new WeakMap<Server, Set<ServerResponse>>();
const venueServerLifecycles = new WeakMap<Server, VenueHttpLifecycle>();
const venueServerShutdowns = new WeakMap<Server, VenueHttpShutdown>();

export type VenueHttpShutdown = Readonly<{
  mutationsDrained: Promise<void>;
  serverClosed: Promise<void>;
}>;

export function createVenueHttpServer(runtime: VenueRuntime, engineToken = ""): Server {
  const commands = new SerializedCommandExecutor<VenueRuntimeStatus>();
  const sseResponses = new Set<ServerResponse>();
  const lifecycle = new VenueHttpLifecycle();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://venue-runtime.local");
    const historyRequest = url.pathname === "/api/history/v1/sessions"
      || url.pathname.startsWith("/api/history/v1/sessions/");
    const authorized = historyRequest
      ? authorizeEngineToken(engineToken, request.headers[engineTokenHeader])
      : authorizeEngineRequest(request.socket.remoteAddress, engineToken, request.headers[engineTokenHeader]);
    if (url.pathname !== "/api/health" && !authorized) {
      response.writeHead(401).end("engine token required");
      return;
    }
    applyLoopbackCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    try {
      lifecycle.assertAcceptingRequests();
      const dispatch = () => route(runtime, commands, request, response, sseResponses);
      if (isMutationRequest(request)) await lifecycle.runMutation(dispatch);
      else await dispatch();
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error instanceof VenueHttpShuttingDownError ? 503
        : error instanceof RevisionMismatchError || error instanceof SessionHistoryConflictError ? 409
        : error instanceof SessionHistoryNotFoundError ? 404
          : error instanceof RequestValidationError
            || error instanceof SessionHistoryValidationError
            || error instanceof SyntaxError
            || error instanceof TypeError ? 400
          : 500;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  venueServerSseResponses.set(server, sseResponses);
  venueServerLifecycles.set(server, lifecycle);
  return server;
}

/** End only long-lived event streams. Ordinary in-flight commands remain
 * connected so shutdown can wait for them before draining runtime state. */
export function closeVenueHttpSse(server: Server): void {
  for (const response of venueServerSseResponses.get(server) ?? []) response.end();
}

/** Atomically stops accepting work, closes long-lived feeds, and exposes the
 * two independent shutdown boundaries. Runtime camera/history drain may begin
 * as soon as mutationsDrained resolves; it must not wait for unrelated HTTP
 * connections represented by serverClosed. */
export function beginVenueHttpShutdown(server: Server): VenueHttpShutdown {
  const existing = venueServerShutdowns.get(server);
  if (existing) return existing;
  const lifecycle = venueServerLifecycles.get(server);
  if (!lifecycle) throw new Error("venue HTTP server lifecycle is unavailable");
  const mutationsDrained = lifecycle.beginShutdown();
  closeVenueHttpSse(server);
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
  const shutdown = { mutationsDrained, serverClosed };
  venueServerShutdowns.set(server, shutdown);
  return shutdown;
}

class VenueHttpShuttingDownError extends Error {}

class VenueHttpLifecycle {
  private acceptingRequests = true;
  private activeMutations = 0;
  private mutationDrain: Promise<void> | null = null;
  private resolveMutationDrain: (() => void) | null = null;

  assertAcceptingRequests(): void {
    if (!this.acceptingRequests) throw new VenueHttpShuttingDownError("venue runtime is shutting down");
  }

  async runMutation<T>(action: () => T | Promise<T>): Promise<T> {
    this.assertAcceptingRequests();
    this.activeMutations += 1;
    try {
      return await action();
    } finally {
      this.activeMutations -= 1;
      if (this.activeMutations === 0 && this.resolveMutationDrain) {
        this.resolveMutationDrain();
        this.resolveMutationDrain = null;
      }
    }
  }

  beginShutdown(): Promise<void> {
    this.acceptingRequests = false;
    if (this.activeMutations === 0) return Promise.resolve();
    if (!this.mutationDrain) {
      this.mutationDrain = new Promise<void>((resolve) => { this.resolveMutationDrain = resolve; });
    }
    return this.mutationDrain;
  }
}

function isMutationRequest(request: IncomingMessage): boolean {
  return request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
}

async function route(
  runtime: VenueRuntime,
  commands: SerializedCommandExecutor<VenueRuntimeStatus>,
  request: IncomingMessage,
  response: ServerResponse,
  sseResponses: Set<ServerResponse>
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://venue-runtime.local");
  if (url.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    json(response, runtime.health(), request.method === "HEAD");
    return;
  }
  if (url.pathname === "/api/history/v1/sessions" && request.method === "GET") {
    const status = url.searchParams.get("status");
    if (status && status !== "active" && status !== "ended") {
      throw new RequestValidationError("status must be active or ended");
    }
    const historyStatus = status === "active" || status === "ended" ? status : undefined;
    json(response, runtime.listHistorySessions({
      cursor: url.searchParams.get("cursor") || undefined,
      limit: queryInteger(url, "limit"),
      status: historyStatus,
      from: queryInteger(url, "from"),
      to: queryInteger(url, "to")
    }));
    return;
  }
  const replayMatch = /^\/api\/history\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/replay$/u.exec(url.pathname);
  if (replayMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }).end("method not allowed");
      return;
    }
    const replay = runtime.historyRunReplay(
      decodePathSegment(replayMatch[1] ?? ""),
      decodePathSegment(replayMatch[2] ?? "")
    );
    response.writeHead(200, {
      "Content-Type": replay.asset.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeDownloadName(replay.asset.fileName ?? "run-replay.mlrun.jsonl.gz")}"`,
      "Cache-Control": "private, no-store",
      ...(replay.asset.byteSize === undefined ? {} : { "Content-Length": replay.asset.byteSize })
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(replay.path).on("error", () => response.destroy()).pipe(response);
    return;
  }
  const historyMatch = /^\/api\/history\/v1\/sessions\/([^/]+)(?:\/(events|recordings))?$/u.exec(url.pathname);
  if (historyMatch) {
    const id = decodePathSegment(historyMatch[1] ?? "");
    const child = historyMatch[2];
    if (!child && request.method === "GET") {
      json(response, runtime.historySession(id));
      return;
    }
    if (child === "events" && request.method === "GET") {
      json(response, runtime.historyEvents(id, {
        cursor: url.searchParams.get("cursor") || undefined,
        limit: queryInteger(url, "limit")
      }));
      return;
    }
    if (child === "recordings" && request.method === "POST") {
      json(response, runtime.addHistoryRecording(id, recordingAsset(await readJson(request, 262_144))));
      return;
    }
    response.writeHead(405, { Allow: child === "recordings" ? "POST, OPTIONS" : "GET, OPTIONS" }).end("method not allowed");
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
    sse(response, request, sseResponses, "display", runtime.display(), (listener) => runtime.subscribeDisplay(listener));
    return;
  }
  if (url.pathname === "/api/live-floor/events" && request.method === "GET") {
    sseOptional<ObservedFloorFrame>(
      response,
      request,
      sseResponses,
      "live-floor",
      null,
      (listener) => runtime.subscribeObservedFloor(listener)
    );
    return;
  }
  if (url.pathname === "/api/player-state/events" && request.method === "GET") {
    sse(response, request, sseResponses, "player-state", runtime.status(), (listener) => runtime.subscribeStatus(listener));
    return;
  }
  if (url.pathname === "/api/select" && request.method === "POST") {
    const body = await readJson(request) as Parameters<VenueRuntime["select"]>[0];
    json(response, await commands.execute(String(body.commandId ?? ""), () => runtime.select(body)));
    return;
  }
  if (url.pathname === "/api/control" && request.method === "POST") {
    const body = await readJson(request);
    json(response, await commands.execute(
      String(body.commandId ?? ""),
      () => runtime.control(body.action, body.recordingGateId)
    ));
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
    sse(response, request, sseResponses, "menu-state", runtime.getMenuState(), (listener) => runtime.subscribeMenuState(listener));
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

function queryInteger(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new RequestValidationError(`${name} must be a non-negative integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RequestValidationError(`${name} must be a non-negative integer`);
  }
  return number;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestValidationError("session id is malformed");
  }
}

function recordingAsset(body: Record<string, unknown>): RecordingAsset {
  const id = requiredText(body.id, "recording id");
  const scope = requiredText(body.scope, "recording scope");
  const status = requiredText(body.status, "recording status");
  if (scope !== "visit" && scope !== "selection" && scope !== "run") {
    throw new RequestValidationError("recording scope is invalid");
  }
  if (!["requested", "recording", "finalizing", "pending_upload", "uploading", "complete", "partial", "failed", "missing"].includes(status)) {
    throw new RequestValidationError("recording status is invalid");
  }
  const linkedRunIds = body.linkedRunIds ?? [];
  if (!Array.isArray(linkedRunIds)
    || linkedRunIds.some((value) => typeof value !== "string" || !value.trim())) {
    throw new RequestValidationError("linkedRunIds must be strings");
  }
  const metadata = optionalObject(body.metadata, "recording metadata");
  const sha256 = optionalText(body.sha256, "sha256");
  if (sha256 && !/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new RequestValidationError("sha256 is invalid");
  }
  const captureId = optionalText(body.captureId, "captureId");
  const selectionId = optionalText(body.selectionId, "selectionId");
  const runId = optionalText(body.runId, "runId");
  const startedAtUnixMillis = optionalInteger(body.startedAtUnixMillis, "startedAtUnixMillis");
  const endedAtUnixMillis = optionalInteger(body.endedAtUnixMillis, "endedAtUnixMillis");
  const backend = optionalText(body.backend, "backend");
  const cameraId = optionalText(body.cameraId, "cameraId");
  const localPath = optionalText(body.localPath, "localPath");
  const remoteUrl = optionalText(body.remoteUrl, "remoteUrl");
  const shareUrl = optionalText(body.shareUrl, "shareUrl");
  const downloadUrl = optionalText(body.downloadUrl, "downloadUrl");
  const fileName = optionalText(body.fileName, "fileName");
  const contentType = optionalText(body.contentType, "contentType");
  const byteSize = optionalInteger(body.byteSize, "byteSize");
  return {
    id,
    scope,
    status: status as RecordingAsset["status"],
    linkedRunIds: [...new Set(linkedRunIds.map((value) => String(value).trim()))],
    ...(captureId ? { captureId } : {}),
    ...(selectionId ? { selectionId } : {}),
    ...(runId ? { runId } : {}),
    ...(startedAtUnixMillis === undefined ? {} : { startedAtUnixMillis }),
    ...(endedAtUnixMillis === undefined ? {} : { endedAtUnixMillis }),
    ...(backend ? { backend } : {}),
    ...(cameraId ? { cameraId } : {}),
    ...(localPath ? { localPath } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(shareUrl ? { shareUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(fileName ? { fileName } : {}),
    ...(contentType ? { contentType } : {}),
    ...(byteSize === undefined ? {} : { byteSize }),
    ...(sha256 ? { sha256 } : {}),
    ...(metadata ? { metadata: structuredClone(metadata) as RecordingAsset["metadata"] } : {})
  };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(`${label} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RequestValidationError(`${label} must be a non-negative integer`);
  }
  return number;
}

function optionalObject(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function safeDownloadName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 255) || "run-replay.mlrun.jsonl.gz";
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
  responses: Set<ServerResponse>,
  event: string,
  initial: T,
  subscribe: (listener: (value: T) => void) => () => void
): void {
  responses.add(response);
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
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    responses.delete(response);
  };
  request.once("close", close);
  response.once("close", close);
}

function sseOptional<T>(
  response: ServerResponse,
  request: IncomingMessage,
  responses: Set<ServerResponse>,
  event: string,
  initial: T | null,
  subscribe: (listener: (value: T) => void) => () => void
): void {
  responses.add(response);
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
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    writer.close();
    unsubscribe();
    responses.delete(response);
  };
  request.once("close", close);
  response.once("close", close);
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
  return authorizeEngineToken(expectedToken, providedToken);
}

export function authorizeEngineToken(
  expectedToken: string,
  providedToken: string | string[] | undefined
): boolean {
  if (!expectedToken || typeof providedToken !== "string") return false;
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.byteLength === provided.byteLength && timingSafeEqual(expected, provided);
}
