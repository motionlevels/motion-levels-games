export const CANONICAL_RIG_ID = "motion-athlete-v1";
export const CANONICAL_RIG_VERSION = 1;
export const CHARACTER_ASSET_SCHEMA_VERSION = 1;

export type CanonicalBoneName =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "upper_arm_l"
  | "lower_arm_l"
  | "hand_l"
  | "upper_arm_r"
  | "lower_arm_r"
  | "hand_r"
  | "upper_leg_l"
  | "lower_leg_l"
  | "foot_l"
  | "toe_l"
  | "upper_leg_r"
  | "lower_leg_r"
  | "foot_r"
  | "toe_r";

export type CanonicalRig = {
  id: typeof CANONICAL_RIG_ID;
  version: typeof CANONICAL_RIG_VERSION;
  bindPose: "a-pose";
  forwardAxis: "+z";
  upAxis: "+y";
  unit: "meter";
  targetHeightMeters: number;
  bones: readonly CanonicalBoneName[];
};

export const canonicalRig: CanonicalRig = {
  id: CANONICAL_RIG_ID,
  version: CANONICAL_RIG_VERSION,
  bindPose: "a-pose",
  forwardAxis: "+z",
  upAxis: "+y",
  unit: "meter",
  targetHeightMeters: 1.55,
  bones: [
    "root", "hips", "spine", "chest", "neck", "head",
    "upper_arm_l", "lower_arm_l", "hand_l",
    "upper_arm_r", "lower_arm_r", "hand_r",
    "upper_leg_l", "lower_leg_l", "foot_l", "toe_l",
    "upper_leg_r", "lower_leg_r", "foot_r", "toe_r"
  ]
};

export type CharacterArchetype = "explorer" | "runner" | "trickster" | "guardian";

export type CharacterVariant = {
  id: CharacterArchetype;
  label: string;
  rigId: typeof CANONICAL_RIG_ID;
  silhouette: string;
  palette: { primary: `#${string}`; secondary: `#${string}`; emissive: `#${string}` };
  accessories: readonly string[];
};

export const motionAthleteCast: readonly CharacterVariant[] = [
  {
    id: "explorer",
    label: "Explorer",
    rigId: CANONICAL_RIG_ID,
    silhouette: "compact-backpack",
    palette: { primary: "#e8eff5", secondary: "#4f6f82", emissive: "#35d7ff" },
    accessories: ["visor", "backpack-beacon"]
  },
  {
    id: "runner",
    label: "Runner",
    rigId: CANONICAL_RIG_ID,
    silhouette: "streamlined-shoulders",
    palette: { primary: "#f4f7fb", secondary: "#62395e", emissive: "#ff3bd7" },
    accessories: ["heel-fins", "speed-band"]
  },
  {
    id: "trickster",
    label: "Trickster",
    rigId: CANONICAL_RIG_ID,
    silhouette: "asymmetric-antennae",
    palette: { primary: "#f6f0d9", secondary: "#66571f", emissive: "#ffe176" },
    accessories: ["tilted-antenna", "wrist-projector"]
  },
  {
    id: "guardian",
    label: "Guardian",
    rigId: CANONICAL_RIG_ID,
    silhouette: "broad-shoulder-plates",
    palette: { primary: "#e9f4ee", secondary: "#33594a", emissive: "#5fff9e" },
    accessories: ["shoulder-plates", "shield-core"]
  }
] as const;

export type AnimationClipName =
  | "idle-neutral"
  | "idle-alert"
  | "walk"
  | "run"
  | "strafe-left"
  | "strafe-right"
  | "turn-left"
  | "turn-right"
  | "pivot"
  | "stop-recover"
  | "jump-anticipation"
  | "jump-airborne"
  | "land-light"
  | "land-heavy"
  | "dodge"
  | "collect"
  | "interact"
  | "hit"
  | "fall"
  | "revive"
  | "point"
  | "wave"
  | "celebrate-small"
  | "celebrate-large"
  | "celebrate-team"
  | "disappointment"
  | "fear"
  | "confused"
  | "taunt";

export type AnimationClipDefinition = {
  name: AnimationClipName;
  layer: "locomotion" | "full-body" | "upper-body";
  loop: boolean;
  durationMillis: number;
  interruptPriority: number;
  additive: boolean;
};

