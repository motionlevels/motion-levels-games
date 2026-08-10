import type { GridPoint } from "./contracts.ts";
import { gridPointKey, sameGridPoint, type GridCostProvider } from "./grid.ts";

type ReservationBase = Readonly<{
  id: string;
  ownerId: string;
  startsAtMillis: number;
  expiresAtMillis: number;
  priority: number;
}>;

export type ObjectiveReservation = ReservationBase & Readonly<{
  kind: "objective";
  objectiveId: string;
}>;

export type DestinationReservation = ReservationBase & Readonly<{
  kind: "destination";
  point: GridPoint;
}>;

export type CorridorReservation = ReservationBase & Readonly<{
  kind: "corridor";
  points: readonly GridPoint[];
  stepMillis?: number;
}>;

export type AgentReservation = ObjectiveReservation | DestinationReservation | CorridorReservation;

export type ReservationResult = Readonly<{
  ok: boolean;
  reservation?: AgentReservation;
  conflict?: AgentReservation;
}>;

export type ReservationOptions = Readonly<{
  priority?: number;
}>;

export type CorridorReservationOptions = ReservationOptions & Readonly<{
  stepMillis?: number;
}>;

export type ReservationCostOptions = Readonly<{
  ownerId?: string;
  cost?: number;
  hard?: boolean;
}>;

export class ReservationBook {
  readonly #reservations = new Map<string, AgentReservation>();
  #nextId = 1;

  public reserveObjective(
    ownerId: string,
    objectiveId: string,
    nowMillis: number,
    ttlMillis: number,
    options: ReservationOptions = {}
  ): ReservationResult {
    return this.#reserve({ kind: "objective", ownerId, objectiveId }, nowMillis, ttlMillis, options);
  }

  public reserveDestination(
    ownerId: string,
    point: GridPoint,
    nowMillis: number,
    ttlMillis: number,
    options: ReservationOptions = {}
  ): ReservationResult {
    return this.#reserve(
      { kind: "destination", ownerId, point: Object.freeze({ ...point }) },
      nowMillis,
      ttlMillis,
      options
    );
  }

  public reserveCorridor(
    ownerId: string,
    points: readonly GridPoint[],
    nowMillis: number,
    ttlMillis: number,
    options: CorridorReservationOptions = {}
  ): ReservationResult {
    if (points.length === 0) {
      throw new Error("A corridor reservation requires at least one point");
    }
    if (options.stepMillis !== undefined && (!Number.isFinite(options.stepMillis) || options.stepMillis <= 0)) {
      throw new Error("Corridor stepMillis must be positive when provided");
    }
    return this.#reserve(
      {
        kind: "corridor",
        ownerId,
        points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
        stepMillis: options.stepMillis
      },
      nowMillis,
      ttlMillis,
      options
    );
  }

  public release(reservationId: string): boolean {
    return this.#reservations.delete(reservationId);
  }

  public releaseOwner(ownerId: string): number {
    let released = 0;
    for (const reservation of this.#reservations.values()) {
      if (reservation.ownerId === ownerId && this.#reservations.delete(reservation.id)) {
        released += 1;
      }
    }
    return released;
  }

  public prune(nowMillis: number): number {
    validateTime(nowMillis, "nowMillis");
    let pruned = 0;
    for (const reservation of this.#reservations.values()) {
      if (reservation.expiresAtMillis <= nowMillis && this.#reservations.delete(reservation.id)) {
        pruned += 1;
      }
    }
    return pruned;
  }

  public reservations(nowMillis: number): readonly AgentReservation[] {
    validateTime(nowMillis, "nowMillis");
    return Object.freeze([...this.#reservations.values()]
      .filter((reservation) => reservation.startsAtMillis <= nowMillis && reservation.expiresAtMillis > nowMillis)
      .sort(compareReservations));
  }

  public objectiveOwner(objectiveId: string, nowMillis: number): string | undefined {
    return this.reservations(nowMillis).find(
      (reservation): reservation is ObjectiveReservation =>
        reservation.kind === "objective" && reservation.objectiveId === objectiveId
    )?.ownerId;
  }

  public pointReservations(point: GridPoint, atMillis: number): readonly AgentReservation[] {
    return Object.freeze(this.reservations(atMillis).filter((reservation) =>
      reservationOccupiesPoint(reservation, point, atMillis)
    ));
  }

  public costAt(point: GridPoint, atMillis: number, options: ReservationCostOptions = {}): number {
    const occupied = this.pointReservations(point, atMillis).some(
      (reservation) => reservation.ownerId !== options.ownerId
    );
    if (!occupied) {
      return 0;
    }
    if (options.hard ?? false) {
      return Number.POSITIVE_INFINITY;
    }
    const cost = options.cost ?? 8;
    if (Number.isNaN(cost) || cost < 0) {
      throw new Error("Reservation cost must be non-negative");
    }
    return cost;
  }

  #reserve(
    request:
      | Readonly<{ kind: "objective"; ownerId: string; objectiveId: string }>
      | Readonly<{ kind: "destination"; ownerId: string; point: GridPoint }>
      | Readonly<{
          kind: "corridor";
          ownerId: string;
          points: readonly GridPoint[];
          stepMillis?: number;
        }>,
    nowMillis: number,
    ttlMillis: number,
    options: ReservationOptions
  ): ReservationResult {
    validateOwner(request.ownerId);
    validateTime(nowMillis, "nowMillis");
    if (!Number.isFinite(ttlMillis) || ttlMillis <= 0) {
      throw new Error("Reservation ttlMillis must be positive");
    }
    this.prune(nowMillis);
    const priority = Number.isFinite(options.priority) ? (options.priority ?? 0) : 0;
    const candidate = Object.freeze({
      ...request,
      id: `${request.ownerId}:${request.kind}:${this.#nextId}`,
      startsAtMillis: nowMillis,
      expiresAtMillis: nowMillis + ttlMillis,
      priority
    }) as AgentReservation;
    const conflict = [...this.#reservations.values()]
      .filter((reservation) => reservation.ownerId !== request.ownerId)
      .sort(compareReservations)
      .find((reservation) => reservationsConflict(candidate, reservation));
    if (conflict !== undefined) {
      return Object.freeze({ ok: false, conflict });
    }
    this.#nextId += 1;
    this.#reservations.set(candidate.id, candidate);
    return Object.freeze({ ok: true, reservation: candidate });
  }
}

