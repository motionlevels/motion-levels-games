/**
 * Color helpers shared across the front-ends. These were copy-pasted into
 * player-menu and player-display (and inlined in the platform) with identical
 * behavior; this is the single home for them.
 *
 * Note the two string formats are intentionally distinct and preserved:
 *   - hexToRGB / colorRGB return a bare `"r,g,b"` triplet (for CSS `rgb(var(--x))`
 *     style composition and `--accent-rgb`-shaped tokens).
 *   - colorCSS returns a ready-to-use `"rgb(r, g, b)"` string.
 */

export type RGB = { r: number; g: number; b: number };

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** "#2fd86c" -> { r, g, b } */
export function hexToColor(hex: string): RGB {
  const [r, g, b] = channels(hex);
  return { r, g, b };
}

/** "#2fd86c" -> "47,216,108" (no spaces; pairs with rgb()/rgba() composition). */
export function hexToRGB(hex: string): string {
  const [r, g, b] = channels(hex);
  return `${r},${g},${b}`;
}

/** { r, g, b } -> "rgb(47, 216, 108)" */
export function colorCSS(color: RGB): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

/** { r, g, b } -> "47, 216, 108" */
export function colorRGB(color: RGB): string {
  return `${color.r}, ${color.g}, ${color.b}`;
}

/** Linearly blend two hex colors; amount 0 -> left, 1 -> right. Returns "rgb(...)". */
export function mix(left: string, right: string, amount: number): string {
  const a = channels(left);
  const b = channels(right);
  const out = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}
