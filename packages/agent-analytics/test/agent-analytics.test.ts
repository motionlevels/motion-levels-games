import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAJECTORY_SCHEMA_VERSION,
  compareTrajectorySets,
  evaluateRouteChoiceModel,
  guardLearnedDirection,
  measureTrajectory,
  parseRouteChoiceModel,
  predictRouteChoice,
  serializeRouteChoiceModel,
  trainRouteChoiceModel,
  type AgentTrajectory,
  type TrajectoryPoint
} from "../src/index.ts";

test("behaviour metrics capture hesitation, route diversity, danger, replans, and mistakes", () => {
  const route = trajectory("bot-a", [
    point(0, 0, 3, "wait", "checkpoint-1"),
    point(1, 0, 3, "wait", "checkpoint-1"),
    { ...point(2, 0, 2, "move", "checkpoint-1"), inDanger: true, replanned: true },
    { ...point(3, 1, 2, "move", "checkpoint-1"), collided: true, mistake: true }
  ]);
  const metrics = measureTrajectory(route);
  assert.equal(metrics.hesitationTicks, 1);
  assert.equal(metrics.reactionDelayTicks, 2);
  assert.equal(metrics.distanceTiles, 2);
  assert.equal(metrics.collisions, 1);
  assert.equal(metrics.replans, 1);
  assert.equal(metrics.dangerTicks, 1);
  assert.equal(metrics.mistakes, 1);

  const comparison = compareTrajectorySets([route], [
    trajectory("bot-b", [point(0, 0, 3, "move"), point(1, 0, 2, "move")], true, 10),
    trajectory("bot-c", [point(0, 1, 3, "move"), point(1, 2, 3, "move")], true, 8)
  ]);
  assert.equal(comparison.baseline.completionRate, 0);
  assert.equal(comparison.candidate.completionRate, 1);
  assert.equal(comparison.candidate.routeDiversity, 1);
  assert.ok(Math.abs((comparison.candidate.spacingTiles ?? 0) - (1 + Math.sqrt(5)) / 2) < 1e-9);
});

test("offline route-choice fitting is versioned, deterministic, and beats a simple baseline", () => {
  const training = [
    trajectory("authored-1", [
      point(0, 0, 3, "move", "checkpoint"),
      point(1, 0, 2, "move", "checkpoint"),
      point(2, 0, 1, "move", "checkpoint")
    ]),
    trajectory("synthetic-1", [
      point(0, 2, 3, "move", "checkpoint"),
      point(1, 2, 2, "move", "checkpoint"),
      point(2, 2, 1, "move", "checkpoint")
    ], true, 4, { kind: "synthetic", generatorVersion: "human-like-v1" })
  ];
  const model = trainRouteChoiceModel(training, { versionLabel: "cruce-route-v1" });
  assert.match(model.version, /^cruce-route-v1-[0-9a-f]{8}$/);
  const prediction = predictRouteChoice(model, "checkpoint|safe|move");
  assert.equal(prediction.direction, "up");
  assert.ok(prediction.probabilities.up > prediction.probabilities.left);
  const evaluation = evaluateRouteChoiceModel(model, training, () => "right");
  assert.equal(evaluation.accuracy, 1);
  assert.equal(evaluation.improvesOnBaseline, true);
  assert.deepEqual(parseRouteChoiceModel(serializeRouteChoiceModel(model)), model);
});

test("human training data is rejected unless its policy version is explicitly approved", () => {
  const human = trajectory("anonymous-session", [point(0, 0, 1, "move"), point(1, 0, 0, "move")], true, 1, {
    kind: "anonymized-human",
    policyVersion: "privacy-v1",
    datasetId: "approved-dataset",
    retentionDeadline: "2026-09-01"
  });
  assert.throws(
    () => trainRouteChoiceModel([human], { versionLabel: "model" }),
    /not approved/
  );
  const model = trainRouteChoiceModel([human], {
    versionLabel: "model",
    allowedHumanPolicyVersions: ["privacy-v1"]
  });
  assert.deepEqual(model.trainingPolicyVersions, ["privacy-v1"]);
});

test("learned output stays behind deterministic action validation", () => {
  assert.equal(guardLearnedDirection("left", ["left", "up"], "up"), "left");
  assert.equal(guardLearnedDirection("right", ["left", "up"], "up"), "up");
  assert.throws(() => guardLearnedDirection("right", ["left"], "up"), /fallback/);
});

function trajectory(
  id: string,
  points: TrajectoryPoint[],
  completed = false,
  score = 0,
  provenance: AgentTrajectory["provenance"] = { kind: "authored", authoringVersion: "test-v1" }
): AgentTrajectory {
  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    id,
    tickRate: 50,
    completed,
    score,
    provenance,
    points
  };
}

function point(
  tick: number,
  x: number,
  y: number,
  action: string,
  targetId?: string
): TrajectoryPoint {
  return {
    tick,
    position: { x, y },
    action,
    ...(targetId ? { targetId } : {})
  };
}
