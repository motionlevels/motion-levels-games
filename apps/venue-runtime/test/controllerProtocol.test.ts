import assert from "node:assert/strict";
import test from "node:test";
import {
  DelimitedMessageDecoder,
  controllerProtocolVersion,
  decodeControllerMessage,
  decodeRuntimeMessage,
  encodeControllerMessage,
  encodeDelimited,
  encodeRuntimeMessage,
  floorHeight,
  floorRgbBytes,
  floorWidth,
  maxDelimitedMessageBytes,
  pressureBitsetBytes,
  validateControllerHello,
  validateRuntimeFrame
} from "../src/controllerProtocol.ts";

test("controller runtime.proto v2 has cross-language golden encodings", () => {
  const bytes = encodeRuntimeMessage({
    type: "hello",
    hello: { protocolVersion: 2, sourceRevision: "revision-v2" }
  });
  assert.equal(Buffer.from(bytes).toString("hex"), "0a0f0802120b7265766973696f6e2d7632");

  const frame = encodeRuntimeMessage({
    type: "frame",
    frame: { sequence: 9n, unixNanos: 1_700n, rgb: Uint8Array.from([1, 2, 3]), sessionId: "session-v2", venueSessionId: "venue-v2" }
  });
  assert.equal(Buffer.from(frame).toString("hex"), "1220080910a40d1a03010203220a73657373696f6e2d76322a0876656e75652d7632");

  const controllerHello = encodeControllerMessage({
    type: "hello",
    hello: { protocolVersion: 2, controllerId: "controller-v2", width: 16, height: 32, refreshFps: 50, pressureSequence: 42n, pressed: Uint8Array.from([1, 2]) }
  });
  assert.equal(Buffer.from(controllerHello).toString("hex"), "0a1d0802120d636f6e74726f6c6c65722d7632181020202832302a3a020102");

  const pressure = encodeControllerMessage({
    type: "pressureChange",
    pressureChange: { sequence: 43n, unixNanos: 1_800n, x: 3, y: 7, pressed: true }
  });
  assert.equal(Buffer.from(pressure).toString("hex"), "120b082b10880e180320072801");
});

test("controller hello preserves the authoritative pressure bitset", () => {
  const pressure = new Uint8Array(pressureBitsetBytes);
  pressure[0] = 1;
  pressure[63] = 0x80;
  const message = {
    type: "hello" as const,
    hello: {
      protocolVersion: controllerProtocolVersion,
      controllerId: "floor-a",
      width: floorWidth,
      height: floorHeight,
      refreshFps: 50,
      pressureSequence: 12n,
      pressed: pressure
    }
  };
  assert.deepEqual(decodeControllerMessage(encodeControllerMessage(message)), message);
  assert.throws(() => validateControllerHello({ ...message.hello, controllerId: "" }), /controller id/);
  assert.throws(() => validateControllerHello({ ...message.hello, refreshFps: 0 }), /refresh fps/);
});

test("runtime frames require exactly 1536 RGB bytes", () => {
  const frame = {
    type: "frame" as const,
    frame: { sequence: 7n, unixNanos: 9n, rgb: new Uint8Array(floorRgbBytes), sessionId: "s", venueSessionId: "v" }
  };
  assert.deepEqual(decodeRuntimeMessage(encodeRuntimeMessage(frame)), frame);
  assert.throws(() => validateRuntimeFrame({ ...frame.frame, rgb: new Uint8Array(floorRgbBytes - 1) }), /1536/);
});

test("delimited decoder accepts fragmented/coalesced messages and rejects limits", () => {
  const hello = encodeDelimited(encodeRuntimeMessage({
    type: "hello",
    hello: { protocolVersion: 2, sourceRevision: "abc" }
  }));
  const decoder = new DelimitedMessageDecoder();
  assert.deepEqual(decoder.push(hello.slice(0, 2)), []);
  assert.equal(decoder.push(hello.slice(2)).length, 1);
  assert.equal(decoder.push(Buffer.concat([hello, hello])).length, 2);
  assert.equal(decoder.push(Buffer.concat(Array.from({ length: 10_000 }, () => hello))).length, 10_000);
  assert.throws(() => encodeDelimited(new Uint8Array(maxDelimitedMessageBytes + 1)), /64 KiB/);
  assert.throws(() => decoder.push(Uint8Array.from([0x81, 0x80, 0x04])), /64 KiB/);
});

test("pressure changes use bounded floor coordinates", () => {
  assert.throws(() => decodeControllerMessage(encodeControllerMessage({
    type: "pressureChange",
    pressureChange: {
      sequence: 1n,
      unixNanos: 2n,
      x: 16,
      y: 0,
      pressed: true,
    }
  })), /out of bounds/);
});
