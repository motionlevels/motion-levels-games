import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptLegacyFixedPatrol,
  assignArenaRoles,
  assignTeamObjectives,
  chooseSpaceManeuver,
  chooseTetrisPlacement,
  createAgentDefinition,
  createAgentObservation,
  createChaseInterceptionController,
  createGrid,
  createImperfectMemory,
  createLavaSafeZoneController,
  createObjectiveHazardBrain,
  createPongController,
  createReservationBook,
  createScriptedChoreographyController,
  createSeededRandom,
  createSpaceController,
  createTeamArenaCoordinator,
  createTetrisController,
  estimateMemoryConfidence,
  evaluateChoreography,
  getAgentProfile,
  gridPoint,
  hazardRiskAt,
  predictInterceptPoint,
  predictPongIntercept,
  selectSafestZone,
  type AgentBrain,
  type AgentEntity,
  type AgentHazard,
  type AgentObjective,
  type AgentObservation,
  type ArenaRole,
  type ChoreographyState,
  type ChaseBrainState,
  type ChaseWorld,
  type LavaSafeZoneState,
  type LavaSafeZoneWorld,
  type ObjectiveHazardBrainState,
  type ObjectiveHazardWorld,
  type PongBrainState,
  type PongWorld,
  type SpaceBrainState,
  type SpaceWorld,
  type TeamAgent
} from "../src/index.ts";

test("hazard risk observes activation windows, severity, and velocity", () => {
  const hazards: AgentHazard[] = [{
    id: "sweep",
    position: gridPoint(0, 0),
    velocity: { x: 1, y: 0 },
    radius: 2,
    severity: 1,
    activeFromMillis: 1_000,
    activeUntilMillis: 4_000
  }];
  assert.equal(hazardRiskAt(gridPoint(2, 0), hazards, 500), 0);
  assert.equal(hazardRiskAt(gridPoint(2, 0), hazards, 3_000), 1);
  assert.equal(hazardRiskAt(gridPoint(2, 0), hazards, 4_000), 0);

  const observedWithoutActivation: AgentHazard[] = [{
    id: "observed-sweep",
    position: gridPoint(5, 0),
    positionAtMillis: 10_000,
    velocity: { x: 2, y: 0 },
    radius: 0,
    severity: 1
  }];
  assert.equal(hazardRiskAt(gridPoint(5, 0), observedWithoutActivation, 10_000), 1);
  assert.equal(hazardRiskAt(gridPoint(7, 0), observedWithoutActivation, 11_000), 1);
});

test("reference objective/hazard brain favors survivable utility and reserves its route", () => {
  const grid = createGrid({ width: 4, height: 3 });
  const reservations = createReservationBook();
  const world: ObjectiveHazardWorld = { grid, reservations };
  const objectives: AgentObjective[] = [
    { id: "danger", position: gridPoint(1, 0), value: 100 },
    { id: "safe", position: gridPoint(2, 1), value: 80 }
  ];
  const hazards: AgentHazard[] = [
    { id: "fire", position: gridPoint(1, 0), radius: 1, severity: 1 }
  ];
  const brain = createObjectiveHazardBrain();
  const definition = createAgentDefinition({ id: "agent", brainId: brain.id, profileId: "cautious" });
  const observation = makeObservation("agent", 1, 0, gridPoint(0, 0), world, { objectives, hazards });
  const decision = decide(brain, definition, observation, getAgentProfile("cautious"));

  assert.equal(decision.intention?.targetId, "safe");
  assert.equal(decision.action?.kind, "move");
  assert.equal(reservations.objectiveOwner("safe", 0), "agent");
  assert.ok(decision.state.path.length > 1);
  assert.match(decision.explanation, /Selected/);
});

test("lava safe-zone policy rejects full zones and routes around timed lava", () => {
  const grid = createGrid({ width: 4, height: 2 });
  const world: LavaSafeZoneWorld = {
    grid,
    safeZones: [
      { id: "full", center: gridPoint(1, 0), capacity: 1, occupants: 1, safety: 1 },
      { id: "open", center: gridPoint(3, 0), capacity: 2, occupants: 0, safety: 0.9 }
    ],
    lavaCostAt: (point) => point.x === 1 && point.y === 0 ? 100 : 0,
    reservations: createReservationBook()
  };
  const profile = getAgentProfile("cautious");
  const selection = selectSafestZone({
    agentId: "agent",
    position: gridPoint(0, 0),
    nowMillis: 0,
    world,
    profile
  });
  assert.equal(selection.selected?.targetId, "open");

  const brain = createLavaSafeZoneController();
  const definition = createAgentDefinition({ id: "agent", brainId: brain.id, profileId: profile.id });
  const observation = makeObservation("agent", 1, 0, gridPoint(0, 0), world);
  const decision = decide(brain, definition, observation, profile);
  assert.deepEqual(decision.action?.target, gridPoint(0, 1));
  assert.equal(decision.state.zoneId, "open");
});

