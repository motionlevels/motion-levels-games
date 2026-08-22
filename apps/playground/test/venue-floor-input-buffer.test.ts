import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VenueRuntimeFloorInputBuffer,
  type VenueRuntimeFloorBatch,
} from "../src/venueRuntimeClient.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

test("floor input behind one active request is retained as one ordered batch", async () => {
  const first = deferred();
  const sent: VenueRuntimeFloorBatch[] = [];
  const buffer = new VenueRuntimeFloorInputBuffer(async (batch) => {
    sent.push(batch);
    if (sent.length === 1) await first.promise;
  });

  const drained = buffer.enqueue([{ x: 0, y: 0, pressed: true }]);
  for (let y = 1; y < 32; y += 1) {
    void buffer.enqueue([
      { x: 0, y: y - 1, pressed: false },
      { x: 0, y, pressed: true },
    ]);
  }

  assert.equal(sent.length, 1, "only one request may be active while the pointer keeps moving");
  first.resolve();
  await drained;

  assert.equal(sent.length, 2, "all trailing pointer input should share one follow-up request");
  assert.equal(sent[1]!.changes.length, 62);
  assert.deepEqual(sent[1]!.changes[0], { x: 0, y: 0, pressed: false });
  assert.deepEqual(sent[1]!.changes.at(-1), { x: 0, y: 31, pressed: true });
});

test("release-all supersedes stale queued input but preserves later presses", async () => {
  const first = deferred();
  const sent: VenueRuntimeFloorBatch[] = [];
  const buffer = new VenueRuntimeFloorInputBuffer(async (batch) => {
    sent.push(batch);
    if (sent.length === 1) await first.promise;
  });

  const drained = buffer.enqueue([{ x: 0, y: 0, pressed: true }]);
  void buffer.enqueue([{ x: 1, y: 1, pressed: true }]);
  void buffer.enqueue([], true);
  void buffer.enqueue([{ x: 2, y: 2, pressed: true }]);
  first.resolve();
  await drained;

  assert.deepEqual(sent[1], {
    changes: [{ x: 2, y: 2, pressed: true }],
    releaseAll: true,
  });
});
