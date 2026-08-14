export const RUN_REPLAY_SCHEMA = "motion-levels-run-replay-v1" as const;
export const RUN_REPLAY_CONTRACT_VERSION = 1 as const;
export const RUN_REPLAY_CONTENT_TYPE = "application/vnd.motion-levels.run-replay+jsonl" as const;
export const RUN_REPLAY_COMPRESSION = "gzip" as const;
export const RUN_REPLAY_FILE_EXTENSION = ".mlrun.jsonl.gz" as const;
export const RUN_REPLAY_MAX_DIMENSION = 256 as const;
export const RUN_REPLAY_MAX_PIXELS = 16_384 as const;
export const RUN_REPLAY_MAX_RECORD_BYTES = 4 * 1024 * 1024;
const maximumEncodedByteFieldCharacters = 2_000_000;

export type RunReplayJsonPrimitive = boolean | number | string | null;
export type RunReplayJsonValue =
  | RunReplayJsonPrimitive
  | RunReplayJsonValue[]
  | RunReplayJsonObject;
export type RunReplayJsonObject = { [key: string]: RunReplayJsonValue };

export type RunReplayHeaderRecord = {
  type: "header";
  schema: typeof RUN_REPLAY_SCHEMA;
  contractVersion: typeof RUN_REPLAY_CONTRACT_VERSION;
  sessionId: string;
  selectionId: string;
  runId: string;
  gameId: string;
  engineGame: string;
  sourceRevision: string;
  contentRevision?: string;
  width: number;
  height: number;
  pixelFormat: "rgb24";
  pressureFormat: "row-major-bitset-lsb0";
  frameSource: "presented-frame";
  firstDesiredSequence: string;
  startedAtUnixMillis: number;
};

/** A keyframe contains the complete byte array. A delta contains a sequence of
 * big-endian uint16 offset/length pairs followed by the replacement bytes. */
export type RunReplayByteField = {
  encoding: "keyframe" | "delta";
  dataBase64: string;
};

export type RunReplayFrameRecord = {
  type: "frame";
  recordSequence: number;
  presentationSequence: string;
  desiredSequence: string;
  presentedUnixNanos: string;
  engineAtMillis: number;
  fadeRatio: number;
  rgb: RunReplayByteField;
  pressure: RunReplayByteField;
};

export type RunReplayInputRecord = {
  type: "input";
  recordSequence: number;
  occurredAtUnixMillis: number;
  engineAtMillis: number;
  source: "physical" | "remote" | "restored";
  x: number;
  y: number;
  pressed: boolean;
};

export type RunReplayGameEventRecord = {
  type: "game-event";
  recordSequence: number;
  occurredAtUnixMillis: number;
  engineAtMillis: number;
  eventAtMillis: number;
  cue: string;
  message: string;
};

export type RunReplayCheckpointRecord = {
  type: "checkpoint";
  recordSequence: number;
  occurredAtUnixMillis: number;
  engineAtMillis: number;
  reason: "initial" | "periodic" | "phase" | "event" | "terminal";
  paused: boolean;
  snapshot: RunReplayJsonObject;
};

export type RunReplayFooterRecord = {
  type: "footer";
  recordSequence: number;
  endedAtUnixMillis: number;
  outcome: string;
  partial: boolean;
  frameCount: number;
  inputCount: number;
  eventCount: number;
  checkpointCount: number;
  firstPresentationSequence?: string;
  lastPresentationSequence?: string;
};

export type RunReplayRecord =
  | RunReplayHeaderRecord
  | RunReplayFrameRecord
  | RunReplayInputRecord
  | RunReplayGameEventRecord
  | RunReplayCheckpointRecord
  | RunReplayFooterRecord;

export type DecodedRunReplayFrame = {
  rgb: Uint8Array;
  pressure: Uint8Array;
};

