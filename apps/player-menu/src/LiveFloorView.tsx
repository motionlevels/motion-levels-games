import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawFloorCanvas, floorDisplayCells, type FloorBoardCell } from "./floorView";
import { FLOOR_COLS, FLOOR_ROWS } from "./floor";

const PITCH = 14;
const GAP = 2;
const LIT = PITCH - GAP;
const IDLE: [number, number, number] = [13, 19, 30];
const IDLE_CSS = `rgb(${IDLE[0]}, ${IDLE[1]}, ${IDLE[2]})`;

type ConnectionState = "connecting" | "live" | "error";
type LiveFloorOrientation = "portrait" | "landscape";

type PressureMessage = {
  type?: string;
  x?: number;
  y?: number;
  pressed?: boolean;
};

function controllerWebSocketURL(): string {
  const configured = import.meta.env.VITE_FLOOR_CONTROLLER_URL;
  if (configured) {
    const url = new URL(configured, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
    url.search = "";
    return url.toString();
  }
  const gatewayMatch = window.location.pathname.match(/^\/gateways\/[^/]+\/menu(?:\/|$)/);
  if (gatewayMatch) {
    const url = new URL(`${gatewayMatch[0].replace(/\/menu\/?$/, "/controller/ws")}`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  if (window.location.pathname.startsWith("/menu")) {
    const url = new URL("/controller/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  const controllerPort = import.meta.env.VITE_FLOOR_CONTROLLER_PORT || "4101";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "127.0.0.1";
  return `${protocol}://${host}:${controllerPort}/ws`;
}

export function LiveFloorView({ interactive = false, orientation = "landscape" }: { interactive?: boolean; orientation?: LiveFloorOrientation }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<Uint8Array | null>(null);
  const frameSizeRef = useRef({ width: FLOOR_COLS, height: FLOOR_ROWS });
  const pressedRef = useRef<Set<number>>(new Set());
  const pointerPressRef = useRef<{ x: number; y: number } | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;

    const landscape = orientation === "landscape";
    const displayCols = landscape ? FLOOR_ROWS : FLOOR_COLS;
    const displayRows = landscape ? FLOOR_COLS : FLOOR_ROWS;
    const width = displayCols * PITCH + GAP;
    const height = displayRows * PITCH + GAP;
    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.style.height = "auto";

    function fitCanvas() {
      const parent = targetCanvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const aspect = width / height;
      const maxWidth = Math.max(1, rect.width - 20);
      const maxHeight = Math.max(1, rect.height - 20);
      const cssWidth = Math.floor(Math.min(maxWidth, maxHeight * aspect));
      targetCanvas.style.width = `${cssWidth}px`;
    }

    function draw() {
      const frame = frameRef.current;
      const frameSize = frameSizeRef.current;
      const cells: FloorBoardCell[] = [];
      for (let y = 0; y < FLOOR_ROWS; y++) {
        for (let x = 0; x < FLOOR_COLS; x++) {
          const index = y * FLOOR_COLS + x;
          let r = IDLE[0];
          let g = IDLE[1];
          let b = IDLE[2];
          if (frame && x < frameSize.width && y < frameSize.height) {
            const rgbIndex = (y * frameSize.width + x) * 3;
            r = frame[rgbIndex] || 0;
            g = frame[rgbIndex + 1] || 0;
            b = frame[rgbIndex + 2] || 0;
            if (r + g + b < 14) [r, g, b] = IDLE;
          }
          cells.push({ x, y, color: `rgb(${r | 0}, ${g | 0}, ${b | 0})`, pressed: pressedRef.current.has(index) });
        }
      }
      drawFloorCanvas({
        canvas: targetCanvas,
        ...floorDisplayCells(FLOOR_COLS, FLOOR_ROWS, cells, landscape ? "clockwise" : "data", IDLE_CSS),
        emptyColor: "#05070a",
        tileSize: LIT,
        gapSize: GAP,
        drawCellOverlay(context, cell, rect) {
          if (!cell.pressed) return;
          context.strokeStyle = "#ff334f";
          context.lineWidth = 3;
          context.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.size - 3, rect.size - 3);
        },
      });
    }

    function applyFrame(buffer: ArrayBuffer) {
      const view = new DataView(buffer);
      if (view.byteLength < 16 || view.getUint8(0) !== 77 || view.getUint8(1) !== 76 || view.getUint8(2) !== 70 || view.getUint8(3) !== 49) return;
      const frameWidth = view.getUint16(8, true);
      const frameHeight = view.getUint16(10, true);
      const flags = view.getUint8(12);
      const headerLength = view.getUint16(14, true);
      const tileCount = frameWidth * frameHeight;
      const rgbOffset = headerLength;
      const pressureOffset = rgbOffset + tileCount * 3;
      const bytes = new Uint8Array(buffer);
      if (bytes.length < pressureOffset) return;

      frameSizeRef.current = { width: frameWidth, height: frameHeight };
      frameRef.current = bytes.slice(rgbOffset, pressureOffset);
      if (flags & 1 && bytes.length >= pressureOffset + Math.ceil(tileCount / 8)) {
        const pressed = new Set<number>();
        for (let index = 0; index < tileCount; index++) {
          if (bytes[pressureOffset + Math.floor(index / 8)] & (1 << (index % 8))) pressed.add(index);
        }
        pressedRef.current = pressed;
      } else pressedRef.current = new Set();
      lastFrameAtRef.current = Date.now();
      reconnectAttemptRef.current = 0;
      setConnection("live");
      draw();
    }

    function applyPressure(message: PressureMessage) {
      if (message.type !== "pressure" || typeof message.x !== "number" || typeof message.y !== "number") return;
      if (message.x < 0 || message.x >= FLOOR_COLS || message.y < 0 || message.y >= FLOOR_ROWS) return;
      const index = message.y * FLOOR_COLS + message.x;
      const pressed = new Set(pressedRef.current);
      if (message.pressed) pressed.add(index);
      else pressed.delete(index);
      pressedRef.current = pressed;
      lastFrameAtRef.current = Date.now();
      reconnectAttemptRef.current = 0;
      setConnection("live");
      draw();
    }

    fitCanvas();
    draw();
    const resizeObserver = new ResizeObserver(fitCanvas);
    if (targetCanvas.parentElement) resizeObserver.observe(targetCanvas.parentElement);

    let closed = false;

    function connect() {
      if (closed) return;
      setConnection("connecting");
      lastFrameAtRef.current = Date.now();
      const socket = new WebSocket(controllerWebSocketURL());
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => setConnection("connecting"));
      socket.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          applyFrame(event.data);
          return;
        }
        try {
          applyPressure(JSON.parse(event.data) as PressureMessage);
        } catch {
          // Ignore status/config text messages here; the controller view owns those details.
        }
      });
      socket.addEventListener("error", () => {
        setConnection("error");
        socket.close();
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        pressedRef.current = new Set();
        draw();
        setConnection("error");
        const delay = Math.min(5_000, 600 * (2 ** reconnectAttemptRef.current));
        reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, 4);
        reconnectRef.current = window.setTimeout(connect, delay);
      });
    }

    connect();
    const watchdog = window.setInterval(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastFrameAtRef.current <= 4_000) return;
      setConnection("error");
      socket.close();
    }, 1_000);
    return () => {
      closed = true;
      resizeObserver.disconnect();
      window.clearInterval(watchdog);
      if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [orientation]);

  function pressureFromPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const displayX = Math.floor((canvasX - GAP) / PITCH);
    const displayY = Math.floor((canvasY - GAP) / PITCH);
    if (orientation === "portrait") {
      if (displayX < 0 || displayX >= FLOOR_COLS || displayY < 0 || displayY >= FLOOR_ROWS) return null;
      return { x: displayX, y: displayY };
    }
    if (displayX < 0 || displayX >= FLOOR_ROWS || displayY < 0 || displayY >= FLOOR_COLS) return null;
    return { x: displayY, y: FLOOR_ROWS - 1 - displayX };
  }

  function sendPressure(point: { x: number; y: number }, pressed: boolean) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "press", x: point.x, y: point.y, pressed }));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const point = pressureFromPointer(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerPressRef.current = point;
    sendPressure(point, true);
  }

  function releasePointer() {
    const point = pointerPressRef.current;
    if (!point) return;
    pointerPressRef.current = null;
    sendPressure(point, false);
  }

  return (
    <div className={`live-floor ${connection} ${orientation} ${interactive ? "interactive" : ""}`}>
      <canvas
        ref={canvasRef}
        className="live-floor-canvas"
        aria-label="Estado real del suelo LED"
        onPointerDown={handlePointerDown}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onPointerLeave={releasePointer}
      />
      <span className="live-floor-status" role="status" aria-live="polite">{connection === "live" ? "Suelo en vivo" : connection === "connecting" ? "Conectando al suelo" : "Sin señal del suelo"}</span>
    </div>
  );
}
