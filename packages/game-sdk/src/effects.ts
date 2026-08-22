import type { Frame, HexColor } from "./index.ts";

export type FloorEffectCell = {
  distance: number;
  phase: number;
  step: number;
  x: number;
  y: number;
};

export type FloorEffectColor = HexColor | ((cell: FloorEffectCell) => HexColor | undefined);

export type DiamondRingOptions = {
  centerX?: number;
  centerY?: number;
  color: FloorEffectColor;
  radius: number;
  thickness?: number;
};

export type DiamondWaveOptions = {
  bandWidth?: number;
  centerX?: number;
  centerY?: number;
  color: FloorEffectColor;
  period?: number;
  step: number;
};

export type SmoothPulseOptions = {
  atMillis: number;
  maxValue: number;
  minValue: number;
  periodMillis: number;
  phaseOffsetMillis?: number;
};

export type BeatPulseOptions = {
  atMillis: number;
  attackMillis: number;
  periodMillis: number;
  phaseOffsetMillis?: number;
  releaseMillis: number;
};

export type ProgressiveTileRevealCell = {
  intensity: number;
  progress: number;
  threshold: number;
  x: number;
  y: number;
};

export type ProgressiveTileRevealColor = HexColor | ((cell: ProgressiveTileRevealCell) => HexColor | undefined);

export type ProgressiveTileRevealOptions = {
  color: ProgressiveTileRevealColor;
  fadeSpan?: number;
  progress: number;
  threshold: (cell: { x: number; y: number }) => number | undefined;
};

export type StaggeredTileRevealCell = {
  intensity: number;
  progress: number;
  threshold: number;
  variant: number;
  x: number;
  y: number;
};

export type StaggeredTileRevealColor = HexColor | ((cell: StaggeredTileRevealCell) => HexColor | undefined);

export type StaggeredTileRevealOptions = {
  color: StaggeredTileRevealColor;
  fadeSpan?: number;
  progress: number;
  seed: number;
};

export type SparseTilePulseCell = {
  cycle: number;
  intensity: number;
  variant: number;
  x: number;
  y: number;
};

export type SparseTilePulseColor = HexColor | ((cell: SparseTilePulseCell) => HexColor | undefined);

export type SparseTilePulseOptions = {
  atMillis: number;
  color: SparseTilePulseColor;
  cycleMillis: number;
  density: number;
  exclude?: (cell: { x: number; y: number }) => boolean;
  pulseMillis: number;
  seed: number;
};

export type SparseBlockPulseCell = SparseTilePulseCell & {
  height: number;
  width: number;
};

export type SparseBlockPulseColor = HexColor | ((cell: SparseBlockPulseCell) => HexColor | undefined);

export type SparseBlockPulseOptions = {
  atMillis: number;
  blockHeight: number;
  blockWidth: number;
  color: SparseBlockPulseColor;
  cycleMillis: number;
  density: number;
  exclude?: (cell: { x: number; y: number }) => boolean;
  gapX?: number;
  gapY?: number;
  pulseMillis: number;
  seed: number;
};

/** Samples a continuous cosine pulse from explicit engine time. */
export function sampleSmoothPulse(options: SmoothPulseOptions): number {
  const firstValue = finiteNumber(options.minValue, 0);
  const secondValue = finiteNumber(options.maxValue, firstValue);
  const minValue = Math.min(firstValue, secondValue);
  const maxValue = Math.max(firstValue, secondValue);
  if (!Number.isFinite(options.periodMillis) || options.periodMillis <= 0 || minValue === maxValue) {
    return minValue;
  }

  const periodMillis = options.periodMillis;
  const atMillis = finiteNumber(options.atMillis, 0);
  const phaseOffsetMillis = finiteNumber(options.phaseOffsetMillis, 0);
  const phase = positiveModulo(atMillis + phaseOffsetMillis, periodMillis) / periodMillis;
  const unitPulse = (1 - Math.cos(phase * Math.PI * 2)) / 2;

  return minValue + (maxValue - minValue) * unitPulse;
}

/** Samples a short attack/release pulse repeated from an explicit local clock. */
export function sampleBeatPulse(options: BeatPulseOptions): number {
  const periodMillis = finiteNumber(options.periodMillis, 0);
  if (periodMillis <= 0) return 0;

  const attackMillis = Math.min(periodMillis, Math.max(0, finiteNumber(options.attackMillis, 0)));
  const releaseMillis = Math.min(
    periodMillis - attackMillis,
    Math.max(0, finiteNumber(options.releaseMillis, 0))
  );
  if (attackMillis <= 0 && releaseMillis <= 0) return 0;

  const atMillis = finiteNumber(options.atMillis, 0);
  const phaseOffsetMillis = finiteNumber(options.phaseOffsetMillis, 0);
  const phaseMillis = positiveModulo(atMillis + phaseOffsetMillis, periodMillis);
  if (attackMillis > 0 && phaseMillis < attackMillis) {
    return smoothstep(phaseMillis / attackMillis);
  }
  if (phaseMillis < attackMillis + releaseMillis) {
    return 1 - smoothstep((phaseMillis - attackMillis) / releaseMillis);
  }
  return 0;
}

