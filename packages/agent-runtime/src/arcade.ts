import {
  AGENT_CONTRACT_VERSION,
  createAgentAction,
  type AgentAction,
  type AgentBrain,
  type AgentEntity,
  type AgentIntention,
  type AgentVector,
  type GridPoint
} from "./contracts.ts";
import { euclideanDistance } from "./grid.ts";

export type PongBall = Readonly<{
  position: AgentVector;
  velocity: AgentVector;
}>;

export type PongWorld = Readonly<{
  ball: PongBall;
  paddleX: number;
  minY: number;
  maxY: number;
}>;

export type PongPrediction = Readonly<{
  y: number;
  timeMillis: number;
  reachable: boolean;
}>;

export type PongBrainState = Readonly<{
  predictedY: number;
  plannedAtMillis: number;
}>;

export function predictPongIntercept(ball: PongBall, paddleX: number, minY: number, maxY: number): PongPrediction {
  if (maxY <= minY) {
    throw new Error("Pong bounds require maxY > minY");
  }
  const deltaX = paddleX - ball.position.x;
  if (ball.velocity.x === 0 || deltaX / ball.velocity.x < 0) {
    return Object.freeze({ y: ball.position.y, timeMillis: 0, reachable: false });
  }
  const timeSeconds = deltaX / ball.velocity.x;
  const rawY = ball.position.y + ball.velocity.y * timeSeconds;
  return Object.freeze({
    y: reflectBetween(rawY, minY, maxY),
    timeMillis: timeSeconds * 1_000,
    reachable: true
  });
}

export function createPongController(id = "arcade-pong"): AgentBrain<PongWorld, PongBrainState> {
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id,
    initialState(_definition, observation): PongBrainState {
      return Object.freeze({ predictedY: observation.position.y, plannedAtMillis: observation.nowMillis });
    },
    decide(context) {
      const prediction = predictPongIntercept(
        context.observation.world.ball,
        context.observation.world.paddleX,
        context.observation.world.minY,
        context.observation.world.maxY
      );
      const strength = context.profile.parameters.prediction;
      const desiredY = prediction.reachable
        ? context.observation.world.ball.position.y * (1 - strength) + prediction.y * strength
        : context.observation.world.ball.position.y;
      const target = Object.freeze({ x: Math.round(context.observation.world.paddleX), y: Math.round(desiredY) });
      const action = createAgentAction({
        actorId: context.definition.id,
        kind: "move",
        atMillis: context.observation.nowMillis,
        target,
        payload: Object.freeze({ interceptMillis: prediction.timeMillis, reachable: prediction.reachable }),
        explanation: prediction.reachable ? "Tracking predicted ball intercept" : "Tracking current ball position"
      });
      return Object.freeze({
        state: Object.freeze({ predictedY: desiredY, plannedAtMillis: context.observation.nowMillis }),
        action,
        intention: Object.freeze({
          id: "pong:intercept",
          label: "Intercept the ball",
          selectedAtMillis: context.observation.nowMillis,
          target
        }),
        explanation: action.explanation ?? "Tracking ball"
      });
    }
  });
}

export type TetrisBoard = readonly (readonly number[])[];

export type TetrisPiece = Readonly<{
  id: string;
  rotations: readonly (readonly GridPoint[])[];
}>;

export type TetrisWeights = Readonly<{
  lines: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
}>;

export type TetrisMetrics = Readonly<{
  linesCleared: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
}>;

export type TetrisPlacement = Readonly<{
  pieceId: string;
  rotationIndex: number;
  x: number;
  y: number;
  score: number;
  metrics: TetrisMetrics;
  cells: readonly GridPoint[];
}>;

export const BALANCED_TETRIS_WEIGHTS: TetrisWeights = Object.freeze({
  lines: 0.76,
  aggregateHeight: -0.51,
  holes: -0.86,
  bumpiness: -0.18
});

