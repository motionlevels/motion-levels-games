import { randomUUID } from "node:crypto";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  type Frame,
  type GameContent,
  type GameManifest
} from "@motion-levels-games/game-sdk";
import {
  controlsForState,
  lifecycleFromRuntime,
  playerExperienceContractVersion,
  type PlayerExperienceGameSummary,
  type PlayerExperienceState
} from "@motion-levels-games/player-experience";
import { GameSession, gameCatalog, gameplayRegistry, type GameSessionState } from "@motion-levels-games/runtime";
import { ControllerClient, type PressureInput } from "./controllerClient.ts";
import {
  floorRgbBytes,
  type AdapterStatus,
  type ControllerHello,
  type PresentedFrame
} from "./controllerProtocol.ts";
import { createLiveFloorPublisher, encodeLiveViewerFrame, type LiveFloorPublisher } from "./liveFloorPublisher.ts";

export type SelectGameRequest = {
  commandId?: string;
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
  levelMode?: string;
  durationSeconds?: number;
  challengeElapsedMillis?: number;
  challengeAttemptCount?: number;
  narrationEnabled?: boolean;
  countdownFloorOverlay?: boolean;
  teamName?: string;
  config?: Record<string, unknown>;
  players?: Array<{ index: number; label: string; color: { r: number; g: number; b: number } }>;
};

export type MenuStateEnvelope = {
  kioskId: string;
  version: number;
  updatedUnixMillis: number;
  snapshot: unknown;
};

export type VenueRuntimeStatus = PlayerExperienceState & {
  pressureStreamConnected: boolean;
  roomControllerId: string;
  controllerId: string;
  floorAdapter: FloorAdapterStatus;
  remoteFloorInput: RemoteFloorInputStatus;
};

export type VenueRuntimeOptions = {
  sourceRevision: string;
  controllerAddress: string;
  platformUrl?: string;
  platformToken?: string;
  controllerId?: string;
  liveFloorFps?: number;
  liveFloorTimeoutMillis?: number;
  localLiveFloorFps?: number;
  remoteFloorInputLeaseMillis?: number;
  remoteFloorInputTombstoneMillis?: number;
  screensaverRefreshMillis?: number;
  brightness?: number;
  log?(message: string, error?: unknown): void;
};

export type ObservedFloorFrame = {
  sequence: number;
  width: number;
  height: number;
  presentedUnixNanos: number;
  frameBase64: string;
};

export type RemoteFloorInputChange = {
  x: number;
  y: number;
  pressed: boolean;
};

export type RemoteFloorInputRequest = {
  commandId: string;
  clientId: string;
  clientSequence: number;
  changes?: RemoteFloorInputChange[];
  releaseAll?: boolean;
};

export type RemoteFloorInputResult = VenueRuntimeStatus & {
  applied: boolean;
  lastSequence: number;
};

export type RemoteFloorInputStatus = {
  activeClients: number;
  heldTiles: number;
  leaseMillis: number;
  trackedClients: number;
};

type FloorAdapterStatus = {
  connected: boolean;
  protocol: "v2";
  revision: string;
  width: number;
  height: number;
  targetFps: number;
  actualFps: number;
  desiredFrameAgeMillis: number;
  presentedFrames: number;
  udpErrorCount: number;
  lastStatusUnixNanos: number;
  lastPresentedSequence: number;
  lastPresentedUnixNanos: number;
  fadeRatio: number;
};

type ObservedFloorSubscription = {
  listener: (frame: ObservedFloorFrame) => void;
  lastSequence: number | null;
};

type RemoteFloorInputClient = {
  held: Set<string>;
  leaseTimer: NodeJS.Timeout | null;
};

type RemoteFloorInputSequence = {
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  lastSequence: number;
};

type NormalizedRemoteFloorInputRequest = {
  clientId: string;
  clientSequence: number;
  changes: RemoteFloorInputChange[];
  releaseAll: boolean;
};

type SelectionMetadata = {
  manifest: GameManifest;
  runtimeGameId: string;
  engineGame: string;
  sourceKind: "motion_levels_games" | "platform_levels";
  difficulty: string;
  teamName: string;
  level: string;
  levelSlug: string;
  levelMode: string;
  venueSessionId: string;
  challengeElapsedMillis: number;
  challengeAttemptCount: number;
  contentRevision: string;
};

const screensaverGameId = "salvapantallas";
const screensaverContentSchema = "motion-levels-animation-content-v1";
const defaultScreensaverRefreshMillis = 60_000;
const maximumScreensaverContentBytes = 1_048_576;
const defaultLocalLiveFloorFps = 20;
const minimumLocalLiveFloorFps = 5;
const maximumLocalLiveFloorFps = 25;
const defaultRemoteFloorInputLeaseMillis = 5_000;
const minimumRemoteFloorInputLeaseMillis = 100;
const maximumRemoteFloorInputLeaseMillis = 30_000;
const defaultRemoteFloorInputTombstoneMillis = 5 * 60_000;
const minimumRemoteFloorInputTombstoneMillis = 100;
const maximumRemoteFloorInputTombstoneMillis = 15 * 60_000;
const maximumTrackedRemoteFloorInputClients = 1_024;
const maximumRemoteFloorInputChanges = FLOOR_COLS * FLOOR_ROWS;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class RevisionMismatchError extends Error {}
export class RequestValidationError extends Error {}

export class VenueRuntime {
  private readonly session = new GameSession();
  private readonly controller: ControllerClient;
  private readonly liveFloorPublisher: LiveFloorPublisher | null;
  private readonly localLiveFloorFps: number;
  private readonly remoteFloorInputLeaseMillis: number;
  private readonly remoteFloorInputTombstoneMillis: number;
  private readonly liveFloorListeners = new Set<ObservedFloorSubscription>();
  private readonly displayListeners = new Set<(display: Record<string, unknown>) => void>();
  private readonly statusListeners = new Set<(status: VenueRuntimeStatus) => void>();
  private readonly menuListeners = new Set<(state: MenuStateEnvelope) => void>();
  private readonly runId = randomUUID();
  private stateRevision = 1;
  private state!: GameSessionState;
  private selection: SelectionMetadata | null = null;
  private gameStartedAt = performance.now();
  private pauseStartedAt = 0;
  private sessionStartedUnix = 0;
  private gameSessionId = "";
  private frameSequence = 0n;
  private lastDisplayPublishedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private screensaverRefreshTimer: NodeJS.Timeout | null = null;
  private screensaverContent: GameContent | undefined;
  private screensaverContentRevision = "builtin";
  private screensaverRefreshInFlight: Promise<boolean> | null = null;
  private lastPressureUnix = 0;
  private controllerConnected = false;
  private adapterRevision = "";
  private latestObservedFloor: ObservedFloorFrame | null = null;
  private localLiveFloorPending = false;
  private localLiveFloorLastPublishedAt = 0;
  private localLiveFloorTimer: NodeJS.Timeout | null = null;
  private floorAdapter: FloorAdapterStatus = emptyFloorAdapter();
  private readonly physicalPressure = new Set<string>();
  private readonly remotePressureClients = new Map<string, RemoteFloorInputClient>();
  private readonly remotePressureCounts = new Map<string, number>();
  private readonly remoteFloorInputSequences = new Map<string, RemoteFloorInputSequence>();
  private readonly heldPressure = new Set<string>();
  private menuState: MenuStateEnvelope = { kioskId: "", version: 0, updatedUnixMillis: 0, snapshot: null };
  private displayClientReport: Record<string, unknown> | null = null;
  private displayClientReceivedUnixMillis = 0;