/** Paints a deterministic per-cell reveal from normalized thresholds and progress. */
export function paintProgressiveTileReveal(frame: Frame, options: ProgressiveTileRevealOptions): void {
  const progress = clampUnit(finiteNumber(options.progress, 0));
  const fadeSpan = clampUnit(finiteNumber(options.fadeSpan, 0.12));
  if (progress <= 0 || fadeSpan <= 0) return;

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const rawThreshold = options.threshold({ x, y });
      if (typeof rawThreshold !== "number" || !Number.isFinite(rawThreshold)) continue;

      const threshold = clampUnit(rawThreshold);
      const revealAt = threshold * (1 - fadeSpan);
      const localProgress = clampUnit((progress - revealAt) / fadeSpan);
      if (localProgress <= 0) continue;

      const reveal = {
        intensity: smoothstep(localProgress),
        progress,
        threshold,
        x,
        y
      };
      const resolvedColor = typeof options.color === "function" ? options.color(reveal) : options.color;
      if (resolvedColor) {
        frame.cells[y * frame.width + x] = { x, y, color: resolvedColor };
      }
    }
  }
}

/** Reveals every tile in a deterministic seeded order with independent soft attacks. */
export function paintStaggeredTileReveal(frame: Frame, options: StaggeredTileRevealOptions): void {
  const progress = clampUnit(finiteNumber(options.progress, 0));
  const fadeSpan = clampUnit(finiteNumber(options.fadeSpan, 0.08));
  const seed = Math.trunc(finiteNumber(options.seed, 0));
  if (progress <= 0 || fadeSpan <= 0) return;

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const threshold = effectHash(seed, x, y, 71);
      const revealAt = threshold * (1 - fadeSpan);
      const localProgress = clampUnit((progress - revealAt) / fadeSpan);
      if (localProgress <= 0) continue;

      const reveal = {
        intensity: smoothstep(localProgress),
        progress,
        threshold,
        variant: effectHash(seed, x, y, 97),
        x,
        y
      };
      const resolvedColor = typeof options.color === "function" ? options.color(reveal) : options.color;
      if (resolvedColor) {
        frame.cells[y * frame.width + x] = { x, y, color: resolvedColor };
      }
    }
  }
}

/** Paints sparse, stateless tile pulses with deterministic per-cell timing. */
export function paintSparseTilePulses(frame: Frame, options: SparseTilePulseOptions): void {
  const cycleMillis = finiteNumber(options.cycleMillis, 0);
  const pulseMillis = Math.min(cycleMillis, finiteNumber(options.pulseMillis, 0));
  const density = Math.min(1, Math.max(0, finiteNumber(options.density, 0)));
  if (cycleMillis <= 0 || pulseMillis <= 0 || density <= 0) return;

  const atMillis = finiteNumber(options.atMillis, 0);
  const seed = Math.trunc(finiteNumber(options.seed, 0));
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (options.exclude?.({ x, y })) continue;

      const phaseOffsetMillis = effectHash(seed, x, y, 17) * cycleMillis;
      const shiftedMillis = atMillis + phaseOffsetMillis;
      const cycle = Math.floor(shiftedMillis / cycleMillis);
      const localMillis = positiveModulo(shiftedMillis, cycleMillis);
      if (localMillis >= pulseMillis || effectHash(seed, x, y, cycle, 31) >= density) continue;

      const progress = localMillis / pulseMillis;
      const intensity = Math.sin(progress * Math.PI) ** 2;
      if (intensity <= Number.EPSILON) continue;

      const pulse = {
        cycle,
        intensity,
        variant: effectHash(seed, cycle, y, x, 47),
        x,
        y
      };
      const resolvedColor = typeof options.color === "function" ? options.color(pulse) : options.color;
      if (resolvedColor) {
        frame.cells[y * frame.width + x] = { x, y, color: resolvedColor };
      }
    }
  }
}