export function encodeRunReplayByteField(
  current: Uint8Array,
  previous?: Uint8Array,
  forceKeyframe = false
): RunReplayByteField {
  if (current.byteLength > 0xffff) throw new Error("Replay byte field exceeds the delta offset range");
  if (!previous || forceKeyframe || previous.byteLength !== current.byteLength) {
    return { encoding: "keyframe", dataBase64: encodeBase64(current) };
  }
  const delta = encodeReplacementRuns(previous, current);
  if (delta.byteLength >= current.byteLength) {
    return { encoding: "keyframe", dataBase64: encodeBase64(current) };
  }
  return { encoding: "delta", dataBase64: encodeBase64(delta) };
}

export function decodeRunReplayByteField(
  field: RunReplayByteField,
  expectedLength: number,
  previous?: Uint8Array
): Uint8Array {
  nonNegativeInteger(expectedLength, "Replay byte length");
  const maximumBytes = field.encoding === "delta" ? expectedLength * 5 : expectedLength;
  if (field.dataBase64.length > Math.ceil(maximumBytes / 3) * 4) {
    throw new Error("Replay byte data exceeds the expected frame bounds");
  }
  const encoded = decodeBase64(field.dataBase64);
  if (field.encoding === "keyframe") {
    if (encoded.byteLength !== expectedLength) {
      throw new Error(`Replay keyframe contains ${encoded.byteLength} bytes; expected ${expectedLength}`);
    }
    return encoded;
  }
  if (field.encoding !== "delta") throw new Error("Unsupported replay byte encoding");
  if (!previous || previous.byteLength !== expectedLength) {
    throw new Error("Replay delta requires a previous frame with the expected length");
  }
  const result = previous.slice();
  let cursor = 0;
  let previousEnd = 0;
  while (cursor < encoded.byteLength) {
    if (cursor + 4 > encoded.byteLength) throw new Error("Replay delta header is truncated");
    const offset = (encoded[cursor] ?? 0) * 256 + (encoded[cursor + 1] ?? 0);
    const length = (encoded[cursor + 2] ?? 0) * 256 + (encoded[cursor + 3] ?? 0);
    cursor += 4;
    if (length < 1 || offset < previousEnd || offset + length > result.byteLength || cursor + length > encoded.byteLength) {
      throw new Error("Replay delta replacement run is invalid");
    }
    result.set(encoded.subarray(cursor, cursor + length), offset);
    cursor += length;
    previousEnd = offset + length;
  }
  return result;
}

export function decodeRunReplayFrame(
  header: RunReplayHeaderRecord,
  frame: RunReplayFrameRecord,
  previous?: DecodedRunReplayFrame
): DecodedRunReplayFrame {
  const pixels = header.width * header.height;
  assertReplayDimensions(header.width, header.height);
  return {
    rgb: decodeRunReplayByteField(frame.rgb, pixels * 3, previous?.rgb),
    pressure: decodeRunReplayByteField(frame.pressure, Math.ceil(pixels / 8), previous?.pressure)
  };
}

export function encodeRunReplayRecord(record: RunReplayRecord): string {
  assertRunReplayRecord(record);
  return `${JSON.stringify(record)}\n`;
}

export function decodeRunReplayRecord(serialized: string): RunReplayRecord {
  if (serialized.length > RUN_REPLAY_MAX_RECORD_BYTES
    || new TextEncoder().encode(serialized).byteLength > RUN_REPLAY_MAX_RECORD_BYTES) {
    throw new Error("Run replay record exceeds the maximum encoded size");
  }
  const value: unknown = JSON.parse(serialized);
  assertRunReplayRecord(value);
  return value;
}

