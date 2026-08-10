import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CONTRACT_VERSION,
  AGENT_PROFILE_LIMITS,
  AGENT_PROFILES,
  PatrolBrain,
  adaptLegacyFixedPatrol,
  assertAgentContractVersion,
  blendAgentProfiles,
  createAgentAction,
  createAgentDefinition,
  createAgentObservation,
  createSeededRandom,
  defineAgentProfile,
  getAgentProfile,
  gridPoint,
  readPatrolConfig,
  type AgentObservation
} from "../src/index.ts";

test("versioned contract constructors create immutable replay data", () => {
  const tags = ["test"];
  const config = { nested: { enabled: true }, weights: [1, 2] };
  const definition = createAgentDefinition({
    id: "agent-1",
    brainId: "brain",
    profileId: "balanced",
    tags,
    config
  });
  const world = {
    round: { number: 1 },
    route: [{ x: 2, y: 3 }],
    confidence: new Map([["target", { value: 0.8 }]])
  };
  const observation = createAgentObservation({
    agentId: definition.id,
    tick: 1,
    nowMillis: 20,
    position: gridPoint(2, 3),
    entities: [],
    objectives: [],
    hazards: [],
    world
  });
  const payload = { combo: { count: 2 }, labels: ["move"] };
  const action = createAgentAction({
    actorId: definition.id,
    kind: "move",
    atMillis: 20,
    target: gridPoint(2, 4),
    payload
  });

  tags.push("mutated");
  config.nested.enabled = false;
  config.weights.push(3);
  world.round.number = 99;
  world.route[0]!.x = 9;
  world.confidence.get("target")!.value = 0;
  payload.combo.count = 99;
  payload.labels.push("mutated");

  assert.equal(definition.version, AGENT_CONTRACT_VERSION);
  assert.equal(observation.version, AGENT_CONTRACT_VERSION);
  assert.equal(action.version, AGENT_CONTRACT_VERSION);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.tags), true);
  assert.equal(Object.isFrozen((definition.config as typeof config).nested), true);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.world.round), true);
  assert.equal(Object.isFrozen(observation.world.route), true);
  assert.equal(Object.isFrozen(action), true);
  assert.equal(Object.isFrozen((action.payload as typeof payload).combo), true);
  assert.deepEqual(definition.tags, ["test"]);
  assert.deepEqual(definition.config, { nested: { enabled: true }, weights: [1, 2] });
  assert.equal(observation.world.round.number, 1);
  assert.deepEqual(observation.world.route, [{ x: 2, y: 3 }]);
  assert.equal(observation.world.confidence.get("target")?.value, 0.8);
  assert.deepEqual(action.payload, { combo: { count: 2 }, labels: ["move"] });
  assert.throws(() => (definition.tags as string[]).push("blocked"), /read only|extensible|frozen|object/i);
  assert.throws(() => (observation.world.confidence as Map<string, unknown>).set("other", 1), /immutable/);
  assert.throws(() => assertAgentContractVersion({ version: 99 }), /Unsupported agent contract version/);
  assert.throws(() => gridPoint(1.5, 2), /integer coordinates/);
  assert.throws(
    () => createAgentDefinition({ id: "", brainId: "brain", profileId: "balanced" }),
    /must not be empty/
  );
});

test("seeded random streams restore and fork deterministically", () => {
  const first = createSeededRandom(1_234);
  const second = createSeededRandom(1_234);
  assert.deepEqual(
    Array.from({ length: 8 }, () => first.int(10_000)),
    Array.from({ length: 8 }, () => second.int(10_000))
  );

  const state = first.state;
  const expected = first.next();
  first.restore(state);
  assert.equal(first.next(), expected);
  const firstFork = createSeededRandom(99).fork("route");
  const secondFork = createSeededRandom(99).fork("route");
  assert.deepEqual(
    Array.from({ length: 4 }, () => firstFork.next()),
    Array.from({ length: 4 }, () => secondFork.next())
  );
  assert.equal(first.chance(0), false);
  assert.equal(first.chance(1), true);
  assert.throws(() => first.int(0), /positive integer/);
});

