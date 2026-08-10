import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AgentLabFrameTrajectory,
  advanceAgentLabHarness,
  nextAgentLabSeed,
  replayFileName,
  toAgentRenderSnapshot,
  toRendererDebugInput
} from "../src/agentLabModel.ts";
import type {
  PlaygroundAgentHarness,
  PlaygroundAgentHarnessFrame
} from "../src/gameRegistry.ts";

const frame = {
  tick: 3,
  atMillis: 60,
  agents: [{
    id: "cruce-agent-01",
    tick: 3,
    atMillis: 60,
    color: "#26d9ff",
    profileId: "expert",
    variant: "guardian",
    position: { x: 5, y: 23 },
    velocity: { x: 0, y: -1 },
    facingRadians: -Math.PI / 2,
    grounded: false,
    action: "dodge",
    intention: "Reach checkpoint",
    target: { x: 5, y: 15 },
    targetId: "checkpoint-2",
    emotion: "afraid",
    debug: {
      path: [{ x: 5, y: 23 }, { x: 5, y: 22 }],
      reservations: [],
      explanation: "Safest route has the highest utility",
      replans: 1,
      stuckReplans: 0
    }
  }, {
    id: "cruce-agent-02",
    tick: 3,
    atMillis: 60,
    color: "#66ff9a",
    profileId: "helper",
    position: { x: 9, y: 23 },
    velocity: { x: 0, y: 0 },
    facingRadians: 0,
    grounded: true,
    action: "none",
    intention: "wait",
    emotion: "neutral",
    debug: {
      path: [{ x: 9, y: 23 }, { x: 9, y: 22 }],
      reservations: [],
      explanation: "Yielding reserved lane",
      replans: 0,
      stuckReplans: 0
    }
  }],
  debug: {
    paths: [
      { id: "cruce-agent-01", points: [{ x: 5, y: 23 }, { x: 5, y: 22 }], color: "#26d9ff" },
      { id: "cruce-agent-02", points: [{ x: 9, y: 23 }, { x: 9, y: 22 }], color: "#66ff9a" }
    ],
    reservations: [
      { id: "reservation-1", ownerId: "cruce-agent-01", points: [{ x: 5, y: 22 }], color: "#26d9ff" }
    ],
    targets: [
      { id: "cruce-agent-01", position: { x: 5, y: 15 }, radiusTiles: 0.4, color: "#26d9ff" }
    ]
  }
} as unknown as PlaygroundAgentHarnessFrame;

test("Agent Lab forwards authoritative character presentation fields", () => {
  const snapshot = toAgentRenderSnapshot(frame, frame.agents[0]!, 0);

  assert.equal(snapshot.tick, 3);
  assert.equal(snapshot.atMillis, 60);
  assert.equal(snapshot.variant, "guardian");
  assert.equal(snapshot.grounded, false);
  assert.equal(snapshot.action, "dodge");
  assert.equal(snapshot.emotion, "afraid");
  assert.deepEqual(snapshot.targetPosition, { x: 5, y: 15 });
});

test("Agent Lab debug overlays honor selection and visibility without inspecting pixels", () => {
  const selected = toRendererDebugInput(frame, {
    paths: true,
    reservations: true,
    targets: false
  }, "cruce-agent-01");

  assert.deepEqual(selected.paths?.map((path) => path.id), ["path-cruce-agent-01"]);
  assert.deepEqual(selected.reservations?.map((reservation) => reservation.ownerId), ["cruce-agent-01"]);
  assert.deepEqual(selected.targets, []);
});

test("Agent Lab seed and replay names are deterministic", () => {
  assert.equal(nextAgentLabSeed(137), nextAgentLabSeed(137));
  assert.notEqual(nextAgentLabSeed(137), 137);
  assert.equal(replayFileName(137), "cruce-galactico-agents-137.replay.json");
});

