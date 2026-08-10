import assert from "node:assert/strict";
import test from "node:test";
import { createGameEngine, type GameEngineState } from "@motion-levels-games/game-sdk";
import {
  createDueloAgentDirector,
  inspectDueloSemanticBoard
} from "../src/agents.ts";
import { createDueloAgentHarness, type DueloAgentInput } from "../src/agent-harness.ts";
import {
  createGame,
  createSessionController,
  dueloReadyZones,
  manifest,
  winAnimationMillis,
  type DueloSnapshot
} from "../src/index.ts";

test("renderer-neutral director selects owned targets without advancing the game clock", () => {
  const game = createGame({ playerCount: 2, seed: 137, options: { base_fill_percent: 30 } });
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, { nowMillis: 0, initialEvents });
  for (const zone of game.playerReadyZones()) engine.press(zone.minX, zone.minY, 0);
  engine.tickTo(3_000);
  assert.equal(snapshot(engine.state).phase, "running");

  const positions = dueloReadyZones(2).map((zone, playerIndex) => Object.freeze({
    id: `external-${playerIndex}`,
    playerIndex,
    position: Object.freeze({ x: zone.minX, y: zone.minY })
  }));
  const director = createDueloAgentDirector({ game, playerCount: 2, seed: 137 });
  const pending = director.step({
    tick: 1,
    atMillis: 3_000,
    agents: positions,
    snapshot: snapshot(engine.state)
  });
  assert.equal(pending.decisions.every((decision) => decision.action === undefined), true);
  assert.equal(engine.clockMillis, 3_000, "the pure director must not advance GameEngine");

  const ready = director.step({
    tick: 2,
    atMillis: 3_060,
    agents: positions,
    snapshot: snapshot(engine.state)
  });
  for (const decision of ready.decisions) {
    assert.equal(decision.action?.kind, "move");
    assert.ok(decision.action?.target && decision.action.targetId);
    assert.equal(game.targetOwner(decision.action.target.x, decision.action.target.y), decision.playerIndex);
    assert.equal(decision.path[0]?.x, positions[decision.playerIndex]?.position.x);
    assert.equal(decision.path[0]?.y, positions[decision.playerIndex]?.position.y);
    assert.deepEqual(decision.path.at(-1), decision.action.target);
    assert.match(decision.explanation, /Player [12]: Selected/);
  }
  assert.equal(engine.clockMillis, 3_000, "decisions remain commands until GameSession applies them");

  const first = ready.decisions[0];
  assert.ok(first?.action?.target && first.action.targetId);
  engine.press(first.action.target.x, first.action.target.y, 3_060);
  assert.equal(game.targetClaimed(first.action.target.x, first.action.target.y), true);
  const reconciled = director.step({
    tick: 3,
    atMillis: 3_080,
    agents: positions.map((agent, index) => Object.freeze({
      ...agent,
      requestDecision: false,
      targetId: index === 0 ? first.action?.targetId : ready.decisions[index]?.action?.targetId
    })),
    snapshot: snapshot(engine.state)
  });
  assert.equal(reconciled.remainingTargets.some((target) => target.id === first.action?.targetId), false);
  assert.equal(reconciled.decisions[0]?.targetInvalidated, true);
});

test("harness readiness and movement use only the real press/release boundary", () => {
  const harness = createDueloAgentHarness({
    playerCount: 8,
    seed: 2026,
    movementTilesPerSecond: 20,
    gameOptions: { base_fill_percent: 30 }
  });
  const initialPositions = new Map(harness.frame.agents.map((agent) => [agent.id, agent.position]));
  assert.equal(snapshot(harness.state).phase, "starting");
  assert.equal(harness.frame.inputs.length, 8);
  assert.equal(harness.frame.inputs.every((input) =>
    input.kind === "press" && input.purpose === "readiness" && input.atMillis === 0
  ), true);

  const running = harness.step(150);
  assert.equal(running.atMillis, 3_000);
  assert.equal(snapshot(running.state).phase, "running");
  assert.equal(running.inputs.length, 8);
  assert.equal(running.inputs.every((input) => input.kind === "release" && input.purpose === "readiness"), true);

  while (harness.inputHistory.filter((input) => input.kind === "press" && input.purpose === "movement").length < 80) {
    harness.step();
  }
  assertBoundaryTrajectory(harness.inputHistory, initialPositions);
  assert.ok(snapshot(harness.state).claimedTargets > 0);
});

