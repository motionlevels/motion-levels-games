import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type ColorRepresentation,
  type WebGLRendererParameters
} from "three";
import {
  CharacterPerformanceMonitor,
  advanceAnimationGraph,
  characterQualityProfiles,
  createAnimationGraphState,
  proceduralPose,
  type AnimationGraphState,
  type AnimationParameters,
  type CharacterArchetype,
  type CharacterPerformanceReport,
  type CharacterPerformanceSample,
  type CharacterQualityTier,
  type GameplayAction
} from "@motion-levels-games/character-runtime";
import type { Frame } from "@motion-levels-games/game-sdk";
import {
  rendererGridToWorld,
  rendererQualitySettings,
  selectRendererLod,
  type AgentRenderSnapshot,
  type RendererDebugInput,
  type RendererLod,
  type RendererQualitySettings
} from "./contracts.ts";
import { RendererDebugOverlay } from "./debug-overlay.ts";
import { InstancedContactShadows } from "./contact-shadows.ts";
import { InstancedFrameFloor } from "./floor.ts";
import { MotionAthlete, MotionAthleteGeometryPool } from "./motion-athlete.ts";
import { AgentSnapshotBuffer } from "./snapshot-buffer.ts";

const DEFAULT_INTERPOLATION_DELAY_MILLIS = 80;
const DEFAULT_PERFORMANCE_WINDOW = 120;
const DEFAULT_BACKGROUND = 0x07121c;
const DEFAULT_CAMERA_TARGET = new Vector3(0, 0.35, 0);

const GAMEPLAY_ACTIONS = new Set<GameplayAction>([
  "none", "jump", "airborne", "land-light", "land-heavy", "dodge", "collect", "interact",
  "hit", "fall", "revive", "celebrate-small", "celebrate-large", "celebrate-team"
]);

export type PerformanceSampleCallback = (
  sample: Readonly<CharacterPerformanceSample>,
  report: Readonly<CharacterPerformanceReport>
) => void;

export type AgentSceneRendererOptions = Readonly<{
  canvas: HTMLCanvasElement;
  qualityTier?: CharacterQualityTier;
  interpolationDelayMillis?: number;
  snapshotCapacity?: number;
  background?: ColorRepresentation;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  performanceWindowSize?: number;
  estimatedTextureMegabytes?: number;
  onPerformanceSample?: PerformanceSampleCallback;
  /** Test/embedding seam. Ownership transfers to AgentSceneRenderer. */
  rendererFactory?: (parameters: WebGLRendererParameters) => WebGLRenderer;
  /** Used only for CPU measurements, never to advance presentation state. */
  performanceNow?: () => number;
}>;

export type AgentSceneDiagnostics = Readonly<{
  disposed: boolean;
  qualityTier: CharacterQualityTier;
  lastRenderAtMillis?: number;
  bufferedAgents: number;
  renderedCharacters: number;
  culledAgentIds: readonly string[];
  lodCounts: Readonly<Record<RendererLod, number>>;
  performance: Readonly<CharacterPerformanceReport>;
}>;

type AgentEntry = {
  id: string;
  variant: CharacterArchetype;
  buffer: AgentSnapshotBuffer;
  athlete?: MotionAthlete;
  graph: AnimationGraphState;
  lastSample?: AgentRenderSnapshot;
  movementStartedAtMillis?: number;
  movementEndedAtMillis?: number;
};

/**
 * Browser-only raw Three.js renderer. It intentionally owns no RAF or gameplay
 * clock: render(atMillis) is the sole presentation-time authority.
 */
export class AgentSceneRenderer {
  public readonly scene = new Scene();
  public readonly camera = new PerspectiveCamera(42, 1, 0.05, 60);
  public readonly renderer: WebGLRenderer;
  public readonly floor = new InstancedFrameFloor();
  readonly #agentRoot = new Group();
  readonly #debug = new RendererDebugOverlay();
  readonly #resources = new MotionAthleteGeometryPool();
  readonly #contactShadows = new InstancedContactShadows(10);
  readonly #agents = new Map<string, AgentEntry>();
  readonly #snapshotCapacity: number;
  readonly #interpolationDelayMillis: number;
  readonly #performanceSamples: CharacterPerformanceSample[] = [];
  readonly #performanceWindowSize: number;
  readonly #estimatedTextureMegabytes: number;
  readonly #onPerformanceSample: PerformanceSampleCallback | undefined;
  readonly #performanceNow: () => number;
  readonly #keyLight = new DirectionalLight(0xffffff, 2.1);
  #quality: RendererQualitySettings;
  #lastRenderAtMillis: number | undefined;
  #lastWidth = 1;
  #lastHeight = 1;
  #lastDevicePixelRatio = 1;
  #lastCulledAgentIds: readonly string[] = Object.freeze([]);
  #lastLodCounts: Readonly<Record<RendererLod, number>> = zeroLodCounts();
  #pendingPreparationMillis = 0;
  #disposed = false;

