import {
  Bone,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Uint16BufferAttribute,
  Vector3,
  type BufferGeometry,
  type Material
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  canonicalRig,
  minimumAnimationLibrary,
  motionAthleteCast,
  type AnimationClipName,
  type AnimationGraphState,
  type AnimationParameters,
  type CanonicalBoneName,
  type CharacterArchetype,
  type CharacterEmotion,
  type CharacterVariant,
  type ProceduralPose
} from "@motion-levels-games/character-runtime";
import { disposeGeometryOnce, disposeMaterialOnce } from "./disposal.ts";
import type { RendererLod } from "./contracts.ts";

type RigNodes = Readonly<Record<CanonicalBoneName, Group>>;
type ShadowMode = "none" | "contact" | "key" | "full";
type GeometryDetail = "high" | "medium";

type RigidPart = Readonly<{
  bone: CanonicalBoneName;
  geometry: BufferGeometry;
  color: string;
  scale: readonly [number, number, number];
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  accent?: boolean;
  blink?: boolean;
}>;

type AthleteShaderUniforms = Readonly<{
  blinkScale: { value: number };
  accentIntensity: { value: number };
}>;

const RIG_PARENT: Readonly<Record<CanonicalBoneName, CanonicalBoneName | undefined>> = Object.freeze({
  root: undefined,
  hips: "root",
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  upper_arm_l: "chest",
  lower_arm_l: "upper_arm_l",
  hand_l: "lower_arm_l",
  upper_arm_r: "chest",
  lower_arm_r: "upper_arm_r",
  hand_r: "lower_arm_r",
  upper_leg_l: "hips",
  lower_leg_l: "upper_leg_l",
  foot_l: "lower_leg_l",
  toe_l: "foot_l",
  upper_leg_r: "hips",
  lower_leg_r: "upper_leg_r",
  foot_r: "lower_leg_r",
  toe_r: "foot_r"
});

const BIND_POSITION: Readonly<Record<CanonicalBoneName, readonly [number, number, number]>> = Object.freeze({
  root: [0, 0, 0],
  hips: [0, 0.74, 0],
  spine: [0, 0.17, 0],
  chest: [0, 0.19, 0],
  neck: [0, 0.17, 0],
  head: [0, 0.13, 0],
  upper_arm_l: [0.24, 0.1, 0],
  lower_arm_l: [0.25, 0, 0],
  hand_l: [0.22, 0, 0],
  upper_arm_r: [-0.24, 0.1, 0],
  lower_arm_r: [-0.25, 0, 0],
  hand_r: [-0.22, 0, 0],
  upper_leg_l: [0.12, -0.04, 0],
  lower_leg_l: [0, -0.35, 0],
  foot_l: [0, -0.34, 0],
  toe_l: [0, -0.08, 0.12],
  upper_leg_r: [-0.12, -0.04, 0],
  lower_leg_r: [0, -0.35, 0],
  foot_r: [0, -0.34, 0],
  toe_r: [0, -0.08, 0.12]
});

export class MotionAthleteGeometryPool {
  public readonly box = new BoxGeometry(1, 1, 1, 1, 1, 1);
  public readonly sphere = new SphereGeometry(0.5, 12, 8);
  public readonly cylinder = new CylinderGeometry(0.5, 0.5, 1, 10, 1);
  public readonly cone = new ConeGeometry(0.5, 1, 8, 1);
  public readonly torus = new TorusGeometry(0.5, 0.12, 6, 12);
  public readonly circle = new CircleGeometry(0.5, 20);
  readonly #athleteGeometries = new Map<string, BufferGeometry>();
  #disposed = false;

  public athleteGeometry(variant: CharacterVariant, detail: GeometryDetail): BufferGeometry {
    if (this.#disposed) throw new Error("MotionAthleteGeometryPool has been disposed");
    const key = `${variant.id}:${detail}`;
    let geometry = this.#athleteGeometries.get(key);
    if (geometry === undefined) {
      geometry = buildAthleteGeometry(this, variant, detail);
      geometry.name = `motion-athlete-${variant.id}-${detail}`;
      this.#athleteGeometries.set(key, geometry);
    }
    return geometry;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const geometry of this.geometries()) disposeGeometryOnce(geometry);
    this.#athleteGeometries.clear();
  }