test("session-controller export shares one externally clocked team decision across bot factories", () => {
  const game = createGame({ playerCount: 3, seed: 619, options: { base_fill_percent: 30 } });
  const initialEvents = game.init(0);
  const engine = createGameEngine(game, { nowMillis: 0, initialEvents });
  for (const zone of game.playerReadyZones()) engine.press(zone.minX, zone.minY, 0);
  engine.tickTo(3_000);
  const zones = dueloReadyZones(3);
  const avatars = zones.map((zone, index) => Object.freeze({
    id: index,
    playerIndex: index,
    isBot: index > 0,
    position: Object.freeze({ x: zone.minX, y: zone.minY }),
    tile: Object.freeze({ x: zone.minX, y: zone.minY }),
    target: null
  }));
  const firstBot = createSessionController({
    id: "bot-one",
    seed: 619,
    playerIndex: 1,
    game,
    manifest,
    profile: "mixed"
  });
  const secondBot = createSessionController({
    id: "bot-two",
    seed: 619,
    playerIndex: 2,
    game,
    manifest,
    profile: "mixed"
  });
  assert.throws(() => createSessionController({
    id: "profile-mismatch",
    seed: 619,
    playerIndex: 1,
    game,
    manifest,
    profile: "expert"
  }), /same seed and profile/);
  assert.throws(() => createSessionController({
    id: "seed-mismatch",
    seed: 620,
    playerIndex: 1,
    game,
    manifest,
    profile: "mixed"
  }), /same seed and profile/);
  assert.throws(() => createSessionController({
    id: "invalid-profile",
    seed: 619,
    playerIndex: 1,
    game,
    manifest,
    profile: "reckless"
  }), /Unknown Duelo session profile/);
  const observe = (tick: number, atMillis: number) => Object.freeze({
    tick,
    atMillis,
    deltaMillis: 20,
    gameId: "duelo",
    game,
    frame: engine.state.frame,
    snapshot: engine.state.snapshot,
    self: avatars[1] as (typeof avatars)[number],
    avatars
  });
  assert.equal(firstBot.step(observe(1, 3_000))?.action, undefined);
  assert.equal(secondBot.step({ ...observe(1, 3_000), self: avatars[2] as (typeof avatars)[number] })?.action, undefined);
  const firstAction = firstBot.step(observe(2, 3_500))?.action;
  const secondAction = secondBot.step({
    ...observe(2, 3_500),
    self: avatars[2] as (typeof avatars)[number]
  })?.action;
  assert.equal(firstAction?.kind, "move");
  assert.equal(secondAction?.kind, "move");
  assert.ok(firstAction?.target && secondAction?.target);
  assert.deepEqual(firstAction.path?.at(-1), firstAction.target);
  assert.deepEqual(secondAction.path?.at(-1), secondAction.target);
  assert.ok((firstAction.path?.length ?? 0) > 1);
  assert.ok((secondAction.path?.length ?? 0) > 1);
  assert.equal(game.targetOwner(firstAction.target.x, firstAction.target.y), 1);
  assert.equal(game.targetOwner(secondAction.target.x, secondAction.target.y), 2);
  assert.equal(engine.clockMillis, 3_000, "session controllers must use the supplied clock without advancing it");
  firstBot.dispose();
  secondBot.dispose();
  assert.equal(firstBot.step(observe(3, 3_080)), undefined);
});