export function decodeRunReplayRecords(
  serialized: string,
  options: { allowIncomplete?: boolean } = {}
): RunReplayRecord[] {
  const records = serialized.split("\n")
    .filter((line) => line.length > 0)
    .map(decodeRunReplayRecord);
  if (records[0]?.type !== "header") throw new Error("Run replay header is missing");
  let previousRecordSequence = 0;
  let footerSeen = false;
  const header = records[0];
  if (header?.type !== "header") throw new Error("Run replay header is missing");
  for (const record of records.slice(1)) {
    if (record.type === "header") throw new Error("Run replay contains more than one header");
    if (footerSeen) throw new Error("Run replay footer must be the final record");
    if (record.recordSequence !== previousRecordSequence + 1) {
      throw new Error("Run replay record sequences must be contiguous");
    }
    previousRecordSequence = record.recordSequence;
    footerSeen = record.type === "footer";
    if (record.type === "input" && (record.x >= header.width || record.y >= header.height)) {
      throw new Error("Run replay input coordinate is outside the declared floor");
    }
  }
  const footer = records.at(-1);
  if (!options.allowIncomplete && footer?.type !== "footer") throw new Error("Run replay footer is missing");
  if (footer?.type === "footer") {
    const count = (type: RunReplayRecord["type"]) => records.filter((record) => record.type === type).length;
    if (footer.frameCount !== count("frame")
      || footer.inputCount !== count("input")
      || footer.eventCount !== count("game-event")
      || footer.checkpointCount !== count("checkpoint")) {
      throw new Error("Run replay footer counts do not match its records");
    }
    const frames = records.filter((record): record is RunReplayFrameRecord => record.type === "frame");
    if (footer.firstPresentationSequence !== frames[0]?.presentationSequence
      || footer.lastPresentationSequence !== frames.at(-1)?.presentationSequence) {
      if (frames.length > 0 || footer.firstPresentationSequence !== undefined || footer.lastPresentationSequence !== undefined) {
        throw new Error("Run replay footer presentation bounds do not match its frames");
      }
    }
  }
  return records;
}

