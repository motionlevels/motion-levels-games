import assert from "node:assert/strict";
import test from "node:test";
import { floorHeight, floorRgbBytes, floorWidth, pressureBitsetBytes, type PresentedFrame } from "../src/controllerProtocol.ts";
import { createLiveFloorPublisher, encodeLiveViewerFrame, type LiveFloorJob } from "../src/liveFloorPublisher.ts";

const controllerId = "01234567-89ab-4def-8123-456789abcdef";
const sessionId = "76543210-89ab-4def-8123-456789abcdef";

function observedFrame(sequence = 42n): PresentedFrame {
  const rgb = new Uint8Array(floorRgbBytes);
  rgb.set([10, 20, 30, 40, 50, 60]);
  const pressureBits = new Uint8Array(pressureBitsetBytes);
  pressureBits[0] = 0b0000_0010;
  return {
    presentationSequence: sequence,
    desiredSequence: 41n,
    presentedUnixNanos: 1_700_000_000_000_000_000n,
    width: floorWidth,
    height: floorHeight,
    rgb,
    pressureBits,
    fadeRatio: 0
  };
}

test("MLF1 preserves authoritative controller RGB and pressure", () => {
  const encoded = encodeLiveViewerFrame(observedFrame());
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  assert.equal(Buffer.from(encoded.subarray(0, 4)).toString(), "MLF1");
  assert.equal(view.getUint32(4, true), 42);
  assert.equal(view.getUint16(8, true), floorWidth);
  assert.equal(view.getUint16(10, true), floorHeight);
  assert.equal(view.getUint8(12), 1);
  assert.equal(view.getUint16(14, true), 16);
  assert.deepEqual([...encoded.subarray(16, 22)], [10, 20, 30, 40, 50, 60]);
  assert.equal(encoded[16 + floorRgbBytes], 0b0000_0010);
});

test("publisher posts room identity and active session without changing observed frame", async () => {
  const requests: Array<{ url: string; headers: Headers; job: LiveFloorJob }> = [];
  const publisher = createLiveFloorPublisher({
    platformUrl: "https://platform.example.test/base/",
    platformToken: "test-token",
    controllerId,
    fps: 5,
    timeoutMillis: 2000,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        job: JSON.parse(String(init?.body)) as LiveFloorJob
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.ok(publisher);

  publisher.observe(observedFrame(17n), sessionId, 1000);
  await waitFor(() => requests.length === 1);

  assert.equal(requests[0]?.url, "https://platform.example.test/base/api/live-floor/ingest");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-token");
  assert.deepEqual(
    { ...requests[0]?.job, frameBase64: undefined },
    {
      controllerId,
      sessionId,
      sequence: 17,
      width: floorWidth,
      height: floorHeight,
      presentedUnixNanos: 1_700_000_000_000_000_000,
      frameBase64: undefined
    }
  );
  const decoded = Buffer.from(requests[0]?.job.frameBase64 ?? "", "base64");
  assert.equal(decoded.subarray(0, 4).toString(), "MLF1");
  assert.deepEqual([...decoded.subarray(16, 22)], [10, 20, 30, 40, 50, 60]);
});

test("publisher rejects adapter revision in place of configured room UUID", () => {
  assert.throws(() => createLiveFloorPublisher({
    platformUrl: "https://platform.example.test",
    controllerId: "b6aef1eeb1edc795ab43b81740f838f70135c36b"
  }), /controller ID must be a UUID/u);
});

test("publisher stays disabled when the platform token is unavailable", () => {
  assert.equal(createLiveFloorPublisher({
    platformUrl: "https://platform.example.test",
    controllerId,
    platformToken: ""
  }), null);
});

test("publisher delivers the latest frame at the next rate-limit boundary", async () => {
  const sequences: number[] = [];
  const publisher = createLiveFloorPublisher({
    platformUrl: "https://platform.example.test",
    platformToken: "test-token",
    controllerId,
    fps: 20,
    fetch: async (_input, init) => {
      sequences.push((JSON.parse(String(init?.body)) as LiveFloorJob).sequence);
      return new Response(null, { status: 200 });
    }
  });
  assert.ok(publisher);
  const now = Date.now();
  publisher.observe(observedFrame(1n), "", now);
  publisher.observe(observedFrame(2n), "", now + 1);
  publisher.observe(observedFrame(3n), "", now + 2);
  await waitFor(() => sequences.length === 2);
  assert.deepEqual(sequences, [1, 3]);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met");
}