/** Paints sparse, stateless rectangular pulses whose cells share one color and clock. */
export function paintSparseBlockPulses(frame: Frame, options: SparseBlockPulseOptions): void {
  const cycleMillis = finiteNumber(options.cycleMillis, 0);
  const pulseMillis = Math.min(cycleMillis, finiteNumber(options.pulseMillis, 0));
  const density = Math.min(1, Math.max(0, finiteNumber(options.density, 0)));
  const blockWidth = Math.max(1, Math.trunc(finiteNumber(options.blockWidth, 0)));
  const blockHeight = Math.max(1, Math.trunc(finiteNumber(options.blockHeight, 0)));
  const strideX = blockWidth + Math.max(0, Math.trunc(finiteNumber(options.gapX, 0)));
  const strideY = blockHeight + Math.max(0, Math.trunc(finiteNumber(options.gapY, 0)));
  if (cycleMillis <= 0 || pulseMillis <= 0 || density <= 0) return;

  const atMillis = finiteNumber(options.atMillis, 0);
  const seed = Math.trunc(finiteNumber(options.seed, 0));
  for (let y = 0; y + blockHeight <= frame.height; y += strideY) {
    for (let x = 0; x + blockWidth <= frame.width; x += strideX) {
      let excluded = false;
      for (let dy = 0; dy < blockHeight && !excluded; dy += 1) {
        for (let dx = 0; dx < blockWidth; dx += 1) {
          if (options.exclude?.({ x: x + dx, y: y + dy })) {
            excluded = true;
            break;
          }
        }
      }
      if (excluded) continue;

      const phaseOffsetMillis = effectHash(seed, x, y, blockWidth, blockHeight, 19) * cycleMillis;
      const shiftedMillis = atMillis + phaseOffsetMillis;
      const cycle = Math.floor(shiftedMillis / cycleMillis);
      const localMillis = positiveModulo(shiftedMillis, cycleMillis);
      if (localMillis >= pulseMillis || effectHash(seed, x, y, cycle, 37) >= density) continue;

      const progress = localMillis / pulseMillis;
      const intensity = Math.sin(progress * Math.PI) ** 2;
      if (intensity <= Number.EPSILON) continue;

      const pulse = {
        cycle,
        height: blockHeight,
        intensity,
        variant: effectHash(seed, cycle, y, x, 53),
        width: blockWidth,
        x,
        y
      };
      const resolvedColor = typeof options.color === "function" ? options.color(pulse) : options.color;
      if (!resolvedColor) continue;
      for (let dy = 0; dy < blockHeight; dy += 1) {
        for (let dx = 0; dx < blockWidth; dx += 1) {
          const cellX = x + dx;
          const cellY = y + dy;
          frame.cells[cellY * frame.width + cellX] = { x: cellX, y: cellY, color: resolvedColor };
        }
      }
    }
  }
}

/** Paints a Manhattan-distance ring, useful for player-ready and target cues. */
export function paintDiamondRing(frame: Frame, options: DiamondRingOptions): void {
  const centerX = options.centerX ?? (frame.width - 1) / 2;
  const centerY = options.centerY ?? (frame.height - 1) / 2;
  const radius = Math.max(0, options.radius);
  const thickness = Math.max(0, options.thickness ?? 1);

  visitFrame(frame, options.color, (x, y) => {
    const distance = manhattanDistance(x, y, centerX, centerY);
    return {
      distance,
      phase: Math.abs(distance - radius),
      selected: Math.abs(distance - radius) <= thickness
    };
  }, 0);
}

/** Paints repeating Manhattan-distance bands that advance with a deterministic step. */
export function paintDiamondWave(frame: Frame, options: DiamondWaveOptions): void {
  const centerX = options.centerX ?? (frame.width - 1) / 2;
  const centerY = options.centerY ?? (frame.height - 1) / 2;
  const period = Math.max(1, Math.floor(options.period ?? 7));
  const bandWidth = Math.min(period, Math.max(1, Math.floor(options.bandWidth ?? 2)));
  const step = Math.floor(options.step);

  visitFrame(frame, options.color, (x, y) => {
    const distance = Math.floor(manhattanDistance(x, y, centerX, centerY));
    const phase = positiveModulo(distance + step, period);
    return { distance, phase, selected: phase < bandWidth };
  }, step);
}

function visitFrame(
  frame: Frame,
  color: FloorEffectColor,
  select: (x: number, y: number) => { distance: number; phase: number; selected: boolean },
  step: number
): void {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const selection = select(x, y);
      if (!selection.selected) {
        continue;
      }

      const resolvedColor = typeof color === "function"
        ? color({ distance: selection.distance, phase: selection.phase, step, x, y })
        : color;
      if (resolvedColor) {
        frame.cells[y * frame.width + x] = { x, y, color: resolvedColor };
      }
    }
  }
}

function manhattanDistance(x: number, y: number, centerX: number, centerY: number): number {
  return Math.abs(x - centerX) + Math.abs(y - centerY);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const normalized = clampUnit(value);
  return normalized * normalized * (3 - 2 * normalized);
}

function effectHash(...values: number[]): number {
  let state = 2_166_136_261;
  for (const value of values) {
    state ^= Math.trunc(value * 1_000_003);
    state = Math.imul(state, 16_777_619);
    state ^= state >>> 13;
  }
  return (state >>> 0) / 0x1_0000_0000;
}
