import * as THREE from "three";

export type JugarStageQuality = "mobile-low" | "desktop-medium" | "venue-high" | "capture";

export type JugarStageQualityBudget = Readonly<{
  minimumSamples: number;
  maxP95FrameMillis: number;
  /** Explicit CI ceiling for software WebGL; never presented as hardware certification. */
  maxSoftwareP95FrameMillis: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxGeometries: number;
  maxTextures: number;
  maxPrograms: number;
  maxGpuMemoryProxyMegabytes: number;
}>;

/**
 * Scene-level budgets for the canonical Jugar stage at its supported eight
 * avatars. They are deliberately renderer totals, rather than per-character
 * numbers that would omit the floor, venue, TV and shadow passes.
 */
export const jugarStageQualityBudgets: Readonly<Record<JugarStageQuality, JugarStageQualityBudget>> =
  Object.freeze({
    "mobile-low": createBudget(45, 34, 175, 170, 33_000, 168, 4, 9, 20),
    // The slowest self-hosted SwiftShader worker measured 602.5 ms desktop p95
    // over a complete window; 700 ms retains about 16% regression headroom.
    "desktop-medium": createBudget(60, 25, 700, 170, 33_000, 168, 4, 9, 24),
    "venue-high": createBudget(60, 18.5, 175, 170, 33_000, 168, 4, 9, 36),
    // Local native capture/desktop p95 was 1.90x. The slowest self-hosted
    // SwiftShader capture measured 1,305.6 ms; 1,400 ms keeps 7% headroom.
    // The same eight-avatar capture scene compiles either 9 or 10 programs in
    // SwiftShader depending on shader readiness; keep one exact variant of
    // headroom without relaxing any other structural budget.
    capture: createBudget(45, 40, 1400, 170, 33_000, 168, 4, 10, 36)
  });

export type JugarStagePerformanceSample = Readonly<{
  frameMillis: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  geometryMemoryProxyMegabytes: number;
  textureMemoryProxyMegabytes: number;
  framebufferMemoryProxyMegabytes: number;
  shadowMemoryProxyMegabytes: number;
  gpuMemoryProxyMegabytes: number;
}>;

export type JugarStageRendererEnvironment = Readonly<{
  vendor: string;
  renderer: string;
  softwareRenderer: boolean;
}>;

export type JugarStageBudgetViolation =
  | "frame-time"
  | "draw-calls"
  | "triangles"
  | "geometries"
  | "textures"
  | "programs"
  | "gpu-memory-proxy";

/** Stable, serialisable diagnostics emitted by the Stage callback. */
export type JugarStageDiagnostics = Readonly<{
  schemaVersion: 1;
  qualityTier: JugarStageQuality;
  samples: number;
  latest: JugarStagePerformanceSample;
  averageFrameMillis: number;
  p95FrameMillis: number;
  worstFrameMillis: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxGeometries: number;
  maxTextures: number;
  maxPrograms: number;
  /** Compatibility field: estimated scene texture bytes only, not total GPU memory. */
  maxTextureMegabytes: number;
  maxGpuMemoryProxyMegabytes: number;
  budget: JugarStageQualityBudget;
  budgetReady: boolean;
  structuralWithinBudget: boolean;
  /** Hardware frame target, even when a separate software-CI ceiling applies. */
  timingWithinBudget: boolean;
  softwareTimingWithinBudget: boolean;
  /** Venue timing is observational when the browser identifies software WebGL. */
  timingBudgetWaived: boolean;
  withinBudget: boolean;
  violations: readonly JugarStageBudgetViolation[];
  environment?: JugarStageRendererEnvironment;
  caveats: readonly string[];
}>;

export type JugarStageMemoryProxy = Readonly<{
  geometryBytes: number;
  textureBytes: number;
  framebufferBytes: number;
  shadowBytes: number;
  totalBytes: number;
}>;

export type JugarStageMemoryProxyOptions = Readonly<{
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  shadowMapSize: number;
}>;

export type JugarStageDiagnosticsContext = Readonly<{
  environment?: JugarStageRendererEnvironment;
  caveats?: readonly string[];
}>;

const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_SAMPLE_WINDOW = 120;

/** Fixed-size monitor: long-running venue sessions never accumulate samples. */
export class JugarStagePerformanceMonitor {
  readonly #qualityTier: JugarStageQuality;
  readonly #sampleWindow: number;
  readonly #samples: JugarStagePerformanceSample[] = [];

