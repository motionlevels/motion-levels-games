import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  paintFrameCell,
  type Frame,
  type HexColor
} from "@motion-levels-games/game-sdk";

export type Rgb = Readonly<{ r: number; g: number; b: number }>;
export type Pixel = Readonly<Rgb & { a?: number }>;
export type AnimationCategory = "ambient" | "energetic" | "nature" | "celebration";

export type PressurePoint = Readonly<{
  x: number;
  y: number;
  startedAtMillis: number;
}>;

export type ShaderContext = Readonly<{
  x: number;
  y: number;
  xn: number;
  yn: number;
  width: number;
  height: number;
  timeSeconds: number;
  progress: number;
  seed: number;
}>;

export type PixelShader = (context: ShaderContext) => Pixel;

export type NativeAnimation = Readonly<{
  id: string;
  label: string;
  description: string;
  animated: boolean;
  automaticRotation: boolean;
  category: AnimationCategory;
  durationMillis: number;
  palette: readonly HexColor[];
  tags: readonly string[];
  render: PixelShader;
  pressure?: "ripple" | "spark" | "glow" | "none";
}>;

export type NativeAnimationDefinition = Omit<NativeAnimation, "animated" | "automaticRotation"> &
  Partial<Pick<NativeAnimation, "animated" | "automaticRotation">>;

export type RenderAnimationOptions = Readonly<{
  atMillis: number;
  seed?: number;
  pressure?: readonly PressurePoint[];
}>;

type LayerMode = "normal" | "add" | "screen" | "multiply";

export function defineAnimation(definition: NativeAnimationDefinition): NativeAnimation {
  const animation: NativeAnimation = {
    ...definition,
    animated: definition.animated ?? true,
    automaticRotation: definition.automaticRotation ?? true
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(animation.id)) {
    throw new Error(`Invalid animation id: ${animation.id}`);
  }
  if (!Number.isFinite(animation.durationMillis) || animation.durationMillis < 100) {
    throw new Error(`Animation ${animation.id} needs a duration of at least 100ms`);
  }
  return Object.freeze({ ...animation, palette: Object.freeze([...animation.palette]), tags: Object.freeze([...animation.tags]) });
}

export function renderAnimationFrame(animation: NativeAnimation, options: RenderAnimationOptions): Frame {
  const frame = createFrame("#000000");
  const durationMillis = Math.max(100, animation.durationMillis);
  const wrappedMillis = positiveModulo(options.atMillis, durationMillis);
  const timeSeconds = wrappedMillis / 1_000;
  const progress = wrappedMillis / durationMillis;
  const seed = Math.trunc(options.seed ?? 137);

  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      const context: ShaderContext = {
        x,
        y,
        xn: x / (FLOOR_COLS - 1),
        yn: y / (FLOOR_ROWS - 1),
        width: FLOOR_COLS,
        height: FLOOR_ROWS,
        timeSeconds,
        progress,
        seed
      };
      const base = clampPixel(animation.render(context));
      const pressured = applyPressure(base, context, options.atMillis, options.pressure ?? [], animation.pressure ?? "ripple");
      paintFrameCell(frame, x, y, rgbToHex(pressured));
    }
  }
  return frame;
}

export function compose(...shaders: PixelShader[]): PixelShader {
  return (context) => shaders.reduce(
    (result, shader) => blend(result, shader(context), layerModes.get(shader) ?? "normal"),
    transparent
  );
}

export function add(shader: PixelShader): PixelShader {
  return withMode(shader, "add");
}

export function screen(shader: PixelShader): PixelShader {
  return withMode(shader, "screen");
}

export function multiply(shader: PixelShader): PixelShader {
  return withMode(shader, "multiply");
}

const layerModes = new WeakMap<PixelShader, LayerMode>();

function withMode(shader: PixelShader, mode: LayerMode): PixelShader {
  const wrapped: PixelShader = (context) => shader(context);
  layerModes.set(wrapped, mode);
  return wrapped;
}

export function solid(color: HexColor | Rgb, alpha = 1): PixelShader {
  const value = toRgb(color);
  return () => ({ ...value, a: clamp01(alpha) });
}

export function gradient(colors: readonly (HexColor | Rgb)[], options: { angle?: number; offset?: number; speed?: number } = {}): PixelShader {
  const palette = colors.map(toRgb);
  const angle = options.angle ?? 90;
  const radians = angle * Math.PI / 180;
  return (context) => {
    const axis = context.xn * Math.cos(radians) + context.yn * Math.sin(radians);
    const position = positiveModulo(axis + (options.offset ?? 0) + context.progress * (options.speed ?? 0), 1);
    return samplePalette(palette, position);
  };
}

