export const controllerProtocolVersion = 2 as const;
export const floorWidth = 16 as const;
export const floorHeight = 32 as const;
export const floorRgbBytes = floorWidth * floorHeight * 3;
export const pressureBitsetBytes = floorWidth * floorHeight / 8;
export const maxDelimitedMessageBytes = 64 * 1024;

export type RuntimeHello = {
  protocolVersion: number;
  sourceRevision: string;
};

export type RuntimeFrame = {
  sequence: bigint;
  unixNanos: bigint;
  rgb: Uint8Array;
  sessionId: string;
  venueSessionId: string;
};

export type ControllerHello = {
  protocolVersion: number;
  controllerId: string;
  width: number;
  height: number;
  refreshFps: number;
  pressureSequence: bigint;
  pressed: Uint8Array;
};

export type PressureChange = {
  sequence: bigint;
  unixNanos: bigint;
  x: number;
  y: number;
  pressed: boolean;
};

export type RuntimeMessage =
  | { type: "hello"; hello: RuntimeHello }
  | { type: "frame"; frame: RuntimeFrame };

export type ControllerMessage =
  | { type: "hello"; hello: ControllerHello }
  | { type: "pressureChange"; pressureChange: PressureChange };

export function encodeRuntimeMessage(message: RuntimeMessage): Uint8Array {
  const payload = message.type === "hello" ? encodeRuntimeHello(message.hello) : encodeRuntimeFrame(message.frame);
  return fieldBytes(message.type === "hello" ? 1 : 2, payload);
}

export function decodeRuntimeMessage(bytes: Uint8Array): RuntimeMessage {
  const envelope = oneofEnvelope(bytes, "runtime message");
  if (envelope.field === 1) return { type: "hello", hello: decodeRuntimeHello(envelope.payload) };
  if (envelope.field === 2) return { type: "frame", frame: decodeRuntimeFrame(envelope.payload) };
  throw new Error(`unknown runtime message field: ${envelope.field}`);
}

export function encodeControllerMessage(message: ControllerMessage): Uint8Array {
  const payload = message.type === "hello"
    ? encodeControllerHello(message.hello)
    : encodePressureChange(message.pressureChange);
  return fieldBytes(message.type === "hello" ? 1 : 2, payload);
}

export function decodeControllerMessage(bytes: Uint8Array): ControllerMessage {
  const envelope = oneofEnvelope(bytes, "controller message");
  if (envelope.field === 1) return { type: "hello", hello: decodeControllerHello(envelope.payload) };
  if (envelope.field === 2) return { type: "pressureChange", pressureChange: decodePressureChange(envelope.payload) };
  throw new Error(`unknown controller message field: ${envelope.field}`);
}

export function encodeDelimited(payload: Uint8Array): Uint8Array {
  if (payload.byteLength > maxDelimitedMessageBytes) throw new Error("protobuf message exceeds 64 KiB limit");
  return concat([encodeVarint(BigInt(payload.byteLength)), payload]);
}

export class DelimitedMessageDecoder {
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array();

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength === 0) return [];
    this.buffered = concat([this.buffered, chunk]);
    const messages: Uint8Array[] = [];
    let offset = 0;
    while (offset < this.buffered.byteLength) {
      const prefix = tryDecodeVarint(this.buffered, offset);
      if (!prefix) break;
      if (prefix.value > BigInt(maxDelimitedMessageBytes)) throw new Error("protobuf message exceeds 64 KiB limit");
      const length = Number(prefix.value);
      const end = prefix.next + length;
      if (end > this.buffered.byteLength) break;
      messages.push(this.buffered.slice(prefix.next, end));
      offset = end;
    }
    this.buffered = this.buffered.slice(offset);
    if (this.buffered.byteLength > maxDelimitedMessageBytes + 10) {
      throw new Error("incomplete delimited protobuf message exceeds limit");
    }
    return messages;
  }

  reset(): void {
    this.buffered = new Uint8Array();
  }
}

