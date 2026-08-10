import type { RandomSource } from "./contracts.ts";

const UINT32_RANGE = 0x1_0000_0000;

function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/** Serializable Mulberry32 stream. It intentionally has no ambient entropy. */
export class SeededRandom implements RandomSource {
  #state: number;

  public constructor(seed: number) {
    this.#state = normalizeSeed(seed);
  }

  public get state(): number {
    return this.#state;
  }

  public restore(state: number): void {
    this.#state = normalizeSeed(state);
  }

  public next(): number {
    this.#state = (this.#state + 0x6d2b_79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  public int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("maxExclusive must be a positive integer");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  public chance(probability: number): boolean {
    const bounded = Math.max(0, Math.min(1, probability));
    if (bounded <= 0) {
      return false;
    }
    if (bounded >= 1) {
      return true;
    }
    return this.next() < bounded;
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error("Cannot pick from an empty collection");
    }
    return values[this.int(values.length)] as T;
  }

  public fork(salt: string | number): SeededRandom {
    const saltText = String(salt);
    let hash = this.#state ^ 0x811c_9dc5;
    for (let index = 0; index < saltText.length; index += 1) {
      hash ^= saltText.charCodeAt(index);
      hash = Math.imul(hash, 0x0100_0193);
    }
    return new SeededRandom(hash >>> 0);
  }
}

export function createSeededRandom(seed: number): SeededRandom {
  return new SeededRandom(seed);
}