  constructor(private readonly options: VenueRuntimeOptions) {
    if (!/^[0-9a-f]{40}$/u.test(options.sourceRevision)) throw new Error("source revision must be a 40-character git hash");
    this.localLiveFloorFps = normalizeLocalLiveFloorFps(options.localLiveFloorFps);
    this.remoteFloorInputLeaseMillis = normalizeRemoteFloorInputLeaseMillis(options.remoteFloorInputLeaseMillis);
    this.remoteFloorInputTombstoneMillis = normalizeRemoteFloorInputTombstoneMillis(options.remoteFloorInputTombstoneMillis);
    this.liveFloorPublisher = createLiveFloorPublisher({
      platformUrl: options.platformUrl,
      platformToken: options.platformToken,
      controllerId: options.controllerId,
      fps: options.liveFloorFps,
      timeoutMillis: options.liveFloorTimeoutMillis,
      log: options.log
    });
    this.controller = new ControllerClient({
      address: options.controllerAddress,
      sourceRevision: options.sourceRevision,
      onPressure: (input) => this.applyPressure(input),
      onPresentedFrame: (frame) => this.observePresentedFrame(frame),
      onAdapterStatus: (status) => this.observeAdapterStatus(status),
      onConnectionChange: (connected, revision, hello) => {
        this.controllerConnected = connected;
        this.adapterRevision = revision;
        this.floorAdapter = connected && hello
          ? connectedFloorAdapter(revision, hello)
          : { ...this.floorAdapter, connected: false };
      },
      log: options.log
    });
    this.activateScreensaver();
  }

