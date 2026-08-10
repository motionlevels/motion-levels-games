import { interpolateAgentSnapshot } from "@motion-levels-games/character-runtime";
import type { AgentRenderSnapshot } from "./contracts.ts";

export type AgentSnapshotBufferOptions = Readonly<{
  capacity?: number;
}>;

/** Sorted, bounded, defensive snapshot storage for exactly one agent. */
export class AgentSnapshotBuffer {
  readonly #agentId: string;
  readonly #capacity: number;
  readonly #samples: AgentRenderSnapshot[] = [];

  public constructor(agentId: string, options: AgentSnapshotBufferOptions = {}) {
    if (agentId.trim().length === 0) throw new Error("Snapshot buffer agent id must not be empty");
    const capacity = options.capacity ?? 32;
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error("Snapshot buffer capacity must be an integer of at least two");
    }
    this.#agentId = agentId;
    this.#capacity = capacity;
  }

  public get agentId(): string {
    return this.#agentId;
  }

  public get size(): number {
    return this.#samples.length;
  }

  public get range(): Readonly<{ oldestMillis?: number; newestMillis?: number }> {
    return Object.freeze({
      ...(this.#samples[0] === undefined ? {} : { oldestMillis: this.#samples[0].atMillis }),
      ...(this.#samples.at(-1) === undefined ? {} : { newestMillis: this.#samples.at(-1)?.atMillis })
    });
  }

  /** Inserts out-of-order delivery deterministically and replaces equal timestamps. */
  public push(sample: AgentRenderSnapshot): void {
    validateSample(sample, this.#agentId);
    const copy = copySnapshot(sample);
    const index = lowerBound(this.#samples, copy.atMillis);
    if (this.#samples[index]?.atMillis === copy.atMillis) {
      this.#samples[index] = copy;
    } else {
      this.#samples.splice(index, 0, copy);
    }
    if (this.#samples.length > this.#capacity) {
      this.#samples.splice(0, this.#samples.length - this.#capacity);
    }
  }

  /**
   * Interpolates between neighbouring samples. Outside the known interval the
   * nearest endpoint is held; this renderer never invents authoritative motion.
   */
  public sample(atMillis: number): AgentRenderSnapshot | undefined {
    if (!Number.isFinite(atMillis)) throw new Error("Snapshot sample time must be finite");
    const first = this.#samples[0];
    if (first === undefined) return undefined;
    if (atMillis <= first.atMillis) return copySnapshot(first);
    const last = this.#samples.at(-1) as AgentRenderSnapshot;
    if (atMillis >= last.atMillis) return copySnapshot(last);

    const nextIndex = lowerBound(this.#samples, atMillis);
    const previous = this.#samples[nextIndex - 1] as AgentRenderSnapshot;
    const next = this.#samples[nextIndex] as AgentRenderSnapshot;
    const alpha = (atMillis - previous.atMillis) / (next.atMillis - previous.atMillis);
    const base = interpolateAgentSnapshot(previous, next, alpha);
    const discrete = alpha < 0.5 ? previous : next;
    return freezeSnapshot({
      ...base,
      atMillis,
      ...(discrete.variant === undefined ? {} : { variant: discrete.variant }),
      ...(interpolateVector(previous.acceleration, next.acceleration, alpha, discrete.acceleration) === undefined
        ? {}
        : { acceleration: interpolateVector(previous.acceleration, next.acceleration, alpha, discrete.acceleration) }),
      ...(interpolateNumber(previous.angularVelocity, next.angularVelocity, alpha, discrete.angularVelocity) === undefined
        ? {}
        : { angularVelocity: interpolateNumber(previous.angularVelocity, next.angularVelocity, alpha, discrete.angularVelocity) }),
      ...(discrete.targetPosition === undefined ? {} : { targetPosition: discrete.targetPosition }),
      ...(discrete.socialGesture === undefined ? {} : { socialGesture: discrete.socialGesture }),
      ...(discrete.recentEvent === undefined ? {} : { recentEvent: discrete.recentEvent })
    });
  }

  public clear(): void {
    this.#samples.length = 0;
  }

  public snapshots(): readonly AgentRenderSnapshot[] {
    return Object.freeze(this.#samples.map(copySnapshot));
  }
}

function copySnapshot(sample: AgentRenderSnapshot): AgentRenderSnapshot {
  return freezeSnapshot({ ...sample });
}

function freezeSnapshot(sample: AgentRenderSnapshot): AgentRenderSnapshot {
  return Object.freeze({
    ...sample,
    position: Object.freeze({ ...sample.position }),
    velocity: Object.freeze({ ...sample.velocity }),
    ...(sample.acceleration === undefined ? {} : { acceleration: Object.freeze({ ...sample.acceleration }) }),
    ...(sample.targetPosition === undefined ? {} : { targetPosition: Object.freeze({ ...sample.targetPosition }) })
  });
}

function interpolateVector(
  previous: Readonly<{ x: number; y: number }> | undefined,
  next: Readonly<{ x: number; y: number }> | undefined,
  alpha: number,
  fallback: Readonly<{ x: number; y: number }> | undefined
): Readonly<{ x: number; y: number }> | undefined {
  if (previous === undefined || next === undefined) return fallback;
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha
  };
}

function interpolateNumber(
  previous: number | undefined,
  next: number | undefined,
  alpha: number,
  fallback: number | undefined
): number | undefined {
  if (previous === undefined || next === undefined) return fallback;
  return previous + (next - previous) * alpha;
}

function lowerBound(samples: readonly AgentRenderSnapshot[], atMillis: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((samples[middle] as AgentRenderSnapshot).atMillis < atMillis) low = middle + 1;
    else high = middle;
  }
  return low;
}

function validateSample(sample: AgentRenderSnapshot, agentId: string): void {
  if (sample.id !== agentId) throw new Error(`Snapshot for ${sample.id} cannot enter buffer for ${agentId}`);
  if (!Number.isFinite(sample.atMillis)) throw new Error("Snapshot timestamp must be finite");
  if (!Number.isInteger(sample.tick) || sample.tick < 0) throw new Error("Snapshot tick must be a non-negative integer");
  for (const [label, vector] of [
    ["position", sample.position],
    ["velocity", sample.velocity],
    ["acceleration", sample.acceleration],
    ["targetPosition", sample.targetPosition]
  ] as const) {
    if (vector !== undefined && (!Number.isFinite(vector.x) || !Number.isFinite(vector.y))) {
      throw new Error(`Snapshot ${label} must be finite`);
    }
  }
  if (!Number.isFinite(sample.facingRadians)) throw new Error("Snapshot facing must be finite");
  if (sample.angularVelocity !== undefined && !Number.isFinite(sample.angularVelocity)) {
    throw new Error("Snapshot angular velocity must be finite");
  }
}
