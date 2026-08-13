import { connect, type Socket } from "node:net";
import {
  DelimitedMessageDecoder,
  controllerProtocolVersion,
  decodeControllerMessage,
  encodeDelimited,
  encodeRuntimeMessage,
  floorHeight,
  floorWidth,
  pressureAt,
  validateControllerHello,
  validateRuntimeFrame,
  type RuntimeFrame
} from "./controllerProtocol.ts";

export type PressureInput = { x: number; y: number; pressed: boolean; unixNanos: bigint; sequence: bigint };

export type ControllerClientOptions = {
  address: string;
  sourceRevision: string;
  onPressure(input: PressureInput): void;
  onConnectionChange?(connected: boolean, controllerId: string): void;
  log?(message: string, error?: unknown): void;
};

/** Reconnecting, latest-frame-wins controller v2 TCP client. */
export class ControllerClient {
  private socket: Socket | null = null;
  private decoder = new DelimitedMessageDecoder();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectMillis = 250;
  private stopping = false;
  private helloReceived = false;
  private blocked = false;
  private pendingFrame: RuntimeFrame | null = null;
  private pressed = new Uint8Array(floorWidth * floorHeight / 8);
  private pressureSequence = 0n;
  private controllerIdValue = "";

  constructor(private readonly options: ControllerClientOptions) {}

  get connected(): boolean { return this.helloReceived; }
  get controllerId(): string { return this.controllerIdValue; }

  start(): void {
    if (this.socket || this.reconnectTimer) return;
    this.stopping = false;
    this.open();
  }

  stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.destroy();
    this.socket = null;
    this.setDisconnected();
  }

  sendFrame(frame: RuntimeFrame): void {
    validateRuntimeFrame(frame);
    if (!this.socket || !this.helloReceived || this.blocked) {
      this.pendingFrame = frame;
      return;
    }
    this.writeFrame(frame);
  }

  private open(): void {
    const target = parseControllerAddress(this.options.address);
    const socket = connect(target);
    this.socket = socket;
    this.decoder.reset();
    this.helloReceived = false;
    this.blocked = false;
    socket.setNoDelay(true);
    socket.on("connect", () => {
      const hello = encodeDelimited(encodeRuntimeMessage({
        type: "hello",
        hello: { protocolVersion: controllerProtocolVersion, sourceRevision: this.options.sourceRevision }
      }));
      this.blocked = !socket.write(hello);
    });
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const payload of this.decoder.push(chunk)) this.handlePayload(payload);
      } catch (error) {
        this.options.log?.("invalid controller v2 message", error);
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("drain", () => {
      this.blocked = false;
      const pending = this.pendingFrame;
      this.pendingFrame = null;
      if (pending && this.helloReceived) this.writeFrame(pending);
    });
    socket.on("error", (error) => this.options.log?.("controller connection error", error));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setDisconnected();
      if (!this.stopping) this.scheduleReconnect();
    });
  }

  private handlePayload(payload: Uint8Array): void {
    const message = decodeControllerMessage(payload);
    if (message.type === "hello") {
      validateControllerHello(message.hello);
      this.helloReceived = true;
      this.controllerIdValue = message.hello.controllerId;
      this.reconnectMillis = 250;
      this.options.onConnectionChange?.(true, this.controllerIdValue);
      if (!this.blocked && this.pendingFrame) {
        const pending = this.pendingFrame;
        this.pendingFrame = null;
        this.writeFrame(pending);
      }
      return;
    }
    if (message.type === "presentedFrame") {
      if (!this.helloReceived) throw new Error("controller hello must precede presented frames");
      this.resyncPressure(message.pressureBits, this.pressureSequence, message.presentedUnixNanos);
      return;
    }
    if (message.type === "status") return;
    if (!this.helloReceived) throw new Error("controller hello must precede pressure changes");
    if (message.pressureChange.sequence <= this.pressureSequence) return;
    if (pressureSequenceHasGap(this.pressureSequence, message.pressureChange.sequence)) {
      this.options.log?.(`pressure sequence gap: ${this.pressureSequence} -> ${message.pressureChange.sequence}`);
    }
    this.pressureSequence = message.pressureChange.sequence;
    const { x, y, pressed, unixNanos, sequence } = message.pressureChange;
    if (pressureAt(this.pressed, x, y) === pressed) return;
    setPressure(this.pressed, x, y, pressed);
    this.options.onPressure({ x, y, pressed, unixNanos, sequence });
  }

  private resyncPressure(authoritative: Uint8Array, sequence: bigint, unixNanos?: bigint): void {
    for (const input of reconcilePressure(this.pressed, authoritative, sequence, unixNanos)) this.options.onPressure(input);
    this.pressed = authoritative.slice();
    this.pressureSequence = sequence;
  }

  private writeFrame(frame: RuntimeFrame): void {
    const socket = this.socket;
    if (!socket) {
      this.pendingFrame = frame;
      return;
    }
    this.blocked = !socket.write(encodeDelimited(encodeRuntimeMessage({ type: "frame", frame })));
  }

  private setDisconnected(): void {
    const wasConnected = this.helloReceived;
    this.helloReceived = false;
    this.controllerIdValue = "";
    this.blocked = false;
    if (wasConnected) this.options.onConnectionChange?.(false, "");
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectMillis;
    this.reconnectMillis = Math.min(5_000, this.reconnectMillis * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopping) this.open();
    }, delay);
    this.reconnectTimer.unref();
  }
}

export function pressureSequenceHasGap(current: bigint, incoming: bigint): boolean {
  return incoming !== current + 1n;
}

export function reconcilePressure(
  previous: Uint8Array,
  authoritative: Uint8Array,
  sequence: bigint,
  unixNanos = BigInt(Date.now()) * 1_000_000n
): PressureInput[] {
  const changes: PressureInput[] = [];
  for (let y = 0; y < floorHeight; y += 1) {
    for (let x = 0; x < floorWidth; x += 1) {
      const before = pressureAt(previous, x, y);
      const after = pressureAt(authoritative, x, y);
      if (before !== after) changes.push({ x, y, pressed: after, unixNanos, sequence });
    }
  }
  return changes;
}

function setPressure(bitset: Uint8Array, x: number, y: number, pressed: boolean): void {
  const index = y * floorWidth + x;
  const byteIndex = index >> 3;
  const value = bitset[byteIndex] ?? 0;
  bitset[byteIndex] = pressed ? value | (1 << (index & 7)) : value & ~(1 << (index & 7));
}

export function parseControllerAddress(address: string): { host: string; port: number } {
  const candidate = address.trim().replace(/^tcp:\/\//u, "");
  const bracketed = candidate.match(/^\[([^\]]+)\]:(\d+)$/u);
  const plain = candidate.match(/^([^:]+):(\d+)$/u);
  const match = bracketed ?? plain;
  if (!match) throw new Error(`invalid controller address: ${address}`);
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid controller port: ${match[2]}`);
  return { host: match[1] ?? "", port };
}