  start(): void {
    if (this.timer) return;
    this.controller.start();
    this.timer = setInterval(() => this.tick(performance.now()), 20);
    if (this.options.platformUrl) {
      void this.refreshScreensaverContent();
      const refreshMillis = normalizeScreensaverRefreshMillis(this.options.screensaverRefreshMillis);
      if (refreshMillis > 0) {
        this.screensaverRefreshTimer = setInterval(() => void this.refreshScreensaverContent(), refreshMillis);
        this.screensaverRefreshTimer.unref();
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.screensaverRefreshTimer) clearInterval(this.screensaverRefreshTimer);
    this.screensaverRefreshTimer = null;
    if (this.localLiveFloorTimer) clearTimeout(this.localLiveFloorTimer);
    this.localLiveFloorTimer = null;
    this.localLiveFloorPending = false;
    for (const clientId of [...this.remotePressureClients.keys()]) this.releaseRemoteFloorInputClient(clientId);
    this.controller.stop();
  }

  async select(request: SelectGameRequest): Promise<VenueRuntimeStatus> {
    if (request.sourceRevision !== this.options.sourceRevision) {
      throw new RevisionMismatchError("motion-levels-games revision mismatch");
    }
    const gameId = runtimeGameId(request);
    const module = gameplayRegistry.get(gameId.toLowerCase());
    if (!module || !module.manifest.availability.production) {
      throw new RequestValidationError(`production TypeScript game is unavailable: ${gameId}`);
    }
    const publishedLevels = module.manifest.tags?.includes("published-levels") === true;
    if (request.sourceKind !== "motion_levels_games" && !(request.sourceKind === "platform_levels" && publishedLevels)) {
      throw new RequestValidationError(`unsupported game source: ${request.sourceKind ?? ""}`);
    }
    if (request.allowAnyPlayers !== undefined && request.allowAnyPlayers !== module.manifest.players.allowAny) {
      throw new RequestValidationError("player mode does not match the bundled game manifest");
    }
    const minimumPlayers = module.manifest.players.allowAny ? 0 : module.manifest.players.min;
    const playerCount = boundedInteger(request.playerCount, minimumPlayers, module.manifest.players.max, "playerCount");
    const players = normalizePlayers(request.players ?? [], playerCount, module.manifest.players.allowAny);
    const durationSeconds = Number(request.durationSeconds);
    const durationMillis = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds * 1_000 : undefined;
    if (module === gameplayRegistry.get(screensaverGameId) && isScreensaverRequest(request)) {
      const screensaverOptions: Record<string, unknown> = { mode: "rotation", ...(request.config ?? {}) };
      if (screensaverOptions.rotationSeconds === undefined && durationMillis !== undefined) {
        screensaverOptions.rotationSeconds = Math.max(5, Math.min(3600, Math.round(durationSeconds)));
      }
      await this.refreshScreensaverContent(durationMillis === undefined ? undefined : Math.round(durationSeconds));
      this.activateScreensaver(screensaverOptions);
      this.publishDisplay();
      return this.status();
    }
    const contentResult = request.sourceKind === "platform_levels"
      ? await this.fetchRuntimeContent(request)
      : null;
    const now = performance.now();
    this.state = this.session.select({
      gameId: module.manifest.id,
      playerCount,
      players,
      difficulty: request.difficulty,
      ...(durationMillis === undefined ? {} : { durationMillis }),
      options: request.config ?? {},
      ...(contentResult ? { content: contentResult.content } : {})
    });
    this.selection = {
      manifest: module.manifest,
      runtimeGameId: cleanText(request.game, 256),
      engineGame: cleanText(request.engineGame, 256) || `motion-levels-games:${module.manifest.id}`,
      sourceKind: request.sourceKind,
      difficulty: String(request.difficulty || module.manifest.config?.difficulty?.default || "medium"),
      teamName: cleanText(request.teamName, 256),
      level: cleanText(request.level, 256),
      levelSlug: cleanText(request.levelSlug, 256),
      levelMode: cleanText(request.levelMode, 32),
      venueSessionId: cleanText(request.venueSessionId, 256),
      challengeElapsedMillis: nonNegative(request.challengeElapsedMillis),
      challengeAttemptCount: nonNegativeInteger(request.challengeAttemptCount),
      contentRevision: contentResult?.contentRevision ?? ""
    };
    this.gameStartedAt = now;
    this.pauseStartedAt = 0;
    this.sessionStartedUnix = Math.floor(Date.now() / 1_000);
    this.gameSessionId = randomUUID();
    this.applyHeldPressure(0);
    this.publishDisplay();
    return this.status();
  }

  control(actionValue: unknown): VenueRuntimeStatus {
    const action = String(actionValue ?? "");
    const now = performance.now();
    if (action === "exit") {
      this.activateScreensaver();
      this.publishDisplay();
      return this.status();
    }
    if (!this.selection) throw new RequestValidationError("no active game");
    if (action === "pause") {
      if (!this.state.paused) this.pauseStartedAt = now;
      this.state = this.session.pause(this.elapsedAt(now));
    } else if (action === "resume") {
      if (this.state.paused && this.pauseStartedAt > 0) this.gameStartedAt += now - this.pauseStartedAt;
      this.pauseStartedAt = 0;
      this.state = this.session.resume();
      this.applyHeldPressure(this.state.clockMillis);
    } else if (action === "restart") {
      this.state = this.session.restart(0);
      this.gameStartedAt = now;
      this.pauseStartedAt = 0;
      this.sessionStartedUnix = Math.floor(Date.now() / 1_000);
      this.gameSessionId = randomUUID();
      this.applyHeldPressure(0);
    } else if (action === "narration" || action === "mute" || action === "unmute" || action === "toggle_mute") {
      // Audio is intentionally unavailable until the venue provides a TS-owned adapter.
    } else {
      throw new RequestValidationError(`unknown control action: ${action}`);
    }
    this.publishDisplay();
    return this.status();
  }

  status(): VenueRuntimeStatus {
    const catalog = productionCatalog();
    if (!this.selection) {
      const snapshot = this.state.snapshot;
      const lastEvent = this.state.events.at(-1);
      const status: PlayerExperienceState = {
        contractVersion: playerExperienceContractVersion,
        revision: this.stateRevision,
        runId: this.runId,
        lifecycle: "idle",
        allowedControls: [],
        currentGame: screensaverGameId,
        engineGame: `motion-levels-games:${this.state.gameId}`,
        sourceKind: "motion_levels_games",
        sourceRevision: this.options.sourceRevision,
        venueSessionId: "",
        sessionId: "",
        label: "En espera",
        phase: "ambient",
        difficulty: "medium",
        difficultyConfigurable: false,
        teamName: "",
        playerCount: 0,
        playerConfigurable: false,
        players: [],
        score: 0,
        lives: -1,
        music: "",
        musicVolume: 0,
        audioEnabled: false,
        audioMuted: true,
        paused: false,
        success: false,
        introRemainingMillis: 0,
        countdownRemainingMillis: 0,
        startedUnix: 0,
        sessionStartedUnix: 0,
        endsUnix: 0,
        elapsedMillis: 0,
        remainingMillis: 0,
        activeTargets: snapshot.activeTargets,
        lastEventUnixNanos: lastEvent ? Date.now() * 1_000_000 : 0,
        lastEventCue: lastEvent?.cue ?? snapshot.lastEventCue,
        lastEventMessage: lastEvent?.message ?? snapshot.lastEventMessage,
        lastPressureUnix: this.lastPressureUnix,
        catalog
      };
      return {
        ...status,
        pressureStreamConnected: this.controllerConnected,
        roomControllerId: this.options.controllerId ?? "",
        controllerId: this.options.controllerId ?? "",
        floorAdapter: { ...this.floorAdapter },
        remoteFloorInput: this.remoteFloorInputStatus()
      };
    }
    const snapshot = this.state.snapshot;
    const lastEvent = this.state.events.at(-1);
    const status: PlayerExperienceState = {
      contractVersion: playerExperienceContractVersion,
      revision: this.stateRevision,
      runId: this.runId,
      lifecycle: "running",
      allowedControls: [],
      currentGame: this.selection.runtimeGameId,
      engineGame: this.selection.engineGame,
      sourceKind: this.selection.sourceKind,
      sourceRevision: this.options.sourceRevision,
      contentRevision: this.selection.contentRevision,
      venueSessionId: this.selection.venueSessionId,
      label: snapshot.label || this.selection.manifest.label,
      difficulty: this.selection.difficulty,
      difficultyConfigurable: (this.selection.manifest.config?.difficulty?.options?.length ?? 0) > 1,
      level: this.selection.level,
      levelSlug: this.selection.levelSlug,
      levelMode: this.selection.levelMode,
      teamName: this.selection.teamName,
      playerCount: snapshot.playerCount,
      playerConfigurable: !this.selection.manifest.players.allowAny,
      players: snapshot.players.map((player) => ({ ...player, color: hexToRgb(player.color) })),
      score: snapshot.score,
      lives: snapshot.lives,
      livesStart: snapshot.maxLives,
      music: "",
      musicVolume: 0,
      audioEnabled: false,
      audioMuted: true,
      paused: this.state.paused,
      phase: snapshot.phase,
      success: snapshot.success,
      introRemainingMillis: 0,
      countdownRemainingMillis: snapshot.countdownMillis ?? 0,
      startedUnix: this.sessionStartedUnix,
      sessionStartedUnix: this.sessionStartedUnix,
      endsUnix: snapshot.remainingMillis > 0 ? Math.floor(Date.now() / 1_000 + snapshot.remainingMillis / 1_000) : 0,
      sessionElapsedMillis: snapshot.elapsedMillis,
      sessionRemainingMillis: snapshot.remainingMillis,
      challengeElapsedMillis: this.selection.challengeElapsedMillis,
      challengeAttemptCount: this.selection.challengeAttemptCount,
      elapsedMillis: snapshot.elapsedMillis,
      remainingMillis: snapshot.remainingMillis,
      activeTargets: snapshot.activeTargets,
      lastEventUnixNanos: lastEvent ? Date.now() * 1_000_000 : 0,
      lastEventCue: lastEvent?.cue ?? snapshot.lastEventCue,
      lastEventMessage: lastEvent?.message ?? snapshot.lastEventMessage,
      sessionId: this.gameSessionId,
      lastPressureUnix: this.lastPressureUnix,
      catalog
    };
    status.lifecycle = lifecycleFromRuntime(status);
    status.allowedControls = controlsForState(status);
    return {
      ...status,
      pressureStreamConnected: this.controllerConnected,
      roomControllerId: this.options.controllerId ?? "",
      controllerId: this.options.controllerId ?? "",
      floorAdapter: { ...this.floorAdapter },
      remoteFloorInput: this.remoteFloorInputStatus()
    };
  }

  display(): Record<string, unknown> {
    const status = this.status();
    return {
      ...status,
      sourceKind: "motion_levels_games",
      gameSnapshot: this.state.snapshot,
      frame: this.state.frame
    };
  }

  health(): Record<string, unknown> {
    const liveFloor = this.liveFloorPublisher?.status() ?? { configured: false };
    return {
      status: "ok",
      sourceRevision: this.options.sourceRevision,
      controllerProtocolVersion: 2,
      controllerConnected: this.controllerConnected,
      roomControllerId: this.options.controllerId ?? "",
      adapterRevision: this.adapterRevision,
      floorAdapter: { ...this.floorAdapter },
      liveFloor: {
        ...liveFloor,
        localTargetFps: this.localLiveFloorFps,
        localSubscribers: this.liveFloorListeners.size
      },
      remoteFloorInput: this.remoteFloorInputStatus(),
      audioEnabled: false,
      displayClient: this.displayClientStatus()
    };
  }

  subscribeDisplay(listener: (display: Record<string, unknown>) => void): () => void {
    this.displayListeners.add(listener);
    return () => this.displayListeners.delete(listener);
  }

  subscribeStatus(listener: (status: VenueRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  observedFloor(): ObservedFloorFrame | null {
    return this.latestObservedFloor ? { ...this.latestObservedFloor } : null;
  }

  subscribeObservedFloor(listener: (frame: ObservedFloorFrame) => void): () => void {
    const wasEmpty = this.liveFloorListeners.size === 0;
    const subscription: ObservedFloorSubscription = { listener, lastSequence: null };
    this.liveFloorListeners.add(subscription);
    const current = this.observedFloor();
    if (current) {
      this.deliverObservedFloor(subscription, current);
      if (wasEmpty) this.localLiveFloorLastPublishedAt = Date.now();
    }
    return () => {
      this.liveFloorListeners.delete(subscription);
      if (this.liveFloorListeners.size > 0) return;
      if (this.localLiveFloorTimer) clearTimeout(this.localLiveFloorTimer);
      this.localLiveFloorTimer = null;
      this.localLiveFloorPending = false;
      this.localLiveFloorLastPublishedAt = 0;
    };
  }

  getMenuState(): MenuStateEnvelope { return structuredClone(this.menuState); }

  putMenuState(kioskId: unknown, snapshot: unknown): MenuStateEnvelope {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > 1_000_000) throw new RequestValidationError("snapshot is too large");
    this.menuState = {
      kioskId: cleanText(kioskId, 256),
      version: this.menuState.version + 1,
      updatedUnixMillis: Date.now(),
      snapshot: structuredClone(snapshot)
    };
    for (const listener of this.menuListeners) listener(this.getMenuState());
    return this.getMenuState();
  }

  subscribeMenuState(listener: (state: MenuStateEnvelope) => void): () => void {
    this.menuListeners.add(listener);
    return () => this.menuListeners.delete(listener);
  }

  updateVenueSession(request: Record<string, unknown>): Record<string, unknown> {
    const action = String(request.action ?? "");
    if (action !== "start" && action !== "end") throw new RequestValidationError("action must be start or end");
    const venueSessionId = cleanText(request.venueSessionId, 256);
    if (!venueSessionId) throw new RequestValidationError("venueSessionId is required");
    if (this.selection && (action === "start" || this.selection.venueSessionId === venueSessionId)) {
      this.selection.venueSessionId = action === "start" ? venueSessionId : "";
      this.selection.teamName = action === "start" ? cleanText(request.teamName, 256) : this.selection.teamName;
    }
    this.bestEffortCamera(action, request);
    return this.status();
  }

  recordMenuEvent(request: Record<string, unknown>): { ok: true } {
    if (!cleanText(request.venueSessionId, 256) || !cleanText(request.name, 160)) {
      throw new RequestValidationError("venueSessionId and name are required");
    }
    return { ok: true };
  }

  updateDisplayClient(report: Record<string, unknown>): Record<string, unknown> {
    if (report.clientId !== "player-display") throw new RequestValidationError("clientId must be player-display");
    this.displayClientReport = structuredClone(report);
    this.displayClientReceivedUnixMillis = Date.now();
    return this.displayClientStatus();
  }

  displayClientStatus(): Record<string, unknown> {
    const report = this.displayClientReport ?? {};
    const seen = this.displayClientReceivedUnixMillis > 0;
    const ageMillis = seen ? Math.max(0, Date.now() - this.displayClientReceivedUnixMillis) : 0;
    const currentGame = String(this.status().currentGame ?? "");
    const matchesCurrentGame = seen && report.currentGame === currentGame;
    const fresh = seen && ageMillis <= 15_000;
    const lastFeedUnixMillis = Number(report.lastFeedUnixMillis ?? 0);
    const feedFresh = Number.isFinite(lastFeedUnixMillis) && lastFeedUnixMillis > 0 && Date.now() - lastFeedUnixMillis <= 15_000;
    const connected = report.connected === true || (report.feedTransport === "poll" && feedFresh);
    const revisionMatches = seen
      && report.expectedRevision === this.options.sourceRevision
      && report.loadedRevision === this.options.sourceRevision;
    return {
      ...report,
      seen,
      fresh,
      healthy: fresh && connected && report.renderStatus === "ready" && matchesCurrentGame && revisionMatches,
      matchesCurrentGame,
      revisionMatches,
      receivedUnixMillis: this.displayClientReceivedUnixMillis,
      ageMillis
    };
  }

  /** Controller input boundary; public to permit deterministic host tests. */
  applyPressure(input: PressureInput): void {
    this.lastPressureUnix = Math.floor(Number(input.unixNanos / 1_000_000_000n)) || Math.floor(Date.now() / 1_000);
    this.applyPhysicalPressureTransition(input.x, input.y, input.pressed);
  }

  /** Authenticated operator input. Each browser owns a leased set of latches,
   * separate from physical pressure and every other browser. The complete
   * batch is validated before any mutation. */
  applyRemoteFloorInput(request: RemoteFloorInputRequest): RemoteFloorInputResult {
    const normalized = normalizeRemoteFloorInputRequest(request);
    const now = Date.now();
    this.pruneRemoteFloorInputTombstones(now);
    const sequence = this.remoteFloorInputSequences.get(normalized.clientId);
    const lastSequence = sequence?.lastSequence ?? 0;
    if (normalized.clientSequence <= lastSequence) {
      return { ...this.status(), applied: false, lastSequence };
    }
    if (!sequence && this.remoteFloorInputSequences.size >= maximumTrackedRemoteFloorInputClients) {
      throw new RequestValidationError("too many remote floor input clients");
    }
    this.rememberRemoteFloorInputSequence(normalized.clientId, normalized.clientSequence, now);
    let mutated = false;
    if (normalized.releaseAll) {
      mutated = this.releaseRemoteFloorInputClient(normalized.clientId) || mutated;
    }
    let client = this.remotePressureClients.get(normalized.clientId);
    for (const change of normalized.changes) {
      if (!client) {
        client = { held: new Set(), leaseTimer: null };
        this.remotePressureClients.set(normalized.clientId, client);
      }
      mutated = this.applyRemotePressureTransition(client, change.x, change.y, change.pressed) || mutated;
    }
    client = this.remotePressureClients.get(normalized.clientId);
    if (client?.held.size) this.renewRemoteFloorInputLease(normalized.clientId, client);
    else if (client) this.removeEmptyRemoteFloorInputClient(normalized.clientId, client);
    if (mutated) {
      this.lastPressureUnix = Math.floor(Date.now() / 1_000);
      this.publishDisplay();
    }
    return { ...this.status(), applied: true, lastSequence: normalized.clientSequence };
  }

  /** Authoritative controller observation boundary; public for deterministic host tests. */
  observePresentedFrame(frame: PresentedFrame): void {
    const observedAt = Date.now();
    const encoded = encodeLiveViewerFrame(frame);
    const observed: ObservedFloorFrame = {
      sequence: safeProtocolNumber(frame.presentationSequence),
      width: frame.width,
      height: frame.height,
      presentedUnixNanos: Number(frame.presentedUnixNanos),
      frameBase64: Buffer.from(encoded).toString("base64")
    };
    this.latestObservedFloor = observed;
    this.floorAdapter = {
      ...this.floorAdapter,
      lastPresentedSequence: observed.sequence,
      lastPresentedUnixNanos: observed.presentedUnixNanos,
      fadeRatio: frame.fadeRatio
    };
    this.scheduleObservedFloor(observedAt);
    this.liveFloorPublisher?.observe(frame, this.gameSessionId, observedAt, encoded);
  }

  private scheduleObservedFloor(observedAt: number): void {
    if (this.liveFloorListeners.size === 0) return;
    this.localLiveFloorPending = true;
    if (this.localLiveFloorTimer) return;
    const intervalMillis = 1000 / this.localLiveFloorFps;
    const waitMillis = this.localLiveFloorLastPublishedAt > 0
      ? Math.max(0, this.localLiveFloorLastPublishedAt + intervalMillis - observedAt)
      : 0;
    if (waitMillis <= 0) {
      this.publishObservedFloor(observedAt);
      return;
    }
    this.localLiveFloorTimer = setTimeout(() => {
      this.localLiveFloorTimer = null;
      this.publishObservedFloor(Date.now());
    }, waitMillis);
    this.localLiveFloorTimer.unref();
  }

  private publishObservedFloor(publishedAt: number): void {
    if (!this.localLiveFloorPending || this.liveFloorListeners.size === 0) return;
    const current = this.observedFloor();
    this.localLiveFloorPending = false;
    if (!current) return;
    this.localLiveFloorLastPublishedAt = publishedAt;
    for (const subscription of this.liveFloorListeners) this.deliverObservedFloor(subscription, current);
  }

  private deliverObservedFloor(subscription: ObservedFloorSubscription, frame: ObservedFloorFrame): void {
    if (subscription.lastSequence === frame.sequence) return;
    subscription.lastSequence = frame.sequence;
    try {
      subscription.listener({ ...frame });
    } catch (error) {
      this.options.log?.("local live-floor listener failed", error);
    }
  }

  private observeAdapterStatus(status: AdapterStatus): void {
    this.floorAdapter = {
      ...this.floorAdapter,
      actualFps: status.actualFps,
      targetFps: status.targetFps,
      desiredFrameAgeMillis: Number(status.desiredFrameAgeMillis),
      presentedFrames: safeProtocolNumber(status.presentedFrames),
      udpErrorCount: safeProtocolNumber(status.udpSendErrors),
      lastStatusUnixNanos: Number(status.unixNanos)
    };
  }

  private tick(now: number): void {
    if (!this.state.paused) this.state = this.session.tick(this.elapsedAt(now));
    const frame = this.state.frame;
    this.frameSequence += 1n;
    this.controller.sendFrame({
      sequence: this.frameSequence,
      unixNanos: BigInt(Date.now()) * 1_000_000n,
      width: FLOOR_COLS,
      height: FLOOR_ROWS,
      rgb: frameToRgb(frame, this.options.brightness ?? 1)
    });
    if (now - this.lastDisplayPublishedAt >= 250) {
      this.lastDisplayPublishedAt = now;
      this.publishDisplay();
    }
  }

  private elapsedAt(now: number): number {
    return Math.max(0, (this.pauseStartedAt || now) - this.gameStartedAt);
  }

  private applyHeldPressure(atMillis: number): void {
    for (const key of this.heldPressure) {
      const [x, y] = key.split(",").map(Number);
      if (x !== undefined && y !== undefined) this.state = this.session.press(x, y, atMillis);
    }
  }

  private applyPhysicalPressureTransition(x: number, y: number, pressed: boolean): boolean {
    const key = `${x},${y}`;
    if (this.physicalPressure.has(key) === pressed) return false;
    if (pressed) this.physicalPressure.add(key); else this.physicalPressure.delete(key);
    this.applyEffectivePressureTransition(x, y);
    return true;
  }

  private applyRemotePressureTransition(
    client: RemoteFloorInputClient,
    x: number,
    y: number,
    pressed: boolean
  ): boolean {
    const key = `${x},${y}`;
    if (client.held.has(key) === pressed) return false;
    if (pressed) {
      client.held.add(key);
      this.remotePressureCounts.set(key, (this.remotePressureCounts.get(key) ?? 0) + 1);
    } else {
      client.held.delete(key);
      const remaining = (this.remotePressureCounts.get(key) ?? 1) - 1;
      if (remaining > 0) this.remotePressureCounts.set(key, remaining);
      else this.remotePressureCounts.delete(key);
    }
    this.applyEffectivePressureTransition(x, y);
    return true;
  }

  private applyEffectivePressureTransition(x: number, y: number): void {
    const key = `${x},${y}`;
    const wasHeld = this.heldPressure.has(key);
    const isHeld = this.physicalPressure.has(key) || this.remotePressureCounts.has(key);
    if (wasHeld === isHeld) return;
    if (isHeld) this.heldPressure.add(key); else this.heldPressure.delete(key);
    const atMillis = this.elapsedAt(performance.now());
    this.state = isHeld
      ? this.session.press(x, y, atMillis)
      : this.session.release(x, y, atMillis);
  }

  private renewRemoteFloorInputLease(clientId: string, client: RemoteFloorInputClient): void {
    if (client.leaseTimer) clearTimeout(client.leaseTimer);
    client.leaseTimer = setTimeout(() => {
      const current = this.remotePressureClients.get(clientId);
      if (current !== client) return;
      this.releaseRemoteFloorInputClient(clientId);
      this.publishDisplay();
    }, this.remoteFloorInputLeaseMillis);
    client.leaseTimer.unref();
  }

  private releaseRemoteFloorInputClient(clientId: string): boolean {
    const client = this.remotePressureClients.get(clientId);
    if (!client) return false;
    if (client.leaseTimer) clearTimeout(client.leaseTimer);
    client.leaseTimer = null;
    let mutated = false;
    for (const key of [...client.held]) {
      const [x, y] = pressureCoordinates(key);
      mutated = this.applyRemotePressureTransition(client, x, y, false) || mutated;
    }
    this.remotePressureClients.delete(clientId);
    return mutated;
  }

  private removeEmptyRemoteFloorInputClient(clientId: string, client: RemoteFloorInputClient): void {
    if (client.leaseTimer) clearTimeout(client.leaseTimer);
    client.leaseTimer = null;
    this.remotePressureClients.delete(clientId);
  }

  private remoteFloorInputStatus(): RemoteFloorInputStatus {
    return {
      activeClients: this.remotePressureClients.size,
      heldTiles: this.remotePressureCounts.size,
      leaseMillis: this.remoteFloorInputLeaseMillis,
      trackedClients: this.remoteFloorInputSequences.size
    };
  }

  private rememberRemoteFloorInputSequence(clientId: string, lastSequence: number, now: number): void {
    const previous = this.remoteFloorInputSequences.get(clientId);
    if (previous) clearTimeout(previous.expiryTimer);
    const entry: RemoteFloorInputSequence = {
      expiresAt: now + this.remoteFloorInputTombstoneMillis,
      expiryTimer: setTimeout(() => this.expireRemoteFloorInputTombstone(clientId, entry), this.remoteFloorInputTombstoneMillis),
      lastSequence
    };
    entry.expiryTimer.unref();
    this.remoteFloorInputSequences.set(clientId, entry);
  }

  private expireRemoteFloorInputTombstone(clientId: string, expected: RemoteFloorInputSequence): void {
    const current = this.remoteFloorInputSequences.get(clientId);
    if (current !== expected) return;
    const remaining = current.expiresAt - Date.now();
    if (remaining > 0) {
      current.expiryTimer = setTimeout(() => this.expireRemoteFloorInputTombstone(clientId, current), remaining);
      current.expiryTimer.unref();
      return;
    }
    this.remoteFloorInputSequences.delete(clientId);
  }

  private pruneRemoteFloorInputTombstones(now: number): void {
    for (const [clientId, entry] of this.remoteFloorInputSequences) {
      if (entry.expiresAt > now) continue;
      clearTimeout(entry.expiryTimer);
      this.remoteFloorInputSequences.delete(clientId);
    }
  }

  private publishDisplay(): void {
    this.stateRevision = this.stateRevision >= Number.MAX_SAFE_INTEGER ? 1 : this.stateRevision + 1;
    const status = this.status();
    for (const listener of this.statusListeners) listener(status);
    if (this.displayListeners.size === 0) return;
    const display = { ...status, sourceKind: "motion_levels_games", gameSnapshot: this.state.snapshot, frame: this.state.frame };
    for (const listener of this.displayListeners) listener(display);
  }

  private activateScreensaver(options: Record<string, unknown> = { mode: "rotation" }): void {
    this.state = this.session.select({
      gameId: screensaverGameId,
      playerCount: 0,
      difficulty: "medium",
      seed: 137,
      options,
      ...(this.screensaverContent ? { content: this.screensaverContent } : {})
    });
    this.selection = null;
    this.gameStartedAt = performance.now();
    this.pauseStartedAt = 0;
    this.sessionStartedUnix = 0;
    this.gameSessionId = "";
    this.applyHeldPressure(0);
  }

  async refreshScreensaverContent(rotationSeconds?: number): Promise<boolean> {
    if (!this.options.platformUrl) return false;
    if (this.screensaverRefreshInFlight) return this.screensaverRefreshInFlight;
    const refresh = this.fetchScreensaverContent(rotationSeconds)
      .then(({ content, contentRevision }) => {
        if (contentRevision === this.screensaverContentRevision) return false;
        this.screensaverContent = content;
        this.screensaverContentRevision = contentRevision;
        if (!this.selection) {
          this.activateScreensaver();
          this.publishDisplay();
        }
        return true;
      })
      .catch((error) => {
        this.options.log?.("screensaver content refresh failed; keeping the last good rotation", error);
        return false;
      })
      .finally(() => {
        this.screensaverRefreshInFlight = null;
      });
    this.screensaverRefreshInFlight = refresh;
    return refresh;
  }

  private async fetchScreensaverContent(rotationSeconds?: number): Promise<{ content: GameContent; contentRevision: string }> {
    const platform = resolveRuntimeContentPlatformUrl(this.options.platformUrl, undefined);
    if (!platform) throw new RequestValidationError("platform URL is invalid");
    const endpoint = new URL(platform);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/api/level-games/${screensaverGameId}/runtime-content`;
    if (rotationSeconds !== undefined) endpoint.searchParams.set("rotationSeconds", String(rotationSeconds));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.platformToken) headers.Authorization = `Bearer ${this.options.platformToken.trim()}`;
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new RequestValidationError(`screensaver content returned HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumScreensaverContentBytes) {
      throw new RequestValidationError("screensaver content is too large");
    }
    const content = JSON.parse(text) as Record<string, unknown>;
    const contentRevision = String(content.contentRevision ?? "").trim().toLowerCase();
    if (content.schema !== screensaverContentSchema
      || !/^[0-9a-f]{64}$/u.test(contentRevision)
      || !Array.isArray(content.rotationIds)
      || content.rotationIds.length < 1
      || content.rotationIds.length > 100) {
      throw new RequestValidationError("screensaver content is invalid");
    }
    return { content: content as GameContent, contentRevision };
  }

  private async fetchRuntimeContent(request: SelectGameRequest): Promise<{ content: GameContent; contentRevision: string }> {
    const platform = resolveRuntimeContentPlatformUrl(this.options.platformUrl, request.platformUrl);
    if (!platform) throw new RequestValidationError("platform URL is required for published-level games");
    const canonicalGameId = String(request.game ?? "").trim().toLowerCase();
    if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/u.test(canonicalGameId)) {
      throw new RequestValidationError("published level canonical game id is invalid");
    }
    const endpoint = new URL(platform);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/api/level-games/${encodeURIComponent(canonicalGameId)}/runtime-content`;
    for (const [key, value] of [
      ["difficulty", request.difficulty], ["level", request.level], ["levelSlug", request.levelSlug], ["mode", request.levelMode]
    ] as const) if (value) endpoint.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.platformToken) headers.Authorization = `Bearer ${this.options.platformToken.trim()}`;
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new RequestValidationError(`published level content returned HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new RequestValidationError("published level content exceeds 32 MiB");
    const content = JSON.parse(text) as Record<string, unknown>;
    if (content.schema !== "motion-levels-published-level-content-v1" || String(content.gameId).toLowerCase() !== canonicalGameId) {
      throw new RequestValidationError("published level content identity mismatch");
    }
    const engineGame = String(content.engineGame ?? "").trim();
    if (!engineGame || engineGame.length > 160) throw new RequestValidationError("published level engineGame is invalid");
    const selectedModule = gameplayRegistry.get(runtimeGameId(request).trim().toLowerCase());
    const contentModule = gameplayRegistry.get(engineGame.replace(/^motion-levels-games:/u, "").trim().toLowerCase());
    if (!selectedModule || contentModule !== selectedModule) {
      throw new RequestValidationError("published level engine product mismatch");
    }
    const selectedLevelId = String(content.selectedLevelId ?? "").trim();
    const selectedLevelSlug = String(content.selectedLevelSlug ?? "").trim();
    if (!selectedLevelId || !selectedLevelSlug) throw new RequestValidationError("published level selection is incomplete");
    if (request.level && /^[0-9a-f-]{32,64}$/iu.test(request.level) && selectedLevelId.toLowerCase() !== request.level.toLowerCase()) {
      throw new RequestValidationError("published level selection identity mismatch");
    }
    const mode = String(content.mode ?? "").toLowerCase();
    if (mode !== "challenge" && mode !== "free") throw new RequestValidationError("published level mode is invalid");
    if (request.levelMode && mode !== request.levelMode.toLowerCase()) throw new RequestValidationError("published level mode mismatch");
    const contentRevision = String(content.contentRevision ?? "");
    if (!/^[0-9a-f]{64}$/u.test(contentRevision)) throw new RequestValidationError("published level content revision is invalid");
    return { content: content as GameContent, contentRevision };
  }