export const minimumAnimationLibrary: readonly AnimationClipDefinition[] = [
  clip("idle-neutral", "locomotion", true, 2_400, 0),
  clip("idle-alert", "locomotion", true, 1_800, 0),
  clip("walk", "locomotion", true, 900, 0),
  clip("run", "locomotion", true, 640, 0),
  clip("strafe-left", "locomotion", true, 780, 0),
  clip("strafe-right", "locomotion", true, 780, 0),
  clip("turn-left", "locomotion", true, 620, 0),
  clip("turn-right", "locomotion", true, 620, 0),
  clip("pivot", "locomotion", false, 320, 12),
  clip("stop-recover", "locomotion", false, 360, 10),
  clip("jump-anticipation", "full-body", false, 180, 70),
  clip("jump-airborne", "full-body", true, 420, 70),
  clip("land-light", "full-body", false, 260, 72),
  clip("land-heavy", "full-body", false, 420, 74),
  clip("dodge", "full-body", false, 380, 76),
  clip("collect", "full-body", false, 480, 45),
  clip("interact", "upper-body", false, 520, 30, true),
  clip("hit", "full-body", false, 460, 90),
  clip("fall", "full-body", false, 900, 100),
  clip("revive", "full-body", false, 800, 95),
  clip("point", "upper-body", false, 650, 22, true),
  clip("wave", "upper-body", false, 900, 20, true),
  clip("celebrate-small", "upper-body", false, 950, 35, true),
  clip("celebrate-large", "full-body", false, 1_500, 60),
  clip("celebrate-team", "full-body", false, 1_800, 62),
  clip("disappointment", "upper-body", false, 1_100, 30, true),
  clip("fear", "upper-body", false, 760, 34, true),
  clip("confused", "upper-body", false, 1_000, 18, true),
  clip("taunt", "upper-body", false, 1_000, 16, true)
] as const;

export type CharacterEmotion = "neutral" | "happy" | "afraid" | "frustrated" | "excited";
export type SocialGesture = "point" | "wave" | "taunt";
export type GameplayAction =
  | "none"
  | "jump"
  | "airborne"
  | "land-light"
  | "land-heavy"
  | "dodge"
  | "collect"
  | "interact"
  | "hit"
  | "fall"
  | "revive"
  | "celebrate-small"
  | "celebrate-large"
  | "celebrate-team";

export type AnimationParameters = {
  velocity: { x: number; y: number };
  acceleration: { x: number; y: number };
  angularVelocity: number;
  grounded: boolean;
  action: GameplayAction;
  intention: string;
  targetDirection?: { x: number; y: number };
  emotion: CharacterEmotion;
  /** An explicit authored social cue. It never changes authoritative game state. */
  socialGesture?: SocialGesture;
  recentEvent?: "blocked" | "near-miss" | "objective-selected" | "damage" | "success" | "failure";
  timeSinceMovementBeganMillis: number;
  timeSinceMovementEndedMillis: number;
};

export type AnimationChannelState = {
  clip: AnimationClipName;
  previousClip?: AnimationClipName;
  /** Compatibility alias for currentWeight. */
  blend: number;
  currentWeight: number;
  previousWeight: number;
  elapsedMillis: number;
  previousElapsedMillis?: number;
  fadingOut?: boolean;
};

export type AnimationGraphState = {
  nowMillis: number;
  locomotion: AnimationChannelState;
  fullBody?: AnimationChannelState;
  upperBody?: AnimationChannelState;
  playbackRate: number;
};

export function createAnimationGraphState(): AnimationGraphState {
  return {
    nowMillis: 0,
    locomotion: channel("idle-neutral"),
    playbackRate: 1
  };
}

export function advanceAnimationGraph(
  previous: AnimationGraphState,
  parameters: AnimationParameters,
  deltaMillis: number
): AnimationGraphState {
  const delta = Number.isFinite(deltaMillis) ? Math.max(0, deltaMillis) : 0;
  const desiredLocomotion = selectLocomotion(parameters);
  const desiredFullBody = selectFullBody(parameters);
  const desiredUpperBody = selectUpperBody(parameters);
  const speed = Math.hypot(parameters.velocity.x, parameters.velocity.y);
  return {
    nowMillis: previous.nowMillis + delta,
    locomotion: advanceChannel(previous.locomotion, desiredLocomotion, delta, 140),
    ...(advanceOptionalChannel(previous.fullBody, desiredFullBody, delta, 90) ?? {}),
    ...(advanceOptionalChannel(previous.upperBody, desiredUpperBody, delta, 120, "upperBody") ?? {}),
    playbackRate: locomotionPlaybackRate(desiredLocomotion, speed)
  };
}

export function animationBlendWeights(channelState: AnimationChannelState): Record<string, number> {
  const weights: Record<string, number> = {};
  if (channelState.previousClip !== undefined && channelState.previousWeight > 0) {
    weights[channelState.previousClip] = channelState.previousWeight;
  }
  if (channelState.currentWeight > 0) {
    weights[channelState.clip] = (weights[channelState.clip] ?? 0) + channelState.currentWeight;
  }
  return weights;
}

