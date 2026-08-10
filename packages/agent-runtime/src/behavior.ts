import {
  AGENT_CONTRACT_VERSION,
  type AgentAction,
  type AgentStuckDetectorSnapshot,
  type GridPoint,
  type RandomSource
} from "./contracts.ts";
import { euclideanDistance } from "./grid.ts";
import type { AgentProfile } from "./profiles.ts";

export type ControlledMistakeOptions = Readonly<{
  maxOffset?: number;
  width?: number;
  height?: number;
}>;

export type ControlledMistakeResult = Readonly<{
  action: AgentAction;
  mistakeApplied: boolean;
  intendedAction: AgentAction;
}>;

export function applyControlledMistake(
  action: AgentAction,
  profile: AgentProfile,
  random: RandomSource,
  options: ControlledMistakeOptions = {}
): ControlledMistakeResult {
  const { mistakeRate, mistakeSeverity } = profile.parameters;
  if (mistakeRate <= 0 || mistakeSeverity <= 0 || !random.chance(mistakeRate)) {
    return Object.freeze({ action, mistakeApplied: false, intendedAction: action });
  }

  if (action.kind === "move" && action.target !== undefined) {
    const maximum = Math.max(1, Math.trunc(options.maxOffset ?? 3));
    const radius = Math.max(1, Math.ceil(mistakeSeverity * maximum));
    const directions = [
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
      { x: -1, y: 0 }, { x: 1, y: 0 },
      { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }
    ] as const;
    const direction = directions[random.int(directions.length)] as GridPoint;
    const target = Object.freeze({
      x: clampCoordinate(action.target.x + direction.x * radius, options.width),
      y: clampCoordinate(action.target.y + direction.y * radius, options.height)
    });
    const mistaken = Object.freeze({
      ...action,
      target,
      explanation: appendExplanation(action.explanation, `Seeded movement error (${radius} tile offset)`)
    });
    return Object.freeze({ action: mistaken, mistakeApplied: true, intendedAction: action });
  }

  const idle = Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    actorId: action.actorId,
    kind: "idle" as const,
    atMillis: action.atMillis,
    explanation: appendExplanation(action.explanation, "Seeded hesitation")
  });
  return Object.freeze({ action: idle, mistakeApplied: true, intendedAction: action });
}

export type StickyTargetCandidate<T> = Readonly<{
  id: string;
  score: number;
  value: T;
}>;

export function chooseStickyTarget<T>(
  candidates: readonly StickyTargetCandidate<T>[],
  currentTargetId: string | undefined,
  stickiness: number,
  scale = 1
): StickyTargetCandidate<T> | undefined {
  const boundedStickiness = Math.max(0, Math.min(1, stickiness));
  return [...candidates].sort((first, second) => {
    const firstScore = first.score + (first.id === currentTargetId ? boundedStickiness * scale : 0);
    const secondScore = second.score + (second.id === currentTargetId ? boundedStickiness * scale : 0);
    return secondScore - firstScore || first.id.localeCompare(second.id);
  })[0];
}

export type StuckStatus = Readonly<{
  stuck: boolean;
  newlyStuck: boolean;
  observedMillis: number;
  displacement: number;
}>;

type PositionSample = Readonly<{
  atMillis: number;
  position: GridPoint;
}>;

export class StuckDetector {
  readonly #windowMillis: number;
  readonly #distanceThreshold: number;
  readonly #samples: PositionSample[] = [];
  #wasStuck = false;
  #lastMillis = Number.NEGATIVE_INFINITY;

  public constructor(windowMillis: number, distanceThreshold: number) {
    if (!Number.isFinite(windowMillis) || windowMillis <= 0) {
      throw new Error("Stuck detection window must be positive");
    }
    if (!Number.isFinite(distanceThreshold) || distanceThreshold < 0) {
      throw new Error("Stuck distance threshold must be non-negative");
    }
    this.#windowMillis = windowMillis;
    this.#distanceThreshold = distanceThreshold;
  }