  private bestEffortCamera(action: string, request: Record<string, unknown>): void {
    const base = validBaseUrl(process.env.MOTION_LEVELS_CAMERA_RECORDER_URL);
    if (!base || request.recordingEnabled === false) return;
    const path = action === "start" ? "/sessions/start" : "/sessions/stop";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = process.env.MOTION_LEVELS_CAMERA_RECORDER_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(new URL(path, base), {
      method: "POST",
      headers,
      body: JSON.stringify(action === "start"
        ? { ...request, startedUnixNanos: Date.now() * 1_000_000 }
        : { ...request, endedUnixNanos: Date.now() * 1_000_000 }),
      signal: AbortSignal.timeout(2_000)
    }).catch((error) => this.options.log?.("camera hook failed", error));
  }
}

export function productionCatalog(): PlayerExperienceGameSummary[] {
  return gameCatalog.filter((manifest) => manifest.availability.production).map((manifest) => ({
    game: `motion-levels-games:${manifest.id}`,
    label: manifest.label,
    description: manifest.description ?? "",
    music: "",
    players: !manifest.players.allowAny,
    minPlayers: manifest.players.min,
    maxPlayers: manifest.players.max,
    difficulty: (manifest.config?.difficulty?.options?.length ?? 0) > 1,
    volume: 0
  }));
}

