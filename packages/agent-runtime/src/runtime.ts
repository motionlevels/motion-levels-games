import {
  assertAgentContractVersion,
  createAgentSnapshot,
  immutableAgentData,
  type AgentAction,
  type AgentBrain,
  type AgentDecision,
  type AgentDefinition,
  type AgentIntention,
  type AgentObservation,
  type AgentReplanReason,
  type AgentSnapshot
} from "./contracts.ts";
import { applyControlledMistake, StuckDetector } from "./behavior.ts";
import type { AgentProfile } from "./profiles.ts";
import { SeededRandom } from "./random.ts";

export type AgentRuntimeOptions<TWorld, TState, TServices = undefined> = Readonly<{
  definition: AgentDefinition;
  profile: AgentProfile;
  brain: AgentBrain<TWorld, TState, TServices>;
  seed: number;
  services?: TServices;
  gridBounds?: Readonly<{ width: number; height: number }>;
}>;

export type AgentStepResult<TState> = Readonly<{
  action?: AgentAction;
  intendedAction?: AgentAction;
  mistakeApplied: boolean;
  planned: boolean;
  replanReason?: AgentReplanReason;
  pendingUntilMillis?: number;
  snapshot: AgentSnapshot<TState>;
  explanation: string;
}>;

type PendingDecision<TState> = Readonly<{
  decision: AgentDecision<TState>;
  executeAtMillis: number;
}>;

/** Stateful deterministic scheduler around a pure decision brain. */
export class AgentRuntime<TWorld, TState, TServices = undefined> {
  readonly #definition: AgentDefinition;
  readonly #profile: AgentProfile;
  readonly #brain: AgentBrain<TWorld, TState, TServices>;
  readonly #services: TServices;
  readonly #random: SeededRandom;
  readonly #stuckDetector: StuckDetector;
  readonly #gridBounds?: Readonly<{ width: number; height: number }>;
  #state?: TState;
  #intention?: AgentIntention;
  #lastAction?: AgentAction;
  #pending?: PendingDecision<TState>;
  #nextPlanAtMillis = Number.NEGATIVE_INFINITY;
  #lastNowMillis = Number.NEGATIVE_INFINITY;
  #lastTick = -1;
  #sequence = 0;
  #replans = 0;
  #forceReplan = false;
  #lastSnapshot?: AgentSnapshot<TState>;

