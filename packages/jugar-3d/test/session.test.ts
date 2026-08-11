import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentType } from "react";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GameManifest,
  type GameSnapshot,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay as DueloPlayerDisplay,
  createGame as createDueloGame,
  createSessionController as createDueloSessionController,
  manifest as dueloManifest,
  type DueloGameInstance,
  type DueloSnapshot
} from "@motion-levels-games/duelo";

import type {
  RegisteredGame,
  SessionControllerFactory,
  SessionControllerObservation
} from "../src/contracts.ts";
import { GameSession, type SessionTrajectoryFrame } from "../src/core/session.ts";

test("identical seeds produce identical authority under different rAF partitions", () => {
  const game = fakeRegistration();
  const first = new GameSession(game, { playerCount: 3, seed: 137 });
  const second = new GameSession(game, { playerCount: 3, seed: 137 });

  drive(first, [0, ...range(20, 2_000, 20)]);
  drive(second, [0, ...range(100, 2_000, 100)]);

  assert.equal(first.tick, 100);
  assert.equal(second.tick, 100);
  assert.deepEqual(avatarAuthority(first), avatarAuthority(second));
  assert.deepEqual(first.state.snapshot, second.state.snapshot);
  first.dispose();
  second.dispose();
});

test("pause and resume never catch up elapsed wall time", () => {
  const session = new GameSession(fakeRegistration(), { playerCount: 2, seed: 8 });
  session.advanceTo(0);
  session.advanceTo(20);
  assert.equal(session.tick, 1);

  session.setPaused(true);
  session.advanceTo(50_000);
  assert.equal(session.tick, 1);
  session.setPaused(false);
  session.advanceTo(90_000);
  session.advanceTo(90_020);

  assert.equal(session.tick, 2);
  assert.equal(session.clockMillis, 40);
  session.dispose();
});

test("explicit stepping advances exact ticks while paused", () => {
  const session = new GameSession(fakeRegistration(), { playerCount: 2, seed: 21 });
  session.setPaused(true);
  const state = session.stepTicks(3);
  assert.equal(session.tick, 3);
  assert.equal(session.clockMillis, 60);
  assert.equal(state.clockMillis, 60);
  assert.throws(() => session.stepTicks(0), /positive integer/u);
  session.dispose();
});

test("restart replaces controllers and dispose is idempotent", () => {
  let created = 0;
  let disposed = 0;
  const createSessionController: SessionControllerFactory = ({ id }) => {
    created += 1;
    return {
      id,
      step: () => undefined,
      dispose: () => {
        disposed += 1;
      }
    };
  };
  const session = new GameSession(fakeRegistration(createSessionController), {
    controllerSlots: "all",
    playerCount: 2,
    seed: 55
  });
  assert.equal(created, 2);

  session.restart({ seed: 55 });
  assert.equal(session.seed, 55);
  assert.equal(created, 4);
  assert.equal(disposed, 2);
  assert.equal(session.tick, 0);

  session.dispose();
  session.dispose();
  assert.equal(disposed, 4);
  assert.throws(() => session.stepTicks(), /disposed/u);
});

test("unsupported games route deterministic seeded compatibility behavior through controllers", () => {
  const first = new GameSession(fakeRegistration(), { playerCount: 2, seed: 901 });
  const second = new GameSession(fakeRegistration(), { playerCount: 2, seed: 901 });
  first.stepTicks(80);
  second.stepTicks(80);
  assert.deepEqual(avatarAuthority(first), avatarAuthority(second));
  assert.ok(first.avatars[1]?.stepCount, "fallback companion should traverse authoritative tiles");
  first.dispose();
  second.dispose();
});

