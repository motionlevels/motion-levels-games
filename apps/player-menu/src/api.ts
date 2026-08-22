import type { EngineGame, EngineStatus, PlatformGameCatalogEntry, RecordingPolicy, RecordingScope } from "./contracts";
import { newPlayerExperienceCommandId } from "@motion-levels-games/player-experience";

export type { EngineGame, EngineStatus, PlatformGameCatalogEntry, RecordingPolicy, RecordingScope };

export type RequestFailureKind = "network" | "response" | "timeout";

export class RequestError extends Error {
  readonly kind: RequestFailureKind;
  readonly status?: number;

  constructor(kind: RequestFailureKind, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RequestError";
    this.kind = kind;
    this.status = options.status;
  }
}

const statusTimeoutMillis = 3_000;
const mirrorTimeoutMillis = 2_500;
const readTimeoutMillis = 8_000;
const commandTimeoutMillis = 12_000;

export async function requestJSON<T>(url: string, init: RequestInit = {}, timeoutMillis = readTimeoutMillis): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMillis));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim();
      throw new RequestError("response", detail || `HTTP ${response.status}`, { status: response.status });
    }
    try {
      return await response.json() as T;
    } catch (cause) {
      throw new RequestError("response", "La respuesta del sistema no es válida", { cause, status: response.status });
    }
  } catch (cause) {
    if (cause instanceof RequestError) throw cause;
    if (controller.signal.aborted) {
      throw new RequestError("timeout", "La solicitud ha superado el tiempo de espera", { cause });
    }
    throw new RequestError("network", "No se pudo conectar con el sistema", { cause });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function friendlyRequestError(error: unknown, fallback: string): string {
  if (!(error instanceof RequestError)) return fallback;
  if (error.kind === "timeout") return "El sistema está tardando más de lo esperado. Inténtalo de nuevo.";
  if (error.kind === "network") return "Sin conexión con el motor. Comprueba la conexión e inténtalo de nuevo.";
  return fallback;
}

export type AnimationPreview = {
  level: string;
  frames: Array<{ pixels: string }>;
};

export type SelectGameRequest = {
  commandId?: string;
  game: string;
  engineGame?: string;
  gameLabel?: string;
  sourceKind?: string;
  sourceRevision?: string;
  venueSessionId?: string;
  recordingEnabled?: boolean;
  recordingPolicy?: RecordingPolicy;
  playerCount: number;
  allowAnyPlayers?: boolean;
  difficulty?: string;
  level?: string;
  levelSlug?: string;
  levelMode?: "challenge" | "free";
  durationSeconds?: number;
  challengeElapsedMillis?: number;
  challengeAttemptCount?: number;
  narrationEnabled?: boolean;
  countdownFloorOverlay?: boolean;
  teamName?: string;
  config?: Record<string, number | boolean | string>;
  players?: Array<{
    index: number;
    label: string;
    color: { r: number; g: number; b: number };
  }>;
};

const enginePort = "4102";
const localEngineURL = `http://127.0.0.1:${enginePort}`;
const publicPlatformHost = "platform.motionlevels.obis.dev";
export const publicPlatformURL = `https://${publicPlatformHost}`;

function inferEngineURL(): string {
  if (typeof window === "undefined" || !window.location.hostname || window.location.protocol === "file:") {
    return localEngineURL;
  }
  const gatewayMatch = window.location.pathname.match(/^\/gateways\/[^/]+\/menu(?:\/|$)/);
  if (gatewayMatch) {
    return `${window.location.origin}${gatewayMatch[0].replace(/\/menu\/?$/, "/engine")}`;
  }
  if (window.location.pathname.startsWith("/menu") || window.location.pathname.startsWith("/display") || window.location.pathname.startsWith("/player-menu")) {
    return `${window.location.origin}/engine`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${enginePort}`;
}

export function engineBaseURL(): string {
  return import.meta.env?.VITE_GAME_ENGINE_URL || inferEngineURL();
}

export function inferPlatformURL(location: Pick<Location, "hostname" | "origin" | "pathname" | "protocol"> = window.location): string {
  if (!location.origin || location.protocol === "file:") {
    return "";
  }
  if (location.pathname.startsWith("/gateways/")) {
    return location.origin;
  }
  const hostname = location.hostname.toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isPlatformHost = hostname === publicPlatformHost;
  if (isLocalHost || isPlatformHost) {
    return location.origin;
  }
  return publicPlatformURL;
}

export function platformBaseURL(): string {
  return import.meta.env?.VITE_PLATFORM_URL || inferPlatformURL();
}

export async function fetchEngineStatus(): Promise<EngineStatus> {
  return requestJSON<EngineStatus>(`${engineBaseURL()}/api/player-state`, { cache: "no-store" }, statusTimeoutMillis);
}

export function playerExperienceEventSource(): EventSource {
  return new EventSource(`${engineBaseURL()}/api/player-state/events`);
}

export async function fetchGameCatalog(): Promise<PlatformGameCatalogEntry[]> {
  const baseURL = platformBaseURL();
  if (!baseURL) return [];
  try {
    const payload = await requestJSON<{ games?: PlatformGameCatalogEntry[] }>(`${baseURL}/api/game-catalog`, { cache: "no-store" });
    return Array.isArray(payload.games) ? payload.games : [];
  } catch {
    // Keep the caller's bundled fallback active when the cloud catalog is
    // unavailable. Returning the complete local catalog here makes the
    // result look like a successful platform response and can replace the
    // curated offline selection (including published animation cards) with
    // alphabetically featured metadata.
    throw new Error("game catalog unavailable");
  }
}

export async function fetchAnimationPreview(level: string, frames = 16, revision?: string): Promise<AnimationPreview> {
  const params = new URLSearchParams({ level, frames: String(frames) });
  if (revision) params.set("revision", revision);
  return requestJSON<AnimationPreview>(`${engineBaseURL()}/api/animation-preview?${params.toString()}`);
}

// One menu is the sole command writer. Keep a single ordered transport queue
// so launch/control requests cannot overtake one another after double taps,
// reconnects, or a slow engine response.
let playerCommandTail: Promise<void> = Promise.resolve();
let venueSessionCommandTail: Promise<void> = Promise.resolve();

function enqueuePlayerCommand<T>(command: () => Promise<T>): Promise<T> {
  const result = playerCommandTail.then(command, command);
  playerCommandTail = result.then(() => undefined, () => undefined);
  return result;
}

function enqueueVenueSessionCommand<T>(command: () => Promise<T>): Promise<T> {
  const result = venueSessionCommandTail.then(command, command);
  venueSessionCommandTail = result.then(() => undefined, () => undefined);
  return result;
}

async function requestPlayerCommand(url: string, body: unknown): Promise<EngineStatus> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  try {
    return await requestJSON<EngineStatus>(url, init, commandTimeoutMillis);
  } catch (error) {
    if (!(error instanceof RequestError) || error.kind === "response") throw error;
    // The first response may have been lost after the engine committed. The
    // same commandId makes this retry a read of the committed result.
    return requestJSON<EngineStatus>(url, init, commandTimeoutMillis);
  }
}

export async function selectGame(request: SelectGameRequest): Promise<EngineStatus> {
  const commandId = request.commandId || newPlayerExperienceCommandId(globalThis.crypto);
  return enqueuePlayerCommand(() => requestPlayerCommand(`${engineBaseURL()}/api/select`, { ...request, commandId }));
}

export type OutputTestTarget = "floor" | "audio";
export type ControlGameAction =
  | "pause"
  | "resume"
  | "restart"
  | "exit"
  | "narration"
  | "stop_narration"
  | "mute"
  | "unmute"
  | "toggle_mute"
  | "recording_retry"
  | "recording_continue_without"
  | "recording_cancel";

export type ControlGameOptions = {
  recordingGateId?: string;
};

export async function controlGame(action: ControlGameAction, options: ControlGameOptions = {}): Promise<EngineStatus> {
  const recordingAction = action === "recording_retry"
    || action === "recording_continue_without"
    || action === "recording_cancel";
  const recordingGateId = options.recordingGateId?.trim() || "";
  if (recordingAction && !recordingGateId) {
    throw new TypeError("recordingGateId is required for recording gate actions");
  }
  const commandId = newPlayerExperienceCommandId(globalThis.crypto);
  return enqueuePlayerCommand(() => requestPlayerCommand(`${engineBaseURL()}/api/control`, {
    action,
    commandId,
    ...(recordingGateId ? { recordingGateId } : {}),
  }));
}

export async function testOutput(target: OutputTestTarget): Promise<EngineStatus> {
  const commandId = newPlayerExperienceCommandId(globalThis.crypto);
  return enqueuePlayerCommand(() => requestPlayerCommand(`${engineBaseURL()}/api/output-test`, { commandId, target }));
}

export type VenueSessionRequest = {
  action: "start" | "end";
  venueSessionId: string;
  teamName?: string;
  recordingEnabled?: boolean;
  recordingPolicy?: RecordingPolicy;
  kioskId?: string;
  reason?: string;
};

export type MenuEventRequest = {
  venueSessionId: string;
  name: string;
  kioskId?: string;
  occurredAtUnixMillis?: number;
  properties?: Record<string, unknown>;
};

export type MenuStateEnvelope<TSnapshot = unknown> = {
  activeClients: number;
  kioskId: string;
  version: number;
  updatedUnixMillis: number;
  snapshot: TSnapshot | null;
};

type MenuStateWrite<TSnapshot = unknown> = {
  changedFields: Array<"menu" | "screen" | "view">;
  kioskId: string;
  expectedVersion: number;
  snapshot: TSnapshot;
};

type MenuStateWriteObserver<TSnapshot = unknown> = {
  onAccepted?: (envelope: MenuStateEnvelope<TSnapshot>) => void;
  onConflict?: () => void;
};

type PendingMenuStateWrite = {
  request: MenuStateWrite;
  onAccepted?: (envelope: MenuStateEnvelope) => void;
  onConflict?: () => void;
};

let pendingMenuStateWrite: PendingMenuStateWrite | null = null;
let menuStateWriteInFlight = false;
let menuStateRetryDelayMillis = 500;

// Venue session lifecycle is canonical runtime state. Keep every mutation in
// one FIFO so a recording-policy update cannot overtake a close/recovery (or a
// later policy update) when the engine is slow.
export async function postVenueSession(request: VenueSessionRequest): Promise<EngineStatus | null> {
  return enqueueVenueSessionCommand(() => requestJSON<EngineStatus>(`${engineBaseURL()}/api/venue-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    keepalive: true,
  }, mirrorTimeoutMillis));
}

