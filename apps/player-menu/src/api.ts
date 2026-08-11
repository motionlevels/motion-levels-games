import type { EngineGame, EngineStatus, PlatformGameCatalogEntry } from "./contracts";

export type { EngineGame, EngineStatus, PlatformGameCatalogEntry };

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

export type SelectGameRequest = {
  game: string;
  engineGame?: string;
  gameLabel?: string;
  sourceKind?: string;
  sourceRevision?: string;
  platformUrl?: string;
  venueSessionId?: string;
  recordingEnabled?: boolean;
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

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const localPortPattern = /^\d{2,5}$/u;

function integratedExperienceMode(): boolean {
  return import.meta.env?.DEV === true || import.meta.env?.VITE_HOSTED_PLAYER_EXPERIENCE === "true";
}

function embeddedInPlayground(menuLocation: Location | undefined, integratedExperience: boolean): boolean {
  if (!integratedExperience || !menuLocation) return false;
  const params = new URLSearchParams(menuLocation.search || "");
  return params.get("embed") === "playground";
}

function embeddedPlaygroundURL(menuLocation: Location): URL {
  const playgroundPath = (menuLocation.pathname || "/player-menu/").replace(/player-menu\/?$/u, "");
  return new URL(playgroundPath || "/", menuLocation.origin);
}

function configuredLocalPlaygroundPort(): string | undefined {
  return import.meta.env?.DEV ? import.meta.env.VITE_LOCAL_PLAYGROUND_PORT : undefined;
}

export function localPlaygroundEnabled(
  playgroundPort: string | undefined = undefined,
  menuLocation = typeof window === "undefined" ? undefined : window.location,
  integratedExperience = integratedExperienceMode(),
): boolean {
  const embedded = embeddedInPlayground(menuLocation, integratedExperience);
  const resolvedPort = playgroundPort ?? configuredLocalPlaygroundPort();
  return Boolean(
    menuLocation
    && (embedded || (loopbackHosts.has(menuLocation.hostname) && resolvedPort && localPortPattern.test(resolvedPort))),
  );
}

export function localPlaygroundLaunchURL(
  request: SelectGameRequest,
  playgroundPort: string | undefined = undefined,
  menuLocation = typeof window === "undefined" ? undefined : window.location,
  integratedExperience = integratedExperienceMode(),
): string | undefined {
  const embedded = embeddedInPlayground(menuLocation, integratedExperience);
  const resolvedPort = playgroundPort ?? configuredLocalPlaygroundPort();
  if (!localPlaygroundEnabled(resolvedPort, menuLocation, integratedExperience) || !menuLocation) {
    return undefined;
  }
  const runtimeID = request.engineGame?.startsWith("motion-levels-games:")
    ? request.engineGame.slice("motion-levels-games:".length)
    : request.game.startsWith("motion-levels-games:")
      ? request.game.slice("motion-levels-games:".length)
      : request.game;
  const target = embedded
    ? embeddedPlaygroundURL(menuLocation)
    : new URL(`http://${menuLocation.hostname}:${resolvedPort}/`);
  target.searchParams.set("journey", "1");
  target.searchParams.set("game", runtimeID);
  target.searchParams.set("players", String(request.playerCount));
  if (request.difficulty) target.searchParams.set("difficulty", request.difficulty);
  if (request.config && Object.keys(request.config).length > 0) {
    target.searchParams.set("options", JSON.stringify(request.config));
  }
  const returnTarget = embedded
    ? embeddedPlaygroundURL(menuLocation)
    : new URL(`${menuLocation.protocol}//${menuLocation.host}/`);
  if (embedded) returnTarget.searchParams.set("screen", "menu");
  target.searchParams.set("return", returnTarget.toString());
  return target.toString();
}

export function launchLocalPlayground(request: SelectGameRequest): boolean {
  const target = localPlaygroundLaunchURL(request);
  if (!target || typeof window === "undefined") return false;
  if (window.self !== window.top) {
    window.open(target, "_top");
    return true;
  }
  window.location.assign(target);
  return true;
}

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
  if (window.location.pathname.startsWith("/menu") || window.location.pathname.startsWith("/display")) {
    return `${window.location.origin}/engine`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${enginePort}`;
}

export function engineBaseURL(): string {
  return import.meta.env.VITE_GAME_ENGINE_URL || inferEngineURL();
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
  return import.meta.env.VITE_PLATFORM_URL || inferPlatformURL();
}

export async function fetchEngineStatus(): Promise<EngineStatus> {
  if (localPlaygroundEnabled()) {
    const { localPlayerExperienceCatalog } = await import("./localCatalog");
    const catalog = localPlayerExperienceCatalog().map((game): EngineGame => ({
      game: game.engine_game,
      label: game.label,
      description: game.description,
      music: "",
      players: game.allow_any_players !== true,
      minPlayers: game.min_players,
      maxPlayers: game.max_players,
      difficulty: (game.difficulties?.length ?? 0) > 1,
      volume: 0,
    }));
    return localIdleEngineStatus(catalog);
  }
  return requestJSON<EngineStatus>(`${engineBaseURL()}/api/status`, { cache: "no-store" }, statusTimeoutMillis);
}

function localIdleEngineStatus(catalog: EngineGame[]): EngineStatus {
  return {
    currentGame: "salvapantallas",
    venueSessionId: "",
    label: "Playground local",
    difficulty: "medium",
    teamName: "",
    playerCount: 0,
    score: 0,
    lives: -1,
    music: "",
    musicVolume: 0,
    audioEnabled: false,
    audioMuted: true,
    paused: false,
    phase: "idle",
    success: false,
    introRemainingMillis: 0,
    countdownRemainingMillis: 0,
    startedUnix: 0,
    elapsedMillis: 0,
    sessionId: "",
    lastPressureUnix: Math.floor(Date.now() / 1000),
    catalog,
  };
}

export async function fetchGameCatalog(): Promise<PlatformGameCatalogEntry[]> {
  if (localPlaygroundEnabled()) {
    const { localPlayerExperienceCatalog } = await import("./localCatalog");
    return localPlayerExperienceCatalog();
  }
  const baseURL = platformBaseURL();
  if (!baseURL) return [];
  const payload = await requestJSON<{ games?: PlatformGameCatalogEntry[] }>(`${baseURL}/api/game-catalog`, { cache: "no-store" });
  return Array.isArray(payload.games) ? payload.games : [];
}

export async function selectGame(request: SelectGameRequest): Promise<EngineStatus> {
  return requestJSON<EngineStatus>(`${engineBaseURL()}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, commandTimeoutMillis);
}