export function chooseTetrisPlacement(
  board: TetrisBoard,
  piece: TetrisPiece,
  weights: TetrisWeights = BALANCED_TETRIS_WEIGHTS
): TetrisPlacement | undefined {
  const { width, height } = validateBoard(board);
  const candidates: TetrisPlacement[] = [];
  piece.rotations.forEach((declaredRotation, rotationIndex) => {
    const rotation = normalizeRotation(declaredRotation);
    const pieceWidth = Math.max(...rotation.map((point) => point.x)) + 1;
    for (let x = 0; x <= width - pieceWidth; x += 1) {
      let y = 0;
      if (!canPlace(board, rotation, x, y)) {
        continue;
      }
      while (y + 1 < height && canPlace(board, rotation, x, y + 1)) {
        y += 1;
      }
      const simulated = board.map((row) => [...row]);
      const cells = rotation.map((point) => Object.freeze({ x: x + point.x, y: y + point.y }));
      for (const cell of cells) {
        (simulated[cell.y] as number[])[cell.x] = 1;
      }
      const cleared = simulated.filter((row) => row.every((cell) => cell !== 0)).length;
      const remaining = simulated.filter((row) => row.some((cell) => cell === 0));
      while (remaining.length < height) {
        remaining.unshift(Array.from({ length: width }, () => 0));
      }
      const metrics = measureTetrisBoard(remaining, cleared);
      const score = metrics.linesCleared * weights.lines
        + metrics.aggregateHeight * weights.aggregateHeight
        + metrics.holes * weights.holes
        + metrics.bumpiness * weights.bumpiness;
      candidates.push(Object.freeze({
        pieceId: piece.id,
        rotationIndex,
        x,
        y,
        score,
        metrics,
        cells: Object.freeze(cells)
      }));
    }
  });
  return candidates.sort((first, second) =>
    second.score - first.score
      || second.metrics.linesCleared - first.metrics.linesCleared
      || first.rotationIndex - second.rotationIndex
      || first.x - second.x
  )[0];
}

export class TetrisController {
  readonly #weights: TetrisWeights;

  public constructor(weights: TetrisWeights = BALANCED_TETRIS_WEIGHTS) {
    this.#weights = Object.freeze({ ...weights });
  }

  public choose(board: TetrisBoard, piece: TetrisPiece): TetrisPlacement | undefined {
    return chooseTetrisPlacement(board, piece, this.#weights);
  }
}

export function createTetrisController(weights?: TetrisWeights): TetrisController {
  return new TetrisController(weights);
}

export type SpaceBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

export type SpaceManeuver = Readonly<{
  moveTarget: GridPoint;
  aimTarget?: GridPoint;
  targetId?: string;
  fire: boolean;
  threatId?: string;
  explanation: string;
}>;

export type SpaceWorld = Readonly<{
  bounds: SpaceBounds;
  threats: readonly AgentEntity[];
  targets: readonly AgentEntity[];
}>;

export type SpaceBrainState = Readonly<{
  threatId?: string;
  targetId?: string;
  plannedAtMillis: number;
}>;

export function chooseSpaceManeuver(
  position: GridPoint,
  world: SpaceWorld,
  caution: number
): SpaceManeuver {
  const threat = [...world.threats].sort((first, second) =>
    projectedThreatDistance(position, first) - projectedThreatDistance(position, second)
      || first.id.localeCompare(second.id)
  )[0];
  const target = [...world.targets].sort((first, second) =>
    euclideanDistance(position, first.position) - euclideanDistance(position, second.position)
      || first.id.localeCompare(second.id)
  )[0];
  let moveTarget = position;
  let explanation = "Holding a clear firing line";
  if (threat !== undefined) {
    const deltaX = position.x - threat.position.x;
    const deltaY = position.y - threat.position.y;
    const dodgeScale = 1 + Math.round(clamp01(caution) * 2);
    const dodgeX = Math.abs(deltaX) >= Math.abs(deltaY) ? Math.sign(deltaX || 1) * dodgeScale : 0;
    const dodgeY = Math.abs(deltaY) > Math.abs(deltaX) ? Math.sign(deltaY || 1) * dodgeScale : 0;
    moveTarget = {
      x: Math.round(clamp(position.x + dodgeX, world.bounds.minX, world.bounds.maxX)),
      y: Math.round(clamp(position.y + dodgeY, world.bounds.minY, world.bounds.maxY))
    };
    explanation = `Dodging threat ${threat.id}`;
  }
  return Object.freeze({
    moveTarget: Object.freeze(moveTarget),
    aimTarget: target?.position,
    targetId: target?.id,
    fire: target !== undefined,
    threatId: threat?.id,
    explanation
  });
}

export function createSpaceController(id = "arcade-space"): AgentBrain<SpaceWorld, SpaceBrainState> {
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id,
    initialState(): SpaceBrainState {
      return Object.freeze({ plannedAtMillis: 0 });
    },
    decide(context) {
      const maneuver = chooseSpaceManeuver(
        context.observation.position,
        context.observation.world,
        context.profile.parameters.caution
      );
      const action = createAgentAction({
        actorId: context.definition.id,
        kind: "move",
        atMillis: context.observation.nowMillis,
        target: maneuver.moveTarget,
        targetId: maneuver.targetId,
        payload: Object.freeze({ aimTarget: maneuver.aimTarget, fire: maneuver.fire, threatId: maneuver.threatId }),
        explanation: maneuver.explanation
      });
      return Object.freeze({
        state: Object.freeze({
          threatId: maneuver.threatId,
          targetId: maneuver.targetId,
          plannedAtMillis: context.observation.nowMillis
        }),
        action,
        intention: Object.freeze({
          id: maneuver.threatId === undefined ? "space:attack" : `space:dodge:${maneuver.threatId}`,
          label: maneuver.explanation,
          selectedAtMillis: context.observation.nowMillis,
          targetId: maneuver.targetId,
          target: maneuver.moveTarget
        }),
        explanation: maneuver.explanation
      });
    }
  });
}