  public constructor(qualityTier: JugarStageQuality, sampleWindow = DEFAULT_SAMPLE_WINDOW) {
    if (!Number.isInteger(sampleWindow) || sampleWindow < 1) {
      throw new Error("Jugar Stage performance sample window must be a positive integer");
    }
    this.#qualityTier = qualityTier;
    this.#sampleWindow = sampleWindow;
  }

  public record(sample: JugarStagePerformanceSample): void {
    for (const [field, value] of Object.entries(sample)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Jugar Stage performance ${field} must be finite and non-negative`);
      }
    }
    this.#samples.push(Object.freeze({ ...sample }));
    if (this.#samples.length > this.#sampleWindow) this.#samples.shift();
  }

  public report(context: JugarStageDiagnosticsContext = {}): JugarStageDiagnostics {
    const budget = jugarStageQualityBudgets[this.#qualityTier];
    const latest = this.#samples.at(-1) ?? zeroSample();
    const frames = this.#samples.map((sample) => sample.frameMillis).sort((left, right) => left - right);
    const p95FrameMillis = percentile(frames, 0.95);
    const maxDrawCalls = maximum(this.#samples.map((sample) => sample.drawCalls));
    const maxTriangles = maximum(this.#samples.map((sample) => sample.triangles));
    const maxGeometries = maximum(this.#samples.map((sample) => sample.geometries));
    const maxTextures = maximum(this.#samples.map((sample) => sample.textures));
    const maxPrograms = maximum(this.#samples.map((sample) => sample.programs));
    const maxTextureMegabytes = maximum(
      this.#samples.map((sample) => sample.textureMemoryProxyMegabytes)
    );
    const maxGpuMemoryProxyMegabytes = maximum(
      this.#samples.map((sample) => sample.gpuMemoryProxyMegabytes)
    );
    const violations: JugarStageBudgetViolation[] = [];
    if (p95FrameMillis > budget.maxP95FrameMillis) violations.push("frame-time");
    if (maxDrawCalls > budget.maxDrawCalls) violations.push("draw-calls");
    if (maxTriangles > budget.maxTriangles) violations.push("triangles");
    if (maxGeometries > budget.maxGeometries) violations.push("geometries");
    if (maxTextures > budget.maxTextures) violations.push("textures");
    if (maxPrograms > budget.maxPrograms) violations.push("programs");
    if (maxGpuMemoryProxyMegabytes > budget.maxGpuMemoryProxyMegabytes) {
      violations.push("gpu-memory-proxy");
    }
    const budgetReady = this.#samples.length >= budget.minimumSamples;
    const timingWithinBudget = !violations.includes("frame-time");
    const softwareTimingWithinBudget = p95FrameMillis <= budget.maxSoftwareP95FrameMillis;
    const structuralWithinBudget = violations.every((violation) => violation === "frame-time");
    const timingBudgetWaived = (this.#qualityTier === "venue-high" || this.#qualityTier === "capture")
      && context.environment?.softwareRenderer === true
      && !softwareTimingWithinBudget;
    const appliedTimingWithinBudget = timingWithinBudget
      || (context.environment?.softwareRenderer === true && softwareTimingWithinBudget)
      || timingBudgetWaived;
    return Object.freeze({
      schemaVersion: 1,
      qualityTier: this.#qualityTier,
      samples: this.#samples.length,
      latest,
      averageFrameMillis: average(frames),
      p95FrameMillis,
      worstFrameMillis: frames.at(-1) ?? 0,
      maxDrawCalls,
      maxTriangles,
      maxGeometries,
      maxTextures,
      maxPrograms,
      maxTextureMegabytes,
      maxGpuMemoryProxyMegabytes,
      budget,
      budgetReady,
      structuralWithinBudget,
      timingWithinBudget,
      softwareTimingWithinBudget,
      timingBudgetWaived,
      withinBudget: budgetReady
        && structuralWithinBudget
        && appliedTimingWithinBudget,
      violations: Object.freeze(violations),
      ...(context.environment ? { environment: Object.freeze({ ...context.environment }) } : {}),
      caveats: Object.freeze([...(context.caveats ?? [])])
    });
  }
}

/**
 * Lower-bound proxy for resources addressable from the scene graph. It adds
 * geometry buffers, discoverable texture pixels, one color/depth framebuffer,
 * and one directional shadow map. It intentionally excludes driver padding,
 * multisample resolve buffers, shader binaries and browser compositor memory.
 */
export function estimateJugarStageMemoryProxy(
  root: THREE.Object3D,
  options: JugarStageMemoryProxyOptions
): JugarStageMemoryProxy {
  const drawingBufferWidth = nonNegativeInteger(options.drawingBufferWidth, "drawing-buffer width");
  const drawingBufferHeight = nonNegativeInteger(options.drawingBufferHeight, "drawing-buffer height");
  const shadowMapSize = nonNegativeInteger(options.shadowMapSize, "shadow-map size");
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry?.isBufferGeometry) geometries.add(renderable.geometry);
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) {
      if (material) collectMaterialTextures(material, textures);
    }
  });
  if (root instanceof THREE.Scene) {
    if (root.background instanceof THREE.Texture) textures.add(root.background);
    if (root.environment instanceof THREE.Texture) textures.add(root.environment);
  }

  const geometryBytes = estimateGeometryBytes(geometries);
  const textureBytes = [...textures].reduce((total, texture) => total + estimateTextureBytes(texture), 0);
  // Four bytes of color plus a conservative four-byte depth/stencil surface.
  const framebufferBytes = drawingBufferWidth * drawingBufferHeight * 8;
  // The Stage owns one directional light shadow map; zero disables the pass.
  const shadowBytes = shadowMapSize * shadowMapSize * 4;
  return Object.freeze({
    geometryBytes,
    textureBytes,
    framebufferBytes,
    shadowBytes,
    totalBytes: geometryBytes + textureBytes + framebufferBytes + shadowBytes
  });
}

export function bytesToMegabytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error("GPU memory proxy bytes must be finite and non-negative");
  }
  return bytes / BYTES_PER_MEGABYTE;
}

function createBudget(
  minimumSamples: number,
  maxP95FrameMillis: number,
  maxSoftwareP95FrameMillis: number,
  maxDrawCalls: number,
  maxTriangles: number,
  maxGeometries: number,
  maxTextures: number,
  maxPrograms: number,
  maxGpuMemoryProxyMegabytes: number
): JugarStageQualityBudget {
  return Object.freeze({
    minimumSamples,
    maxP95FrameMillis,
    maxSoftwareP95FrameMillis,
    maxDrawCalls,
    maxTriangles,
    maxGeometries,
    maxTextures,
    maxPrograms,
    maxGpuMemoryProxyMegabytes
  });
}

function zeroSample(): JugarStagePerformanceSample {
  return Object.freeze({
    frameMillis: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    geometryMemoryProxyMegabytes: 0,
    textureMemoryProxyMegabytes: 0,
    framebufferMemoryProxyMegabytes: 0,
    shadowMemoryProxyMegabytes: 0,
    gpuMemoryProxyMegabytes: 0
  });
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) textures.add(value);
  }
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform?.value;
    if (value instanceof THREE.Texture) textures.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) if (entry instanceof THREE.Texture) textures.add(entry);
    }
  }
}

function estimateGeometryBytes(geometries: Set<THREE.BufferGeometry>): number {
  const arrays = new Set<ArrayBufferView>();
  for (const geometry of geometries) {
    if (geometry.index) addAttributeArray(geometry.index, arrays);
    for (const attribute of Object.values(geometry.attributes)) addAttributeArray(attribute, arrays);
    for (const attributes of Object.values(geometry.morphAttributes)) {
      for (const attribute of attributes) addAttributeArray(attribute, arrays);
    }
  }
  return [...arrays].reduce((total, array) => total + array.byteLength, 0);
}

function addAttributeArray(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  arrays: Set<ArrayBufferView>
): void {
  const array = attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.array
    : attribute.array;
  arrays.add(array);
}

function estimateTextureBytes(texture: THREE.Texture): number {
  if (texture.mipmaps.length > 0) {
    return texture.mipmaps.reduce((total, mipmap) => total + imageBytes(mipmap), 0);
  }
  const source = texture.source.data as unknown;
  const baseBytes = Array.isArray(source)
    ? source.reduce((total, image) => total + imageBytes(image), 0)
    : imageBytes(source);
  return texture.generateMipmaps ? Math.ceil(baseBytes * 4 / 3) : baseBytes;
}

function imageBytes(image: unknown): number {
  if (!image || typeof image !== "object") return 0;
  const record = image as {
    data?: ArrayBufferView;
    width?: number;
    height?: number;
    depth?: number;
  };
  if (record.data && ArrayBuffer.isView(record.data)) return record.data.byteLength;
  const width = finiteDimension(record.width);
  const height = finiteDimension(record.height);
  const depth = finiteDimension(record.depth ?? 1);
  return width * height * depth * 4;
}

function finiteDimension(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.trunc(value!) : 0;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return Math.trunc(value);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}
