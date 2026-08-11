import { useEffect, useRef } from "react";
import { drawFloorCanvas, floorDisplayCells, type FloorBoardCell } from "./floorView";
import { FLOOR_COLS, FLOOR_ROWS, type FloorAnim } from "./floor";

const PITCH = 14; // device pixels per LED (lit cell + gap)
const GAP = 2;
const LIT = PITCH - GAP;
const IDLE: [number, number, number] = [13, 19, 30]; // unlit LED, matches controller preview tile tone
const IDLE_CSS = `rgb(${IDLE[0]}, ${IDLE[1]}, ${IDLE[2]})`;
const FPS = 50;

type FloorPreviewOrientation = "portrait" | "landscape";

// Renders the 16x32 LED floor as crisp tiles on a canvas and
// loops the given per-game animation. One self-contained rAF loop per card; pauses when the
// tab is hidden and falls back to a single static frame under prefers-reduced-motion.
export function FloorPreview({ anim, orientation = "portrait" }: { anim: FloorAnim; orientation?: FloorPreviewOrientation }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;

    const cols = FLOOR_COLS;
    const rows = FLOOR_ROWS;
    const landscape = orientation === "landscape";
    const displayCols = landscape ? rows : cols;
    const displayRows = landscape ? cols : rows;
    const width = displayCols * PITCH + GAP;
    const height = displayRows * PITCH + GAP;
    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.style.height = "auto";

    function fitCanvas() {
      const parent = targetCanvas.parentElement;
      if (!parent) return;
      const aspect = width / height;
      // The kiosk frame is transform-scaled to preserve its 16:9 shape.
      // Measure layout pixels here so canvas previews are not scaled twice.
      const maxWidth = Math.max(1, parent.clientWidth - 8);
      const maxHeight = Math.max(1, parent.clientHeight - 8);
      const cssWidth = Math.floor(Math.min(maxWidth, maxHeight * aspect));
      targetCanvas.style.width = `${cssWidth}px`;
    }

    fitCanvas();
    const resizeObserver = new ResizeObserver(fitCanvas);
    if (targetCanvas.parentElement) resizeObserver.observe(targetCanvas.parentElement);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw(seconds: number) {
      const cells: FloorBoardCell[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let [r, g, b] = anim(x, y, cols, rows, seconds);
          if (r + g + b < 14) [r, g, b] = IDLE;
          cells.push({ x, y, color: `rgb(${r | 0}, ${g | 0}, ${b | 0})` });
        }
      }
      drawFloorCanvas({
        canvas: targetCanvas,
        ...floorDisplayCells(cols, rows, cells, landscape ? "clockwise" : "data", IDLE_CSS),
        emptyColor: "#05070a",
        tileSize: LIT,
        gapSize: GAP,
      });
    }

    if (reduceMotion) {
      draw(2.4);
      return () => resizeObserver.disconnect();
    }

    let raf = 0;
    let last = -1;
    const interval = 1000 / FPS;

    function frame(nowMs: number) {
      raf = requestAnimationFrame(frame);
      if (nowMs - last < interval) return;
      last = nowMs;
      draw(nowMs / 1000);
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = -1;
        raf = requestAnimationFrame(frame);
      }
    }

    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [anim, orientation]);

  return <canvas ref={canvasRef} className="floor-canvas" aria-hidden="true" />;
}
