import assert from "node:assert/strict";
import test from "node:test";
import { parseControllerAddress, pressureSequenceHasGap, reconcilePressure } from "../src/controllerClient.ts";

test("controller addresses support hostnames, tcp URLs, and IPv6", () => {
  assert.deepEqual(parseControllerAddress("127.0.0.1:4201"), { host: "127.0.0.1", port: 4201 });
  assert.deepEqual(parseControllerAddress("tcp://controller:4201"), { host: "controller", port: 4201 });
  assert.deepEqual(parseControllerAddress("[::1]:4201"), { host: "::1", port: 4201 });
  assert.throws(() => parseControllerAddress("controller"), /invalid/);
});

test("reconnect hello snapshots release stale pressure and apply current pressure", () => {
  const previous = new Uint8Array(64);
  const authoritative = new Uint8Array(64);
  previous[0] = 1;
  authoritative[63] = 0x80;
  assert.deepEqual(reconcilePressure(previous, authoritative, 42n, 99n), [
    { x: 0, y: 0, pressed: false, unixNanos: 99n, sequence: 42n },
    { x: 15, y: 31, pressed: true, unixNanos: 99n, sequence: 42n }
  ]);
});

test("pressure sequence gaps require a hello resync", () => {
  assert.equal(pressureSequenceHasGap(0n, 1n), false);
  assert.equal(pressureSequenceHasGap(0n, 42n), true);
  assert.equal(pressureSequenceHasGap(42n, 43n), false);
  assert.equal(pressureSequenceHasGap(42n, 44n), true);
});