  public constructor(options: AgentRuntimeOptions<TWorld, TState, TServices>) {
    assertAgentContractVersion(options.definition);
    assertAgentContractVersion(options.brain);
    if (options.definition.brainId !== options.brain.id) {
      throw new Error(`Definition brain ${options.definition.brainId} does not match ${options.brain.id}`);
    }
    if (options.definition.profileId !== options.profile.id) {
      throw new Error(`Definition profile ${options.definition.profileId} does not match ${options.profile.id}`);
    }
    this.#definition = immutableAgentData(options.definition);
    this.#profile = options.profile;
    this.#brain = options.brain;
    this.#services = options.services as TServices;
    this.#random = new SeededRandom(options.seed);
    this.#gridBounds = options.gridBounds;
    this.#stuckDetector = new StuckDetector(
      options.profile.parameters.stuckWindowMillis,
      options.profile.parameters.stuckDistance
    );
  }

  public forceReplan(): void {
    this.#forceReplan = true;
    if (this.#lastSnapshot !== undefined) {
      this.#lastSnapshot = immutableAgentData({ ...this.#lastSnapshot, forceReplan: true });
    }
  }

  public snapshot(): AgentSnapshot<TState> {
    if (this.#lastSnapshot === undefined) {
      throw new Error("The runtime has no snapshot before its first observation");
    }
    return this.#lastSnapshot;
  }

  public restore(snapshot: AgentSnapshot<TState>): void {
    assertAgentContractVersion(snapshot);
    if (snapshot.definitionId !== this.#definition.id || snapshot.brainId !== this.#brain.id) {
      throw new Error("Snapshot belongs to a different agent or brain");
    }
    if (!Number.isFinite(snapshot.nextPlanAtMillis)) {
      throw new Error("Snapshot next plan time must be finite");
    }
    const restored = immutableAgentData(snapshot);
    this.#state = restored.brainState;
    this.#intention = restored.intention;
    this.#lastAction = restored.lastAction;
    this.#pending = restored.pendingAction === undefined || restored.pendingActionAtMillis === undefined
      ? undefined
      : Object.freeze({
          decision: Object.freeze({
            state: restored.brainState,
            action: restored.pendingAction,
            intention: restored.pendingIntention,
            explanation: "Restored pending decision"
          }),
          executeAtMillis: restored.pendingActionAtMillis
        });
    this.#random.restore(restored.randomState);
    this.#sequence = restored.sequence;
    this.#replans = restored.replans;
    this.#lastNowMillis = restored.atMillis;
    this.#lastTick = restored.tick;
    this.#nextPlanAtMillis = restored.nextPlanAtMillis;
    this.#forceReplan = restored.forceReplan;
    this.#stuckDetector.restore(restored.stuckDetector);
    this.#lastSnapshot = restored;
  }

  public step(observation: AgentObservation<TWorld>): AgentStepResult<TState> {
    assertAgentContractVersion(observation);
    if (observation.agentId !== this.#definition.id) {
      throw new Error(`Observation for ${observation.agentId} cannot drive ${this.#definition.id}`);
    }
    if (observation.nowMillis < this.#lastNowMillis || observation.tick <= this.#lastTick) {
      throw new Error("Agent observations must have increasing ticks and monotonic time");
    }

    this.#lastNowMillis = observation.nowMillis;
    this.#lastTick = observation.tick;
    let action: AgentAction | undefined;
    let intendedAction: AgentAction | undefined;
    let mistakeApplied = false;
    let planned = false;
    let replanReason: AgentReplanReason | undefined;
    const explanations: string[] = [];

    const matured = this.#executePending(observation.nowMillis);
    if (matured !== undefined) {
      ({ action, intendedAction, mistakeApplied } = matured);
      explanations.push(matured.explanation);
    }

    if (this.#state === undefined) {
      this.#state = immutableAgentData(this.#brain.initialState(this.#definition, observation));
      replanReason = "initial";
    } else {
      const stuck = this.#stuckDetector.update(
        observation.nowMillis,
        observation.position,
        this.#lastAction?.kind === "move"
      );
      if (stuck.newlyStuck) {
        replanReason = "stuck";
        this.#pending = undefined;
        this.#stuckDetector.reset();
      } else if (this.#intention?.expiresAtMillis !== undefined
        && this.#intention.expiresAtMillis <= observation.nowMillis) {
        replanReason = "intention-expired";
        this.#pending = undefined;
      } else if (this.#forceReplan) {
        replanReason = "forced";
        this.#pending = undefined;
      } else if (this.#pending === undefined && observation.nowMillis >= this.#nextPlanAtMillis) {
        replanReason = "interval";
      }
    }

    if (replanReason !== undefined) {
      const decision = this.#plan(observation, replanReason);
      planned = true;
      explanations.push(decision.explanation);
      this.#forceReplan = false;
      const immediate = this.#executePending(observation.nowMillis);
      if (immediate !== undefined) {
        ({ action, intendedAction, mistakeApplied } = immediate);
        explanations.push(immediate.explanation);
      }
    }

    this.#sequence += 1;
    const snapshot = this.#makeSnapshot(observation);
    this.#lastSnapshot = snapshot;
    return Object.freeze({
      action,
      intendedAction,
      mistakeApplied,
      planned,
      replanReason,
      pendingUntilMillis: this.#pending?.executeAtMillis,
      snapshot,
      explanation: explanations.join("; ") || "No decision was due"
    });
  }

  #plan(
    observation: AgentObservation<TWorld>,
    reason: AgentReplanReason
  ): AgentDecision<TState> {
    const state = this.#state as TState;
    let decision = immutableAgentData(this.#brain.decide(Object.freeze({
      definition: this.#definition,
      observation,
      profile: this.#profile,
      state,
      previousIntention: this.#intention,
      replanReason: reason,
      random: this.#random,
      services: this.#services
    })));

    const previous = this.#intention;
    const switching = previous !== undefined
      && decision.intention !== undefined
      && previous.id !== decision.intention.id
      && (previous.expiresAtMillis === undefined || previous.expiresAtMillis > observation.nowMillis);
    if (switching && this.#lastAction !== undefined
      && this.#random.chance(this.#profile.parameters.targetStickiness)) {
      decision = immutableAgentData({
        ...decision,
        action: { ...this.#lastAction, atMillis: observation.nowMillis },
        intention: previous,
        explanation: `${decision.explanation}; retained ${previous.label} through target stickiness`
      });
    }

    this.#state = decision.state;
    this.#intention = decision.intention;
    this.#replans += 1;
    const interval = this.#profile.parameters.replanIntervalMillis;
    this.#nextPlanAtMillis = Math.max(
      observation.nowMillis,
      decision.reconsiderAtMillis ?? observation.nowMillis + interval
    );
    if (decision.action !== undefined) {
      this.#pending = Object.freeze({
        decision,
        executeAtMillis: observation.nowMillis + this.#profile.parameters.reactionDelayMillis
      });
    } else {
      this.#pending = undefined;
    }
    return decision;
  }

  #executePending(nowMillis: number): (ControlledExecution & { explanation: string }) | undefined {
    if (this.#pending === undefined || this.#pending.executeAtMillis > nowMillis) {
      return undefined;
    }
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending.decision.action === undefined) {
      return undefined;
    }
    const intendedAction = immutableAgentData({ ...pending.decision.action, atMillis: nowMillis });
    const outcome = applyControlledMistake(
      intendedAction,
      this.#profile,
      this.#random,
      this.#gridBounds
    );
    this.#lastAction = immutableAgentData(outcome.action);
    return Object.freeze({
      action: outcome.action,
      intendedAction: outcome.intendedAction,
      mistakeApplied: outcome.mistakeApplied,
      explanation: outcome.mistakeApplied ? "Executed with a controlled seeded mistake" : "Executed planned action"
    });
  }

  #makeSnapshot(observation: AgentObservation<TWorld>): AgentSnapshot<TState> {
    const pendingAction = this.#pending?.decision.action;
    return createAgentSnapshot({
      definitionId: this.#definition.id,
      brainId: this.#brain.id,
      tick: observation.tick,
      sequence: this.#sequence,
      atMillis: observation.nowMillis,
      position: observation.position,
      brainState: this.#state as TState,
      randomState: this.#random.state,
      intention: this.#intention,
      lastAction: this.#lastAction,
      pendingAction,
      pendingIntention: this.#pending?.decision.intention,
      pendingActionAtMillis: this.#pending?.executeAtMillis,
      nextPlanAtMillis: this.#nextPlanAtMillis,
      forceReplan: this.#forceReplan,
      stuckDetector: this.#stuckDetector.snapshot(),
      replans: this.#replans
    });
  }
}

type ControlledExecution = Readonly<{
  action: AgentAction;
  intendedAction: AgentAction;
  mistakeApplied: boolean;
}>;

export function createAgentRuntime<TWorld, TState, TServices = undefined>(
  options: AgentRuntimeOptions<TWorld, TState, TServices>
): AgentRuntime<TWorld, TState, TServices> {
  return new AgentRuntime(options);
}
