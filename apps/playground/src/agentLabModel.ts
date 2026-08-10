import type { CharacterEmotion, CharacterQualityTier } from "@motion-levels-games/character-runtime";
import type {
  AgentRenderSnapshot,
  RendererDebugInput
} from "@motion-levels-games/three-renderer";
import type {
  PlaygroundAgentHarness,
  PlaygroundAgentHarnessFrame,
  PlaygroundAgentPoint,
  PlaygroundRenderableAgent
} from "./gameRegistry.ts";

export const agentLabProfiles = [
  "mixed",
  "cautious",
  "balanced",
  "bold",
  "helper",
  "explorer",
  "expert"
] as const;

export const agentLabQualityTiers = [
  "venue-high",
  "desktop-medium",
  "mobile-low",
  "capture"
] as const satisfies readonly CharacterQualityTier[];

export type AgentLabDebugVisibility = Readonly<{
  paths: boolean;
  reservations: boolean;
  targets: boolean;
}>;

const archetypes = ["explorer", "runner", "trickster", "guardian"] as const;

/**
 * Exact in-memory presentation frames for the current recording. Frames remain
 * browser-local; the portable replay export intentionally has a smaller schema.
 */
export class AgentLabFrameTrajectory {
  readonly #frames: PlaygroundAgentHarnessFrame[] = [];

  public get length(): number {
    return this.#frames.length;
  }

  public get firstTick(): number | undefined {
    return this.#frames[0]?.tick;
  }

  public get endTick(): number | undefined {
    return this.#frames.at(-1)?.tick;
  }

  public reset(initialFrame: PlaygroundAgentHarnessFrame): void {
    this.#frames.length = 0;
    this.#frames.push(initialFrame);
  }

  public append(frame: PlaygroundAgentHarnessFrame): void {
    const previous = this.#frames.at(-1);
    if (previous === undefined) {
      this.reset(frame);
      return;
    }
    if (frame.tick !== previous.tick + 1) {
      throw new Error(`Agent Lab recording expected tick ${previous.tick + 1}, received ${frame.tick}`);
    }
    this.#frames.push(frame);
  }

  public frameAtOrBefore(tick: number): PlaygroundAgentHarnessFrame | undefined {
    if (this.#frames.length === 0) return undefined;
    const requested = Number.isFinite(tick) ? Math.floor(tick) : 0;
    if (requested <= (this.#frames[0] as PlaygroundAgentHarnessFrame).tick) return this.#frames[0];
    const last = this.#frames.at(-1) as PlaygroundAgentHarnessFrame;
    if (requested >= last.tick) return last;
    let low = 0;
    let high = this.#frames.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if ((this.#frames[middle] as PlaygroundAgentHarnessFrame).tick <= requested) low = middle + 1;
      else high = middle;
    }
    return this.#frames[low - 1];
  }

  public checksumMap(): Map<number, string> {
    return new Map(this.#frames.map((frame) => [frame.tick, frame.replay.checksum]));
  }
}

/** Advances authority at one fixed tick per call while allowing one final render. */
export function advanceAgentLabHarness(
  harness: PlaygroundAgentHarness,
  ticks: number,
  onTick?: (frame: PlaygroundAgentHarnessFrame) => void
): PlaygroundAgentHarnessFrame {
  if (!Number.isInteger(ticks) || ticks <= 0) {
    throw new Error("Agent Lab advance ticks must be a positive integer");
  }
  let frame = harness.frame;
  for (let tick = 0; tick < ticks; tick += 1) {
    frame = harness.step(1);
    onTick?.(frame);
  }
  return frame;
}

export function toAgentRenderSnapshot(
  frame: PlaygroundAgentHarnessFrame,
  agent: PlaygroundRenderableAgent,
  index: number
): AgentRenderSnapshot {
  return {
    id: agent.id,
    tick: agent.tick ?? frame.tick,
    atMillis: agent.atMillis ?? frame.atMillis,
    variant: agent.variant ?? archetypes[index % archetypes.length],
    position: { ...agent.position },
    velocity: { ...agent.velocity },
    facingRadians: agent.facingRadians,
    grounded: agent.grounded ?? true,
    action: agent.action,
    intention: agent.intention ?? "wait",
    ...(agent.targetId ? { targetId: agent.targetId } : {}),
    ...(agent.target ? { targetPosition: { ...agent.target } } : {}),
    emotion: presentationEmotion(agent.emotion)
  };
}

export function toRendererDebugInput(
  frame: PlaygroundAgentHarnessFrame,
  visibility: AgentLabDebugVisibility,
  selectedAgentId?: string
): RendererDebugInput {
  const selected = selectedAgentId
    ? new Set([selectedAgentId])
    : new Set(frame.agents.map((agent) => agent.id));
  const paths = visibility.paths
    ? frame.debug.paths.flatMap((path) => (
      selected.has(path.id) && path.points.length >= 2
        ? [{ id: `path-${path.id}`, points: clonePoints(path.points), color: asHexColor(path.color) }]
        : []
    ))
    : [];
  const reservations = visibility.reservations
    ? frame.debug.reservations.flatMap((reservation) => (
      selected.has(reservation.ownerId) && reservation.points.length > 0
        ? [{
          id: reservation.id,
          ownerId: reservation.ownerId,
          points: clonePoints(reservation.points),
          color: asHexColor(reservation.color)
        }]
        : []
    ))
    : [];
  const targets = visibility.targets
    ? frame.debug.targets.flatMap((target) => (
      selected.has(target.id)
        ? [{
          id: `target-${target.id}`,
          position: { ...target.position },
          radiusTiles: target.radiusTiles,
          color: asHexColor(target.color)
        }]
        : []
    ))
    : [];

  return { paths, reservations, targets };
}

/** A deterministic replacement for ad-hoc random seed generation in the lab. */
export function nextAgentLabSeed(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) || 1;
}

export function replayFileName(seed: number): string {
  return `cruce-galactico-agents-${seed}.replay.json`;
}

function presentationEmotion(emotion: string): CharacterEmotion {
  switch (emotion) {
    case "happy":
    case "afraid":
    case "frustrated":
    case "excited":
    case "neutral":
      return emotion;
    default:
      return "neutral";
  }
}

function clonePoints(points: readonly PlaygroundAgentPoint[]): PlaygroundAgentPoint[] {
  return points.map((point) => ({ ...point }));
}

function asHexColor(value: string | undefined): `#${string}` | undefined {
  return value !== undefined && /^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(value)
    ? value as `#${string}`
    : undefined;
}
