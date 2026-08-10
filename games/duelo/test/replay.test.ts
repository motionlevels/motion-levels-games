import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeReplay,
  encodeReplay,
  replayChecksum
} from "@motion-levels-games/replay-runtime";
import * as product from "../src/index.ts";
import {
  CURATED_DUELO_DEMONSTRATION_METADATA,
  CURATED_DUELO_FINAL_AUTHORITATIVE_CHECKSUM,
  CURATED_DUELO_GHOST,
  CURATED_DUELO_GOLDEN_REPLAY_CHECKSUM,
  createCuratedDueloDemonstrationReplay
} from "../src/demonstration.ts";
import {
  DUELO_REPLAY_SIMULATION_VERSION,
  dueloGhostTrack,
  dueloReplayArtifactChecksum,
  dueloReplayFinalChecksum,
  verifyDueloAgentReplay,
  verifyDueloReplaySeek
} from "../src/replay.ts";

test("replay and demonstration tooling stay off the product root", () => {
  assert.equal("recordDueloAgentReplay" in product, false);
  assert.equal("createCuratedDueloDemonstrationReplay" in product, false);
  assert.equal("CURATED_DUELO_GHOST" in product, false);
});

test("curated synthetic replay has a stable version, artifact checksum, and real inputs", () => {
  const replay = createCuratedDueloDemonstrationReplay();
  assert.equal(CURATED_DUELO_DEMONSTRATION_METADATA.source, "synthetic-agent");
  assert.equal(CURATED_DUELO_DEMONSTRATION_METADATA.containsHumanData, false);
  assert.equal(replay.header.gameId, "duelo");
  assert.equal(replay.header.simulationVersion, DUELO_REPLAY_SIMULATION_VERSION);
  assert.equal(replay.frames.length, 1_080);
  assert.equal(dueloReplayArtifactChecksum(replay), CURATED_DUELO_GOLDEN_REPLAY_CHECKSUM);
  assert.equal(dueloReplayFinalChecksum(replay), CURATED_DUELO_FINAL_AUTHORITATIVE_CHECKSUM);
  assert.deepEqual(replay.snapshots.map((snapshot) => snapshot.tick), [
    0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000
  ]);
  assert.equal(replay.frames.every((frame) => frame.authoritativeChecksum !== undefined), true);
  assert.equal(replay.snapshots.every((snapshot) =>
    replayChecksum(snapshot.state) === snapshot.checksum
  ), true);
  const inputs = replay.frames.flatMap((frame) => frame.inputs);
  assert.ok(inputs.some((input) => input.kind === "press"));
  assert.ok(inputs.some((input) => input.kind === "release"));
  assert.equal(inputs.every((input) => input.sourceId?.startsWith("duelo-player-") === true), true);
  assert.equal(replay.frames.every((frame) => frame.inputs.length === frame.actions.length), true);

  const repeated = createCuratedDueloDemonstrationReplay();
  assert.equal(dueloReplayArtifactChecksum(repeated), CURATED_DUELO_GOLDEN_REPLAY_CHECKSUM);
  assert.deepEqual(repeated.header, replay.header);
});

test("verification replays every authoritative input and detects corruption", () => {
  const replay = createCuratedDueloDemonstrationReplay();
  const verified = verifyDueloAgentReplay(replay);
  assert.equal(verified.valid, true);
  assert.equal(verified.verifiedFrames, replay.frames.length);
  assert.equal(verified.mismatches.length, 0);
  assert.equal(verified.finalChecksum, CURATED_DUELO_FINAL_AUTHORITATIVE_CHECKSUM);

  const corrupted = decodeReplay(encodeReplay(replay));
  const firstInput = corrupted.frames[0]?.inputs[0];
  assert.ok(firstInput !== undefined);
  firstInput.x = 8;
  firstInput.y = 16;
  const rejected = verifyDueloAgentReplay(corrupted);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.mismatches.length > 0);

  const wrongVersion = decodeReplay(encodeReplay(replay));
  wrongVersion.header.simulationVersion = "duelo-replay-0";
  assert.throws(() => verifyDueloAgentReplay(wrongVersion), /Unsupported Duelo replay simulation/);
});

test("seek verifies snapshot integrity but honestly replays authority from tick zero", () => {
  const replay = createCuratedDueloDemonstrationReplay();
  const seek = verifyDueloReplaySeek(replay, 555);
  assert.equal(seek.valid, true);
  assert.equal(seek.resolvedTick, 555);
  assert.equal(seek.snapshotTick, 500);
  assert.equal(seek.snapshotChecksumValid, true);
  assert.equal(seek.authorityReplayOriginTick, 0);
  assert.equal(seek.replayedFrames, 556);
  assert.equal(seek.actualChecksum, seek.expectedChecksum);

  const corrupted = decodeReplay(encodeReplay(replay));
  const snapshot = corrupted.snapshots.find((candidate) => candidate.tick === 500);
  assert.ok(snapshot !== undefined);
  snapshot.checksum = "deadbeef";
  const rejected = verifyDueloReplaySeek(corrupted, 555);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.snapshotChecksumValid, false);
});

test("curated non-human ghost is a sparse exact projection of the golden replay", () => {
  const replay = createCuratedDueloDemonstrationReplay();
  const fullTrack = dueloGhostTrack(replay, CURATED_DUELO_GHOST.agentId);
  assert.equal(fullTrack.samples.length, replay.frames.length);
  assert.equal(CURATED_DUELO_GHOST.samples.length, 8);
  for (const curated of CURATED_DUELO_GHOST.samples) {
    const recorded = fullTrack.samples.find((sample) => sample.tick === curated.tick);
    assert.ok(recorded !== undefined);
    assert.deepEqual(recorded.position, curated.position);
    assert.equal(recorded.facingRadians, curated.facingRadians);
    assert.equal(recorded.action, curated.action);
    assert.equal(recorded.score, curated.score);
    assert.equal(recorded.state?.intention, curated.state?.intention);
  }
});
