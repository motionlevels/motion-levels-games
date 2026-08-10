import type { AgentProfile } from "./profiles.ts";

export const AGENT_CONTRACT_VERSION = 1 as const;

export type AgentContractVersion = typeof AGENT_CONTRACT_VERSION;

export type GridPoint = Readonly<{
  x: number;
  y: number;
}>;

export type AgentVector = Readonly<{
  x: number;
  y: number;
}>;

export type AgentEntity = Readonly<{
  id: string;
  kind: string;
  position: GridPoint;
  velocity?: AgentVector;
  teamId?: string;
  attributes?: Readonly<Record<string, unknown>>;
}>;

export type AgentObjective = Readonly<{
  id: string;
  position: GridPoint;
  value: number;
  kind?: string;
  claimedBy?: string;
  expiresAtMillis?: number;
  attributes?: Readonly<Record<string, unknown>>;
}>;

export type AgentHazard = Readonly<{
  id: string;
  position: GridPoint;
  /** Simulation time at which position was observed; defaults to zero. */
  positionAtMillis?: number;
  radius: number;
  severity: number;
  activeFromMillis?: number;
  activeUntilMillis?: number;
  velocity?: AgentVector;
}>;

export type AgentSignal = Readonly<{
  fromAgentId: string;
  kind: string;
  atMillis: number;
  payload?: Readonly<Record<string, unknown>>;
}>;

/** A complete, replayable view of the information available to one agent. */
export type AgentObservation<TWorld = unknown> = Readonly<{
  version: AgentContractVersion;
  agentId: string;
  tick: number;
  nowMillis: number;
  position: GridPoint;
  velocity?: AgentVector;
  entities: readonly AgentEntity[];
  objectives: readonly AgentObjective[];
  hazards: readonly AgentHazard[];
  signals?: readonly AgentSignal[];
  world: TWorld;
}>;

export type AgentActionKind = "idle" | "move" | "interact" | "ability" | "signal";

/** Actions are data only, so they can cross worker and replay boundaries. */
export type AgentAction<TPayload = Readonly<Record<string, unknown>>> = Readonly<{
  version: AgentContractVersion;
  actorId: string;
  kind: AgentActionKind;
  atMillis: number;
  target?: GridPoint;
  targetId?: string;
  durationMillis?: number;
  payload?: TPayload;
  explanation?: string;
}>;