test("interception prediction and chase controller are deterministic", () => {
  const prediction = predictInterceptPoint(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 1, y: 0 },
    5,
    3_000
  );
  assert.equal(prediction.reachable, true);
  assert.equal(prediction.timeMillis, 2_500);
  assert.deepEqual(prediction.point, { x: 12.5, y: 0 });

  const grid = createGrid({ width: 6, height: 2 });
  const world: ChaseWorld = { grid, targetId: "runner" };
  const entity: AgentEntity = {
    id: "runner",
    kind: "player",
    position: gridPoint(3, 0),
    velocity: { x: 0, y: 0 }
  };
  const brain = createChaseInterceptionController({ speedTilesPerSecond: 5 });
  const profile = getAgentProfile("expert");
  const definition = createAgentDefinition({ id: "chaser", brainId: brain.id, profileId: profile.id });
  const observation = makeObservation("chaser", 1, 0, gridPoint(0, 0), world, { entities: [entity] });
  const decision = decide(brain, definition, observation, profile);
  assert.equal(decision.intention?.targetId, "runner");
  assert.deepEqual(decision.action?.target, gridPoint(1, 0));
});

test("imperfect memory decays confidence, sorts recalls, and evicts deterministically", () => {
  assert.ok(Math.abs(estimateMemoryConfidence(1, 10_000, 0.1) - Math.exp(-1)) < 1e-12);
  const memory = createImperfectMemory<string>({ decayPerSecond: 0.1, capacity: 2, minimumConfidence: 0.1 });
  memory.observe({ id: "old", value: "old", observedAtMillis: 0, initialConfidence: 1 });
  memory.observe({ id: "middle", value: "middle", observedAtMillis: 1_000, initialConfidence: 0.8 });
  memory.observe({ id: "new", value: "new", observedAtMillis: 2_000, initialConfidence: 0.9 });
  assert.equal(memory.recall("old", 2_000), undefined);
  assert.deepEqual(memory.snapshot().map((entry) => entry.id), ["middle", "new"]);
  assert.deepEqual(memory.recallAll(3_000).map((entry) => entry.id), ["new", "middle"]);
  assert.equal(memory.forget("middle"), true);
  assert.equal(memory.prune(100_000), 1);
});

test("team and arena coordination assigns distinct deterministic responsibilities", () => {
  const agents: TeamAgent[] = [
    { id: "a", position: gridPoint(0, 0), role: "guard", traits: { defense: 1 } },
    { id: "b", position: gridPoint(9, 0), role: "runner", traits: { speed: 1 } }
  ];
  const objectives = [
    { id: "left", position: gridPoint(1, 0), value: 10, preferredRole: "guard" },
    { id: "right", position: gridPoint(8, 0), value: 9, preferredRole: "runner" }
  ];
  const assignments = assignTeamObjectives(agents, objectives);
  assert.deepEqual(assignments.map(({ agentId, objectiveId }) => ({ agentId, objectiveId })), [
    { agentId: "a", objectiveId: "left" },
    { agentId: "b", objectiveId: "right" }
  ]);
  const roles: ArenaRole[] = [
    { id: "defend", anchor: gridPoint(0, 0), desiredTraits: { defense: 5 } },
    { id: "attack", anchor: gridPoint(9, 0), desiredTraits: { speed: 5 } }
  ];
  assert.deepEqual(assignArenaRoles(agents, roles).map(({ agentId, roleId }) => ({ agentId, roleId })), [
    { agentId: "b", roleId: "attack" },
    { agentId: "a", roleId: "defend" }
  ]);

  const reservations = createReservationBook();
  const coordinator = createTeamArenaCoordinator(reservations);
  const plan = coordinator.plan(agents, objectives, roles, 100);
  assert.equal(plan.objectiveAssignments.length, 2);
  assert.equal(reservations.objectiveOwner("left", 100), "a");
});

test("Pong prediction reflects wall bounces and controller follows confidence", () => {
  const world: PongWorld = {
    ball: { position: { x: 0, y: 1 }, velocity: { x: 1, y: 3 } },
    paddleX: 10,
    minY: 0,
    maxY: 10
  };
  assert.deepEqual(predictPongIntercept(world.ball, 10, 0, 10), {
    y: 9,
    timeMillis: 10_000,
    reachable: true
  });
  const brain = createPongController();
  const profile = getAgentProfile("expert");
  const definition = createAgentDefinition({ id: "paddle", brainId: brain.id, profileId: profile.id });
  const decision = decide(brain, definition, makeObservation("paddle", 1, 0, gridPoint(10, 1), world), profile);
  assert.equal(decision.action?.kind, "move");
  assert.equal(decision.action?.target?.y, 9);
});