export type ProceduralPose = {
  headYawRadians: number;
  headPitchRadians: number;
  bodyLeanX: number;
  bodyLeanY: number;
  blink: number;
  pointWeight: number;
  lookOverShoulderWeight: number;
  startleWeight: number;
  breathingWeight: number;
  emotionWeight: number;
};

export function proceduralPose(
  parameters: AnimationParameters,
  tick: number,
  seed: number
): ProceduralPose {
  const target = parameters.targetDirection ?? { x: 0, y: 1 };
  const targetAngle = Math.atan2(target.x, target.y);
  const speed = Math.hypot(parameters.velocity.x, parameters.velocity.y);
  const acceleration = Math.hypot(parameters.acceleration.x, parameters.acceleration.y);
  const blinkPhase = positiveModulo(tick + seed * 17, 173);
  const emotionWeight = parameters.emotion === "neutral" ? 0 : 1;
  return {
    headYawRadians: clamp(targetAngle, -0.75, 0.75),
    headPitchRadians: parameters.emotion === "afraid" ? -0.12 : parameters.emotion === "frustrated" ? 0.15 : 0,
    bodyLeanX: clamp(parameters.acceleration.x * 0.08, -0.3, 0.3),
    bodyLeanY: clamp(acceleration * 0.045 + Math.abs(parameters.angularVelocity) * 0.04, 0, 0.35),
    blink: blinkPhase <= 2 ? 1 - blinkPhase / 3 : 0,
    pointWeight: parameters.socialGesture === "point" || parameters.recentEvent === "objective-selected" ||
      (parameters.intention !== "wait" && parameters.timeSinceMovementBeganMillis < 220) ? 1 : 0,
    lookOverShoulderWeight: parameters.emotion === "afraid" && speed > 0.2 ? 1 : 0,
    startleWeight: parameters.recentEvent === "near-miss" || parameters.recentEvent === "damage" ? 1 : 0,
    breathingWeight: speed < 0.08 ? 1 : 0.25,
    emotionWeight
  };
}

export type RenderableAgentSnapshot = {
  id: string;
  tick: number;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facingRadians: number;
  grounded: boolean;
  action: string;
  intention: string;
  targetId?: string;
  emotion: CharacterEmotion;
};

export function interpolateAgentSnapshot(
  previous: RenderableAgentSnapshot,
  next: RenderableAgentSnapshot,
  alpha: number
): RenderableAgentSnapshot {
  if (previous.id !== next.id) throw new Error("Cannot interpolate different agents");
  const t = clamp(alpha, 0, 1);
  const discrete = t < 0.5 ? previous : next;
  return {
    id: next.id,
    tick: discrete.tick,
    position: {
      x: lerp(previous.position.x, next.position.x, t),
      y: lerp(previous.position.y, next.position.y, t)
    },
    velocity: {
      x: lerp(previous.velocity.x, next.velocity.x, t),
      y: lerp(previous.velocity.y, next.velocity.y, t)
    },
    facingRadians: previous.facingRadians + shortestAngle(previous.facingRadians, next.facingRadians) * t,
    grounded: discrete.grounded,
    action: discrete.action,
    intention: discrete.intention,
    emotion: discrete.emotion,
    ...(discrete.targetId === undefined ? {} : { targetId: discrete.targetId })
  };
}

export type GridToWorldTransform = {
  tileSize: number;
  originX: number;
  originZ: number;
  floorY: number;
  invertY: boolean;
};

export const defaultGridToWorldTransform: GridToWorldTransform = {
  tileSize: 0.25,
  originX: -1.875,
  originZ: -3.875,
  floorY: 0,
  invertY: false
};

export function gridToWorld(
  point: { x: number; y: number },
  transform: GridToWorldTransform = defaultGridToWorldTransform
): { x: number; y: number; z: number } {
  return {
    x: transform.originX + point.x * transform.tileSize,
    y: transform.floorY,
    z: transform.originZ + (transform.invertY ? -point.y : point.y) * transform.tileSize
  };
}

export type CharacterQualityTier = "venue-high" | "desktop-medium" | "mobile-low" | "capture";

export type CharacterQualityProfile = {
  id: CharacterQualityTier;
  maxCharacters: number;
  dprCap: number;
  shadows: "none" | "contact" | "key-character" | "full";
  particlesPerEvent: number;
  lodDistances: readonly [number, number];
  maxTrianglesPerCharacter: number;
  maxDrawCallsPerCharacter: number;
  /** Floor, grid, debug overlays, and other renderer-owned scene passes. */
  fixedSceneDrawCallAllowance: number;
  maxTextureMegabytes: number;
  maxFrameMillis: number;
};