  public geometries(): readonly BufferGeometry[] {
    return Object.freeze([
      this.box,
      this.sphere,
      this.cylinder,
      this.cone,
      this.torus,
      this.circle,
      ...this.#athleteGeometries.values()
    ]);
  }
}

export type CanonicalRigNodes = Readonly<{
  root: Group;
  bones: RigNodes;
}>;

/** Creates the same canonical hierarchy for every procedural visual variant. */
export function createCanonicalRigNodes(): CanonicalRigNodes {
  const mutable = {} as Record<CanonicalBoneName, Group>;
  for (const boneName of canonicalRig.bones) {
    const bone = new Bone();
    bone.name = boneName;
    bone.userData.canonicalBone = boneName;
    bone.position.set(...BIND_POSITION[boneName]);
    // Bone and Group share Object3D's transform/child contract. Keeping the
    // exported Group surface is backwards-compatible while Skeleton receives
    // real Bone instances at runtime.
    mutable[boneName] = bone as unknown as Group;
  }
  for (const boneName of canonicalRig.bones) {
    const parentName = RIG_PARENT[boneName];
    if (parentName !== undefined) mutable[parentName].add(mutable[boneName]);
  }
  return Object.freeze({ root: mutable.root, bones: Object.freeze(mutable) });
}

/** A procedural Motion Athlete rendered as one rigid-skinned body draw. */
export class MotionAthlete {
  public readonly variant: CharacterVariant;
  public readonly object = new Group();
  public readonly bones: RigNodes;
  readonly #materials: Material[] = [];
  readonly #bodyMesh: SkinnedMesh;
  readonly #lowDetailMesh: Mesh;
  readonly #skeleton: Skeleton;
  readonly #highGeometry: BufferGeometry;
  readonly #mediumGeometry: BufferGeometry;
  readonly #shaderUniforms: AthleteShaderUniforms = {
    blinkScale: { value: 1 },
    accentIntensity: { value: 0.35 }
  };
  readonly #bindPositions = new Map<CanonicalBoneName, readonly [number, number, number]>();
  #lod: RendererLod = "high";
  #shadowMode: ShadowMode = "contact";
  #isKeyCharacter = false;
  #disposed = false;

  public constructor(
    variantId: CharacterArchetype,
    resources: MotionAthleteGeometryPool
  ) {
    this.variant = findVariant(variantId);
    const rig = createCanonicalRigNodes();
    this.bones = rig.bones;
    for (const boneName of canonicalRig.bones) this.#bindPositions.set(boneName, BIND_POSITION[boneName]);

    this.#highGeometry = resources.athleteGeometry(this.variant, "high");
    this.#mediumGeometry = resources.athleteGeometry(this.variant, "medium");
    const bodyMaterial = this.#own(createBodyMaterial(this.#shaderUniforms));
    this.#bodyMesh = new SkinnedMesh(this.#highGeometry, bodyMaterial);
    this.#bodyMesh.name = "rigid-skinned-body";
    this.#bodyMesh.frustumCulled = false;

    const skeletonBones = canonicalRig.bones.map((boneName) => this.bones[boneName] as unknown as Bone);
    this.#skeleton = new Skeleton(skeletonBones);
    this.object.name = `motion-athlete:${variantId}`;
    this.object.add(rig.root, this.#bodyMesh);
    this.object.updateMatrixWorld(true);
    this.#bodyMesh.bind(this.#skeleton);

    const lowMaterial = this.#own(new MeshStandardMaterial({
      color: this.variant.palette.primary,
      roughness: 0.68,
      metalness: 0.08
    }));
    this.#lowDetailMesh = mesh(resources.cylinder, lowMaterial, [0.22, 0.72, 0.22], [0, 0.73, 0]);
    this.#lowDetailMesh.name = "low-detail-silhouette";
    this.object.add(this.#lowDetailMesh);
    this.setLod("high");
    this.setShadowMode("contact", false);
  }

  public setLod(lod: RendererLod): void {
    this.#assertActive();
    this.#lod = lod;
    this.object.visible = lod !== "hidden";
    this.#bodyMesh.visible = lod === "high" || lod === "medium";
    this.#bodyMesh.geometry = lod === "medium" ? this.#mediumGeometry : this.#highGeometry;
    this.#lowDetailMesh.visible = lod === "low";
  }

  public get lod(): RendererLod {
    return this.#lod;
  }

  public get contactShadowVisible(): boolean {
    return this.#shadowMode === "contact" && this.#lod !== "hidden";
  }

  public setShadowMode(mode: ShadowMode, isKeyCharacter: boolean): void {
    this.#assertActive();
    this.#shadowMode = mode;
    this.#isKeyCharacter = isKeyCharacter;
    const cast = mode === "full" || (mode === "key" && this.#isKeyCharacter);
    this.#bodyMesh.castShadow = cast;
    this.#bodyMesh.receiveShadow = false;
    this.#lowDetailMesh.castShadow = cast;
    this.#lowDetailMesh.receiveShadow = false;
  }

  public setWorldTransform(x: number, y: number, z: number, facingRadians: number): void {
    this.#assertActive();
    this.object.position.set(x, y, z);
    this.object.rotation.set(0, facingRadians, 0);
  }

  /** Applies graph and procedural layers without translating the rig root. */
  public applyPose(
    graph: AnimationGraphState,
    procedural: ProceduralPose,
    parameters: AnimationParameters,
    atMillis: number
  ): void {
    this.#assertActive();
    this.#resetRigPose();
    const speed = Math.hypot(parameters.velocity.x, parameters.velocity.y);
    this.#applyChannel(graph.locomotion, (clip, weight, elapsedMillis) => {
      this.#applyLocomotion(clip, weight, elapsedMillis, graph.playbackRate, speed);
    });
    if (graph.fullBody !== undefined) {
      this.#applyChannel(graph.fullBody, (clip, weight) => this.#applyFullBody(clip, weight));
    }
    if (graph.upperBody !== undefined) {
      this.#applyChannel(graph.upperBody, (clip, weight) => this.#applyUpperBody(clip, weight));
    }
    this.bones.spine.rotation.x += procedural.bodyLeanY;
    this.bones.spine.rotation.z -= procedural.bodyLeanX;
    this.bones.head.rotation.y += procedural.headYawRadians;
    this.bones.head.rotation.x += procedural.headPitchRadians;
    if (procedural.pointWeight > 0) {
      this.bones.upper_arm_r.rotation.z = -1.35 * procedural.pointWeight;
      this.bones.lower_arm_r.rotation.z = -0.25 * procedural.pointWeight;
    }
    if (procedural.lookOverShoulderWeight > 0) {
      this.bones.head.rotation.y += 0.35 * procedural.lookOverShoulderWeight;
    }
    if (procedural.startleWeight > 0) {
      this.bones.upper_arm_l.rotation.z -= 0.55 * procedural.startleWeight;
      this.bones.upper_arm_r.rotation.z += 0.55 * procedural.startleWeight;
    }
    this.#shaderUniforms.blinkScale.value = Math.max(0.08, 1 - procedural.blink * 0.92);
    this.bones.hips.position.y += Math.sin(atMillis / 430) * 0.012 * procedural.breathingWeight;
    this.#applyEmotion(parameters.emotion, procedural.emotionWeight);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.object.removeFromParent();
    this.object.clear();
    this.#skeleton.dispose();
    for (const material of this.#materials) disposeMaterialOnce(material);
  }

  #own<T extends Material>(material: T): T {
    this.#materials.push(material);
    return material;
  }

  #resetRigPose(): void {
    for (const boneName of canonicalRig.bones) {
      const position = this.#bindPositions.get(boneName) as readonly [number, number, number];
      const bone = this.bones[boneName];
      bone.position.set(...position);
      bone.rotation.set(0, 0, 0);
      bone.scale.set(1, 1, 1);
    }
  }

  #applyChannel(
    channel: AnimationGraphState["locomotion"],
    apply: (clip: AnimationClipName, weight: number, elapsedMillis: number) => void
  ): void {
    if (channel.previousClip !== undefined && channel.previousWeight > 0) {
      apply(channel.previousClip, channel.previousWeight, channel.previousElapsedMillis ?? 0);
    }
    if (channel.currentWeight > 0) {
      apply(channel.clip, channel.currentWeight, channel.elapsedMillis);
    }
  }

  #applyLocomotion(
    clip: AnimationClipName,
    weight: number,
    elapsedMillis: number,
    playbackRate: number,
    speed: number
  ): void {
    if (weight <= 0) return;
    const definition = minimumAnimationLibrary.find((candidate) => candidate.name === clip);
    const duration = definition?.durationMillis ?? 1_000;
    const cycle = elapsedMillis * playbackRate / duration * Math.PI * 2;
    if (clip === "walk" || clip === "run" || clip.startsWith("strafe")) {
      const stride = (clip === "run" ? 0.8 : 0.52) * Math.min(1, 0.45 + speed);
      const swing = Math.sin(cycle) * stride * weight;
      this.bones.upper_leg_l.rotation.x += swing;
      this.bones.upper_leg_r.rotation.x -= swing;
      this.bones.lower_leg_l.rotation.x += Math.max(0, -swing) * 0.7;
      this.bones.lower_leg_r.rotation.x += Math.max(0, swing) * 0.7;
      this.bones.upper_arm_l.rotation.z -= swing * 0.65;
      this.bones.upper_arm_r.rotation.z += swing * 0.65;
    } else if (clip.startsWith("turn") || clip === "pivot") {
      this.bones.chest.rotation.y += Math.sin(cycle) * 0.16 * weight;
    } else if (clip === "stop-recover") {
      this.bones.spine.rotation.x += Math.sin(Math.min(Math.PI, cycle * 0.5)) * 0.12 * weight;
    }
  }

  #applyFullBody(clip: AnimationClipName | undefined, weight: number): void {
    if (clip === undefined || weight <= 0) return;
    if (clip.startsWith("jump")) {
      this.bones.upper_leg_l.rotation.x -= 0.65 * weight;
      this.bones.upper_leg_r.rotation.x -= 0.65 * weight;
      this.bones.lower_leg_l.rotation.x += 1.1 * weight;
      this.bones.lower_leg_r.rotation.x += 1.1 * weight;
    } else if (clip.startsWith("land")) {
      this.bones.spine.rotation.x += 0.35 * weight;
      this.bones.upper_leg_l.rotation.x -= 0.3 * weight;
      this.bones.upper_leg_r.rotation.x -= 0.3 * weight;
    } else if (clip === "hit" || clip === "fall") {
      this.bones.spine.rotation.z += 0.45 * weight;
      this.bones.head.rotation.z -= 0.22 * weight;
    } else if (clip.startsWith("celebrate")) {
      this.bones.upper_arm_l.rotation.z -= 1.65 * weight;
      this.bones.upper_arm_r.rotation.z += 1.65 * weight;
    } else if (clip === "dodge") {
      this.bones.spine.rotation.z -= 0.55 * weight;
    } else if (clip === "collect") {
      this.bones.spine.rotation.x += 0.25 * weight;
      this.bones.upper_arm_l.rotation.z -= 0.65 * weight;
      this.bones.upper_arm_r.rotation.z += 0.65 * weight;
    }
  }

  #applyUpperBody(clip: AnimationClipName | undefined, weight: number): void {
    if (clip === undefined || weight <= 0) return;
    if (clip === "wave") {
      this.bones.upper_arm_r.rotation.z += 1.45 * weight;
      this.bones.lower_arm_r.rotation.x += 0.45 * weight;
    } else if (clip === "point") {
      this.bones.upper_arm_r.rotation.z -= 1.35 * weight;
    } else if (clip.startsWith("celebrate")) {
      this.bones.upper_arm_l.rotation.z -= 1.2 * weight;
      this.bones.upper_arm_r.rotation.z += 1.2 * weight;
    } else if (clip === "fear") {
      this.bones.upper_arm_l.rotation.z -= 0.5 * weight;
      this.bones.upper_arm_r.rotation.z += 0.5 * weight;
    } else if (clip === "disappointment") {
      this.bones.head.rotation.x += 0.3 * weight;
    }
  }

  #applyEmotion(emotion: CharacterEmotion, weight: number): void {
    const intensity = emotion === "neutral" ? 0.3
      : emotion === "happy" ? 0.72
        : emotion === "excited" ? 1
          : emotion === "afraid" ? 0.82
            : 0.5;
    this.#shaderUniforms.accentIntensity.value = intensity * Math.max(0.35, weight);
    const headScale = emotion === "afraid" ? 1.06 : emotion === "excited" ? 1.03 : 1;
    this.bones.head.scale.setScalar(headScale);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("MotionAthlete has been disposed");
  }
}