test("all reusable profiles are bounded and custom profiles clamp every parameter", () => {
  assert.deepEqual(Object.keys(AGENT_PROFILES), [
    "cautious", "balanced", "bold", "helper", "explorer", "chaotic", "expert"
  ]);
  for (const profile of Object.values(AGENT_PROFILES)) {
    for (const [name, [minimum, maximum]] of Object.entries(AGENT_PROFILE_LIMITS)) {
      const value = profile.parameters[name as keyof typeof profile.parameters];
      assert.ok(value >= minimum && value <= maximum, `${profile.id}.${name} is bounded`);
    }
  }

  const bounded = defineAgentProfile("bounded", "Bounded", {
    reactionDelayMillis: 99_000,
    mistakeRate: -4,
    prediction: Number.NaN,
    stuckDistance: 99
  });
  assert.equal(bounded.parameters.reactionDelayMillis, 2_000);
  assert.equal(bounded.parameters.mistakeRate, 0);
  assert.equal(bounded.parameters.stuckDistance, 4);
  assert.equal(bounded.parameters.prediction, getAgentProfile("balanced").parameters.prediction);
  assert.throws(() => getAgentProfile("missing"), /Unknown agent profile/);
});

test("profile blending is deterministic and honors endpoints", () => {
  const cautious = getAgentProfile("cautious");
  const bold = getAgentProfile("bold");
  const cautiousCopy = blendAgentProfiles("copy", "Copy", cautious, bold, 0);
  const midpoint = blendAgentProfiles("middle", "Middle", cautious, bold, 0.5);

  assert.deepEqual(cautiousCopy.parameters, cautious.parameters);
  assert.equal(
    midpoint.parameters.caution,
    (cautious.parameters.caution + bold.parameters.caution) / 2
  );
});

test("legacy patrol adapter preserves spawn, fixed path, speed, and damage", () => {
  const adapted = adaptLegacyFixedPatrol({
    id: "legacy-enemy",
    spawn: gridPoint(0, 0),
    path: [gridPoint(1, 0), gridPoint(2, 0)],
    speed: 3.5,
    damage: 12
  });
  const config = readPatrolConfig(adapted.definition);
  assert.deepEqual(config.path, [gridPoint(0, 0), gridPoint(1, 0), gridPoint(2, 0)]);
  assert.equal(config.speed, 3.5);
  assert.equal(config.damage, 12);
  assert.deepEqual(adapted.spawn, gridPoint(0, 0));

  const brain = adapted.brain;
  assert.ok(brain instanceof PatrolBrain);
  const initial = brain.initialState(adapted.definition, patrolObservation(1, 0, 0));
  const first = brain.decide({
    definition: adapted.definition,
    observation: patrolObservation(1, 0, 0),
    profile: getAgentProfile("balanced"),
    state: initial,
    random: createSeededRandom(1),
    services: undefined
  });
  assert.equal(first.action?.kind, "move");
  assert.deepEqual(first.action?.target, gridPoint(1, 0));
  assert.deepEqual(first.action?.payload, { speed: 3.5, damage: 12, spawn: gridPoint(0, 0) });

  const second = brain.decide({
    definition: adapted.definition,
    observation: patrolObservation(2, 1, 0),
    profile: getAgentProfile("balanced"),
    state: first.state,
    previousIntention: first.intention,
    random: createSeededRandom(1),
    services: undefined
  });
  const looped = brain.decide({
    definition: adapted.definition,
    observation: patrolObservation(3, 2, 0),
    profile: getAgentProfile("balanced"),
    state: second.state,
    previousIntention: second.intention,
    random: createSeededRandom(1),
    services: undefined
  });
  assert.deepEqual(second.action?.target, gridPoint(2, 0));
  assert.deepEqual(looped.action?.target, gridPoint(0, 0));
  assert.equal(looped.state.laps, 1);
});

function patrolObservation(tick: number, x: number, y: number): AgentObservation<unknown> {
  return createAgentObservation({
    agentId: "legacy-enemy",
    tick,
    nowMillis: tick * 100,
    position: gridPoint(x, y),
    entities: [],
    objectives: [],
    hazards: [],
    world: undefined
  });
}