test("Agent Lab retains exact frame identities and their authoritative checksums", () => {
  const trajectory = new AgentLabFrameTrajectory();
  const initial = frameAtTick(0);
  const first = frameAtTick(1);
  const second = frameAtTick(2);

  trajectory.reset(initial);
  trajectory.append(first);
  trajectory.append(second);

  assert.equal(trajectory.length, 3);
  assert.equal(trajectory.firstTick, 0);
  assert.equal(trajectory.endTick, 2);
  assert.strictEqual(trajectory.frameAtOrBefore(-10), initial);
  assert.strictEqual(trajectory.frameAtOrBefore(1), first);
  assert.strictEqual(trajectory.frameAtOrBefore(1.9), first);
  assert.strictEqual(trajectory.frameAtOrBefore(99), second);
  assert.deepEqual([...trajectory.checksumMap()], [
    [0, "checksum-0"],
    [1, "checksum-1"],
    [2, "checksum-2"]
  ]);
  assert.throws(() => trajectory.append(frameAtTick(4)), /expected tick 3, received 4/u);
});

test("batched Agent Lab stepping advances authority once per tick and presents only the final frame", () => {
  let current = frameAtTick(0);
  const stepSizes: number[] = [];
  const observed: PlaygroundAgentHarnessFrame[] = [];
  const harness = {
    get frame() {
      return current;
    },
    step(ticks = 1) {
      stepSizes.push(ticks);
      current = frameAtTick(current.tick + ticks);
      return current;
    }
  } as unknown as PlaygroundAgentHarness;

  const presented = advanceAgentLabHarness(harness, 3, (next) => observed.push(next));

  assert.deepEqual(stepSizes, [1, 1, 1]);
  assert.deepEqual(observed.map((entry) => entry.tick), [1, 2, 3]);
  assert.strictEqual(presented, observed[2]);
  assert.throws(() => advanceAgentLabHarness(harness, 0), /positive integer/u);
  assert.throws(() => advanceAgentLabHarness(harness, 1.5), /positive integer/u);
});

test("Agent Lab replay control consumes retained frames without constructing or stepping AI", async () => {
  const source = await readFile(new URL("../src/AgentLab.tsx", import.meta.url), "utf8");
  const enterStart = source.indexOf("const enterReplay = useCallback");
  const seekStart = source.indexOf("const seekReplay = useCallback");
  const seekEnd = source.indexOf("seekReplayRef.current = seekReplay");
  const animationStart = source.indexOf("let animationFrame = 0");
  const animationEnd = source.indexOf("const setRunPausedState = useCallback");
  const exitStart = source.indexOf("const exitReplay = useCallback");
  const exitEnd = source.indexOf("const resetLab = useCallback");
  assert.ok([enterStart, seekStart, seekEnd, animationStart, animationEnd, exitStart, exitEnd]
    .every((index) => index >= 0), "Agent Lab replay source markers must remain discoverable");
  const enterReplay = source.slice(enterStart, seekStart);
  const seekReplay = source.slice(seekStart, seekEnd);
  const animationLoop = source.slice(animationStart, animationEnd);
  const exitReplay = source.slice(exitStart, exitEnd);
  const liveAdvance = source.slice(
    source.indexOf("const advanceLiveHarness = useCallback"),
    source.indexOf("const showRecordedFrame = useCallback")
  );

  assert.match(enterReplay, /recordedFramesRef\.current/u);
  assert.match(enterReplay, /showRecordedFrame/u);
  assert.doesNotMatch(enterReplay, /createFreshHarness|createHarnessRef\.current|\.step\(/u);
  assert.match(seekReplay, /showRecordedFrame/u);
  assert.doesNotMatch(seekReplay, /createFreshHarness|createHarnessRef\.current|\.step\(/u);
  assert.match(animationLoop, /if \(isReplay\)[\s\S]*showRecordedFrame\(targetTick\)/u);
  assert.doesNotMatch(animationLoop, /\.step\(/u);
  assert.match(exitReplay, /liveHarnessRef\.current/u);
  assert.match(exitReplay, /applyFrame\(live\.frame, true\)/u);
  assert.match(liveAdvance, /advanceAgentLabHarness\(harness, ticks/u);
  assert.equal((liveAdvance.match(/applyFrame\(/gu) ?? []).length, 1);
});

function frameAtTick(tick: number): PlaygroundAgentHarnessFrame {
  return {
    ...frame,
    tick,
    atMillis: tick * 20,
    replay: { checksum: `checksum-${tick}` }
  } as PlaygroundAgentHarnessFrame;
}