test("same seed reproduces the complete semantic trajectory and another seed changes it", () => {
  const run = (seed: number) => {
    const harness = createDueloAgentHarness({
      playerCount: 4,
      seed,
      movementTilesPerSecond: 20,
      gameOptions: { base_fill_percent: 30 }
    });
    const frame = harness.run(5_000);
    return {
      boardSignature: frame.boardSignature,
      checksum: frame.checksum,
      checksums: harness.checksumHistory,
      inputs: harness.inputHistory,
      metrics: frame.metrics
    };
  };
  const first = run(424_242);
  const repeated = run(424_242);
  const changed = run(424_243);
  assert.deepEqual(repeated, first);
  assert.notEqual(changed.boardSignature, first.boardSignature);
  assert.notDeepEqual(changed.inputs, first.inputs);
  assert.equal(first.metrics.completed, true);
});

test("product-reference speed decisions stay deterministic for every 2–8 player match", () => {
  const expectedChecksums = [
    "e953af7d",
    "c193d30b",
    "60f54a02",
    "da0a6b26",
    "6a08dc23",
    "02ca7f0f",
    "17ec79d7"
  ] as const;
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const run = () => {
      const harness = createDueloAgentHarness({
        playerCount,
        difficulty: "medium",
        seed: 137,
        movementTilesPerSecond: 4.8
      });
      const initialPositions = new Map(harness.frame.agents.map((agent) => [agent.id, agent.position]));
      const frame = harness.run(12_000);
      assertBoundaryTrajectory(harness.inputHistory, initialPositions);
      return Object.freeze({
        frame,
        checksums: harness.checksumHistory,
        inputs: harness.inputHistory
      });
    };
    const first = run();
    const repeated = run();
    assert.equal(first.frame.metrics.completed, true, `product speed did not finish ${playerCount} players`);
    assert.equal(first.frame.checksum, expectedChecksums[playerCount - 2]);
    assert.deepEqual(repeated, first, `product-speed trajectory changed for ${playerCount} players`);
  }
});

test("rival-aware A* materially reduces accidental opponent contributions", () => {
  const previousUnweightedTotals = new Map([
    [2, 63],
    [4, 89],
    [8, 121]
  ]);
  for (const playerCount of [2, 4, 8]) {
    const harness = createDueloAgentHarness({
      playerCount,
      difficulty: "medium",
      seed: 137,
      movementTilesPerSecond: 20
    });
    const frame = harness.run(5_000);
    const rivalContributions = frame.metrics.rivalTargetsClaimedByAgent.reduce(
      (total, count) => total + count,
      0
    );
    const previous = previousUnweightedTotals.get(playerCount) as number;
    assert.equal(frame.metrics.completed, true);
    assert.ok(
      rivalContributions <= previous * 0.3,
      `${playerCount} players still contributed ${rivalContributions}/${previous} rival targets`
    );
  }
});

test("every 2–8 player medium/hard reference match preserves equal targets and real outcomes", () => {
  const winners = new Set<number>();
  for (const difficulty of ["medium", "hard"] as const) {
    for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
      const harness = createDueloAgentHarness({
        playerCount,
        difficulty,
        seed: 137,
        movementTilesPerSecond: 20
      });
      const frame = harness.run(5_000);
      assert.equal(frame.metrics.completed, true, `${difficulty}/${playerCount} did not finish`);
      assert.equal(frame.metrics.fairTargetAllocation, true);
      assert.equal(frame.metrics.targetSpread, 0);
      assert.equal(new Set(frame.metrics.initialTargetsByPlayer).size, 1);
      assert.ok(frame.metrics.winnerIndex >= 0 && frame.metrics.winnerIndex < playerCount);
      assert.equal(
        frame.metrics.claimsByPlayer[frame.metrics.winnerIndex],
        frame.metrics.initialTargetsByPlayer[frame.metrics.winnerIndex]
      );
      assert.equal(harness.eventHistory.filter((event) => event.cue === "win").length, 1);
      winners.add(frame.metrics.winnerIndex);

      const claimsAtWin = frame.metrics.totalClaims;
      const inputsAtWin = harness.inputHistory.length;
      harness.step(10);
      assert.equal(harness.frame.metrics.totalClaims, claimsAtWin, "finished phase must lock scoring");
      assert.equal(harness.inputHistory.length, inputsAtWin, "finished phase must stop agent input");
    }
  }
  assert.ok(winners.size > 1, "seeded/rotating arbitration must not hard-code player zero as every winner");
});