test("Tetris controller chooses a line-clearing deterministic placement", () => {
  const board = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [1, 1, 0, 0],
    [1, 1, 0, 0]
  ];
  const piece = {
    id: "domino",
    rotations: [
      [gridPoint(0, 0), gridPoint(1, 0)],
      [gridPoint(0, 0), gridPoint(0, 1)]
    ]
  };
  const placement = chooseTetrisPlacement(board, piece);
  const viaController = createTetrisController().choose(board, piece);
  assert.deepEqual(viaController, placement);
  assert.equal(placement?.metrics.linesCleared, 1);
  assert.equal(placement?.x, 2);
  assert.equal(placement?.y, 3);
});

test("space policy dodges the closest projected threat while aiming", () => {
  const world: SpaceWorld = {
    bounds: { minX: 0, maxX: 9, minY: 0, maxY: 9 },
    threats: [{ id: "rock", kind: "threat", position: gridPoint(3, 5), velocity: { x: 1, y: 0 } }],
    targets: [{ id: "enemy", kind: "target", position: gridPoint(8, 5) }]
  };
  const maneuver = chooseSpaceManeuver(gridPoint(5, 5), world, 1);
  assert.deepEqual(maneuver.moveTarget, gridPoint(8, 5));
  assert.equal(maneuver.fire, true);
  assert.equal(maneuver.targetId, "enemy");

  const brain = createSpaceController();
  const profile = getAgentProfile("cautious");
  const definition = createAgentDefinition({ id: "ship", brainId: brain.id, profileId: profile.id });
  const decision = decide(brain, definition, makeObservation("ship", 1, 0, gridPoint(5, 5), world), profile);
  assert.match(decision.explanation, /Dodging/);
  assert.equal((decision.action?.payload as { fire: boolean } | undefined)?.fire, true);
});

test("scripted choreography interpolates, loops, and exposes a brain controller", () => {
  const steps = [{
    id: "cross",
    atMillis: 0,
    durationMillis: 1_000,
    kind: "move" as const,
    from: gridPoint(0, 0),
    target: gridPoint(10, 0),
    easing: "linear" as const
  }];
  assert.deepEqual(evaluateChoreography(steps, 500, "dancer", 5_000).target, gridPoint(5, 0));
  assert.deepEqual(evaluateChoreography(steps, 1_500, "dancer", 5_000, 1_000).target, gridPoint(5, 0));

  const brain = createScriptedChoreographyController(steps, { loopMillis: 1_000 });
  const profile = getAgentProfile("balanced");
  const definition = createAgentDefinition({ id: "dancer", brainId: brain.id, profileId: profile.id });
  const decision = decide(
    brain,
    definition,
    makeObservation("dancer", 1, 500, gridPoint(0, 0), undefined),
    profile
  );
  assert.equal(decision.state.activeStepId, "cross");
  assert.deepEqual(decision.action?.target, gridPoint(5, 0));
});

test("legacy patrol helper remains importable alongside specialized controllers", () => {
  const patrol = adaptLegacyFixedPatrol({
    id: "legacy",
    spawn: gridPoint(0, 0),
    path: [],
    speed: 1,
    damage: 0
  });
  assert.equal(patrol.definition.brainId, "fixed-patrol");
});

type SupportedBrain =
  | AgentBrain<ObjectiveHazardWorld, ObjectiveHazardBrainState>
  | AgentBrain<LavaSafeZoneWorld, LavaSafeZoneState>
  | AgentBrain<ChaseWorld, ChaseBrainState>
  | AgentBrain<PongWorld, PongBrainState>
  | AgentBrain<SpaceWorld, SpaceBrainState>
  | AgentBrain<unknown, ChoreographyState>;

function decide<TWorld, TState>(
  brain: AgentBrain<TWorld, TState>,
  definition: ReturnType<typeof createAgentDefinition>,
  observation: AgentObservation<TWorld>,
  profile: ReturnType<typeof getAgentProfile>
) {
  const state = brain.initialState(definition, observation);
  return brain.decide({
    definition,
    observation,
    profile,
    state,
    random: createSeededRandom(7),
    services: undefined
  });
}

void (undefined as SupportedBrain | undefined);

function makeObservation<TWorld>(
  agentId: string,
  tick: number,
  nowMillis: number,
  position: ReturnType<typeof gridPoint>,
  world: TWorld,
  extras: Readonly<{
    entities?: readonly AgentEntity[];
    objectives?: readonly AgentObjective[];
    hazards?: readonly AgentHazard[];
  }> = {}
): AgentObservation<TWorld> {
  return createAgentObservation({
    agentId,
    tick,
    nowMillis,
    position,
    entities: extras.entities ?? [],
    objectives: extras.objectives ?? [],
    hazards: extras.hazards ?? [],
    world
  });
}
