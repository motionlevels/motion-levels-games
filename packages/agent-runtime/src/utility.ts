import type { GridPoint } from "./contracts.ts";

export type UtilityCurve = "linear" | "quadratic" | "sqrt" | "inverse";

export type UtilityConsideration<TContext> = Readonly<{
  id: string;
  label?: string;
  weight: number;
  evaluate(context: TContext): number;
  curve?: UtilityCurve | ((normalizedInput: number) => number);
  vetoBelow?: number;
}>;

export type UtilityIntention<TContext> = Readonly<{
  id: string;
  label: string;
  baseUtility?: number;
  priority?: number;
  targetId?: string;
  target?: GridPoint;
  available?: (context: TContext) => boolean;
  considerations: readonly UtilityConsideration<TContext>[];
}>;

export type UtilityFactorExplanation = Readonly<{
  id: string;
  label: string;
  input: number;
  normalized: number;
  weight: number;
  contribution: number;
  vetoed: boolean;
}>;

export type UtilityScore<TContext> = Readonly<{
  intention: UtilityIntention<TContext>;
  score: number;
  vetoed: boolean;
  factors: readonly UtilityFactorExplanation[];
}>;

export type UtilitySelection<TContext> = Readonly<{
  selected?: UtilityIntention<TContext>;
  selectedScore?: number;
  rankings: readonly UtilityScore<TContext>[];
  explanation: string;
}>;

export type UtilitySelectionOptions = Readonly<{
  currentIntentionId?: string;
  stickiness?: number;
  stickinessScale?: number;
}>;

export function scoreIntentions<TContext>(
  intentions: readonly UtilityIntention<TContext>[],
  context: TContext,
  options: UtilitySelectionOptions = {}
): readonly UtilityScore<TContext>[] {
  const stickiness = clamp01(options.stickiness ?? 0);
  const stickinessScale = finite(options.stickinessScale ?? 1, "stickinessScale");
  const scores = intentions.map((intention): UtilityScore<TContext> => {
    const available = intention.available?.(context) ?? true;
    let score = finite(intention.baseUtility ?? 0, "baseUtility");
    let vetoed = !available;
    const factors: UtilityFactorExplanation[] = [];

    for (const consideration of intention.considerations) {
      const input = finite(consideration.evaluate(context), `utility input ${consideration.id}`);
      const normalizedInput = clamp01(input);
      const normalized = applyCurve(consideration.curve ?? "linear", normalizedInput);
      const weight = finite(consideration.weight, `utility weight ${consideration.id}`);
      const factorVetoed = consideration.vetoBelow !== undefined
        && normalizedInput < clamp01(consideration.vetoBelow);
      const contribution = normalized * weight;
      score += contribution;
      vetoed ||= factorVetoed;
      factors.push(Object.freeze({
        id: consideration.id,
        label: consideration.label ?? consideration.id,
        input,
        normalized,
        weight,
        contribution,
        vetoed: factorVetoed
      }));
    }

    if (intention.id === options.currentIntentionId && stickiness > 0) {
      const contribution = stickiness * stickinessScale;
      score += contribution;
      factors.push(Object.freeze({
        id: "target-stickiness",
        label: "Target stickiness",
        input: stickiness,
        normalized: stickiness,
        weight: stickinessScale,
        contribution,
        vetoed: false
      }));
    }

    return Object.freeze({
      intention,
      score: vetoed ? Number.NEGATIVE_INFINITY : score,
      vetoed,
      factors: Object.freeze(factors)
    });
  });

  return Object.freeze(scores.sort(compareUtilityScores));
}

export function selectIntention<TContext>(
  intentions: readonly UtilityIntention<TContext>[],
  context: TContext,
  options: UtilitySelectionOptions = {}
): UtilitySelection<TContext> {
  const rankings = scoreIntentions(intentions, context, options);
  const winner = rankings.find((ranking) => !ranking.vetoed);
  if (winner === undefined) {
    return Object.freeze({
      selected: undefined,
      selectedScore: undefined,
      rankings,
      explanation: "No intention was available"
    });
  }
  const strongest = [...winner.factors]
    .filter((factor) => factor.contribution !== 0)
    .sort((first, second) =>
      Math.abs(second.contribution) - Math.abs(first.contribution) || first.id.localeCompare(second.id)
    )[0];
  const reason = strongest === undefined
    ? `Selected ${winner.intention.label} from base utility and deterministic tie-breaking`
    : `Selected ${winner.intention.label}; strongest factor: ${strongest.label} (${formatSigned(strongest.contribution)})`;
  return Object.freeze({
    selected: winner.intention,
    selectedScore: winner.score,
    rankings,
    explanation: reason
  });
}

function compareUtilityScores<TContext>(first: UtilityScore<TContext>, second: UtilityScore<TContext>): number {
  return Number(first.vetoed) - Number(second.vetoed)
    || second.score - first.score
    || (second.intention.priority ?? 0) - (first.intention.priority ?? 0)
    || first.intention.id.localeCompare(second.intention.id);
}

function applyCurve(curve: UtilityCurve | ((value: number) => number), value: number): number {
  if (typeof curve === "function") {
    return clamp01(finite(curve(value), "utility curve result"));
  }
  switch (curve) {
    case "linear":
      return value;
    case "quadratic":
      return value * value;
    case "sqrt":
      return Math.sqrt(value);
    case "inverse":
      return 1 - value;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
