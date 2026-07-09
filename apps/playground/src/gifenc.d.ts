declare module "gifenc" {
  export type GifPalette = number[][];

  export type GifEncoder = {
    finish(): void;
    bytesView(): Uint8Array;
    writeFrame(
      indexedPixels: Uint8Array,
      width: number,
      height: number,
      options: {
        delay?: number;
        palette: GifPalette;
      }
    ): void;
  };

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(pixels: Uint8Array | Uint8ClampedArray, maxColors: number): GifPalette;
  export function applyPalette(pixels: Uint8Array | Uint8ClampedArray, palette: GifPalette): Uint8Array;
}
