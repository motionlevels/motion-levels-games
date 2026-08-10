import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CONTRACT_VERSION,
  StuckDetector,
  applyControlledMistake,
  chooseStickyTarget,
  createAgentAction,
  createAgentDefinition,
  createAgentObservation,
  createAgentRuntime,
  createSeededRandom,
  defineAgentProfile,
  gridPoint,
  scoreIntentions,
  selectIntention,
  type AgentBrain,
  type AgentObservation
} from "../src/index.ts";

test("utility selection explains factors, curves, vetoes, and deterministic ties", () => {
  const intentions = [
    {
      id: "blocked",
      label: "Blocked",
      priority: 100,
      considerations: [{ id: "access", weight: 10, evaluate: () => 0.1, vetoBelow: 0.2 }]
    },
    {
      id: "alpha",
      label: "Alpha",
      considerations: [{ id: "gain", label: "Gain", weight: 2, curve: "quadratic" as const, evaluate: () => 0.5 }]
    },
    {
      id: "beta",
      label: "Beta",
      considerations: [{ id: "gain", label: "Gain", weight: 2, curve: "quadratic" as const, evaluate: () => 0.5 }]
    }
  ];
  const selection = selectIntention(intentions, {});
  assert.equal(selection.selected?.id, "alpha");
  assert.equal(selection.selectedScore, 0.5);
  assert.match(selection.explanation, /strongest factor: Gain/);
  assert.equal(selection.rankings.at(-1)?.intention.id, "blocked");
  assert.equal(selection.rankings.at(-1)?.vetoed, true);
});

test("utility stickiness and sticky target helper retain close incumbents", () => {
  const intentions = [
    { id: "old", label: "Old", considerations: [{ id: "value", weight: 1, evaluate: () => 0.5 }] },
    { id: "new", label: "New", considerations: [{ id: "value", weight: 1, evaluate: () => 0.7 }] }
  ];
  const rankings = scoreIntentions(intentions, {}, {
    currentIntentionId: "old",
    stickiness: 0.5,
    stickinessScale: 1
  });
  assert.equal(rankings[0]?.intention.id, "old");
  assert.equal(rankings[0]?.factors.at(-1)?.id, "target-stickiness");
  assert.equal(chooseStickyTarget([
    { id: "old", score: 1, value: 1 },
    { id: "new", score: 1.2, value: 2 }
  ], "old", 0.5)?.id, "old");
});

test("controlled mistakes are seeded, bounded, and preserve the intended action", () => {
  const profile = defineAgentProfile("mistakes", "Mistakes", { mistakeRate: 0.5, mistakeSeverity: 1 });
  const action = createAgentAction({
    actorId: "a",
    kind: "move",
    atMillis: 0,
    target: gridPoint(0, 0)
  });
  const firstRandom = createSeededRandom(44);
  const secondRandom = createSeededRandom(44);
  const first = Array.from({ length: 20 }, () =>
    applyControlledMistake(action, profile, firstRandom, { width: 4, height: 4 })
  );
  const second = Array.from({ length: 20 }, () =>
    applyControlledMistake(action, profile, secondRandom, { width: 4, height: 4 })
  );
  assert.deepEqual(first, second);
  assert.equal(first.some((result) => result.mistakeApplied), true);
  for (const result of first) {
    assert.equal(result.intendedAction, action);
    if (result.action.target !== undefined) {
      assert.ok(result.action.target.x >= 0 && result.action.target.x < 4);
      assert.ok(result.action.target.y >= 0 && result.action.target.y < 4);
    }
  }
});

test("stuck detector reports one transition after a full immobile window", () => {
  const detector = new StuckDetector(100, 0);
  assert.equal(detector.update(0, gridPoint(2, 2), true).stuck, false);
  assert.equal(detector.update(50, gridPoint(2, 2), true).stuck, false);
  const stuck = detector.update(100, gridPoint(2, 2), true);
  assert.deepEqual(stuck, { stuck: true, newlyStuck: true, observedMillis: 100, displacement: 0 });
  assert.equal(detector.update(120, gridPoint(2, 2), true).newlyStuck, false);
  assert.equal(detector.update(130, gridPoint(3, 2), false).stuck, false);
  assert.throws(() => detector.update(120, gridPoint(3, 2), true), /monotonic/);
});

test("runtime schedules reaction delay and restores a pending snapshot exactly", () => {
  const profile = defineAgentProfile("runtime", "Runtime", {
    reactionDelayMillis: 100,
    mistakeRate: 0,
    replanIntervalMillis: 1_000,
    targetStickiness: 0
  });
  const definition = createAgentDefinition({ id: "agent", brainId: "counter", profileId: profile.id });
  const runtime = createAgentRuntime({ definition, profile, brain: counterBrain, seed: 9 });
  const first = runtime.step(runtimeObservation(1, 0));
  assert.equal(first.action, undefined);
  assert.equal(first.pendingUntilMillis, 100);
  assert.equal(first.replanReason, "initial");

  const restored = createAgentRuntime({ definition, profile, brain: counterBrain, seed: 999 });
  restored.restore(first.snapshot);
  const originalAction = runtime.step(runtimeObservation(2, 100));
  const restoredAction = restored.step(runtimeObservation(2, 100));
  assert.deepEqual(restoredAction.action, originalAction.action);
  assert.deepEqual(restoredAction.snapshot, originalAction.snapshot);
  assert.equal(originalAction.action?.atMillis, 100);
  assert.equal(originalAction.snapshot.brainState.plans, 1);
});

