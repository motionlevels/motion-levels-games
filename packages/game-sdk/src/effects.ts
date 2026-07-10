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