export function createReservationBook(): ReservationBook {
  return new ReservationBook();
}

export function createReservationCostProvider(
  book: ReservationBook,
  options: ReservationCostOptions = {}
): GridCostProvider {
  return (context) => book.costAt(context.point, context.atMillis, options);
}

export function reservationOccupiesPoint(
  reservation: AgentReservation,
  point: GridPoint,
  atMillis: number
): boolean {
  if (atMillis < reservation.startsAtMillis || atMillis >= reservation.expiresAtMillis) {
    return false;
  }
  if (reservation.kind === "objective") {
    return false;
  }
  if (reservation.kind === "destination") {
    return sameGridPoint(reservation.point, point);
  }
  if (reservation.stepMillis === undefined) {
    return reservation.points.some((corridorPoint) => sameGridPoint(corridorPoint, point));
  }
  const index = Math.floor((atMillis - reservation.startsAtMillis) / reservation.stepMillis);
  const activePoint = reservation.points[index];
  return activePoint !== undefined && sameGridPoint(activePoint, point);
}

function reservationsConflict(first: AgentReservation, second: AgentReservation): boolean {
  if (first.kind === "objective" || second.kind === "objective") {
    return first.kind === "objective"
      && second.kind === "objective"
      && first.objectiveId === second.objectiveId;
  }
  const firstPoints = first.kind === "destination" ? [first.point] : first.points;
  const secondKeys = new Set(
    (second.kind === "destination" ? [second.point] : second.points).map(gridPointKey)
  );
  return firstPoints.some((point) => secondKeys.has(gridPointKey(point)));
}

function compareReservations(first: AgentReservation, second: AgentReservation): number {
  return second.priority - first.priority
    || first.expiresAtMillis - second.expiresAtMillis
    || first.id.localeCompare(second.id);
}

function validateTime(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function validateOwner(ownerId: string): void {
  if (ownerId.length === 0) {
    throw new Error("Reservation ownerId must not be empty");
  }
}