export const characterQualityProfiles: Readonly<Record<CharacterQualityTier, CharacterQualityProfile>> = {
  "venue-high": quality("venue-high", 10, 2, "key-character", 36, [6, 13], 40_000, 3, 6, 8, 16.7),
  "desktop-medium": quality("desktop-medium", 10, 1.5, "contact", 18, [5, 10], 28_000, 2, 6, 5, 20),
  "mobile-low": quality("mobile-low", 6, 1, "none", 6, [3.5, 7], 12_000, 1, 6, 2, 33.3),
  capture: quality("capture", 10, 2, "full", 64, [9, 18], 40_000, 3, 6, 8, 33.3)
};

export type CharacterPerformanceSample = {
  frameMillis: number;
  animationMillis: number;
  drawCalls: number;
  triangles: number;
  textureMegabytes: number;
  characters: number;
};

export type CharacterPerformanceReport = {
  samples: number;
  averageFrameMillis: number;
  p95FrameMillis: number;
  worstFrameMillis: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxTextureMegabytes: number;
  withinBudget: boolean;
  violations: string[];
};

export class CharacterPerformanceMonitor {
  private readonly samples: CharacterPerformanceSample[] = [];

  constructor(
    private readonly profile: CharacterQualityProfile,
    private readonly maxSamples = 600
  ) {
    if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
      throw new Error("Character performance sample capacity must be a positive integer");
    }
  }

  record(sample: CharacterPerformanceSample): void {
    if (Object.values(sample).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error("Character performance samples must be finite and non-negative");
    }
    this.samples.push({ ...sample });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  report(): CharacterPerformanceReport {
    const frames = this.samples.map((sample) => sample.frameMillis).sort((a, b) => a - b);
    const violations: string[] = [];
    const averageFrameMillis = average(frames);
    const p95FrameMillis = percentile(frames, 0.95);
    const worstFrameMillis = frames.at(-1) ?? 0;
    const maxDrawCalls = maximum(this.samples.map((sample) => sample.drawCalls));
    const maxTriangles = maximum(this.samples.map((sample) => sample.triangles));
    const maxTextureMegabytes = maximum(this.samples.map((sample) => sample.textureMegabytes));
    const maxCharacters = maximum(this.samples.map((sample) => sample.characters));
    if (p95FrameMillis > this.profile.maxFrameMillis) violations.push("frame-time");
    if (maxCharacters > this.profile.maxCharacters) violations.push("character-count");
    const drawCallsExceeded = this.samples.some((sample) => sample.drawCalls >
      this.profile.maxDrawCallsPerCharacter * sample.characters + this.profile.fixedSceneDrawCallAllowance);
    if (drawCallsExceeded) violations.push("draw-calls");
    const trianglesExceeded = this.samples.some((sample) => sample.triangles >
      this.profile.maxTrianglesPerCharacter * Math.max(1, sample.characters));
    if (trianglesExceeded) violations.push("triangles");
    if (maxTextureMegabytes > this.profile.maxTextureMegabytes) violations.push("texture-memory");
    return {
      samples: frames.length,
      averageFrameMillis,
      p95FrameMillis,
      worstFrameMillis,
      maxDrawCalls,
      maxTriangles,
      maxTextureMegabytes,
      withinBudget: violations.length === 0,
      violations
    };
  }
}

export type GlbInspection = {
  version: number;
  bytes: number;
  generator?: string;
  scenes: number;
  nodes: string[];
  bones: string[];
  skins: number;
  meshes: number;
  primitives: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: string[];
};

export type CharacterAssetManifest = {
  schemaVersion: typeof CHARACTER_ASSET_SCHEMA_VERSION;
  id: string;
  status: "canonical" | "interim" | "legacy";
  file: string;
  sha256?: string;
  source: string;
  author: string;
  license: string;
  attributionRequired: boolean;
  maxBytes: number;
  maxMaterials: number;
  maxTriangles: number;
  expectedClips: readonly string[];
  requiredBones: readonly string[];
};