test("runtime detects stuck movement, replans, and rejects stale observations", () => {
  const profile = defineAgentProfile("stuck", "Stuck", {
    reactionDelayMillis: 0,
    mistakeRate: 0,
    targetStickiness: 0,
    replanIntervalMillis: 5_000,
    stuckWindowMillis: 100,
    stuckDistance: 0
  });
  const definition = createAgentDefinition({ id: "agent", brainId: "counter", profileId: profile.id });
  const runtime = createAgentRuntime({ definition, profile, brain: counterBrain, seed: 1 });
  assert.equal(runtime.step(runtimeObservation(1, 0)).action?.kind, "move");
  const partialWindow = runtime.step(runtimeObservation(2, 50));
  assert.equal(partialWindow.snapshot.stuckDetector.samples.length, 1);
  const restored = createAgentRuntime({ definition, profile, brain: counterBrain, seed: 999 });
  restored.restore(partialWindow.snapshot);
  assert.deepEqual(
    restored.step(runtimeObservation(3, 100)),
    runtime.step(runtimeObservation(3, 100))
  );
  const replanned = runtime.step(runtimeObservation(4, 150));
  const restoredReplanned = restored.step(runtimeObservation(4, 150));
  assert.equal(replanned.replanReason, "stuck");
  assert.deepEqual(restoredReplanned, replanned);
  assert.equal(replanned.snapshot.brainState.plans, 2);
  assert.throws(() => runtime.step(runtimeObservation(4, 150)), /increasing ticks/);
});

test("runtime restore preserves exact scheduler deadlines and queued force replans", () => {
  const profile = defineAgentProfile("scheduler", "Scheduler", {
    reactionDelayMillis: 0,
    mistakeRate: 0,
    targetStickiness: 0,
    replanIntervalMillis: 1_000,
    stuckWindowMillis: 5_000
  });
  const definition = createAgentDefinition({ id: "agent", brainId: "scheduled", profileId: profile.id });
  const brain: AgentBrain<Readonly<{ target: number }>, CounterState> = Object.freeze({
    ...counterBrain,
    id: "scheduled",
    decide(context) {
      const decision = counterBrain.decide(context);
      return Object.freeze({ ...decision, reconsiderAtMillis: context.observation.nowMillis + 275 });
    }
  });
  const original = createAgentRuntime({ definition, profile, brain, seed: 7 });
  original.step(runtimeObservation(1, 0));
  const checkpoint = original.step(runtimeObservation(2, 100)).snapshot;
  assert.equal(checkpoint.nextPlanAtMillis, 275);

  const restored = createAgentRuntime({ definition, profile, brain, seed: 999 });
  restored.restore(checkpoint);
  assert.deepEqual(restored.step(runtimeObservation(3, 274)), original.step(runtimeObservation(3, 274)));
  const due = original.step(runtimeObservation(4, 275));
  assert.equal(due.replanReason, "interval");
  assert.deepEqual(restored.step(runtimeObservation(4, 275)), due);

  original.forceReplan();
  const forcedCheckpoint = original.snapshot();
  assert.equal(forcedCheckpoint.forceReplan, true);
  const forcedRestore = createAgentRuntime({ definition, profile, brain, seed: 123 });
  forcedRestore.restore(forcedCheckpoint);
  const forced = original.step(runtimeObservation(5, 300));
  assert.equal(forced.replanReason, "forced");
  assert.deepEqual(forcedRestore.step(runtimeObservation(5, 300)), forced);
});

type CounterState = Readonly<{ plans: number }>;

const counterBrain: AgentBrain<Readonly<{ target: number }>, CounterState> = Object.freeze({
  version: AGENT_CONTRACT_VERSION,
  id: "counter",
  initialState: () => Object.freeze({ plans: 0 }),
  decide(context) {
    const plans = context.state.plans + 1;
    const target = gridPoint(context.observation.world.target, 0);
    return Object.freeze({
      state: Object.freeze({ plans }),
      action: createAgentAction({
        actorId: context.definition.id,
        kind: "move",
        atMillis: context.observation.nowMillis,
        target,
        explanation: `Plan ${plans}`
      }),
      intention: Object.freeze({
        id: `target:${target.x}`,
        label: `Target ${target.x}`,
        selectedAtMillis: context.observation.nowMillis,
        target
      }),
      explanation: `Plan ${plans}`
    });
  }
});

function runtimeObservation(tick: number, nowMillis: number): AgentObservation<Readonly<{ target: number }>> {
  return createAgentObservation({
    agentId: "agent",
    tick,
    nowMillis,
    position: gridPoint(0, 0),
    entities: [],
    objectives: [],
    hazards: [],
    world: Object.freeze({ target: 3 })
  });
}
