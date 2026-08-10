import assert from "node:assert/strict";
import test from "node:test";
import {
  composeGridCosts,
  createGrid,
  createReservationBook,
  createReservationCostProvider,
  findPath,
  gridPoint,
  gridPointKey,
  reservationOccupiesPoint,
  withDynamicTileCosts
} from "../src/index.ts";

test("grid validates bounds and combines fixed and dynamic tile costs", () => {
  const grid = createGrid({
    width: 3,
    height: 2,
    blocked: [gridPoint(2, 1)],
    tileCosts: [{ point: gridPoint(1, 0), cost: 2 }],
    dynamicTileCosts: [({ point, atMillis }) => point.x === 1 ? atMillis / 100 : 0]
  });
  const context = {
    grid,
    from: gridPoint(0, 0),
    point: gridPoint(1, 0),
    step: 1,
    atMillis: 200
  };
  assert.equal(grid.tileCost(context), 5);
  assert.equal(grid.isInside(gridPoint(2, 1)), true);
  assert.equal(grid.isBlocked(gridPoint(2, 1)), true);
  assert.deepEqual(grid.neighbors(gridPoint(0, 0)), [gridPoint(1, 0), gridPoint(0, 1)]);
  assert.throws(() => createGrid({ width: 0, height: 2 }), /width/);
  assert.throws(
    () => createGrid({ width: 2, height: 2, tileCosts: [{ point: gridPoint(0, 0), cost: -1 }] }),
    /non-negative/
  );
});

test("A* resolves equal-cost routes with stable row-column tie-breaking", () => {
  const grid = createGrid({ width: 3, height: 3 });
  const expected = [
    gridPoint(0, 0), gridPoint(1, 0), gridPoint(2, 0), gridPoint(2, 1), gridPoint(2, 2)
  ];
  const first = findPath(grid, gridPoint(0, 0), gridPoint(2, 2));
  const second = findPath(grid, gridPoint(0, 0), gridPoint(2, 2));
  assert.equal(first.reached, true);
  assert.deepEqual(first.path, expected);
  assert.deepEqual(second, first);
  assert.equal(first.cost, 4);
  assert.equal(first.arrivalMillis, 400);
});

test("A* evaluates time, crowding, reservation, and composed costs at arrival", () => {
  const base = createGrid({ width: 3, height: 2 });
  const dynamic = withDynamicTileCosts(base, [({ point }) => point.x === 1 && point.y === 0 ? 5 : 0]);
  const costs = composeGridCosts(
    ({ point, atMillis }) => point.x === 2 && point.y === 0 && atMillis < 350 ? 5 : 0,
    ({ point }) => point.x === 1 && point.y === 0 ? 2 : 0
  );
  const result = findPath(dynamic, gridPoint(0, 0), gridPoint(2, 0), {
    atMillis: 0,
    stepMillis: 100,
    crowdingCost: costs
  });
  assert.deepEqual(result.path, [
    gridPoint(0, 0), gridPoint(0, 1), gridPoint(1, 1), gridPoint(2, 1), gridPoint(2, 0)
  ]);
});

test("A* handles blocked goals, unreachable paths, limits, and diagonal corner safety", () => {
  const blockedGoal = createGrid({ width: 2, height: 2, blocked: [gridPoint(1, 1)] });
  assert.equal(findPath(blockedGoal, gridPoint(0, 0), gridPoint(1, 1)).reason, "invalid-goal");
  assert.equal(findPath(blockedGoal, gridPoint(-1, 0), gridPoint(0, 0)).reason, "invalid-start");

  const wall = createGrid({ width: 3, height: 3, blocked: [gridPoint(1, 0), gridPoint(1, 1), gridPoint(1, 2)] });
  assert.equal(findPath(wall, gridPoint(0, 1), gridPoint(2, 1)).reason, "unreachable");
  assert.equal(findPath(createGrid({ width: 8, height: 8 }), gridPoint(0, 0), gridPoint(7, 7), {
    maxIterations: 1
  }).reason, "iteration-limit");

  const corner = createGrid({ width: 2, height: 2, blocked: [gridPoint(1, 0), gridPoint(0, 1)] });
  assert.equal(findPath(corner, gridPoint(0, 0), gridPoint(1, 1), { allowDiagonal: true }).reached, false);
});

test("objective reservations conflict until their deterministic expiry", () => {
  const book = createReservationBook();
  const first = book.reserveObjective("a", "gem", 100, 200);
  const blocked = book.reserveObjective("b", "gem", 150, 200);
  assert.equal(first.ok, true);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.conflict?.ownerId, "a");
  assert.equal(book.objectiveOwner("gem", 299), "a");
  assert.equal(book.objectiveOwner("gem", 300), undefined);
  assert.equal(book.reserveObjective("b", "gem", 300, 50).ok, true);
  assert.throws(() => book.reserveObjective("a", "x", 0, 0), /positive/);
});

test("destination and corridor reservations expose spatial and timed occupancy", () => {
  const book = createReservationBook();
  const corridor = book.reserveCorridor(
    "a",
    [gridPoint(1, 0), gridPoint(2, 0)],
    0,
    500,
    { stepMillis: 100 }
  );
  assert.equal(corridor.ok, true);
  const reservation = corridor.reservation;
  assert.ok(reservation?.kind === "corridor");
  assert.equal(reservationOccupiesPoint(reservation, gridPoint(1, 0), 99), true);
  assert.equal(reservationOccupiesPoint(reservation, gridPoint(1, 0), 100), false);
  assert.equal(reservationOccupiesPoint(reservation, gridPoint(2, 0), 100), true);
  assert.equal(book.reserveDestination("b", gridPoint(2, 0), 10, 100).ok, false);
  assert.equal(book.reserveDestination("a", gridPoint(2, 0), 10, 100).ok, true);
  assert.equal(book.releaseOwner("a"), 2);
  assert.deepEqual(book.reservations(20), []);
});

test("reservation cost providers divert paths while ignoring the owner", () => {
  const grid = createGrid({ width: 3, height: 2 });
  const book = createReservationBook();
  book.reserveDestination("occupant", gridPoint(1, 0), 0, 1_000);
  const diverted = findPath(grid, gridPoint(0, 0), gridPoint(2, 0), {
    reservationCost: createReservationCostProvider(book, { ownerId: "walker", hard: true })
  });
  assert.deepEqual(diverted.path, [
    gridPoint(0, 0), gridPoint(0, 1), gridPoint(1, 1), gridPoint(2, 1), gridPoint(2, 0)
  ]);
  assert.equal(book.costAt(gridPoint(1, 0), 100, { ownerId: "occupant", hard: true }), 0);
  assert.equal(gridPointKey(gridPoint(1, 0)), "1,0");
});

test("future reservation cost probes do not destroy earlier timeline queries", () => {
  const book = createReservationBook();
  book.reserveDestination("occupant", gridPoint(1, 0), 100, 200);
  assert.equal(book.costAt(gridPoint(1, 0), 350, { hard: true }), 0);
  assert.equal(book.costAt(gridPoint(1, 0), 150, { hard: true }), Number.POSITIVE_INFINITY);
  assert.equal(book.reservations(350).length, 0);
  assert.equal(book.reservations(150).length, 1);
  assert.equal(book.prune(300), 1, "only an explicit authoritative prune mutates the book");
  assert.equal(book.reservations(150).length, 0);
});