export const sahurAssetManifest: CharacterAssetManifest = {
  schemaVersion: CHARACTER_ASSET_SCHEMA_VERSION,
  id: "sahur-mixamo-interim",
  status: "interim",
  file: "assets/tung-tung-tung-sahur.glb",
  sha256: "0107681fe307b9b8200abbfbf711659c6e837c8293f833b3c7fbdc5438fb9d92",
  source: "https://sketchfab.com/3d-models/tung-tung-tung-sahur-lowpoly-mixamo-rig-99c84a57df394dc8b3976f5582f74c52",
  author: "KAG3D",
  license: "CC-BY-4.0",
  attributionRequired: true,
  maxBytes: 300_000,
  maxMaterials: 2,
  maxTriangles: 2_000,
  expectedClips: ["Armature|walk"],
  requiredBones: ["Hips", "Spine", "Head", "LeftArm", "RightArm", "LeftUpLeg", "RightUpLeg"]
};

export const quaterniusAnimationClips = Object.freeze([
  "Death", "Gun_Shoot", "HitRecieve", "HitRecieve_2", "Idle", "Idle_Gun",
  "Idle_Gun_Pointing", "Idle_Gun_Shoot", "Idle_Neutral", "Idle_Sword", "Interact",
  "Kick_Left", "Kick_Right", "Punch_Left", "Punch_Right", "Roll", "Run", "Run_Back",
  "Run_Left", "Run_Right", "Run_Shoot", "Sword_Slash", "Walk", "Wave"
] as const);

export type QuaterniusCharacterAsset = Readonly<{
  id: string;
  label: string;
  fileName: string;
  source: string;
  sha256: string;
  bytes: number;
  maxTriangles: number;
}>;

const quaterniusMenSource = "https://quaternius.com/packs/ultimatemodularcharacters.html";
const quaterniusWomenSource = "https://quaternius.com/packs/ultimatemodularwomen.html";

export const quaterniusCharacterAssets: readonly QuaterniusCharacterAsset[] = Object.freeze([
  quaternius("adventurer", "Aventurero", "adventurer.glb", quaterniusMenSource, "359ce77215e3d4bf7ed9fa45d343280a8a1b3511ea07721a88f58fc36dec2f1a", 817_116, 10_500),
  quaternius("casual-hoodie", "Urbano", "casual-hoodie.glb", quaterniusMenSource, "903f460b55dd1563381739d56a495eadba82cf0d268e4c23e8c03753bb36bca7", 745_836, 6_500),
  quaternius("punk", "Punk", "punk.glb", quaterniusMenSource, "7cc6c3af903d16df88dc917cde0e4ac9f02f1b44196632e1dbc921511bcff772", 737_424, 6_000),
  quaternius("spacesuit", "Astronauta", "spacesuit.glb", quaterniusMenSource, "2d3fbe5b2f03f6f1d08eb28a58a4ccf2f5ec4fd2f1dbbf3f93978457d708fb91", 812_556, 11_000),
  quaternius("swat", "Unidad táctica", "swat.glb", quaterniusMenSource, "68db9fd01465d4f584f4c7dcb54df67010d2e4ae4ad8355aefc5226e0f674f5f", 782_300, 9_000),
  quaternius("worker", "Constructor", "worker.glb", quaterniusMenSource, "62957fdcf4f54976240bfcb6ff16c0761873ea8c5f164d54648459c841d382c5", 734_968, 5_500),
  quaternius("trailblazer", "Pionera", "trailblazer.glb", quaterniusWomenSource, "c8bff37f0e8fef9e962a2a960558e0396dde9ca7d1bc2fdc5ac90f31523613f2", 761_708, 7_000),
  quaternius("street-scout", "Exploradora urbana", "street-scout.glb", quaterniusWomenSource, "b833ebb8d564a4c99ed2c6c7b2f688cd309c714d870cced4526d97db6d17f1d3", 743_904, 6_700),
  quaternius("star-pilot", "Piloto estelar", "star-pilot.glb", quaterniusWomenSource, "e6d802b27b085df54afcfeb13e95c6832959d46257d985f2f7b53f5239bead76", 783_620, 8_300),
  quaternius("mystic", "Mística", "mystic.glb", quaterniusWomenSource, "3e39ea410be4b8b0fd1c0b0be3e506c7c8073e07e5bd0150efce9f826f50128d", 757_612, 7_100)
]);

export const quaterniusAssetManifests: readonly CharacterAssetManifest[] = Object.freeze(
  quaterniusCharacterAssets.map((asset): CharacterAssetManifest => ({
    schemaVersion: CHARACTER_ASSET_SCHEMA_VERSION,
    id: `quaternius-${asset.id}`,
    status: "interim",
    file: `assets/${asset.fileName}`,
    sha256: asset.sha256,
    source: asset.source,
    author: "Quaternius",
    license: "CC0-1.0",
    attributionRequired: false,
    maxBytes: 850_000,
    maxMaterials: 12,
    maxTriangles: asset.maxTriangles,
    expectedClips: quaterniusAnimationClips,
    requiredBones: ["Root", "Hips", "Chest", "Head", "UpperArm.L", "UpperArm.R", "UpperLeg.L", "UpperLeg.R"]
  }))
);