function encodeReplacementRuns(previous: Uint8Array, current: Uint8Array): Uint8Array {
  const runs: Array<{ offset: number; bytes: Uint8Array }> = [];
  let offset = 0;
  let byteLength = 0;
  while (offset < current.byteLength) {
    if (previous[offset] === current[offset]) {
      offset += 1;
      continue;
    }
    const start = offset;
    while (offset < current.byteLength && previous[offset] !== current[offset] && offset - start < 0xffff) {
      offset += 1;
    }
    const bytes = current.slice(start, offset);
    runs.push({ offset: start, bytes });
    byteLength += 4 + bytes.byteLength;
  }
  const encoded = new Uint8Array(byteLength);
  let cursor = 0;
  for (const run of runs) {
    encoded[cursor] = run.offset >>> 8;
    encoded[cursor + 1] = run.offset & 0xff;
    encoded[cursor + 2] = run.bytes.byteLength >>> 8;
    encoded[cursor + 3] = run.bytes.byteLength & 0xff;
    encoded.set(run.bytes, cursor + 4);
    cursor += 4 + run.bytes.byteLength;
  }
  return encoded;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error("Replay byte data is not valid base64");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertRunReplayRecord(value: unknown): asserts value is RunReplayRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Run replay record must be an object");
  const record = value as Record<string, unknown>;
  if (record.type === "header") {
    if (record.schema !== RUN_REPLAY_SCHEMA || record.contractVersion !== RUN_REPLAY_CONTRACT_VERSION) {
      throw new Error("Unsupported run replay schema");
    }
    for (const key of ["sessionId", "selectionId", "runId", "gameId", "engineGame", "sourceRevision"] as const) {
      if (typeof record[key] !== "string" || !record[key]) throw new Error(`Run replay ${key} is required`);
    }
    assertReplayDimensions(record.width, record.height);
    if (record.pixelFormat !== "rgb24" || record.pressureFormat !== "row-major-bitset-lsb0"
      || record.frameSource !== "presented-frame") throw new Error("Run replay frame format is invalid");
    if (!isUnsigned64String(record.firstDesiredSequence)) {
      throw new Error("Run replay firstDesiredSequence must be an unsigned integer string");
    }
    nonNegativeInteger(record.startedAtUnixMillis, "Run replay start time");
    return;
  }
  positiveInteger(record.recordSequence, "Run replay record sequence");
  if (record.type === "frame") {
    for (const key of ["presentationSequence", "desiredSequence", "presentedUnixNanos"] as const) {
      if (!isUnsigned64String(record[key])) {
        throw new Error(`Run replay ${key} must be an unsigned integer string`);
      }
    }
    nonNegativeNumber(record.engineAtMillis, "Run replay engine time");
    const fadeRatio = nonNegativeNumber(record.fadeRatio, "Run replay fade ratio");
    if (fadeRatio > 1) throw new Error("Run replay fade ratio must not exceed one");
    assertByteField(record.rgb);
    assertByteField(record.pressure);
    return;
  }
  if (record.type === "input") {
    nonNegativeInteger(record.occurredAtUnixMillis, "Run replay input time");
    nonNegativeNumber(record.engineAtMillis, "Run replay engine time");
    if (record.source !== "physical" && record.source !== "remote" && record.source !== "restored") {
      throw new Error("Run replay input source is invalid");
    }
    nonNegativeInteger(record.x, "Run replay input x");
    nonNegativeInteger(record.y, "Run replay input y");
    if (typeof record.pressed !== "boolean") throw new Error("Run replay input pressed is invalid");
    return;
  }
  if (record.type === "game-event") {
    nonNegativeInteger(record.occurredAtUnixMillis, "Run replay event time");
    nonNegativeNumber(record.engineAtMillis, "Run replay engine time");
    nonNegativeNumber(record.eventAtMillis, "Run replay event engine time");
    if (typeof record.cue !== "string" || typeof record.message !== "string") {
      throw new Error("Run replay event cue and message are required");
    }
    return;
  }
  if (record.type === "checkpoint") {
    nonNegativeInteger(record.occurredAtUnixMillis, "Run replay checkpoint time");
    nonNegativeNumber(record.engineAtMillis, "Run replay engine time");
    if (!["initial", "periodic", "phase", "event", "terminal"].includes(String(record.reason))) {
      throw new Error("Run replay checkpoint reason is invalid");
    }
    if (typeof record.paused !== "boolean" || !isJsonObject(record.snapshot)) {
      throw new Error("Run replay checkpoint state is invalid");
    }
    return;
  }
  if (record.type === "footer") {
    nonNegativeInteger(record.endedAtUnixMillis, "Run replay end time");
    if (typeof record.outcome !== "string" || typeof record.partial !== "boolean") {
      throw new Error("Run replay footer outcome is invalid");
    }
    for (const key of ["frameCount", "inputCount", "eventCount", "checkpointCount"] as const) {
      nonNegativeInteger(record[key], `Run replay ${key}`);
    }
    for (const key of ["firstPresentationSequence", "lastPresentationSequence"] as const) {
      if (record[key] !== undefined && !isUnsigned64String(record[key])) {
        throw new Error(`Run replay ${key} must be an unsigned integer string`);
      }
    }
    return;
  }
  throw new Error("Unknown run replay record type");
}

function assertByteField(value: unknown): asserts value is RunReplayByteField {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Replay byte field must be an object");
  const field = value as Record<string, unknown>;
  if ((field.encoding !== "keyframe" && field.encoding !== "delta") || typeof field.dataBase64 !== "string") {
    throw new Error("Replay byte field is invalid");
  }
  if (field.dataBase64.length > maximumEncodedByteFieldCharacters
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(field.dataBase64)) {
    throw new Error("Replay byte data is not valid base64");
  }
}

function assertReplayDimensions(width: unknown, height: unknown): void {
  const safeWidth = positiveInteger(width, "Run replay width");
  const safeHeight = positiveInteger(height, "Run replay height");
  if (safeWidth > RUN_REPLAY_MAX_DIMENSION || safeHeight > RUN_REPLAY_MAX_DIMENSION
    || safeWidth * safeHeight > RUN_REPLAY_MAX_PIXELS) {
    throw new Error("Run replay dimensions exceed the supported floor bounds");
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
  return value;
}

function isJsonObject(value: unknown): value is RunReplayJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsigned64String(value: unknown): value is string {
  return typeof value === "string"
    && /^(?:0|[1-9][0-9]{0,19})$/u.test(value)
    && BigInt(value) <= 18_446_744_073_709_551_615n;
}