test("winner animation resets the real game without silently starting another match", () => {
  const harness = createDueloAgentHarness({
    playerCount: 2,
    seed: 9,
    movementTilesPerSecond: 20,
    gameOptions: { base_fill_percent: 30 }
  });
  const finished = harness.run(5_000);
  assert.equal(finished.metrics.phase, "finished");
  const claims = finished.metrics.totalClaims;
  harness.step(winAnimationMillis / 20 - 1);
  assert.equal(harness.frame.metrics.phase, "finished");
  assert.equal(harness.frame.metrics.totalClaims, claims);
  const reset = harness.step();
  assert.equal(reset.metrics.phase, "waiting");
  assert.equal(reset.metrics.totalClaims, 0);
  assert.equal(snapshot(reset.state).score, 0);
  assert.equal(reset.inputs.length, 0);
  assert.equal(reset.metrics.fairTargetAllocation, true);
  harness.step(20);
  assert.equal(harness.frame.metrics.phase, "waiting", "a test harness must not replace product match lifecycle");
});

test("semantic board inspection and harness validation preserve Duelo's strict contract", () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const game = createGame({ playerCount, seed: 271 });
    game.init(0);
    const board = inspectDueloSemanticBoard(game, playerCount);
    assert.equal(board.targetsByPlayer.length, playerCount);
    assert.equal(new Set(board.targetsByPlayer.map((targets) => targets.length)).size, 1);
    assert.equal(new Set(board.targets.map((target) => target.id)).size, board.targets.length);
  }
  assert.throws(() => createDueloAgentHarness({ playerCount: 1 }), /2 through 8/);
  assert.throws(() => createDueloAgentHarness({ playerCount: 9 }), /2 through 8/);
  assert.throws(() => createDueloAgentHarness({ difficulty: "easy" as "medium" }), /medium and hard/);
  assert.throws(() => createDueloAgentHarness({ movementTilesPerSecond: 21 }), /1–20/);

  const duplicateColors = createDueloAgentHarness({
    playerCount: 2,
    autoReady: false,
    players: [{ name: "Uno", color: "#ff3048" }, { name: "Dos", color: "#ff3048" }]
  });
  assert.deepEqual(snapshot(duplicateColors.state).players.map((player) => player.color), ["#ff3048", "#ff3048"]);
});

function snapshot(state: GameEngineState): DueloSnapshot {
  return state.snapshot as DueloSnapshot;
}

function assertBoundaryTrajectory(
  inputs: readonly DueloAgentInput[],
  initialPositions: ReadonlyMap<string, Readonly<{ x: number; y: number }>>
): void {
  const positions = new Map(initialPositions);
  const held = new Map<string, Readonly<{ x: number; y: number }>>();
  for (const input of inputs) {
    const point = Object.freeze({ x: input.x, y: input.y });
    if (input.purpose === "readiness") {
      if (input.kind === "press") held.set(input.agentId, point);
      else held.delete(input.agentId);
      continue;
    }
    if (input.kind === "release") {
      assert.deepEqual(point, held.get(input.agentId), `${input.agentId} released a tile it did not hold`);
      held.delete(input.agentId);
      continue;
    }
    const previous = positions.get(input.agentId);
    assert.ok(previous);
    const distance = Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y);
    assert.ok(distance <= 1, `${input.agentId} teleported ${distance} tiles`);
    assert.equal(held.has(input.agentId), false, `${input.agentId} pressed before releasing its previous tile`);
    positions.set(input.agentId, point);
    held.set(input.agentId, point);
  }
}