export const characterAssetManifests: readonly CharacterAssetManifest[] = Object.freeze([
  sahurAssetManifest,
  ...quaterniusAssetManifests
]);

function quaternius(
  id: string,
  label: string,
  fileName: string,
  source: string,
  sha256: string,
  bytes: number,
  maxTriangles: number
): QuaterniusCharacterAsset {
  return Object.freeze({ id, label, fileName, source, sha256, bytes, maxTriangles });
}

export type CharacterAssetValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validateCharacterAsset(
  manifest: CharacterAssetManifest,
  inspection: GlbInspection
): CharacterAssetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (manifest.schemaVersion !== CHARACTER_ASSET_SCHEMA_VERSION) errors.push("unsupported-schema");
  if (inspection.bytes > manifest.maxBytes) errors.push("file-size-budget");
  if (inspection.materials > manifest.maxMaterials) errors.push("material-budget");
  if (inspection.triangles > manifest.maxTriangles) errors.push("triangle-budget");
  const duplicateClips = duplicates(inspection.animations);
  if (duplicateClips.length > 0) errors.push(`duplicate-clips:${duplicateClips.join(",")}`);
  const missingClips = manifest.expectedClips.filter((name) => !inspection.animations.includes(name));
  if (missingClips.length > 0) errors.push(`missing-clips:${missingClips.join(",")}`);
  const missingBones = manifest.requiredBones.filter((name) => !inspection.bones.some((bone) => boneNameMatches(bone, name)));
  if (missingBones.length > 0) errors.push(`missing-bones:${missingBones.join(",")}`);
  if (manifest.status !== "canonical") warnings.push(`asset-status:${manifest.status}`);
  const minimumNames = new Set(minimumAnimationLibrary.map((definition) => definition.name));
  const canonicalCoverage = inspection.animations.filter((name) => minimumNames.has(name as AnimationClipName)).length;
  if (canonicalCoverage < minimumAnimationLibrary.length) {
    warnings.push(`canonical-animation-coverage:${canonicalCoverage}/${minimumAnimationLibrary.length}`);
  }
  if (manifest.attributionRequired) warnings.push(`attribution-required:${manifest.author}`);
  return { valid: errors.length === 0, errors, warnings };
}

export function inspectGlb(bytes: Uint8Array): GlbInspection {
  if (bytes.byteLength < 20) throw new Error("GLB is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Invalid GLB magic");
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  if (declaredLength !== bytes.byteLength) throw new Error("GLB declared length does not match file size");
  let offset = 12;
  let json: GltfJson | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) throw new Error("GLB chunk extends beyond the file");
    if (type === 0x4e4f534a) {
      let raw = new TextDecoder().decode(bytes.subarray(start, end));
      while (raw.endsWith("\u0000") || raw.endsWith(" ")) raw = raw.slice(0, -1);
      json = JSON.parse(raw) as GltfJson;
    }
    offset = end;
  }
  if (!json) throw new Error("GLB does not contain a JSON chunk");
  const accessors = json.accessors ?? [];
  const nodes = json.nodes ?? [];
  const boneIndices = new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []));
  let primitives = 0;
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      const indexCount = primitive.indices === undefined ? undefined : accessors[primitive.indices]?.count;
      const positionIndex = primitive.attributes?.POSITION;
      const vertexCount = positionIndex === undefined ? undefined : accessors[positionIndex]?.count;
      triangles += Math.floor((indexCount ?? vertexCount ?? 0) / 3);
    }
  }
  return {
    version,
    bytes: bytes.byteLength,
    ...(json.asset?.generator ? { generator: json.asset.generator } : {}),
    scenes: json.scenes?.length ?? 0,
    nodes: nodes.map((node, index) => node.name ?? `node-${index}`),
    bones: [...boneIndices].map((index) => nodes[index]?.name ?? `node-${index}`),
    skins: json.skins?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    primitives,
    triangles,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    animations: (json.animations ?? []).map((animation, index) => animation.name ?? `animation-${index}`)
  };
}

type GltfJson = {
  asset?: { generator?: string };
  accessors?: Array<{ count?: number }>;
  animations?: Array<{ name?: string }>;
  materials?: unknown[];
  meshes?: Array<{
    primitives?: Array<{ indices?: number; attributes?: { POSITION?: number } }>;
  }>;
  nodes?: Array<{ name?: string }>;
  scenes?: unknown[];
  skins?: Array<{ joints?: number[] }>;
  textures?: unknown[];
};