function runtimeGameId(request: SelectGameRequest): string {
  for (const value of [request.engineGame, request.game]) {
    const candidate = String(value ?? "").trim();
    if (candidate.startsWith("motion-levels-games:")) return candidate.slice("motion-levels-games:".length);
  }
  return String(request.game ?? "").trim();
}

function isScreensaverRequest(request: SelectGameRequest): boolean {
  const screensaver = gameplayRegistry.get(screensaverGameId);
  return [request.engineGame, request.game].some((value) => {
    const candidate = String(value ?? "").trim().toLowerCase().replace(/^motion-levels-games:/u, "");
    return gameplayRegistry.get(candidate) === screensaver;
  });
}

function normalizePlayers(
  players: NonNullable<SelectGameRequest["players"]>,
  playerCount: number,
  allowAnyPlayers: boolean
): Array<{ index: number; label: string; color: `#${string}` }> {
  if (!allowAnyPlayers && players.length !== playerCount) {
    throw new RequestValidationError(`players roster must contain exactly ${playerCount} entries`);
  }
  if (players.length > playerCount) throw new RequestValidationError("players roster exceeds playerCount");
  const indexes = new Set<number>();
  return players.map((player) => {
    if (!Number.isInteger(player.index) || player.index < 0 || player.index >= playerCount || indexes.has(player.index)) {
      throw new RequestValidationError("player indexes must be unique and within playerCount");
    }
    indexes.add(player.index);
    return { index: player.index, label: cleanText(player.label, 80), color: rgbToHex(player.color) };
  }).sort((left, right) => left.index - right.index);
}