export type ControlGameAction = "pause" | "resume" | "restart" | "exit" | "narration" | "mute" | "unmute" | "toggle_mute";

export async function controlGame(action: ControlGameAction): Promise<EngineStatus> {
  return requestJSON<EngineStatus>(`${engineBaseURL()}/api/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  }, commandTimeoutMillis);
}

export type VenueSessionRequest = {
  action: "start" | "end";
  venueSessionId: string;
  teamName?: string;
  recordingEnabled?: boolean;
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
  kioskId: string;
  version: number;
  updatedUnixMillis: number;
  snapshot: TSnapshot | null;
};

let pendingMenuStateWrite: { kioskId: string; snapshot: unknown } | null = null;
let menuStateWriteInFlight = false;
let menuStateRetryDelayMillis = 500;

// Visit recording is best-effort: the kiosk must never block or surface errors
// because the engine is briefly unreachable, so these are fire-and-forget.
export function postVenueSession(request: VenueSessionRequest) {
  if (localPlaygroundEnabled()) return;
  postBestEffort(`${engineBaseURL()}/api/venue-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    keepalive: true,
  });
}

export function postMenuEvent(request: MenuEventRequest) {
  if (localPlaygroundEnabled()) return;
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

export function postMenuState<TSnapshot>(request: { kioskId: string; snapshot: TSnapshot }) {
  if (localPlaygroundEnabled()) return;
  pendingMenuStateWrite = request;
  if (menuStateWriteInFlight) return;
  void flushMenuStateWrites();
}

async function flushMenuStateWrites() {
  menuStateWriteInFlight = true;
  try {
    while (pendingMenuStateWrite) {
      const request = pendingMenuStateWrite;
      pendingMenuStateWrite = null;
      try {
        await requestJSON<MenuStateEnvelope>(`${engineBaseURL()}/api/menu-state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }, mirrorTimeoutMillis);
        menuStateRetryDelayMillis = 500;
      } catch {
        // Keep the latest snapshot queued across a transient outage. If a newer
        // snapshot arrived while this request was running, it supersedes the
        // failed one and will be the payload retried after the backoff.
        if (!pendingMenuStateWrite) pendingMenuStateWrite = request;
        await new Promise((resolve) => globalThis.setTimeout(resolve, menuStateRetryDelayMillis));
        menuStateRetryDelayMillis = Math.min(5_000, menuStateRetryDelayMillis * 2);
      }
    }
  } finally {
    menuStateWriteInFlight = false;
    if (pendingMenuStateWrite) void flushMenuStateWrites();
  }
}