test("controller moves are applied through the session's single engine", () => {
  let observedGame: GameInstance | undefined;
  const createSessionController: SessionControllerFactory = ({ id }) => ({
    id,
    step(observation: SessionControllerObservation) {
      observedGame = observation.game;
      return { action: { kind: "move", target: { x: 7, y: 25 } } };
    }
  });
  const registration = fakeRegistration(createSessionController);
  const session = new GameSession(registration, {
    controllerSlots: "all",
    playerCount: 1,
    seed: 44
  });
  const instance = session.instance as FakeGame;
  session.stepTicks(400);

  assert.equal(observedGame, session.instance);
  assert.ok(instance.presses.some(({ x, y }) => x === 7 && y === 25));
  assert.equal(session.engine.state.snapshot.score, instance.presses.length);
  session.dispose();
});

test("controller waypoints are followed in order through authoritative presses", () => {
  let decisions = 0;
  const createSessionController: SessionControllerFactory = ({ id }) => ({
    id,
    step(observation) {
      if (observation.self.target !== null || decisions > 0) return undefined;
      decisions += 1;
      return {
        action: {
          kind: "move",
          target: { x: 8, y: 25 },
          path: [
            { ...observation.self.tile },
            { x: 7, y: 26 },
            { x: 8, y: 26 },
            { x: 8, y: 25 }
          ],
          explanation: "Follow the semantic route"
        }
      };
    }
  });
  const session = new GameSession(fakeRegistration(createSessionController), {
    controllerSlots: "all",
    playerCount: 1,
    seed: 12
  });
  const instance = session.instance as FakeGame;
  session.stepTicks(180);

  const pressed = instance.presses.map(({ x, y }) => `${x}:${y}`);
  assertOrdered(pressed, ["7:26", "8:26", "8:25"]);
  assert.equal(decisions, 1);
  assert.equal(session.agentDebug[0]?.explanation, "Follow the semantic route");
  session.dispose();
});

test("intermediate controller waypoints preserve configured travel speed", () => {
  let planned = false;
  const createSessionController: SessionControllerFactory = ({ id }) => ({
    id,
    step(observation) {
      if (planned || observation.self.target !== null) return undefined;
      planned = true;
      return {
        action: {
          kind: "move",
          target: { x: 7, y: 20 },
          path: Array.from({ length: 8 }, (_, index) => ({ x: 7, y: 27 - index }))
        }
      };
    }
  });
  const session = new GameSession(fakeRegistration(createSessionController), {
    controllerSlots: "all",
    playerCount: 1,
    seed: 19
  });
  const positions: number[] = [];
  const unsubscribe = session.subscribeTrajectory((frame) => {
    positions.push(frame.avatars[0]?.position.y ?? 27);
  });
  session.stepTicks(50);

  const travelled = 27 - (session.avatars[0]?.position.y ?? 27);
  const speed = Math.hypot(
    session.avatars[0]?.velocity.x ?? 0,
    session.avatars[0]?.velocity.y ?? 0
  );
  assert.ok(travelled >= 4.45 && travelled <= 4.65, `expected accelerated travel, got ${travelled}`);
  assert.ok(speed >= 4.79 && speed <= 4.81, `expected configured cruise speed, got ${speed}`);
  assert.ok(positions.every((position, index) => index === 0 || position <= (positions[index - 1] ?? 27)));
  unsubscribe();
  session.dispose();
});

test("exact trajectory seek leaves live authority untouched and restores it on exit", () => {
  const session = new GameSession(fakeRegistration(), { playerCount: 2, seed: 77 });
  const frames: SessionTrajectoryFrame[] = [session.captureTrajectoryFrame()];
  const unsubscribe = session.subscribeTrajectory((frame) => frames.push(frame));
  session.stepTicks(8);
  const liveClock = session.engine.clockMillis;
  const liveAvatars = avatarAuthority(session);
  const seekFrame = frames[3];
  assert.ok(seekFrame);

  session.setPaused(true);
  session.presentTrajectoryFrame(seekFrame);
  assert.equal(session.isPresentingTrajectory, true);
  assert.equal(session.state.clockMillis, seekFrame.atMillis);
  assert.equal(session.captureTrajectoryFrame().checksum, seekFrame.checksum);
  assert.equal(session.engine.clockMillis, liveClock);
  assert.throws(() => session.stepTicks(), /Exit trajectory playback/u);

  session.exitTrajectoryPlayback();
  assert.equal(session.isPresentingTrajectory, false);
  assert.equal(session.state.clockMillis, liveClock);
  assert.deepEqual(avatarAuthority(session), liveAvatars);
  unsubscribe();
  session.dispose();
});

