import type { GridPoint } from "./contracts.ts";

export type GridCostContext = Readonly<{
  grid: AgentGrid;
  from: GridPoint;
  point: GridPoint;
  step: number;
  atMillis: number;
}>;

export type GridCostProvider = (context: GridCostContext) => number;

export type GridTileCost = Readonly<{
  point: GridPoint;
  cost: number;
}>;

export type AgentGrid = Readonly<{
  width: number;
  height: number;
  isInside(point: GridPoint): boolean;
  isBlocked(point: GridPoint): boolean;
  tileCost(context: GridCostContext): number;
  neighbors(point: GridPoint, allowDiagonal?: boolean): readonly GridPoint[];
}>;

export type CreateGridOptions = Readonly<{
  width: number;
  height: number;
  blocked?: readonly GridPoint[];
  tileCosts?: readonly GridTileCost[];
  dynamicTileCosts?: readonly GridCostProvider[];
  preventDiagonalCornerCutting?: boolean;
}>;

export type AStarOptions = Readonly<{
  atMillis?: number;
  stepMillis?: number;
  allowDiagonal?: boolean;
  maxIterations?: number;
  maxCost?: number;
  heuristic?: (point: GridPoint, goal: GridPoint) => number;
  timeCost?: GridCostProvider;
  crowdingCost?: GridCostProvider;
  reservationCost?: GridCostProvider;
  additionalCosts?: readonly GridCostProvider[];
}>;

export type PathResult = Readonly<{
  reached: boolean;
  path: readonly GridPoint[];
  cost: number;
  visited: number;
  arrivalMillis: number;
  reason: "reached" | "invalid-start" | "invalid-goal" | "unreachable" | "iteration-limit";
}>;

const ORTHOGONAL_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 })
]);

const DIAGONAL_OFFSETS = Object.freeze([
  Object.freeze({ x: -1, y: -1 }),
  Object.freeze({ x: 1, y: -1 }),
  Object.freeze({ x: -1, y: 1 }),
  Object.freeze({ x: 1, y: 1 })
]);

export function gridPointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