function buildAthleteGeometry(
  resources: MotionAthleteGeometryPool,
  variant: CharacterVariant,
  detail: GeometryDetail
): BufferGeometry {
  const parts = [...coreParts(resources, variant)];
  if (detail === "high") parts.push(...accessoryParts(resources, variant));
  const geometries = parts.map((partDefinition) => rigidPartGeometry(partDefinition));
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (merged === null) throw new Error(`Could not merge Motion Athlete ${variant.id} geometry`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function coreParts(resources: MotionAthleteGeometryPool, variant: CharacterVariant): RigidPart[] {
  const { primary, secondary, emissive } = variant.palette;
  const parts: RigidPart[] = [
    part("hips", resources.box, secondary, [0.34, 0.18, 0.22], [0, 0.02, 0]),
    part("spine", resources.box, primary, [0.3, 0.26, 0.2], [0, 0.1, 0]),
    part("chest", resources.box, primary, [0.46, 0.28, 0.23], [0, 0.08, 0]),
    part("head", resources.sphere, primary, [0.35, 0.4, 0.34], [0, 0.08, 0])
  ];
  for (const side of ["l", "r"] as const) {
    const sign = side === "l" ? 1 : -1;
    parts.push(
      part(`upper_arm_${side}`, resources.cylinder, secondary, [0.1, 0.24, 0.1], [sign * 0.12, 0, 0], [0, 0, Math.PI / 2]),
      part(`lower_arm_${side}`, resources.cylinder, primary, [0.085, 0.21, 0.085], [sign * 0.105, 0, 0], [0, 0, Math.PI / 2]),
      part(`hand_${side}`, resources.sphere, emissive, [0.16, 0.13, 0.14], [sign * 0.03, 0, 0], undefined, true),
      part(`upper_leg_${side}`, resources.cylinder, secondary, [0.13, 0.34, 0.13], [0, -0.17, 0]),
      part(`lower_leg_${side}`, resources.cylinder, primary, [0.105, 0.32, 0.105], [0, -0.16, 0]),
      part(`foot_${side}`, resources.box, secondary, [0.2, 0.12, 0.3], [0, -0.04, 0.08])
    );
  }
  parts.push(
    part("head", resources.sphere, "#10202c", [0.055, 0.075, 0.035], [0.075, 0.1, 0.16], undefined, false, true),
    part("head", resources.sphere, "#10202c", [0.055, 0.075, 0.035], [-0.075, 0.1, 0.16], undefined, false, true)
  );
  return parts;
}

function accessoryParts(resources: MotionAthleteGeometryPool, variant: CharacterVariant): RigidPart[] {
  const { secondary, emissive } = variant.palette;
  switch (variant.id) {
    case "explorer":
      return [
        part("head", resources.box, emissive, [0.31, 0.08, 0.16], [0, 0.1, 0.18], undefined, true),
        part("chest", resources.box, secondary, [0.32, 0.35, 0.16], [0, 0.02, -0.17]),
        part("chest", resources.sphere, emissive, [0.09, 0.09, 0.09], [0, 0.1, -0.27], undefined, true)
      ];
    case "runner":
      return [
        part("chest", resources.torus, emissive, [0.34, 0.34, 0.16], [0, 0.07, 0.13], undefined, true),
        part("foot_l", resources.cone, emissive, [0.1, 0.22, 0.1], [0, 0, -0.15], [Math.PI / 2, 0, 0], true),
        part("foot_r", resources.cone, emissive, [0.1, 0.22, 0.1], [0, 0, -0.15], [Math.PI / 2, 0, 0], true)
      ];
    case "trickster":
      return [
        part("head", resources.cone, emissive, [0.08, 0.25, 0.08], [0.1, 0.28, 0], [0, 0, -0.32], true),
        part("hand_l", resources.box, emissive, [0.12, 0.18, 0.12], [0.02, 0, 0], undefined, true)
      ];
    case "guardian":
      return [
        part("upper_arm_l", resources.box, secondary, [0.28, 0.18, 0.3], [0.02, 0.04, 0]),
        part("upper_arm_r", resources.box, secondary, [0.28, 0.18, 0.3], [-0.02, 0.04, 0]),
        part("chest", resources.sphere, emissive, [0.18, 0.18, 0.08], [0, 0.04, 0.14], undefined, true)
      ];
  }
}

function part(
  bone: CanonicalBoneName,
  geometry: BufferGeometry,
  color: string,
  scale: readonly [number, number, number],
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
  accent = false,
  blink = false
): RigidPart {
  return { bone, geometry, color, scale, position, rotation, accent, blink };
}

function rigidPartGeometry(partDefinition: RigidPart): BufferGeometry {
  const geometry = partDefinition.geometry.clone();
  const rotation = partDefinition.rotation ?? [0, 0, 0];
  const partPosition = accumulatedBindPosition(partDefinition.bone)
    .add(new Vector3(...partDefinition.position));
  const transform = new Matrix4().compose(
    partPosition,
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(...partDefinition.scale)
  );
  geometry.applyMatrix4(transform);
  const vertexCount = geometry.getAttribute("position").count;
  const boneIndex = canonicalRig.bones.indexOf(partDefinition.bone);
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  const colors = new Float32Array(vertexCount * 3);
  const accents = new Float32Array(vertexCount);
  const blinks = new Float32Array(vertexCount);
  const blinkCenters = new Float32Array(vertexCount);
  const color = new Color(partDefinition.color);
  for (let index = 0; index < vertexCount; index += 1) {
    skinIndices[index * 4] = boneIndex;
    skinWeights[index * 4] = 1;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    accents[index] = partDefinition.accent ? 1 : 0;
    blinks[index] = partDefinition.blink ? 1 : 0;
    blinkCenters[index] = partPosition.y;
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(skinWeights, 4));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("athleteAccent", new Float32BufferAttribute(accents, 1));
  geometry.setAttribute("athleteBlink", new Float32BufferAttribute(blinks, 1));
  geometry.setAttribute("athleteBlinkCenter", new Float32BufferAttribute(blinkCenters, 1));
  return geometry;
}

/** Rigid skinning expects vertices in mesh bind space, not bone-local space. */
function accumulatedBindPosition(boneName: CanonicalBoneName): Vector3 {
  const result = new Vector3();
  let current: CanonicalBoneName | undefined = boneName;
  while (current !== undefined) {
    const position = BIND_POSITION[current];
    result.x += position[0];
    result.y += position[1];
    result.z += position[2];
    current = RIG_PARENT[current];
  }
  return result;
}

function createBodyMaterial(uniforms: AthleteShaderUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.14
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.athleteBlinkScale = uniforms.blinkScale;
    shader.uniforms.athleteAccentIntensity = uniforms.accentIntensity;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float athleteAccent;\nattribute float athleteBlink;\nattribute float athleteBlinkCenter;\nvarying float vAthleteAccent;\nuniform float athleteBlinkScale;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\ntransformed.y = mix(transformed.y, athleteBlinkCenter + (transformed.y - athleteBlinkCenter) * athleteBlinkScale, athleteBlink);\nvAthleteAccent = athleteAccent;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying float vAthleteAccent;\nuniform float athleteAccentIntensity;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vAthleteAccent * athleteAccentIntensity;`
      );
  };
  material.customProgramCacheKey = () => "motion-athlete-rigid-skin-v2";
  return material;
}

function mesh(
  geometry: BufferGeometry,
  material: Material,
  scale: readonly [number, number, number],
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0]
): Mesh {
  const result = new Mesh(geometry, material);
  result.scale.set(...scale);
  result.position.set(...position);
  result.rotation.set(...rotation);
  return result;
}

function findVariant(id: CharacterArchetype): CharacterVariant {
  const variant = motionAthleteCast.find((candidate) => candidate.id === id);
  if (variant === undefined) throw new Error(`Unknown Motion Athlete variant: ${id}`);
  return variant;
}