test("trajectory playback exposes its recorded clock to character animation", () => {
  const session = new GameSession(fakeRegistration(), { playerCount: 1, seed: 81 });
  session.jump();
  const jumping = session.captureTrajectoryFrame();
  session.stepTicks(30);
  assert.equal(session.clockMillis, 600);

  session.setPaused(true);
  session.presentTrajectoryFrame(jumping);
  assert.equal(session.presentationMillis, 0);
  assert.ok((session.avatars[0]?.airborneUntil ?? 0) > session.presentationMillis);
  session.exitTrajectoryPlayback();
  assert.equal(session.presentationMillis, 600);
  session.dispose();
});

test("Duelo Jugar product sessions are deterministic terminals for 2 through 8 players", () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const first = runDueloProductSession(playerCount);
    const second = runDueloProductSession(playerCount);
    assert.deepEqual(second.result, first.result, `repeatability failed for ${playerCount} players`);
    assert.ok(first.presses.length > 0);
    assert.ok(first.presses.every(({ x, y }) => (
      Number.isInteger(x) && x >= 0 && x < FLOOR_COLS
      && Number.isInteger(y) && y >= 0 && y < FLOOR_ROWS
    )), `${playerCount}-player path emitted an out-of-bounds press`);
  }
});

let fakeCreateOrdinal = 0;

function fakeRegistration(createSessionController?: SessionControllerFactory): RegisteredGame {
  return {
    manifest: fakeManifest,
    createGame(config) {
      return new FakeGame(config.playerCount ?? 2, ++fakeCreateOrdinal);
    },
    PlayerDisplay: (() => null) as ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>,
    ...(createSessionController ? { createSessionController } : {})
  };
}

class FakeGame implements GameInstance {
  readonly presses: PressEvent[] = [];
  readonly createOrdinal: number;
  private readonly playerCount: number;
  private nowMillis = 0;

  constructor(playerCount: number, createOrdinal: number) {
    this.playerCount = playerCount;
    this.createOrdinal = createOrdinal;
  }

  init(nowMillis: number): GameEvent[] {
    this.nowMillis = nowMillis;
    return [];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    this.presses.push({ ...event });
    return [];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  render(): Frame {
    return litFrame;
  }

  snapshot(): GameSnapshot {
    return {
      currentGame: "jugar-test",
      label: "Jugar test",
      phase: "running",
      playerCount: this.playerCount,
      players: Array.from({ length: this.playerCount }, (_, index) => ({
        index,
        label: `Player ${index + 1}`,
        color: playerColors[index % playerColors.length] ?? "#ff0000",
        score: 0,
        lives: 1
      })),
      score: this.presses.length,
      lives: 1,
      elapsedMillis: this.nowMillis,
      remainingMillis: Math.max(0, 60_000 - this.nowMillis),
      activeTargets: 4,
      success: false,
      lastEventCue: "none",
      lastEventMessage: ""
    };
  }

  reset(_config?: Partial<GameConfig>): void {
    this.presses.length = 0;
    this.nowMillis = 0;
  }
}

const playerColors = ["#ff0000", "#00ff00", "#0000ff"] as const;
const litFrame: Frame = {
  width: FLOOR_COLS,
  height: FLOOR_ROWS,
  cells: Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, index) => ({
    x: index % FLOOR_COLS,
    y: Math.floor(index / FLOOR_COLS),
    color: playerColors[index % playerColors.length] ?? "#ff0000"
  }))
};

const fakeManifest: GameManifest = {
  id: "jugar-test",
  label: "Jugar test",
  availability: { development: true, production: true },
  catalog: {
    category: "team",
    color: "#ff0000",
    durationLabel: "1 min",
    modeLabel: "Test",
    audioLabel: "Test",
    rules: []
  },
  players: { allowAny: false, min: 1, max: 8 },
  start: { mode: "immediate" },
  defaultDurationMillis: 60_000,
  display: { entry: "./display.tsx" },
  preview: {
    seed: 137,
    playerCount: 2,
    actions: [],
    captureStartMillis: 0,
    frameCount: 1,
    frameIntervalMillis: 20
  }
};

