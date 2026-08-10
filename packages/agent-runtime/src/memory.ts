import type { GridPoint } from "./contracts.ts";

export type MemoryEntry<T> = Readonly<{
  id: string;
  value: T;
  position?: GridPoint;
  observedAtMillis: number;
  initialConfidence: number;
}>;

export type MemoryRecall<T> = MemoryEntry<T> & Readonly<{
  confidence: number;
  ageMillis: number;
}>;

export type ImperfectMemoryOptions = Readonly<{
  decayPerSecond: number;
  minimumConfidence?: number;
  capacity?: number;
}>;

export function estimateMemoryConfidence(
  initialConfidence: number,
  ageMillis: number,
  decayPerSecond: number
): number {
  const initial = clamp01(initialConfidence);
  const ageSeconds = Math.max(0, ageMillis) / 1_000;
  const decay = Math.max(0, decayPerSecond);
  return clamp01(initial * Math.exp(-decay * ageSeconds));
}

/** Deterministic imperfect memory with explicit simulation time. */
export class ImperfectMemory<T> {
  readonly #decayPerSecond: number;
  readonly #minimumConfidence: number;
  readonly #capacity: number;
  readonly #entries = new Map<string, MemoryEntry<T>>();

  public constructor(options: ImperfectMemoryOptions, entries: readonly MemoryEntry<T>[] = []) {
    if (!Number.isFinite(options.decayPerSecond) || options.decayPerSecond < 0) {
      throw new Error("Memory decay must be non-negative");
    }
    const capacity = options.capacity ?? 64;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Memory capacity must be a positive integer");
    }
    this.#decayPerSecond = options.decayPerSecond;
    this.#minimumConfidence = clamp01(options.minimumConfidence ?? 0.05);
    this.#capacity = capacity;
    for (const entry of entries) {
      this.observe(entry);
    }
  }

  public observe(entry: MemoryEntry<T>): void {
    if (entry.id.length === 0 || !Number.isFinite(entry.observedAtMillis)) {
      throw new Error("Memory observations require an id and finite time");
    }
    const existing = this.#entries.get(entry.id);
    if (existing !== undefined && existing.observedAtMillis > entry.observedAtMillis) {
      return;
    }
    this.#entries.set(entry.id, Object.freeze({
      ...entry,
      position: entry.position === undefined ? undefined : Object.freeze({ ...entry.position }),
      initialConfidence: clamp01(entry.initialConfidence)
    }));
    this.#enforceCapacity();
  }

  public recall(id: string, nowMillis: number): MemoryRecall<T> | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    const recall = this.#toRecall(entry, nowMillis);
    return recall.confidence < this.#minimumConfidence ? undefined : recall;
  }

  public recallAll(nowMillis: number): readonly MemoryRecall<T>[] {
    return Object.freeze([...this.#entries.values()]
      .map((entry) => this.#toRecall(entry, nowMillis))
      .filter((entry) => entry.confidence >= this.#minimumConfidence)
      .sort((first, second) =>
        second.confidence - first.confidence
          || second.observedAtMillis - first.observedAtMillis
          || first.id.localeCompare(second.id)
      ));
  }

  public prune(nowMillis: number): number {
    let removed = 0;
    for (const entry of this.#entries.values()) {
      if (this.#toRecall(entry, nowMillis).confidence < this.#minimumConfidence
        && this.#entries.delete(entry.id)) {
        removed += 1;
      }
    }
    return removed;
  }

  public forget(id: string): boolean {
    return this.#entries.delete(id);
  }

  public snapshot(): readonly MemoryEntry<T>[] {
    return Object.freeze([...this.#entries.values()].sort((first, second) => first.id.localeCompare(second.id)));
  }

  #toRecall(entry: MemoryEntry<T>, nowMillis: number): MemoryRecall<T> {
    if (!Number.isFinite(nowMillis)) {
      throw new Error("Memory recall time must be finite");
    }
    const ageMillis = Math.max(0, nowMillis - entry.observedAtMillis);
    return Object.freeze({
      ...entry,
      ageMillis,
      confidence: estimateMemoryConfidence(entry.initialConfidence, ageMillis, this.#decayPerSecond)
    });
  }

  #enforceCapacity(): void {
    if (this.#entries.size <= this.#capacity) {
      return;
    }
    const oldest = [...this.#entries.values()].sort((first, second) =>
      first.observedAtMillis - second.observedAtMillis || first.id.localeCompare(second.id)
    )[0];
    if (oldest !== undefined) {
      this.#entries.delete(oldest.id);
    }
  }
}

export function createImperfectMemory<T>(
  options: ImperfectMemoryOptions,
  entries: readonly MemoryEntry<T>[] = []
): ImperfectMemory<T> {
  return new ImperfectMemory(options, entries);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
