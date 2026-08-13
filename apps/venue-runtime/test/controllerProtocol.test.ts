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
    frame: { sequence: 9n, unixNanos: 1_700n, width: 16, height: 32, rgb: Uint8Array.from([1, 2, 3, 4, 5, 6]) }
  });
  assert.equal(Buffer.from(frame).toString("hex"), "1a11080910a40d181020202a06010203040506");

  const controllerHello = encodeControllerMessage({
    type: "hello",
    hello: { protocolVersion: 2, adapterRevision: "controller-v2", width: 16, height: 32, refreshFps: 50 }
  });
  assert.equal(Buffer.from(controllerHello).toString("hex"), "12170802120d636f6e74726f6c6c65722d7632181020202832");

  const pressure = encodeControllerMessage({
    type: "pressureChange",
    pressureChange: { sequence: 43n, unixNanos: 1_800n, x: 3, y: 7, pressed: true }
  });
  assert.equal(Buffer.from(pressure).toString("hex"), "220b082b10880e180320072801");
});

test("controller hello validates the adapter contract", () => {
  const message = {
    type: "hello" as const,
    hello: {
      protocolVersion: controllerProtocolVersion,
      adapterRevision: "floor-a",
      width: floorWidth,
      height: floorHeight,
      refreshFps: 50
    }
  };
  assert.deepEqual(decodeControllerMessage(encodeControllerMessage(message)), message);
  assert.throws(() => validateControllerHello({ ...message.hello, adapterRevision: "" }), /adapter revision/);
  assert.throws(() => validateControllerHello({ ...message.hello, refreshFps: 0 }), /refresh fps/);
});

test("runtime frames require exactly 1536 RGB bytes", () => {
  const frame = {
    type: "frame" as const,
    frame: { sequence: 7n, unixNanos: 9n, width: floorWidth, height: floorHeight, rgb: new Uint8Array(floorRgbBytes) }
  };
  assert.deepEqual(decodeRuntimeMessage(encodeRuntimeMessage(frame)), frame);
  assert.throws(() => validateRuntimeFrame({ ...frame.frame, rgb: new Uint8Array(floorRgbBytes - 1) }), /1536/);
  assert.throws(() => validateRuntimeFrame({ ...frame.frame, width: 8 }), /16x32/);
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

test("controller decoder accepts presented pressure snapshots and adapter status", () => {
  const presented = Buffer.concat([
    Buffer.from([0x2a, 0xcf, 0x0c, 0x08, 0x2a, 0x10, 0x29, 0x18, 0x7b, 0x20, 0x10, 0x28, 0x20, 0x32, 0x80, 0x0c]),
    Buffer.alloc(floorRgbBytes),
    Buffer.from([0x3a, 0x40]),
    Buffer.alloc(64),
  ]);
  const decoded = decodeControllerMessage(presented);
  assert.equal(decoded.type, "presentedFrame");
  if (decoded.type !== "presentedFrame") throw new Error("expected presented frame");
  assert.equal(decoded.frame.presentationSequence, 42n);
  assert.equal(decoded.frame.desiredSequence, 41n);
  assert.deepEqual([...decoded.frame.pressureBits], Array(64).fill(0));
  assert.equal(decoded.frame.presentedUnixNanos, 123n);

  const actualFps = Buffer.alloc(8);
  actualFps.writeDoubleLE(49.5);
  const statusPayload = Buffer.concat([
    Buffer.from([0x08, 0x7b, 0x10, 0x2a, 0x19]),
    actualFps,
    Buffer.from([0x20, 0x32, 0x28, 0x11, 0x30, 0x02]),
  ]);
  const status = decodeControllerMessage(Buffer.concat([Buffer.from([0x32, statusPayload.length]), statusPayload]));
  assert.equal(status.type, "status");
  if (status.type !== "status") throw new Error("expected adapter status");
  assert.deepEqual(status.status, {
    unixNanos: 123n,
    presentedFrames: 42n,
    actualFps: 49.5,
    targetFps: 50,
    desiredFrameAgeMillis: 17n,
    udpSendErrors: 2n,
  });
});