export function validateControllerHello(hello: ControllerHello): void {
  if (hello.protocolVersion !== controllerProtocolVersion) {
    throw new Error(`unsupported controller protocol: ${hello.protocolVersion}`);
  }
  if (hello.width !== floorWidth || hello.height !== floorHeight) {
    throw new Error(`unsupported controller floor: ${hello.width}x${hello.height}`);
  }
  if (hello.pressed.byteLength !== pressureBitsetBytes) {
    throw new Error(`controller pressure bitset must be ${pressureBitsetBytes} bytes`);
  }
  if (!hello.controllerId.trim() || hello.controllerId.length > 256) throw new Error("controller id is invalid");
  if (!Number.isInteger(hello.refreshFps) || hello.refreshFps <= 0) throw new Error("controller refresh fps is invalid");
}

export function validateRuntimeFrame(frame: RuntimeFrame): void {
  if (frame.rgb.byteLength !== floorRgbBytes) throw new Error(`runtime frame must contain ${floorRgbBytes} RGB bytes`);
  if (frame.sessionId.length > 256 || frame.venueSessionId.length > 256) throw new Error("session id exceeds limit");
}

export function pressureAt(bitset: Uint8Array, x: number, y: number): boolean {
  const index = y * floorWidth + x;
  const byte = bitset[index >> 3];
  return byte !== undefined && (byte & (1 << (index & 7))) !== 0;
}

function encodeRuntimeHello(value: RuntimeHello): Uint8Array {
  if (value.sourceRevision.length > 128) throw new Error("source revision exceeds limit");
  return concat([
    fieldVarint(1, value.protocolVersion),
    fieldString(2, value.sourceRevision)
  ]);
}

function encodeRuntimeFrame(value: RuntimeFrame): Uint8Array {
  return concat([
    fieldVarint(1, value.sequence),
    fieldVarint(2, value.unixNanos),
    fieldBytes(3, value.rgb),
    fieldString(4, value.sessionId),
    fieldString(5, value.venueSessionId)
  ]);
}

function encodeControllerHello(value: ControllerHello): Uint8Array {
  return concat([
    fieldVarint(1, value.protocolVersion),
    fieldString(2, value.controllerId),
    fieldVarint(3, value.width),
    fieldVarint(4, value.height),
    fieldVarint(5, value.refreshFps),
    fieldVarint(6, value.pressureSequence),
    fieldBytes(7, value.pressed)
  ]);
}

function encodePressureChange(value: PressureChange): Uint8Array {
  return concat([
    fieldVarint(1, value.sequence),
    fieldVarint(2, value.unixNanos),
    fieldVarint(3, value.x),
    fieldVarint(4, value.y),
    fieldVarint(5, value.pressed ? 1 : 0)
  ]);
}

function decodeRuntimeHello(bytes: Uint8Array): RuntimeHello {
  const fields = fieldsByNumber(bytes);
  return {
    protocolVersion: numberField(fields, 1),
    sourceRevision: stringField(fields, 2)
  };
}

function decodeRuntimeFrame(bytes: Uint8Array): RuntimeFrame {
  const fields = fieldsByNumber(bytes);
  const frame = {
    sequence: bigintField(fields, 1),
    unixNanos: bigintField(fields, 2),
    rgb: bytesField(fields, 3),
    sessionId: stringField(fields, 4),
    venueSessionId: stringField(fields, 5)
  };
  return frame;
}

function decodeControllerHello(bytes: Uint8Array): ControllerHello {
  const fields = fieldsByNumber(bytes);
  const hello = {
    protocolVersion: numberField(fields, 1),
    controllerId: stringField(fields, 2),
    width: numberField(fields, 3),
    height: numberField(fields, 4),
    refreshFps: numberField(fields, 5),
    pressureSequence: bigintField(fields, 6),
    pressed: bytesField(fields, 7)
  };
  return hello;
}

function decodePressureChange(bytes: Uint8Array): PressureChange {
  const fields = fieldsByNumber(bytes);
  const value = {
    sequence: bigintField(fields, 1),
    unixNanos: bigintField(fields, 2),
    x: numberField(fields, 3),
    y: numberField(fields, 4),
    pressed: bigintField(fields, 5) !== 0n
  };
  if (!Number.isInteger(value.x) || value.x < 0 || value.x >= floorWidth ||
      !Number.isInteger(value.y) || value.y < 0 || value.y >= floorHeight) {
    throw new Error(`pressure coordinate out of bounds: ${value.x},${value.y}`);
  }
  return value;
}

type DecodedField = { wire: number; varint?: bigint; bytes?: Uint8Array };