export type AgentDefinition = Readonly<{
  version: AgentContractVersion;
  id: string;
  brainId: string;
  profileId: string;
  teamId?: string;
  role?: string;
  tags?: readonly string[];
  config?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type AgentIntention = Readonly<{
  id: string;
  label: string;
  selectedAtMillis: number;
  targetId?: string;
  target?: GridPoint;
  expiresAtMillis?: number;
  utility?: number;
}>;

export type AgentDecision<TState> = Readonly<{
  state: TState;
  action?: AgentAction;
  intention?: AgentIntention;
  explanation: string;
  reconsiderAtMillis?: number;
}>;

export type RandomSource = {
  next(): number;
  int(maxExclusive: number): number;
  chance(probability: number): boolean;
  readonly state: number;
};

export type AgentBrainContext<TWorld, TState, TServices = undefined> = Readonly<{
  definition: AgentDefinition;
  observation: AgentObservation<TWorld>;
  profile: AgentProfile;
  state: TState;
  previousIntention?: AgentIntention;
  replanReason?: AgentReplanReason;
  random: RandomSource;
  services: TServices;
}>;

export type AgentBrain<TWorld, TState, TServices = undefined> = Readonly<{
  version: AgentContractVersion;
  id: string;
  initialState(definition: AgentDefinition, observation: AgentObservation<TWorld>): TState;
  decide(context: AgentBrainContext<TWorld, TState, TServices>): AgentDecision<TState>;
}>;

export type AgentReplanReason =
  | "initial"
  | "interval"
  | "intention-expired"
  | "stuck"
  | "forced";

export type AgentStuckDetectorSnapshot = Readonly<{
  windowMillis: number;
  distanceThreshold: number;
  samples: readonly Readonly<{
    atMillis: number;
    position: GridPoint;
  }>[];
  wasStuck: boolean;
  lastMillis: number | null;
}>;

export type AgentSnapshot<TState = unknown> = Readonly<{
  version: AgentContractVersion;
  definitionId: string;
  brainId: string;
  tick: number;
  sequence: number;
  atMillis: number;
  position: GridPoint;
  brainState: TState;
  randomState: number;
  intention?: AgentIntention;
  lastAction?: AgentAction;
  pendingAction?: AgentAction;
  pendingIntention?: AgentIntention;
  pendingActionAtMillis?: number;
  nextPlanAtMillis: number;
  forceReplan: boolean;
  stuckDetector: AgentStuckDetectorSnapshot;
  replans: number;
}>;

export function createAgentAction(
  action: Omit<AgentAction, "version">
): AgentAction {
  return immutableAgentData({ version: AGENT_CONTRACT_VERSION, ...action });
}

export function createAgentObservation<TWorld>(
  observation: Omit<AgentObservation<TWorld>, "version">
): AgentObservation<TWorld> {
  return immutableAgentData({ version: AGENT_CONTRACT_VERSION, ...observation });
}

export function createAgentDefinition(
  definition: Omit<AgentDefinition, "version">
): AgentDefinition {
  if (definition.id.length === 0 || definition.brainId.length === 0 || definition.profileId.length === 0) {
    throw new Error("Agent definition ids must not be empty");
  }
  return immutableAgentData({ version: AGENT_CONTRACT_VERSION, ...definition });
}

export function createAgentSnapshot<TState>(
  snapshot: Omit<AgentSnapshot<TState>, "version">
): AgentSnapshot<TState> {
  return immutableAgentData({ version: AGENT_CONTRACT_VERSION, ...snapshot });
}

export function assertAgentContractVersion(
  contract: Readonly<{ version: number }>
): asserts contract is Readonly<{ version: AgentContractVersion }> {
  if (contract.version !== AGENT_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported agent contract version ${contract.version}; expected ${AGENT_CONTRACT_VERSION}`
    );
  }
}

export function gridPoint(x: number, y: number): GridPoint {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("Grid points require integer coordinates");
  }
  return Object.freeze({ x, y });
}

/**
 * Defensively copies and recursively freezes structured contract data.
 * Functions and class instances are opaque services and retain identity;
 * arrays, plain records, maps, sets, dates, and regular expressions are copied.
 */
export function immutableAgentData<T>(value: T): T {
  return immutableCopy(value, new WeakMap<object, unknown>());
}

function immutableCopy<T>(value: T, seen: WeakMap<object, unknown>): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  if (typeof value === "function") {
    return value;
  }
  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) {
    return existing as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(object, copy);
    for (const entry of value) copy.push(immutableCopy(entry, seen));
    return Object.freeze(copy) as T;
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    const readonly = readonlyCollectionProxy(copy, ["clear", "delete", "set"]);
    seen.set(object, readonly);
    for (const [key, entry] of value) {
      copy.set(immutableCopy(key, seen), immutableCopy(entry, seen));
    }
    Object.freeze(copy);
    return readonly as T;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    const readonly = readonlyCollectionProxy(copy, ["add", "clear", "delete"]);
    seen.set(object, readonly);
    for (const entry of value) copy.add(immutableCopy(entry, seen));
    Object.freeze(copy);
    return readonly as T;
  }
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    seen.set(object, copy);
    return Object.freeze(copy) as T;
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags);
    copy.lastIndex = value.lastIndex;
    seen.set(object, copy);
    return Object.freeze(copy) as T;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const copy = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(object, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if ("value" in descriptor) descriptor.value = immutableCopy(descriptor.value, seen);
    Object.defineProperty(copy, key, descriptor);
  }
  return Object.freeze(copy) as T;
}

function readonlyCollectionProxy<T extends Map<unknown, unknown> | Set<unknown>>(
  collection: T,
  mutators: readonly PropertyKey[]
): T {
  const blocked = new Set(mutators);
  const proxy = new Proxy(collection, {
    get(target, property) {
      if (blocked.has(property)) {
        return () => {
          throw new TypeError("Agent contract collections are immutable");
        };
      }
      const member = Reflect.get(target, property, target) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
    set() {
      throw new TypeError("Agent contract collections are immutable");
    },
    deleteProperty() {
      throw new TypeError("Agent contract collections are immutable");
    },
    defineProperty() {
      throw new TypeError("Agent contract collections are immutable");
    }
  });
  return proxy;
}