export function frameToRgb(frame: Frame, brightnessValue: number): Uint8Array {
  const brightness = Math.max(0, Math.min(1, Number.isFinite(brightnessValue) ? brightnessValue : 1));
  const rgb = new Uint8Array(floorRgbBytes);
  for (const cell of frame.cells) {
    if (cell.x < 0 || cell.x >= FLOOR_COLS || cell.y < 0 || cell.y >= FLOOR_ROWS) continue;
    const color = hexToRgb(cell.color);
    const offset = (cell.y * FLOOR_COLS + cell.x) * 3;
    rgb[offset] = Math.round(color.r * brightness);
    rgb[offset + 1] = Math.round(color.g * brightness);
    rgb[offset + 2] = Math.round(color.b * brightness);
  }
  return rgb;
}

function rgbToHex(color: { r: number; g: number; b: number }): `#${string}` {
  const channel = (value: unknown) => boundedInteger(value, 0, 255, "color channel").toString(16).padStart(2, "0");
  return `#${channel(color?.r)}${channel(color?.g)}${channel(color?.b)}`;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match?.[1]) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(match[1].slice(0, 2), 16), g: parseInt(match[1].slice(2, 4), 16), b: parseInt(match[1].slice(4, 6), 16) };
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new RequestValidationError(`${label} must be ${min}..${max}`);
  return number;
}

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nonNegativeInteger(value: unknown): number { return Math.floor(nonNegative(value)); }