function oneofEnvelope(bytes: Uint8Array, label: string): { field: number; payload: Uint8Array } {
  const fields = fieldsByNumber(bytes);
  const candidates = [...fields.entries()].filter(([field]) => field === 1 || field === 2);
  if (candidates.length !== 1 || candidates[0]?.[1].length !== 1) throw new Error(`${label} must contain exactly one payload`);
  const [field, values] = candidates[0];
  return { field, payload: bytesValue(values[0], `${label} payload`) };
}

function fieldsByNumber(bytes: Uint8Array): Map<number, DecodedField[]> {
  if (bytes.byteLength > maxDelimitedMessageBytes) throw new Error("protobuf message exceeds 64 KiB limit");
  const result = new Map<number, DecodedField[]>();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tag = decodeVarint(bytes, offset);
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (field < 1) throw new Error("invalid protobuf field number");
    let decoded: DecodedField;
    if (wire === 0) {
      const value = decodeVarint(bytes, offset);
      offset = value.next;
      decoded = { wire, varint: value.value };
    } else if (wire === 2) {
      const length = decodeVarint(bytes, offset);
      offset = length.next;
      if (length.value > BigInt(maxDelimitedMessageBytes)) throw new Error("protobuf bytes field exceeds limit");
      const end = offset + Number(length.value);
      if (end > bytes.byteLength) throw new Error("truncated protobuf bytes field");
      decoded = { wire, bytes: bytes.slice(offset, end) };
      offset = end;
    } else if (wire === 1) {
      if (offset + 8 > bytes.byteLength) throw new Error("truncated protobuf fixed64 field");
      offset += 8;
      decoded = { wire };
    } else if (wire === 5) {
      if (offset + 4 > bytes.byteLength) throw new Error("truncated protobuf fixed32 field");
      offset += 4;
      decoded = { wire };
    } else {
      throw new Error(`unsupported protobuf wire type: ${wire}`);
    }
    const values = result.get(field) ?? [];
    values.push(decoded);
    result.set(field, values);
  }
  return result;
}

function bigintField(fields: Map<number, DecodedField[]>, field: number): bigint {
  const value = fields.get(field)?.at(-1);
  if (!value) return 0n;
  if (value.wire !== 0 || value.varint === undefined) throw new Error(`protobuf field ${field} must be varint`);
  return value.varint;
}

function numberField(fields: Map<number, DecodedField[]>, field: number): number {
  const value = bigintField(fields, field);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`protobuf field ${field} exceeds safe integer range`);
  return Number(value);
}

function bytesField(fields: Map<number, DecodedField[]>, field: number): Uint8Array {
  const value = fields.get(field)?.at(-1);
  return value ? bytesValue(value, `protobuf field ${field}`) : new Uint8Array();
}

function bytesValue(value: DecodedField | undefined, label: string): Uint8Array {
  if (!value || value.wire !== 2 || value.bytes === undefined) throw new Error(`${label} must be length-delimited`);
  return value.bytes;
}

function stringField(fields: Map<number, DecodedField[]>, field: number): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytesField(fields, field));
}

function fieldVarint(field: number, value: number | bigint): Uint8Array {
  const integer = typeof value === "bigint" ? value : BigInt(value);
  if (integer < 0n) throw new Error("protobuf varint cannot be negative");
  return concat([encodeVarint(BigInt(field << 3)), encodeVarint(integer)]);
}

function fieldString(field: number, value: string): Uint8Array {
  return fieldBytes(field, new TextEncoder().encode(value));
}

function fieldBytes(field: number, value: Uint8Array): Uint8Array {
  return concat([encodeVarint(BigInt((field << 3) | 2)), encodeVarint(BigInt(value.byteLength)), value]);
}

function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("protobuf varint cannot be negative");
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Uint8Array.from(bytes);
}

function tryDecodeVarint(bytes: Uint8Array, offset: number): { value: bigint; next: number } | null {
  let value = 0n;
  for (let index = 0; index < 10; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return null;
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if ((byte & 0x80) === 0) return { value, next: offset + index + 1 };
  }
  throw new Error("protobuf varint exceeds 10 bytes");
}

function decodeVarint(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  const value = tryDecodeVarint(bytes, offset);
  if (!value) throw new Error("truncated protobuf varint");
  return value;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