  public update(nowMillis: number, position: GridPoint, intendsMovement: boolean): StuckStatus {
    if (nowMillis < this.#lastMillis) {
      throw new Error("Stuck detector observations must be monotonic");
    }
    this.#lastMillis = nowMillis;
    if (!intendsMovement) {
      this.reset();
      this.#lastMillis = nowMillis;
      return Object.freeze({ stuck: false, newlyStuck: false, observedMillis: 0, displacement: 0 });
    }
    this.#samples.push(Object.freeze({ atMillis: nowMillis, position: Object.freeze({ ...position }) }));
    const cutoff = nowMillis - this.#windowMillis;
    while (this.#samples.length > 1 && (this.#samples[1]?.atMillis ?? nowMillis) <= cutoff) {
      this.#samples.shift();
    }
    const first = this.#samples[0] as PositionSample;
    const observedMillis = nowMillis - first.atMillis;
    const displacement = this.#samples.reduce(
      (maximum, sample) => Math.max(maximum, euclideanDistance(first.position, sample.position)),
      0
    );
    const stuck = observedMillis >= this.#windowMillis && displacement <= this.#distanceThreshold;
    const newlyStuck = stuck && !this.#wasStuck;
    this.#wasStuck = stuck;
    return Object.freeze({ stuck, newlyStuck, observedMillis, displacement });
  }

  public snapshot(): AgentStuckDetectorSnapshot {
    return Object.freeze({
      windowMillis: this.#windowMillis,
      distanceThreshold: this.#distanceThreshold,
      samples: Object.freeze(this.#samples.map((sample) => Object.freeze({
        atMillis: sample.atMillis,
        position: Object.freeze({ ...sample.position })
      }))),
      wasStuck: this.#wasStuck,
      lastMillis: Number.isFinite(this.#lastMillis) ? this.#lastMillis : null
    });
  }

  public restore(snapshot: AgentStuckDetectorSnapshot): void {
    if (snapshot.windowMillis !== this.#windowMillis
      || snapshot.distanceThreshold !== this.#distanceThreshold) {
      throw new Error("Stuck detector snapshot configuration does not match");
    }
    if (snapshot.lastMillis !== null && !Number.isFinite(snapshot.lastMillis)) {
      throw new Error("Stuck detector snapshot time must be finite or null");
    }
    let previousMillis = Number.NEGATIVE_INFINITY;
    const samples = snapshot.samples.map((sample): PositionSample => {
      if (!Number.isFinite(sample.atMillis) || sample.atMillis < previousMillis) {
        throw new Error("Stuck detector snapshot samples must have monotonic finite times");
      }
      if (!Number.isInteger(sample.position.x) || !Number.isInteger(sample.position.y)) {
        throw new Error("Stuck detector snapshot positions require integer coordinates");
      }
      previousMillis = sample.atMillis;
      return Object.freeze({
        atMillis: sample.atMillis,
        position: Object.freeze({ ...sample.position })
      });
    });
    if (snapshot.lastMillis !== null && previousMillis > snapshot.lastMillis) {
      throw new Error("Stuck detector snapshot samples cannot be newer than its clock");
    }
    if (snapshot.lastMillis === null && samples.length > 0) {
      throw new Error("Stuck detector snapshot with samples requires a clock");
    }
    this.#samples.length = 0;
    this.#samples.push(...samples);
    this.#wasStuck = snapshot.wasStuck;
    this.#lastMillis = snapshot.lastMillis ?? Number.NEGATIVE_INFINITY;
  }

  public reset(): void {
    this.#samples.length = 0;
    this.#wasStuck = false;
    this.#lastMillis = Number.NEGATIVE_INFINITY;
  }
}

function clampCoordinate(value: number, size: number | undefined): number {
  const integer = Math.round(value);
  return size === undefined ? integer : Math.max(0, Math.min(size - 1, integer));
}

function appendExplanation(current: string | undefined, addition: string): string {
  return current === undefined || current.length === 0 ? addition : `${current}; ${addition}`;
}
