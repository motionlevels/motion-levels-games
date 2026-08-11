import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  type GameManifest
} from "@motion-levels-games/game-sdk";

import {
  createGame as createParkourGame,
  createSessionController as createParkourController,
  manifest as parkourManifest
} from "../../../games/parkour/src/index.ts";
import {
  createGame as createTemporadaGame,
  createSessionController as createTemporadaController,
  manifest as temporadaManifest
} from "../../../games/temporada1-niveles/src/index.ts";
import type {
  PublishedLevelGameInstance,
  PublishedLevelSessionAvatar,
  PublishedLevelSessionController,
  PublishedLevelSessionControllerFactory,
  PublishedLevelSessionControllerObservation
} from "../src/index.ts";

type Point = { x: number; y: number };
type HarnessAvatar = PublishedLevelSessionAvatar & {
  tile: Point;
  target: Point | null;
  airborneUntil: number;
  pressed: Point | null;
  path: Point[];
};

const seeds = [1, 137, 65_537] as const;

test("Parkour semantic controllers reach terminal for 1–8 players across seeds", () => {
  for (let playerCount = 1; playerCount <= 8; playerCount += 1) {
    for (const seed of seeds) {
      const game = createParkourGame({ playerCount, difficulty: "easy", seed });
      const result = runStructuralJugar(
        game,
        parkourManifest,
        createParkourController,
        playerCount,
        seed
      );
      assert.equal(
        result.success,
        true,
        `Parkour players=${playerCount} seed=${seed}: ${result.diagnostic}`
      );
    }
  }
});

test("Parkour Any roster follows the Jugar one-agent normalization", () => {
  const game = createParkourGame({ playerCount: 0, difficulty: "easy", seed: 137 });
  assert.equal(game.snapshot().playerCount, 1);
  const result = runStructuralJugar(game, parkourManifest, createParkourController, 1, 137);
  assert.equal(result.success, true, `Parkour Any: ${result.diagnostic}`);
});

test("Temporada 1 semantic controllers reach terminal for 1–6 players across seeds", () => {
  for (let playerCount = 1; playerCount <= 6; playerCount += 1) {
    for (const seed of seeds) {
      const game = createTemporadaGame({ playerCount, difficulty: "easy", seed });
      const result = runStructuralJugar(
        game,
        temporadaManifest,
        createTemporadaController,
        playerCount,
        seed
      );
      assert.equal(
        result.success,
        true,
        `Temporada players=${playerCount} seed=${seed}: ${result.diagnostic}`
      );
    }
  }
});

function runStructuralJugar(
  game: PublishedLevelGameInstance,
  manifest: GameManifest,
  factory: PublishedLevelSessionControllerFactory,
  playerCount: number,
  seed: number
): { success: boolean; diagnostic: string } {
  game.init(0);
  const zones = game.playerReadyZones();
  assert.ok(zones.length >= playerCount, "the published board exposes one ready tile per configured player");
  const avatars: HarnessAvatar[] = zones.slice(0, playerCount).map((zone, playerIndex) => {
    const tile = { x: zone.minX, y: zone.minY };
    return {
      id: playerIndex,
      playerIndex,
      isBot: true,
      tile,
      target: null,
      airborneUntil: 0,
      pressed: { ...tile },
      path: []
    };
  });
  for (const avatar of avatars) {
    game.press({ ...avatar.tile, pressed: true, atMillis: 2_990 });
  }
  game.tick({ atMillis: 3_000 });
  const controllers = avatars.map((avatar) => factory({
    id: `${manifest.id}-${seed}-${avatar.id}`,
    seed,
    playerIndex: avatar.playerIndex,
    game,
    manifest,
    profile: "mixed"
  }));

  let atMillis = 3_000;
  let tick = 0;
  try {
    while (tick < 320 && game.snapshot().phase === "running") {
      const snapshot = game.snapshot();
      const frame = game.render();
      for (const [index, controller] of controllers.entries()) {
        const avatar = avatars[index]!;
        const observation = {
          tick,
          atMillis,
          deltaMillis: 100,
          gameId: manifest.id,
          game,
          frame,
          snapshot,
          self: avatar,
          avatars
        } satisfies PublishedLevelSessionControllerObservation;
        applyControllerDecision(controller, observation, avatar);
      }

      const nextMillis = atMillis + 100;
      for (const avatar of avatars) advanceAvatar(game, avatar, nextMillis);
      game.tick({ atMillis: nextMillis });
      atMillis = nextMillis;
      tick += 1;
    }
  } finally {
    for (const controller of controllers) controller.dispose?.();
  }
  const snapshot = game.snapshot();
  return {
    success: snapshot.phase === "finished" && snapshot.success,
    diagnostic: `${snapshot.phase}, score=${snapshot.score}, lives=${snapshot.lives}, remaining=${snapshot.objectivesRemaining}, ticks=${tick}, avatars=${JSON.stringify(avatars.map((avatar) => ({ tile: avatar.tile, target: avatar.target, airborneUntil: avatar.airborneUntil, path: avatar.path.length, pressed: avatar.pressed })))}`
  };
}

function applyControllerDecision(
  controller: PublishedLevelSessionController,
  observation: PublishedLevelSessionControllerObservation,
  avatar: HarnessAvatar
): void {
  const action = controller.step(observation)?.action;
  if (!action) return;
  if (action.kind === "jump") {
    avatar.airborneUntil = Math.max(avatar.airborneUntil, observation.atMillis + 520);
    if (avatar.pressed) {
      observation.game.release({ ...avatar.pressed, pressed: false, atMillis: observation.atMillis });
      avatar.pressed = null;
    }
    return;
  }
  if (action.kind !== "move" || !action.target) return;
  const path = [...(action.path ?? [action.target])].map((point) => ({ ...point }));
  assert.ok(path.length > 0, "a move action has at least one waypoint");
  let previous = avatar.tile;
  for (const point of path) {
    assert.ok(inBounds(point), `controller waypoint ${point.x},${point.y} is in floor bounds`);
    assert.equal(manhattan(previous, point), 1, "controller waypoints are cardinally adjacent");
    previous = point;
  }
  assert.deepEqual(path.at(-1), action.target, "the path terminates at the declared target");
  avatar.path = path;
  avatar.target = avatar.path.shift() ?? null;
}

function advanceAvatar(game: PublishedLevelGameInstance, avatar: HarnessAvatar, atMillis: number): void {
  if (avatar.target) {
    const reached = avatar.target;
    avatar.tile = { ...reached };
    avatar.target = avatar.path.shift() ?? null;
  }
  const airborne = avatar.airborneUntil > atMillis;
  if (airborne) {
    if (avatar.pressed) {
      game.release({ ...avatar.pressed, pressed: false, atMillis });
      avatar.pressed = null;
    }
    return;
  }
  avatar.airborneUntil = 0;
  if (avatar.pressed && !samePoint(avatar.pressed, avatar.tile)) {
    game.release({ ...avatar.pressed, pressed: false, atMillis });
    avatar.pressed = null;
  }
  if (!avatar.pressed) {
    game.press({ ...avatar.tile, pressed: true, atMillis });
    avatar.pressed = { ...avatar.tile };
  }
}

function inBounds(point: Point): boolean {
  return Number.isInteger(point.x)
    && Number.isInteger(point.y)
    && point.x >= 0
    && point.x < FLOOR_COLS
    && point.y >= 0
    && point.y < FLOOR_ROWS;
}

function manhattan(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}