  public constructor(options: AgentSceneRendererOptions) {
    if (options.canvas === undefined) throw new Error("AgentSceneRenderer requires a browser canvas");
    this.#quality = rendererQualitySettings[options.qualityTier ?? "desktop-medium"];
    this.#interpolationDelayMillis = nonNegativeFinite(
      options.interpolationDelayMillis,
      DEFAULT_INTERPOLATION_DELAY_MILLIS,
      "interpolation delay"
    );
    this.#snapshotCapacity = integerAtLeast(options.snapshotCapacity, 32, 2, "snapshot capacity");
    this.#performanceWindowSize = integerAtLeast(
      options.performanceWindowSize,
      DEFAULT_PERFORMANCE_WINDOW,
      1,
      "performance window size"
    );
    this.#estimatedTextureMegabytes = nonNegativeFinite(
      options.estimatedTextureMegabytes,
      0,
      "estimated texture memory"
    );
    this.#onPerformanceSample = options.onPerformanceSample;
    this.#performanceNow = options.performanceNow ?? defaultPerformanceNow;

    this.renderer = options.rendererFactory?.({
      canvas: options.canvas,
      antialias: this.#quality.antialias,
      alpha: false,
      powerPreference: "high-performance"
    }) ?? new WebGLRenderer({
      canvas: options.canvas,
      antialias: this.#quality.antialias,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.name = "motion-levels-agent-scene";
    this.scene.background = new Color(options.background ?? DEFAULT_BACKGROUND);
    this.#agentRoot.name = "motion-athletes";
    this.scene.add(this.floor.object, this.#agentRoot, this.#contactShadows.object, this.#debug.object);
    this.#configureCamera();
    this.#configureLights();
    this.#applyQuality();
    const width = options.width ?? Math.max(1, options.canvas.clientWidth || options.canvas.width || 1);
    const height = options.height ?? Math.max(1, options.canvas.clientHeight || options.canvas.height || 1);
    const pixelRatio = options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
    this.resize(width, height, pixelRatio);
  }

  public get qualityTier(): CharacterQualityTier {
    return this.#quality.tier;
  }

  public get disposed(): boolean {
    return this.#disposed;
  }

  public setFrame(frame: Frame): void {
    this.#assertActive();
    this.#measurePreparation(() => this.floor.update(frame));
  }

  public pushAgentSnapshot(snapshot: AgentRenderSnapshot): void {
    this.#assertActive();
    this.#measurePreparation(() => {
      let entry = this.#agents.get(snapshot.id);
      if (entry === undefined) {
        entry = {
          id: snapshot.id,
          variant: snapshot.variant ?? variantForId(snapshot.id),
          buffer: new AgentSnapshotBuffer(snapshot.id, { capacity: this.#snapshotCapacity }),
          graph: createAnimationGraphState()
        };
        this.#agents.set(snapshot.id, entry);
      } else if (snapshot.variant !== undefined && snapshot.variant !== entry.variant) {
        entry.athlete?.dispose();
        entry.athlete = undefined;
        entry.variant = snapshot.variant;
      }
      entry.buffer.push(snapshot);
      this.#reconcileAthletes();
    });
  }

  public removeAgent(agentId: string): boolean {
    this.#assertActive();
    const entry = this.#agents.get(agentId);
    if (entry === undefined) return false;
    entry.athlete?.dispose();
    this.#agents.delete(agentId);
    this.#reconcileAthletes();
    return true;
  }

  public clearAgents(): void {
    this.#assertActive();
    for (const entry of this.#agents.values()) entry.athlete?.dispose();
    this.#agents.clear();
    this.#agentRoot.clear();
    this.#lastCulledAgentIds = Object.freeze([]);
    this.#lastLodCounts = zeroLodCounts();
  }

  public setDebugData(data?: RendererDebugInput): void {
    this.#assertActive();
    this.#measurePreparation(() => this.#debug.update(data));
  }

  public setQualityTier(tier: CharacterQualityTier): void {
    this.#assertActive();
    this.#quality = rendererQualitySettings[tier];
    this.#performanceSamples.length = 0;
    this.#applyQuality();
    this.#reconcileAthletes();
    this.resize(this.#lastWidth, this.#lastHeight, this.#lastDevicePixelRatio);
  }

  public resize(width: number, height: number, devicePixelRatio = globalThis.devicePixelRatio ?? 1): void {
    this.#assertActive();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("Renderer width and height must be finite and positive");
    }
    if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
      throw new Error("Renderer device pixel ratio must be finite and positive");
    }
    this.#lastWidth = width;
    this.#lastHeight = height;
    this.#lastDevicePixelRatio = devicePixelRatio;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.#quality.dprCap));
    this.renderer.setSize(width, height, false);
  }

  /** Clears temporal animation state; optionally clears buffered snapshots on seek. */
  public resetTimeline(clearSnapshots = false): void {
    this.#assertActive();
    this.#lastRenderAtMillis = undefined;
    for (const entry of this.#agents.values()) {
      entry.graph = createAnimationGraphState();
      entry.lastSample = undefined;
      entry.movementStartedAtMillis = undefined;
      entry.movementEndedAtMillis = undefined;
      if (clearSnapshots) entry.buffer.clear();
    }
  }

  /** Renders exactly the requested presentation timestamp and returns its CPU/GPU counters. */
  public render(atMillis: number): Readonly<CharacterPerformanceSample> {
    this.#assertActive();
    if (!Number.isFinite(atMillis)) throw new Error("Render timestamp must be finite");
    if (this.#lastRenderAtMillis !== undefined && atMillis < this.#lastRenderAtMillis) {
      this.resetTimeline(false);
    }
    const deltaMillis = this.#lastRenderAtMillis === undefined ? 0 : atMillis - this.#lastRenderAtMillis;
    const frameStart = this.#performanceNow();
    const presentationSampleMillis = atMillis - this.#interpolationDelayMillis;
    const lodCounts: Record<RendererLod, number> = { high: 0, medium: 0, low: 0, hidden: 0 };
    let renderedCharacters = 0;
    this.#contactShadows.beginFrame();
    const entries = sortedEntries(this.#agents);
    const allowedIds = new Set(entries.slice(0, this.#quality.maxCharacters).map((entry) => entry.id));
    const culledIds = entries.slice(this.#quality.maxCharacters).map((entry) => entry.id);

    for (const entry of entries) {
      const sample = entry.buffer.sample(presentationSampleMillis);
      if (sample === undefined || !allowedIds.has(entry.id) || entry.athlete === undefined) {
        if (entry.athlete !== undefined) entry.athlete.setLod("hidden");
        if (sample !== undefined && !allowedIds.has(entry.id)) lodCounts.hidden += 1;
        continue;
      }
      const parameters = this.#animationParameters(entry, sample, atMillis, deltaMillis);
      entry.graph = advanceAnimationGraph(entry.graph, parameters, deltaMillis);
      const pose = proceduralPose(parameters, Math.floor(atMillis / 20), stableHash(entry.id));
      const world = rendererGridToWorld(sample.position);
      entry.athlete.setWorldTransform(world.x, world.y, world.z, sample.facingRadians);
      const distance = this.camera.position.distanceTo(new Vector3(world.x, world.y, world.z));
      const lod = selectRendererLod(distance, this.#quality);
      entry.athlete.setLod(lod);
      entry.athlete.setShadowMode(shadowMode(this.#quality.tier), renderedCharacters === 0);
      entry.athlete.applyPose(entry.graph, pose, parameters, atMillis);
      if (entry.athlete.contactShadowVisible && lod !== "hidden") {
        this.#contactShadows.add(world.x, world.z);
      }
      lodCounts[lod] += 1;
      if (lod !== "hidden") renderedCharacters += 1;
      entry.lastSample = sample;
    }
    this.#contactShadows.commit();
    const animationEnd = this.#performanceNow();
    this.renderer.render(this.scene, this.camera);
    const frameEnd = this.#performanceNow();
    const preparationMillis = this.#pendingPreparationMillis;
    this.#pendingPreparationMillis = 0;
    const sample = Object.freeze({
      frameMillis: preparationMillis + Math.max(0, frameEnd - frameStart),
      animationMillis: Math.max(0, animationEnd - frameStart),
      drawCalls: Math.max(0, this.renderer.info.render.calls),
      triangles: Math.max(0, this.renderer.info.render.triangles),
      textureMegabytes: this.#estimatedTextureMegabytes,
      characters: renderedCharacters
    });
    this.#performanceSamples.push(sample);
    if (this.#performanceSamples.length > this.#performanceWindowSize) this.#performanceSamples.shift();
    this.#lastRenderAtMillis = atMillis;
    this.#lastCulledAgentIds = Object.freeze(culledIds);
    this.#lastLodCounts = Object.freeze({ ...lodCounts });
    this.#onPerformanceSample?.(sample, this.performanceReport());
    return sample;
  }

  public performanceReport(): Readonly<CharacterPerformanceReport> {
    const monitor = new CharacterPerformanceMonitor(characterQualityProfiles[this.#quality.tier]);
    for (const sample of this.#performanceSamples) monitor.record(sample);
    return Object.freeze(monitor.report());
  }

  /** Safe after disposal so host diagnostics can confirm cleanup. */
  public diagnostics(): AgentSceneDiagnostics {
    return Object.freeze({
      disposed: this.#disposed,
      qualityTier: this.#quality.tier,
      ...(this.#lastRenderAtMillis === undefined ? {} : { lastRenderAtMillis: this.#lastRenderAtMillis }),
      bufferedAgents: this.#agents.size,
      renderedCharacters: this.#lastLodCounts.high + this.#lastLodCounts.medium + this.#lastLodCounts.low,
      culledAgentIds: this.#lastCulledAgentIds,
      lodCounts: this.#lastLodCounts,
      performance: this.performanceReport()
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#agents.values()) entry.athlete?.dispose();
    this.#agents.clear();
    this.#agentRoot.clear();
    this.#debug.dispose();
    this.#contactShadows.dispose();
    this.floor.dispose();
    this.#resources.dispose();
    this.scene.clear();
    this.#performanceSamples.length = 0;
    this.#pendingPreparationMillis = 0;
    this.#disposeShadowTargets();
    this.renderer.setAnimationLoop(null);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  #configureCamera(): void {
    this.camera.name = "motion-levels-arena-camera";
    this.camera.position.set(5.1, 6.9, 8.8);
    this.camera.lookAt(DEFAULT_CAMERA_TARGET);
  }

  #configureLights(): void {
    const hemisphere = new HemisphereLight(0xdff5ff, 0x172532, 1.5);
    hemisphere.name = "arena-hemisphere";
    const ambient = new AmbientLight(0xffffff, 0.35);
    ambient.name = "arena-ambient";
    this.#keyLight.name = "arena-key-light";
    this.#keyLight.position.set(2.8, 8, 3.6);
    this.#keyLight.target.position.set(0, 0, 0);
    this.#keyLight.shadow.camera.left = -4.5;
    this.#keyLight.shadow.camera.right = 4.5;
    this.#keyLight.shadow.camera.top = 6;
    this.#keyLight.shadow.camera.bottom = -6;
    this.#keyLight.shadow.camera.near = 0.2;
    this.#keyLight.shadow.camera.far = 18;
    this.scene.add(hemisphere, ambient, this.#keyLight, this.#keyLight.target);
  }

  #applyQuality(): void {
    this.#disposeShadowTargets();
    this.renderer.shadowMap.enabled = this.#quality.shadowMapEnabled;
    this.#keyLight.castShadow = this.#quality.shadowMapEnabled;
    this.#keyLight.shadow.mapSize.set(this.#quality.shadowMapSize, this.#quality.shadowMapSize);
    this.floor.setReceiveShadow(this.#quality.shadowMapEnabled);
  }

  #disposeShadowTargets(): void {
    this.#keyLight.shadow.map?.dispose();
    this.#keyLight.shadow.mapPass?.dispose();
    this.#keyLight.shadow.map = null;
    this.#keyLight.shadow.mapPass = null;
  }

  #reconcileAthletes(): void {
    const entries = sortedEntries(this.#agents);
    const allowed = new Set(entries.slice(0, this.#quality.maxCharacters).map((entry) => entry.id));
    for (const entry of entries) {
      if (allowed.has(entry.id) && entry.athlete === undefined) {
        entry.athlete = new MotionAthlete(entry.variant, this.#resources);
        this.#agentRoot.add(entry.athlete.object);
      } else if (!allowed.has(entry.id) && entry.athlete !== undefined) {
        entry.athlete.dispose();
        entry.athlete = undefined;
      }
    }
  }

  #animationParameters(
    entry: AgentEntry,
    sample: AgentRenderSnapshot,
    atMillis: number,
    deltaMillis: number
  ): AnimationParameters {
    const speed = Math.hypot(sample.velocity.x, sample.velocity.y);
    const previousSpeed = entry.lastSample === undefined
      ? speed
      : Math.hypot(entry.lastSample.velocity.x, entry.lastSample.velocity.y);
    if (speed >= 0.08 && previousSpeed < 0.08) entry.movementStartedAtMillis = atMillis;
    if (speed < 0.08 && previousSpeed >= 0.08) entry.movementEndedAtMillis = atMillis;
    if (entry.movementStartedAtMillis === undefined && speed >= 0.08) entry.movementStartedAtMillis = atMillis;
    if (entry.movementEndedAtMillis === undefined && speed < 0.08) entry.movementEndedAtMillis = atMillis;

    const seconds = deltaMillis / 1_000;
    const acceleration = sample.acceleration ?? (
      entry.lastSample !== undefined && seconds > 0
        ? {
            x: (sample.velocity.x - entry.lastSample.velocity.x) / seconds,
            y: (sample.velocity.y - entry.lastSample.velocity.y) / seconds
          }
        : { x: 0, y: 0 }
    );
    const angularVelocity = sample.angularVelocity ?? (
      entry.lastSample !== undefined && seconds > 0
        ? shortestAngle(entry.lastSample.facingRadians, sample.facingRadians) / seconds
        : 0
    );
    const targetDirection = sample.targetPosition === undefined
      ? normalizeVector(sample.velocity)
      : normalizeVector({
          x: sample.targetPosition.x - sample.position.x,
          y: sample.targetPosition.y - sample.position.y
        });
    return {
      velocity: { ...sample.velocity },
      acceleration,
      angularVelocity,
      grounded: sample.grounded,
      action: gameplayAction(sample.action),
      intention: sample.intention,
      ...(targetDirection === undefined ? {} : { targetDirection }),
      emotion: sample.emotion,
      ...(sample.socialGesture === undefined ? {} : { socialGesture: sample.socialGesture }),
      ...(sample.recentEvent === undefined ? {} : { recentEvent: sample.recentEvent }),
      timeSinceMovementBeganMillis: entry.movementStartedAtMillis === undefined
        ? 0
        : Math.max(0, atMillis - entry.movementStartedAtMillis),
      timeSinceMovementEndedMillis: entry.movementEndedAtMillis === undefined
        ? 0
        : Math.max(0, atMillis - entry.movementEndedAtMillis)
    };
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("AgentSceneRenderer has been disposed");
  }

  #measurePreparation(operation: () => void): void {
    const startedAt = this.#performanceNow();
    operation();
    this.#pendingPreparationMillis += Math.max(0, this.#performanceNow() - startedAt);
  }
}

export type AgentSceneRendererConfig = Omit<AgentSceneRendererOptions, "canvas">;

export function createAgentSceneRenderer(
  canvas: HTMLCanvasElement,
  options?: AgentSceneRendererConfig
): AgentSceneRenderer;
export function createAgentSceneRenderer(options: AgentSceneRendererOptions): AgentSceneRenderer;
export function createAgentSceneRenderer(
  canvasOrOptions: HTMLCanvasElement | AgentSceneRendererOptions,
  options: AgentSceneRendererConfig = {}
): AgentSceneRenderer {
  const suppliedOptions = typeof canvasOrOptions === "object" &&
    canvasOrOptions !== null && "canvas" in canvasOrOptions;
  return suppliedOptions
    ? new AgentSceneRenderer(canvasOrOptions)
    : new AgentSceneRenderer({ ...options, canvas: canvasOrOptions });
}

function sortedEntries(agents: ReadonlyMap<string, AgentEntry>): AgentEntry[] {
  return [...agents.values()].sort((first, second) => first.id.localeCompare(second.id));
}

function gameplayAction(action: string): GameplayAction {
  return GAMEPLAY_ACTIONS.has(action as GameplayAction) ? action as GameplayAction : "none";
}

function normalizeVector(vector: Readonly<{ x: number; y: number }>): { x: number; y: number } | undefined {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.000_001) return undefined;
  return { x: vector.x / length, y: vector.y / length };
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function shadowMode(tier: CharacterQualityTier): "none" | "contact" | "key" | "full" {
  const shadows = characterQualityProfiles[tier].shadows;
  return shadows === "key-character" ? "key" : shadows;
}

function variantForId(id: string): CharacterArchetype {
  const variants: readonly CharacterArchetype[] = ["explorer", "runner", "trickster", "guardian"];
  return variants[stableHash(id) % variants.length] as CharacterArchetype;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function nonNegativeFinite(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${label} must be finite and non-negative`);
  return resolved;
}

function integerAtLeast(value: number | undefined, fallback: number, minimum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
  return resolved;
}

function defaultPerformanceNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function zeroLodCounts(): Readonly<Record<RendererLod, number>> {
  return Object.freeze({ high: 0, medium: 0, low: 0, hidden: 0 });
}
