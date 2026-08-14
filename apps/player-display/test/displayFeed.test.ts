import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoalescer, isFeedStalled, type FrameScheduler } from "../src/displayFeed.ts";

function manualScheduler() {
  let pending: (() => void) | null = null;
  let nextHandle = 1;
  let requests = 0;
  const scheduler: FrameScheduler = {
    request(callback) {
      pending = callback;
      requests += 1;
      return nextHandle++;
    },
    cancel() {
      pending = null;
    },
  };
  return {
    scheduler,
    flush() {
      const callback = pending;
      pending = null;
      callback?.();
    },
    hasPending() {
      return pending !== null;
    },
    requestCount() {
      return requests;
    },
  };
}

describe("createCoalescer", () => {
  it("renders only the latest value, once, when the frame fires", () => {
    const harness = manualScheduler();
    const rendered: number[] = [];
    const coalescer = createCoalescer<number>(harness.scheduler, (value) => rendered.push(value));

    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    assert.deepEqual(rendered, [], "nothing renders until the frame fires");

    harness.flush();
    assert.deepEqual(rendered, [3], "only the latest value renders, exactly once");
  });

  it("collapses many pushes into a single scheduled frame (no backlog)", () => {
    const harness = manualScheduler();
    const coalescer = createCoalescer<number>(harness.scheduler, () => {});

    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    assert.equal(harness.requestCount(), 1, "20 events must not queue 20 frames");

    harness.flush();
    coalescer.push(4);
    assert.equal(harness.requestCount(), 2, "a push after a flush schedules a fresh frame");
  });

  it("renders each frame's latest across multiple frames", () => {
    const harness = manualScheduler();
    const rendered: number[] = [];
    const coalescer = createCoalescer<number>(harness.scheduler, (value) => rendered.push(value));

    coalescer.push(1);
    harness.flush();
    coalescer.push(2);
    coalescer.push(3);
    harness.flush();

    assert.deepEqual(rendered, [1, 3]);
  });

  it("does not render when nothing was pushed", () => {
    const harness = manualScheduler();
    const rendered: number[] = [];
    createCoalescer<number>(harness.scheduler, (value) => rendered.push(value));

    harness.flush();
    assert.deepEqual(rendered, []);
  });

  it("cancel drops a pending render", () => {
    const harness = manualScheduler();
    const rendered: number[] = [];
    const coalescer = createCoalescer<number>(harness.scheduler, (value) => rendered.push(value));

    coalescer.push(1);
    assert.equal(coalescer.pending(), true);
    coalescer.cancel();
    harness.flush();

    assert.deepEqual(rendered, []);
    assert.equal(coalescer.pending(), false);
  });
});

describe("isFeedStalled", () => {
  it("is false within the window and true at or beyond it", () => {
    assert.equal(isFeedStalled(1000, 1000 + 2499, 2500), false);
    assert.equal(isFeedStalled(1000, 1000 + 2500, 2500), true);
    assert.equal(isFeedStalled(1000, 1000 + 9000, 2500), true);
  });
});