function clip(
  name: AnimationClipName,
  layer: AnimationClipDefinition["layer"],
  loop: boolean,
  durationMillis: number,
  interruptPriority: number,
  additive = false
): AnimationClipDefinition {
  return { name, layer, loop, durationMillis, interruptPriority, additive };
}

function channel(name: AnimationClipName): AnimationChannelState {
  return {
    clip: name,
    blend: 1,
    currentWeight: 1,
    previousWeight: 0,
    elapsedMillis: 0
  };
}

function selectLocomotion(parameters: AnimationParameters): AnimationClipName {
  const speed = Math.hypot(parameters.velocity.x, parameters.velocity.y);
  if (speed < 0.08) {
    if (Math.abs(parameters.angularVelocity) > 0.8) return parameters.angularVelocity < 0 ? "turn-left" : "turn-right";
    if (parameters.timeSinceMovementEndedMillis >= 0
      && parameters.timeSinceMovementEndedMillis < animationDefinition("stop-recover").durationMillis) {
      return "stop-recover";
    }
    return parameters.intention === "wait" ? "idle-neutral" : "idle-alert";
  }
  if (Math.abs(parameters.angularVelocity) > 2.4 || Math.hypot(parameters.acceleration.x, parameters.acceleration.y) > 4) {
    return "pivot";
  }
  const target = parameters.targetDirection;
  if (target && Math.abs(target.x) > Math.abs(target.y) * 1.6) return target.x < 0 ? "strafe-left" : "strafe-right";
  return speed > 2.2 ? "run" : "walk";
}

function selectFullBody(parameters: AnimationParameters): AnimationClipName | undefined {
  const mapping: Partial<Record<GameplayAction, AnimationClipName>> = {
    jump: "jump-anticipation",
    airborne: "jump-airborne",
    "land-light": "land-light",
    "land-heavy": "land-heavy",
    dodge: "dodge",
    collect: "collect",
    hit: "hit",
    fall: "fall",
    revive: "revive",
    "celebrate-large": "celebrate-large",
    "celebrate-team": "celebrate-team"
  };
  return mapping[parameters.action];
}

function selectUpperBody(parameters: AnimationParameters): AnimationClipName | undefined {
  if (parameters.action === "interact") return "interact";
  if (parameters.action === "celebrate-small") return "celebrate-small";
  if (parameters.socialGesture !== undefined) return parameters.socialGesture;
  if (parameters.recentEvent === "objective-selected") return "point";
  if (parameters.recentEvent === "success") return "celebrate-small";
  if (parameters.recentEvent === "failure") return "disappointment";
  if (parameters.recentEvent === "near-miss" || parameters.recentEvent === "damage") return "fear";
  if (parameters.recentEvent === "blocked") return "confused";
  if (parameters.emotion === "afraid") return "fear";
  if (parameters.emotion === "frustrated") return "confused";
  return undefined;
}

function advanceOptionalChannel(
  previous: AnimationChannelState | undefined,
  desired: AnimationClipName | undefined,
  deltaMillis: number,
  blendMillis: number,
  key: "fullBody" | "upperBody" = "fullBody"
): Pick<AnimationGraphState, "fullBody" | "upperBody"> | undefined {
  if (!desired && !previous) return undefined;
  if (!desired && previous) {
    const definition = animationDefinition(previous.clip);
    if (!previous.fadingOut && !definition.loop && previous.elapsedMillis < definition.durationMillis) {
      return { [key]: advanceChannel(previous, previous.clip, deltaMillis, blendMillis) };
    }
    const faded = fadeOutChannel(previous, deltaMillis, blendMillis);
    return faded.currentWeight > 0 ? { [key]: faded } : undefined;
  }
  if (!desired) return undefined;
  if (!previous) return { [key]: fadeInChannel(desired, deltaMillis, blendMillis) };
  const previousDefinition = animationDefinition(previous.clip);
  const desiredDefinition = animationDefinition(desired);
  const locked = !previousDefinition.loop &&
    previous.elapsedMillis < previousDefinition.durationMillis &&
    previousDefinition.interruptPriority > desiredDefinition.interruptPriority;
  return { [key]: advanceChannel(previous, locked ? previous.clip : desired, deltaMillis, blendMillis) };
}