export function sameGridPoint(first: GridPoint, second: GridPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

export function manhattanDistance(first: GridPoint, second: GridPoint): number {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

export function euclideanDistance(first: GridPoint, second: GridPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function createGrid(options: CreateGridOptions): AgentGrid {
  if (!Number.isInteger(options.width) || options.width <= 0) {
    throw new Error("Grid width must be a positive integer");
  }
  if (!Number.isInteger(options.height) || options.height <= 0) {
    throw new Error("Grid height must be a positive integer");
  }

  const blocked = new Set((options.blocked ?? []).map(gridPointKey));
  const fixedCosts = new Map<string, number>();
  for (const entry of options.tileCosts ?? []) {
    validateNonNegativeCost(entry.cost, "fixed tile cost");
    fixedCosts.set(gridPointKey(entry.point), entry.cost);
  }
  const dynamicCosts = [...(options.dynamicTileCosts ?? [])];
  const preventCornerCutting = options.preventDiagonalCornerCutting ?? true;

  let grid: AgentGrid;
  const isInside = (point: GridPoint): boolean =>
    Number.isInteger(point.x)
      && Number.isInteger(point.y)
      && point.x >= 0
      && point.x < options.width
      && point.y >= 0
      && point.y < options.height;
  const isBlocked = (point: GridPoint): boolean => !isInside(point) || blocked.has(gridPointKey(point));

  grid = Object.freeze({
    width: options.width,
    height: options.height,
    isInside,
    isBlocked,
    tileCost(context: GridCostContext): number {
      if (isBlocked(context.point)) {
        return Number.POSITIVE_INFINITY;
      }
      let cost = 1 + (fixedCosts.get(gridPointKey(context.point)) ?? 0);
      for (const provider of dynamicCosts) {
        const extra = provider(context);
        validateNonNegativeCost(extra, "dynamic tile cost");
        cost += extra;
      }
      return cost;
    },
    neighbors(point: GridPoint, allowDiagonal = false): readonly GridPoint[] {
      const result: GridPoint[] = [];
      for (const offset of ORTHOGONAL_OFFSETS) {
        const candidate = Object.freeze({ x: point.x + offset.x, y: point.y + offset.y });
        if (!isBlocked(candidate)) {
          result.push(candidate);
        }
      }
      if (allowDiagonal) {
        for (const offset of DIAGONAL_OFFSETS) {
          const candidate = Object.freeze({ x: point.x + offset.x, y: point.y + offset.y });
          if (isBlocked(candidate)) {
            continue;
          }
          if (preventCornerCutting) {
            const horizontal = { x: point.x + offset.x, y: point.y };
            const vertical = { x: point.x, y: point.y + offset.y };
            if (isBlocked(horizontal) || isBlocked(vertical)) {
              continue;
            }
          }
          result.push(candidate);
        }
      }
      return result;
    }
  });

  return grid;
}

export function withDynamicTileCosts(
  grid: AgentGrid,
  dynamicTileCosts: readonly GridCostProvider[]
): AgentGrid {
  return Object.freeze({
    ...grid,
    tileCost(context: GridCostContext): number {
      let cost = grid.tileCost({ ...context, grid });
      for (const provider of dynamicTileCosts) {
        const extra = provider({ ...context, grid });
        validateNonNegativeCost(extra, "dynamic tile cost");
        cost += extra;
      }
      return cost;
    }
  });
}

export function composeGridCosts(...providers: readonly GridCostProvider[]): GridCostProvider {
  return (context) => providers.reduce((total, provider) => {
    const cost = provider(context);
    validateNonNegativeCost(cost, "composed grid cost");
    return total + cost;
  }, 0);
}

type SearchNode = {
  readonly point: GridPoint;
  readonly key: string;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly steps: number;
  readonly order: number;
  readonly parent?: SearchNode;
};

function compareSearchNodes(first: SearchNode, second: SearchNode): number {
  return first.f - second.f
    || first.h - second.h
    || first.g - second.g
    || first.point.y - second.point.y
    || first.point.x - second.point.x
    || first.order - second.order;
}

class SearchHeap {
  readonly #nodes: SearchNode[] = [];

  public get size(): number {
    return this.#nodes.length;
  }

  public push(node: SearchNode): void {
    this.#nodes.push(node);
    let index = this.#nodes.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentNode = this.#nodes[parent] as SearchNode;
      if (compareSearchNodes(parentNode, node) <= 0) {
        break;
      }
      this.#nodes[index] = parentNode;
      index = parent;
    }
    this.#nodes[index] = node;
  }

  public pop(): SearchNode | undefined {
    const root = this.#nodes[0];
    const tail = this.#nodes.pop();
    if (root === undefined || tail === undefined || this.#nodes.length === 0) {
      return root;
    }
    let index = 0;
    this.#nodes[0] = tail;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      const smallestNode = this.#nodes[smallest] as SearchNode;
      const leftNode = this.#nodes[left];
      const rightNode = this.#nodes[right];
      if (leftNode !== undefined && compareSearchNodes(leftNode, smallestNode) < 0) {
        smallest = left;
      }
      const candidateNode = this.#nodes[smallest] as SearchNode;
      if (rightNode !== undefined && compareSearchNodes(rightNode, candidateNode) < 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      const current = this.#nodes[index] as SearchNode;
      this.#nodes[index] = this.#nodes[smallest] as SearchNode;
      this.#nodes[smallest] = current;
      index = smallest;
    }
    return root;
  }
}

function defaultHeuristic(point: GridPoint, goal: GridPoint, diagonal: boolean): number {
  const deltaX = Math.abs(point.x - goal.x);
  const deltaY = Math.abs(point.y - goal.y);
  return diagonal
    ? Math.max(deltaX, deltaY) + (Math.SQRT2 - 1) * Math.min(deltaX, deltaY)
    : deltaX + deltaY;
}

function reconstructPath(node: SearchNode): readonly GridPoint[] {
  const reverse: GridPoint[] = [];
  let current: SearchNode | undefined = node;
  while (current !== undefined) {
    reverse.push(current.point);
    current = current.parent;
  }
  return Object.freeze(reverse.reverse());
}

function failedPath(
  reason: PathResult["reason"],
  visited: number,
  atMillis: number
): PathResult {
  return Object.freeze({
    reached: false,
    path: Object.freeze([]),
    cost: Number.POSITIVE_INFINITY,
    visited,
    arrivalMillis: atMillis,
    reason
  });
}

/** Deterministic A*: equal candidates are ordered by h, cost, row, column, then insertion. */
export function findPath(
  grid: AgentGrid,
  start: GridPoint,
  goal: GridPoint,
  options: AStarOptions = {}
): PathResult {
  const atMillis = options.atMillis ?? 0;
  const stepMillis = options.stepMillis ?? 100;
  if (!Number.isFinite(atMillis) || !Number.isFinite(stepMillis) || stepMillis < 0) {
    throw new Error("A* time values must be finite and stepMillis must be non-negative");
  }
  if (!grid.isInside(start) || grid.isBlocked(start)) {
    return failedPath("invalid-start", 0, atMillis);
  }
  if (!grid.isInside(goal) || grid.isBlocked(goal)) {
    return failedPath("invalid-goal", 0, atMillis);
  }
  if (sameGridPoint(start, goal)) {
    return Object.freeze({
      reached: true,
      path: Object.freeze([Object.freeze({ ...start })]),
      cost: 0,
      visited: 0,
      arrivalMillis: atMillis,
      reason: "reached"
    });
  }

  const allowDiagonal = options.allowDiagonal ?? false;
  const heuristic = options.heuristic
    ?? ((point: GridPoint, destination: GridPoint) => defaultHeuristic(point, destination, allowDiagonal));
  const maxIterations = options.maxIterations ?? grid.width * grid.height * 8;
  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;
  const extraCosts = [
    options.timeCost,
    options.crowdingCost,
    options.reservationCost,
    ...(options.additionalCosts ?? [])
  ].filter((provider): provider is GridCostProvider => provider !== undefined);

  const open = new SearchHeap();
  const bestCosts = new Map<string, number>();
  const startH = heuristic(start, goal);
  validateHeuristic(startH);
  let order = 0;
  open.push({
    point: Object.freeze({ ...start }),
    key: gridPointKey(start),
    g: 0,
    h: startH,
    f: startH,
    steps: 0,
    order,
    parent: undefined
  });
  bestCosts.set(gridPointKey(start), 0);

  let visited = 0;
  while (open.size > 0 && visited < maxIterations) {
    const current = open.pop() as SearchNode;
    if (current.g !== bestCosts.get(current.key)) {
      continue;
    }
    visited += 1;
    if (sameGridPoint(current.point, goal)) {
      return Object.freeze({
        reached: true,
        path: reconstructPath(current),
        cost: current.g,
        visited,
        arrivalMillis: atMillis + current.steps * stepMillis,
        reason: "reached"
      });
    }

    for (const point of grid.neighbors(current.point, allowDiagonal)) {
      const steps = current.steps + 1;
      const context: GridCostContext = Object.freeze({
        grid,
        from: current.point,
        point,
        step: steps,
        atMillis: atMillis + steps * stepMillis
      });
      let movementCost = grid.tileCost(context);
      if (point.x !== current.point.x && point.y !== current.point.y) {
        movementCost *= Math.SQRT2;
      }
      for (const provider of extraCosts) {
        const extra = provider(context);
        validateNonNegativeCost(extra, "A* additional cost");
        movementCost += extra;
      }
      const nextCost = current.g + movementCost;
      if (!Number.isFinite(nextCost) || nextCost > maxCost) {
        continue;
      }
      const key = gridPointKey(point);
      const knownCost = bestCosts.get(key);
      if (knownCost !== undefined && nextCost >= knownCost) {
        continue;
      }
      const h = heuristic(point, goal);
      validateHeuristic(h);
      bestCosts.set(key, nextCost);
      order += 1;
      open.push({
        point,
        key,
        g: nextCost,
        h,
        f: nextCost + h,
        steps,
        order,
        parent: current
      });
    }
  }

  return failedPath(open.size > 0 ? "iteration-limit" : "unreachable", visited, atMillis);
}

function validateNonNegativeCost(cost: number, label: string): void {
  if (Number.isNaN(cost) || cost < 0) {
    throw new Error(`${label} must be non-negative`);
  }
}

function validateHeuristic(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("A* heuristic must return a finite non-negative value");
  }
}