export function postMenuEvent(request: MenuEventRequest) {
  postBestEffort(`${engineBaseURL()}/api/menu-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    keepalive: true,
  });
}

function postBestEffort(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), mirrorTimeoutMillis);
  void fetch(url, { ...init, signal: controller.signal })
    .catch(() => {})
    .finally(() => globalThis.clearTimeout(timeout));
}

export async function fetchMenuState<TSnapshot = unknown>(): Promise<MenuStateEnvelope<TSnapshot>> {
  return requestJSON<MenuStateEnvelope<TSnapshot>>(`${engineBaseURL()}/api/menu-state`, { cache: "no-store" }, mirrorTimeoutMillis);
}

export function menuStateEventSource(): EventSource {
  return new EventSource(`${engineBaseURL()}/api/menu-state/events`);
}

export function postMenuState<TSnapshot>(request: MenuStateWrite<TSnapshot>, observer: MenuStateWriteObserver<TSnapshot> = {}) {
  pendingMenuStateWrite = {
    request,
    onAccepted: observer.onAccepted
      ? (envelope) => observer.onAccepted?.(envelope as MenuStateEnvelope<TSnapshot>)
      : undefined,
    onConflict: observer.onConflict,
  };
  if (menuStateWriteInFlight) return;
  void flushMenuStateWrites();
}

async function flushMenuStateWrites() {
  menuStateWriteInFlight = true;
  try {
    while (pendingMenuStateWrite) {
      const pending = pendingMenuStateWrite;
      pendingMenuStateWrite = null;
      try {
        const envelope = await requestJSON<MenuStateEnvelope>(`${engineBaseURL()}/api/menu-state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.request),
        }, mirrorTimeoutMillis);
        pending.onAccepted?.(envelope);
        advancePendingMenuStateVersion(pending.request.expectedVersion, envelope.version);
        menuStateRetryDelayMillis = 500;
      } catch (error) {
        if (error instanceof RequestError && error.status === 409) {
          pendingMenuStateWrite = null;
          pending.onConflict?.();
          menuStateRetryDelayMillis = 500;
          continue;
        }
        // Keep the latest snapshot queued across a transient outage. If a newer
        // snapshot arrived while this request was running, it supersedes the
        // failed one and will be the payload retried after the backoff.
        if (!pendingMenuStateWrite) pendingMenuStateWrite = pending;
        await new Promise((resolve) => globalThis.setTimeout(resolve, menuStateRetryDelayMillis));
        menuStateRetryDelayMillis = Math.min(5_000, menuStateRetryDelayMillis * 2);
      }
    }
  } finally {
    menuStateWriteInFlight = false;
    if (pendingMenuStateWrite) void flushMenuStateWrites();
  }
}

function advancePendingMenuStateVersion(expectedVersion: number, acceptedVersion: number) {
  if (pendingMenuStateWrite?.request.expectedVersion === expectedVersion) {
    pendingMenuStateWrite.request.expectedVersion = acceptedVersion;
  }
}