function normalizeLocalLiveFloorFps(value: unknown): number {
  const candidate = Number(value ?? defaultLocalLiveFloorFps);
  if (!Number.isFinite(candidate)) return defaultLocalLiveFloorFps;
  return Math.max(minimumLocalLiveFloorFps, Math.min(maximumLocalLiveFloorFps, candidate));
}

function normalizeRemoteFloorInputLeaseMillis(value: unknown): number {
  const candidate = Number(value ?? defaultRemoteFloorInputLeaseMillis);
  if (!Number.isFinite(candidate)) return defaultRemoteFloorInputLeaseMillis;
  return Math.round(Math.max(
    minimumRemoteFloorInputLeaseMillis,
    Math.min(maximumRemoteFloorInputLeaseMillis, candidate)
  ));
}

function normalizeRemoteFloorInputTombstoneMillis(value: unknown): number {
  const candidate = Number(value ?? defaultRemoteFloorInputTombstoneMillis);
  if (!Number.isFinite(candidate)) return defaultRemoteFloorInputTombstoneMillis;
  return Math.round(Math.max(
    minimumRemoteFloorInputTombstoneMillis,
    Math.min(maximumRemoteFloorInputTombstoneMillis, candidate)
  ));
}

function normalizeRemoteFloorInputRequest(value: unknown): NormalizedRemoteFloorInputRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("floor input request must be a JSON object");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.clientId !== "string" || !uuidPattern.test(request.clientId.trim())) {
    throw new RequestValidationError("clientId must be a UUID");
  }
  if (typeof request.clientSequence !== "number"
    || !Number.isSafeInteger(request.clientSequence)
    || request.clientSequence < 1) {
    throw new RequestValidationError("clientSequence must be a positive safe integer");
  }
  if (request.releaseAll !== undefined && typeof request.releaseAll !== "boolean") {
    throw new RequestValidationError("releaseAll must be a boolean");
  }
  const changeValues = request.changes ?? [];
  if (!Array.isArray(changeValues)) throw new RequestValidationError("changes must be an array");
  if (changeValues.length > maximumRemoteFloorInputChanges) {
    throw new RequestValidationError(`changes must contain at most ${maximumRemoteFloorInputChanges} entries`);
  }
  const changes = changeValues.map((changeValue, index): RemoteFloorInputChange => {
    if (!changeValue || typeof changeValue !== "object" || Array.isArray(changeValue)) {
      throw new RequestValidationError(`changes[${index}] must be a JSON object`);
    }
    const change = changeValue as Record<string, unknown>;
    if (typeof change.x !== "number" || !Number.isInteger(change.x) || change.x < 0 || change.x >= FLOOR_COLS) {
      throw new RequestValidationError(`changes[${index}].x must be 0..${FLOOR_COLS - 1}`);
    }
    if (typeof change.y !== "number" || !Number.isInteger(change.y) || change.y < 0 || change.y >= FLOOR_ROWS) {
      throw new RequestValidationError(`changes[${index}].y must be 0..${FLOOR_ROWS - 1}`);
    }
    if (typeof change.pressed !== "boolean") {
      throw new RequestValidationError(`changes[${index}].pressed must be a boolean`);
    }
    return { x: change.x, y: change.y, pressed: change.pressed };
  });
  return {
    clientId: request.clientId.trim().toLowerCase(),
    clientSequence: request.clientSequence,
    changes,
    releaseAll: request.releaseAll === true
  };
}