export type ChoreographyStep = Readonly<{
  id: string;
  atMillis: number;
  durationMillis: number;
  kind: AgentAction["kind"];
  from?: GridPoint;
  target?: GridPoint;
  targetId?: string;
  payload?: Readonly<Record<string, unknown>>;
  easing?: "linear" | "step";
}>;

export type ChoreographyOptions = Readonly<{
  id?: string;
  loopMillis?: number;
}>;

export type ChoreographyState = Readonly<{
  elapsedMillis: number;
  activeStepId?: string;
}>;

export function evaluateChoreography(
  steps: readonly ChoreographyStep[],
  elapsedMillis: number,
  actorId: string,
  nowMillis: number,
  loopMillis?: number
): AgentAction {
  const localMillis = loopMillis === undefined
    ? Math.max(0, elapsedMillis)
    : positiveModulo(elapsedMillis, loopMillis);
  const active = [...steps]
    .filter((step) => step.atMillis <= localMillis && localMillis < step.atMillis + step.durationMillis)
    .sort((first, second) => second.atMillis - first.atMillis || first.id.localeCompare(second.id))[0];
  if (active === undefined) {
    return createAgentAction({ actorId, kind: "idle", atMillis: nowMillis, explanation: "Waiting for choreography cue" });
  }
  const progress = active.durationMillis <= 0 ? 1 : clamp01((localMillis - active.atMillis) / active.durationMillis);
  const target = active.from === undefined || active.target === undefined || active.easing === "step"
    ? active.target
    : Object.freeze({
        x: Math.round(active.from.x + (active.target.x - active.from.x) * progress),
        y: Math.round(active.from.y + (active.target.y - active.from.y) * progress)
      });
  return createAgentAction({
    actorId,
    kind: active.kind,
    atMillis: nowMillis,
    durationMillis: active.durationMillis,
    target,
    targetId: active.targetId,
    payload: active.payload,
    explanation: `Scripted cue ${active.id}`
  });
}