function drive(session: GameSession, timestamps: readonly number[]): void {
  for (const timestamp of timestamps) session.advanceTo(timestamp);
}

function range(start: number, end: number, increment: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += increment) values.push(value);
  return values;
}

function avatarAuthority(session: GameSession) {
  return session.avatars.map((avatar) => ({
    id: avatar.id,
    playerIndex: avatar.playerIndex,
    position: { ...avatar.position },
    tile: { ...avatar.tile },
    target: avatar.target ? { ...avatar.target } : null,
    pressedTile: avatar.pressedTile ? { ...avatar.pressedTile } : null,
    stepCount: avatar.stepCount
  }));
}

function runDueloProductSession(playerCount: number) {
  const presses: PressEvent[] = [];
  let createdGame: DueloGameInstance | undefined;
  const registration: RegisteredGame = {
    manifest: dueloManifest,
    createGame(config) {
      createdGame = captureDueloPresses(createDueloGame(config), presses);
      return createdGame;
    },
    PlayerDisplay: DueloPlayerDisplay as RegisteredGame["PlayerDisplay"],
    createSessionController: createDueloSessionController
  };
  const session = new GameSession(registration, {
    controllerProfile: "mixed",
    controllerSlots: "all",
    playerCount,
    seed: 137
  });
  assert.equal(session.instance, createdGame);
  const initial = session.state.snapshot as DueloSnapshot;
  const targets = initial.playerProgress.map((player) => player.target);
  assert.equal(targets.reduce((sum, target) => sum + target, 0), initial.totalTargets);
  assert.ok(Math.max(...targets) - Math.min(...targets) <= 1);

  const maxTicks = 15_000;
  while (session.tick < maxTicks && String(session.state.snapshot.phase) !== "finished") {
    session.stepTicks(Math.min(50, maxTicks - session.tick));
  }

  const snapshot = session.state.snapshot as DueloSnapshot;
  assert.equal(snapshot.phase, "finished", `${playerCount}-player Duelo did not terminate`);
  assert.equal(snapshot.success, true);
  assert.ok(snapshot.winnerIndex >= 0 && snapshot.winnerIndex < playerCount);
  assert.ok(snapshot.winnerLabel.length > 0);
  const completed = snapshot.playerProgress.filter((player) => player.remaining === 0);
  assert.equal(completed.length, 1, "serialized final claim must yield one winner");
  assert.equal(completed[0]?.index, snapshot.winnerIndex);

  const result = {
    playerCount,
    winnerIndex: snapshot.winnerIndex,
    winnerLabel: snapshot.winnerLabel,
    tick: session.tick,
    elapsedMillis: snapshot.elapsedMillis,
    claimedTargets: snapshot.claimedTargets,
    targets,
    checksum: session.captureTrajectoryFrame().checksum
  };
  session.dispose();
  return { presses, result };
}

function captureDueloPresses(
  game: DueloGameInstance,
  presses: PressEvent[]
): DueloGameInstance {
  return {
    init: game.init.bind(game),
    press(event) {
      presses.push({ ...event });
      return game.press(event);
    },
    release: game.release.bind(game),
    tick: game.tick.bind(game),
    render: game.render.bind(game),
    snapshot: game.snapshot.bind(game),
    reset: game.reset.bind(game),
    playerReadyZones: game.playerReadyZones.bind(game),
    targetClaimed: game.targetClaimed.bind(game),
    targetOwner: game.targetOwner.bind(game)
  };
}

function assertOrdered(actual: readonly string[], expected: readonly string[]): void {
  let from = 0;
  for (const value of expected) {
    const index = actual.indexOf(value, from);
    assert.notEqual(index, -1, `expected ${value} after index ${from - 1}; got ${actual.join(",")}`);
    from = index + 1;
  }
}