export function wave(options: {
  colors: readonly (HexColor | Rgb)[];
  angle?: number;
  frequency?: number;
  speed?: number;
  softness?: number;
  alpha?: number;
}): PixelShader {
  const palette = options.colors.map(toRgb);
  const radians = (options.angle ?? 0) * Math.PI / 180;
  return (context) => {
    const axis = context.xn * Math.cos(radians) + context.yn * Math.sin(radians);
    const value = Math.sin((axis * (options.frequency ?? 3) - context.progress * (options.speed ?? 1)) * Math.PI * 2);
    const normalized = 0.5 + value * 0.5;
    const shaped = smoothstep(0.5 - (options.softness ?? 0.45) / 2, 0.5 + (options.softness ?? 0.45) / 2, normalized);
    return { ...samplePalette(palette, shaped), a: options.alpha ?? shaped };
  };
}

export function rings(options: {
  colors: readonly (HexColor | Rgb)[];
  center?: readonly [number, number];
  frequency?: number;
  speed?: number;
  width?: number;
}): PixelShader {
  const palette = options.colors.map(toRgb);
  const [cx, cy] = options.center ?? [0.5, 0.5];
  return (context) => {
    const distance = Math.hypot(context.xn - cx, (context.yn - cy) * 2);
    const phase = positiveModulo(distance * (options.frequency ?? 7) - context.progress * (options.speed ?? 2), 1);
    const intensity = 1 - smoothstep(options.width ?? 0.16, 0.5, Math.abs(phase - 0.5));
    return { ...samplePalette(palette, positiveModulo(distance + context.progress, 1)), a: clamp01(intensity) };
  };
}

export function ribbons(options: {
  colors: readonly (HexColor | Rgb)[];
  count?: number;
  speed?: number;
  bend?: number;
  width?: number;
}): PixelShader {
  const palette = options.colors.map(toRgb);
  return (context) => {
    const count = options.count ?? 4;
    const bend = Math.sin(context.xn * Math.PI * 2 + context.progress * Math.PI * 2 * (options.speed ?? 0.4)) * (options.bend ?? 0.12);
    const lane = positiveModulo(context.yn + bend + context.progress * (options.speed ?? 0.4), 1 / count) * count;
    const distance = Math.abs(lane - 0.5);
    const alpha = 1 - smoothstep(options.width ?? 0.12, 0.5, distance);
    return { ...samplePalette(palette, positiveModulo(context.xn + context.yn + context.progress, 1)), a: clamp01(alpha) };
  };
}

export function sparkles(options: {
  color?: HexColor | Rgb;
  density?: number;
  speed?: number;
  size?: number;
  rainbow?: boolean;
} = {}): PixelShader {
  const base = toRgb(options.color ?? "#ffffff");
  return (context) => {
    const beat = Math.floor(context.timeSeconds * (options.speed ?? 6));
    const random = hash(context.x, context.y, beat, context.seed);
    const density = options.density ?? 0.09;
    const active = random > 1 - density ? 1 : 0;
    const age = positiveModulo(context.timeSeconds * (options.speed ?? 6), 1);
    const intensity = active * Math.pow(1 - age, options.size ?? 1.5);
    const pixel = options.rainbow ? hsv(hash(context.x, context.y, context.seed), 0.8, 1) : base;
    return { ...pixel, a: intensity };
  };
}

export function plasma(options: { colors: readonly (HexColor | Rgb)[]; scale?: number; speed?: number }): PixelShader {
  const palette = options.colors.map(toRgb);
  return (context) => {
    const scale = options.scale ?? 3;
    const time = context.progress * Math.PI * 2 * (options.speed ?? 1);
    const a = Math.sin(context.xn * scale * Math.PI * 2 + time);
    const b = Math.sin(context.yn * scale * Math.PI * 2 - time * 0.73);
    const c = Math.sin((context.xn + context.yn) * scale * Math.PI + time * 0.41);
    return samplePalette(palette, clamp01(0.5 + (a + b + c) / 6));
  };
}

export function checker(options: { colors: readonly [HexColor | Rgb, HexColor | Rgb]; size?: number; speed?: number }): PixelShader {
  const first = toRgb(options.colors[0]);
  const second = toRgb(options.colors[1]);
  return (context) => {
    const offset = context.progress * (options.speed ?? 1);
    const size = options.size ?? 4;
    const cell = Math.floor(context.x / size + offset) + Math.floor(context.y / size - offset);
    return cell % 2 === 0 ? first : second;
  };
}