function pressureCoordinates(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`invalid pressure key: ${key}`);
  }
  return [x, y];
}

function normalizeScreensaverRefreshMillis(value: unknown): number {
  const candidate = Number(value ?? defaultScreensaverRefreshMillis);
  if (!Number.isFinite(candidate)) return defaultScreensaverRefreshMillis;
  if (candidate <= 0) return 0;
  return Math.max(5_000, Math.min(60 * 60_000, Math.round(candidate)));
}

function cleanText(value: unknown, max: number): string { return String(value ?? "").trim().slice(0, max); }

function validBaseUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function emptyFloorAdapter(): FloorAdapterStatus {
  return {
    connected: false,
    protocol: "v2",
    revision: "",
    width: FLOOR_COLS,
    height: FLOOR_ROWS,
    targetFps: 0,
    actualFps: 0,
    desiredFrameAgeMillis: -1,
    presentedFrames: 0,
    udpErrorCount: 0,
    lastStatusUnixNanos: 0,
    lastPresentedSequence: 0,
    lastPresentedUnixNanos: 0,
    fadeRatio: 0
  };
}

function connectedFloorAdapter(revision: string, hello: ControllerHello): FloorAdapterStatus {
  return {
    ...emptyFloorAdapter(),
    connected: true,
    revision,
    width: hello.width,
    height: hello.height,
    targetFps: hello.refreshFps
  };
}

function safeProtocolNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("controller protocol value exceeds JSON integer range");
  return result;
}

/** Configured production origin wins; request URLs are loopback-dev only. */
export function resolveRuntimeContentPlatformUrl(configured: unknown, requested: unknown): URL | null {
  const production = validBaseUrl(configured);
  if (production) return production;
  const development = validBaseUrl(requested);
  if (!development) return null;
  const hostname = development.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ? development : null;
}