function advanceChannel(
  previous: AnimationChannelState,
  desired: AnimationClipName,
  deltaMillis: number,
  blendMillis: number
): AnimationChannelState {
  if (previous.clip !== desired) {
    const outgoing = dominantAnimationSample(previous);
    const currentWeight = blendMillis === 0 ? 1 : clamp(deltaMillis / blendMillis, 0, 1);
    const previousWeight = outgoing.weight * (1 - currentWeight);
    return {
      clip: desired,
      ...(previousWeight > 0 ? {
        previousClip: outgoing.clip,
        previousElapsedMillis: outgoing.elapsedMillis + deltaMillis
      } : {}),
      blend: currentWeight,
      currentWeight,
      previousWeight,
      elapsedMillis: deltaMillis
    };
  }
  const blendStep = blendMillis === 0 ? 1 : deltaMillis / blendMillis;
  const currentWeight = clamp(previous.currentWeight + blendStep, 0, 1);
  const previousWeight = previous.previousClip === undefined
    ? 0
    : clamp(previous.previousWeight - blendStep, 0, 1);
  return {
    clip: previous.clip,
    ...(previousWeight > 0 && previous.previousClip !== undefined ? {
      previousClip: previous.previousClip,
      previousElapsedMillis: (previous.previousElapsedMillis ?? 0) + deltaMillis
    } : {}),
    blend: currentWeight,
    currentWeight,
    previousWeight,
    elapsedMillis: previous.elapsedMillis + deltaMillis
  };
}

function fadeInChannel(
  name: AnimationClipName,
  deltaMillis: number,
  blendMillis: number
): AnimationChannelState {
  const currentWeight = blendMillis === 0 ? 1 : clamp(deltaMillis / blendMillis, 0, 1);
  return {
    clip: name,
    blend: currentWeight,
    currentWeight,
    previousWeight: 0,
    elapsedMillis: deltaMillis
  };
}

function fadeOutChannel(
  previous: AnimationChannelState,
  deltaMillis: number,
  blendMillis: number
): AnimationChannelState {
  const blendStep = blendMillis === 0 ? 1 : deltaMillis / blendMillis;
  const currentWeight = clamp(previous.currentWeight - blendStep, 0, 1);
  return {
    clip: previous.clip,
    blend: currentWeight,
    currentWeight,
    previousWeight: 0,
    elapsedMillis: previous.elapsedMillis + deltaMillis,
    fadingOut: true
  };
}

function dominantAnimationSample(channelState: AnimationChannelState): Readonly<{
  clip: AnimationClipName;
  elapsedMillis: number;
  weight: number;
}> {
  if (channelState.previousClip !== undefined && channelState.previousWeight > channelState.currentWeight) {
    return {
      clip: channelState.previousClip,
      elapsedMillis: channelState.previousElapsedMillis ?? 0,
      weight: channelState.previousWeight
    };
  }
  return {
    clip: channelState.clip,
    elapsedMillis: channelState.elapsedMillis,
    weight: channelState.currentWeight
  };
}

function animationDefinition(name: AnimationClipName): AnimationClipDefinition {
  const definition = minimumAnimationLibrary.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Unknown animation clip ${name}`);
  return definition;
}

function locomotionPlaybackRate(clipName: AnimationClipName, speed: number): number {
  if (clipName !== "walk" && clipName !== "run" && !clipName.startsWith("strafe")) return 1;
  const authoredSpeed = clipName === "run" ? 3 : 1.4;
  return clamp(speed / authoredSpeed, 0.75, 1.25);
}

function quality(
  id: CharacterQualityTier,
  maxCharacters: number,
  dprCap: number,
  shadows: CharacterQualityProfile["shadows"],
  particlesPerEvent: number,
  lodDistances: readonly [number, number],
  maxTrianglesPerCharacter: number,
  maxDrawCallsPerCharacter: number,
  fixedSceneDrawCallAllowance: number,
  maxTextureMegabytes: number,
  maxFrameMillis: number
): CharacterQualityProfile {
  return {
    id,
    maxCharacters,
    dprCap,
    shadows,
    particlesPerEvent,
    lodDistances,
    maxTrianglesPerCharacter,
    maxDrawCallsPerCharacter,
    fixedSceneDrawCallAllowance,
    maxTextureMegabytes,
    maxFrameMillis
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] ?? 0;
}

function maximum(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function boneNameMatches(actual: string, expected: string): boolean {
  const withoutNamespace = actual.split(":").at(-1) ?? actual;
  const withoutExportSuffix = withoutNamespace.replace(/_\d+$/u, "");
  return withoutExportSuffix === expected;
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function shortestAngle(from: number, to: number): number {
  const tau = Math.PI * 2;
  let delta = (to - from) % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta < -Math.PI) delta += tau;
  return delta;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minimum, value));
}