export function kaleidoscope(options: { colors: readonly (HexColor | Rgb)[]; segments?: number; speed?: number }): PixelShader {
  const palette = options.colors.map(toRgb);
  return (context) => {
    const dx = context.xn - 0.5;
    const dy = (context.yn - 0.5) * 2;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) / (Math.PI * 2);
    const segment = Math.abs(positiveModulo(angle * (options.segments ?? 8) + context.progress * (options.speed ?? 1), 2) - 1);
    return samplePalette(palette, positiveModulo(segment + distance * 1.7, 1));
  };
}

export function mask(shader: PixelShader, opacity: (context: ShaderContext) => number): PixelShader {
  return (context) => ({ ...shader(context), a: clamp01(opacity(context)) });
}

export function mapShader(shader: PixelShader, transform: (pixel: Pixel, context: ShaderContext) => Pixel): PixelShader {
  return (context) => transform(shader(context), context);
}

export function hsv(hue: number, saturation: number, value: number): Rgb {
  const h = positiveModulo(hue, 1) * 6;
  const c = clamp01(value) * clamp01(saturation);
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = clamp01(value) - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hash(...values: number[]): number {
  let state = 2166136261;
  for (const value of values) {
    state ^= Math.trunc(value * 1_000_003);
    state = Math.imul(state, 16777619);
    state ^= state >>> 13;
  }
  return (state >>> 0) / 0xffff_ffff;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const normalized = clamp01((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

export function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * clamp01(amount);
}

export function rgbToHex(pixel: Rgb): HexColor {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${channel(pixel.r)}${channel(pixel.g)}${channel(pixel.b)}`;
}

function blend(base: Pixel, layer: Pixel, mode: LayerMode): Pixel {
  const alpha = clamp01(layer.a ?? 1);
  const blendChannel = (bottom: number, top: number) => {
    if (mode === "add") return Math.min(255, bottom + top * alpha);
    if (mode === "screen") return 255 - (255 - bottom) * (255 - top * alpha) / 255;
    if (mode === "multiply") return bottom * mix(1, top / 255, alpha);
    return mix(bottom, top, alpha);
  };
  return { r: blendChannel(base.r, layer.r), g: blendChannel(base.g, layer.g), b: blendChannel(base.b, layer.b), a: Math.max(base.a ?? 0, alpha) };
}

function applyPressure(base: Pixel, context: ShaderContext, atMillis: number, points: readonly PressurePoint[], preset: NonNullable<NativeAnimation["pressure"]>): Pixel {
  if (preset === "none") return base;
  let result = base;
  for (const point of points) {
    const age = (atMillis - point.startedAtMillis) / 900;
    if (age < 0 || age > 1) continue;
    const distance = Math.hypot(context.x - point.x, context.y - point.y);
    const ring = 1 - smoothstep(0.4, 1.8, Math.abs(distance - age * 8));
    const core = Math.max(0, 1 - distance / 2.5) * Math.pow(1 - age, 2);
    const strength = clamp01((ring + core * 0.7) * (1 - age));
    const target = preset === "spark" ? { r: 255, g: 232, b: 118 } : preset === "glow" ? { r: 255, g: 111, b: 214 } : { r: 126, g: 225, b: 255 };
    result = { r: mix(result.r, target.r, strength), g: mix(result.g, target.g, strength), b: mix(result.b, target.b, strength), a: 1 };
  }
  return result;
}

function samplePalette(colors: readonly Rgb[], position: number): Pixel {
  if (colors.length === 0) return transparent;
  if (colors.length === 1) return colors[0]!;
  const scaled = clamp01(position) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const amount = scaled - index;
  const left = colors[index]!;
  const right = colors[index + 1]!;
  return { r: mix(left.r, right.r, amount), g: mix(left.g, right.g, amount), b: mix(left.b, right.b, amount), a: 1 };
}

function toRgb(value: HexColor | Rgb): Rgb {
  if (typeof value !== "string") return value;
  const hex = value.slice(1);
  if (hex.length === 3) return { r: Number.parseInt(hex[0]! + hex[0]!, 16), g: Number.parseInt(hex[1]! + hex[1]!, 16), b: Number.parseInt(hex[2]! + hex[2]!, 16) };
  return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) };
}

function clampPixel(pixel: Pixel): Pixel {
  return { r: clamp(pixel.r, 0, 255), g: clamp(pixel.g, 0, 255), b: clamp(pixel.b, 0, 255), a: clamp01(pixel.a ?? 1) };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

const transparent: Pixel = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