export function createScriptedChoreographyController(
  steps: readonly ChoreographyStep[],
  options: ChoreographyOptions = {}
): AgentBrain<unknown, ChoreographyState> {
  const sorted = Object.freeze([...steps].sort((first, second) =>
    first.atMillis - second.atMillis || first.id.localeCompare(second.id)
  ));
  const id = options.id ?? "scripted-choreography";
  return Object.freeze({
    version: AGENT_CONTRACT_VERSION,
    id,
    initialState(): ChoreographyState {
      return Object.freeze({ elapsedMillis: 0 });
    },
    decide(context) {
      const elapsedMillis = context.observation.nowMillis;
      const action = evaluateChoreography(
        sorted,
        elapsedMillis,
        context.definition.id,
        context.observation.nowMillis,
        options.loopMillis
      );
      const activeStepId = action.explanation?.startsWith("Scripted cue ")
        ? action.explanation.slice("Scripted cue ".length)
        : undefined;
      const intention: AgentIntention = Object.freeze({
        id: activeStepId === undefined ? "choreography:wait" : `choreography:${activeStepId}`,
        label: action.explanation ?? "Scripted choreography",
        selectedAtMillis: context.observation.nowMillis,
        target: action.target,
        targetId: action.targetId
      });
      return Object.freeze({
        state: Object.freeze({ elapsedMillis, activeStepId }),
        action,
        intention,
        explanation: action.explanation ?? "Scripted choreography"
      });
    }
  });
}

function reflectBetween(value: number, minimum: number, maximum: number): number {
  const range = maximum - minimum;
  const period = range * 2;
  const offset = positiveModulo(value - minimum, period);
  return minimum + (offset <= range ? offset : period - offset);
}

function validateBoard(board: TetrisBoard): Readonly<{ width: number; height: number }> {
  if (board.length === 0 || board[0]?.length === 0) {
    throw new Error("Tetris board must not be empty");
  }
  const width = (board[0] as readonly number[]).length;
  if (board.some((row) => row.length !== width)) {
    throw new Error("Tetris board rows must have equal width");
  }
  return Object.freeze({ width, height: board.length });
}

function normalizeRotation(rotation: readonly GridPoint[]): readonly GridPoint[] {
  if (rotation.length === 0) {
    throw new Error("Tetris rotations must contain at least one cell");
  }
  const minX = Math.min(...rotation.map((point) => point.x));
  const minY = Math.min(...rotation.map((point) => point.y));
  return Object.freeze(rotation.map((point) => Object.freeze({ x: point.x - minX, y: point.y - minY })));
}

function canPlace(board: TetrisBoard, rotation: readonly GridPoint[], x: number, y: number): boolean {
  return rotation.every((point) => {
    const boardX = x + point.x;
    const boardY = y + point.y;
    return boardY >= 0
      && boardY < board.length
      && boardX >= 0
      && boardX < (board[0]?.length ?? 0)
      && board[boardY]?.[boardX] === 0;
  });
}

function measureTetrisBoard(board: TetrisBoard, linesCleared: number): TetrisMetrics {
  const width = board[0]?.length ?? 0;
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < width; x += 1) {
    const firstFilled = board.findIndex((row) => row[x] !== 0);
    const height = firstFilled < 0 ? 0 : board.length - firstFilled;
    heights.push(height);
    if (firstFilled >= 0) {
      for (let y = firstFilled + 1; y < board.length; y += 1) {
        if (board[y]?.[x] === 0) {
          holes += 1;
        }
      }
    }
  }
  const bumpiness = heights.slice(1).reduce(
    (total, height, index) => total + Math.abs(height - (heights[index] ?? 0)),
    0
  );
  return Object.freeze({
    linesCleared,
    aggregateHeight: heights.reduce((total, height) => total + height, 0),
    holes,
    bumpiness
  });
}

function projectedThreatDistance(position: GridPoint, threat: AgentEntity): number {
  const future = threat.velocity === undefined
    ? threat.position
    : { x: threat.position.x + threat.velocity.x * 0.5, y: threat.position.y + threat.velocity.y * 0.5 };
  return euclideanDistance(position, future);
}

function positiveModulo(value: number, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error("Loop duration must be positive");
  }
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
