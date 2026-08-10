import assert from "node:assert/strict";
import test from "node:test";
import { AgentSnapshotBuffer, type AgentRenderSnapshot } from "../src/index.ts";

test("per-agent buffers sort delivery and interpolate values over the short angle arc", () => {
  const buffer = new AgentSnapshotBuffer("agent-a", { capacity: 3 });
  const next = snapshot(20, 2, 4, -Math.PI + 0.1);
  const previous = snapshot(0, 0, 2, Math.PI - 0.1);
  buffer.push(next);
  buffer.push(previous);
  const halfway = buffer.sample(10);
  assert.deepEqual(halfway?.position, { x: 1, y: 3 });
  assert.deepEqual(halfway?.velocity, { x: 1, y: 1 });
  assert.ok(Math.abs(Math.abs(halfway?.facingRadians ?? 0) - Math.PI) < 0.01);
  assert.equal(halfway?.action, "jump", "discrete values switch to the next sample at midpoint");
  assert.equal(halfway?.socialGesture, "taunt");
  assert.equal(buffer.sample(9)?.socialGesture, "wave");
  assert.equal(halfway?.atMillis, 10);
  assert.equal(Object.isFrozen(halfway), true);
  assert.equal(Object.isFrozen(halfway?.position), true);
});

test("replacement, endpoint holding, eviction, clear, and ownership are deterministic", () => {
  const buffer = new AgentSnapshotBuffer("agent-a", { capacity: 2 });
  const mutable = snapshot(0, 0, 0, 0) as MutableSnapshot;
  buffer.push(mutable);
  mutable.position.x = 99;
  assert.equal(buffer.sample(-10)?.position.x, 0, "push makes a defensive copy");
  buffer.push({ ...snapshot(0, 3, 3, 0), action: "replacement" });
  assert.equal(buffer.size, 1);
  assert.equal(buffer.sample(0)?.action, "replacement");
  buffer.push(snapshot(20, 2, 2, 0));
  buffer.push(snapshot(40, 4, 4, 0));
  assert.deepEqual(buffer.range, { oldestMillis: 20, newestMillis: 40 });
  assert.equal(buffer.sample(-100)?.atMillis, 20);
  assert.equal(buffer.sample(100)?.atMillis, 40);
  assert.throws(() => buffer.push({ ...snapshot(60, 6, 6, 0), id: "other" }), /cannot enter/);
  buffer.clear();
  assert.equal(buffer.sample(0), undefined);
  assert.deepEqual(buffer.range, {});
});

type MutableSnapshot = Omit<AgentRenderSnapshot, "position"> & { position: { x: number; y: number } };

function snapshot(
  atMillis: number,
  x: number,
  y: number,
  facingRadians: number
): AgentRenderSnapshot {
  return {
    id: "agent-a",
    atMillis,
    tick: Math.max(0, Math.round(atMillis / 20)),
    position: { x, y },
    velocity: { x, y: 2 - x },
    acceleration: { x: x * 2, y: y * 2 },
    angularVelocity: x,
    facingRadians,
    grounded: atMillis < 10,
    action: atMillis < 10 ? "none" : "jump",
    intention: atMillis < 10 ? "wait" : "goal",
    emotion: atMillis < 10 ? "neutral" : "excited",
    socialGesture: atMillis < 10 ? "wave" : "taunt",
    variant: "runner"
  };
}
