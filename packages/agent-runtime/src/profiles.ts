export type AgentProfileId =
  | "cautious"
  | "balanced"
  | "bold"
  | "helper"
  | "explorer"
  | "chaotic"
  | "expert"
  | (string & {});

export type AgentProfileParameters = Readonly<{
  reactionDelayMillis: number;
  mistakeRate: number;
  mistakeSeverity: number;
  targetStickiness: number;
  caution: number;
  exploration: number;
  teamwork: number;
  prediction: number;
  memoryDecayPerSecond: number;
  replanIntervalMillis: number;
  stuckWindowMillis: number;
  stuckDistance: number;
  reservationHorizonMillis: number;
}>;

export type AgentProfile = Readonly<{
  id: AgentProfileId;
  label: string;
  parameters: AgentProfileParameters;
}>;

type ParameterName = keyof AgentProfileParameters;

export const AGENT_PROFILE_LIMITS = Object.freeze({
  reactionDelayMillis: Object.freeze([0, 2_000] as const),
  mistakeRate: Object.freeze([0, 0.5] as const),
  mistakeSeverity: Object.freeze([0, 1] as const),
  targetStickiness: Object.freeze([0, 1] as const),
  caution: Object.freeze([0, 1] as const),
  exploration: Object.freeze([0, 1] as const),
  teamwork: Object.freeze([0, 1] as const),
  prediction: Object.freeze([0, 1] as const),
  memoryDecayPerSecond: Object.freeze([0, 1] as const),
  replanIntervalMillis: Object.freeze([50, 5_000] as const),
  stuckWindowMillis: Object.freeze([100, 5_000] as const),
  stuckDistance: Object.freeze([0, 4] as const),
  reservationHorizonMillis: Object.freeze([100, 15_000] as const)
} satisfies Record<ParameterName, readonly [number, number]>);

const BALANCED_PARAMETERS: AgentProfileParameters = Object.freeze({
  reactionDelayMillis: 180,
  mistakeRate: 0.06,
  mistakeSeverity: 0.25,
  targetStickiness: 0.55,
  caution: 0.5,
  exploration: 0.45,
  teamwork: 0.5,
  prediction: 0.55,
  memoryDecayPerSecond: 0.12,
  replanIntervalMillis: 350,
  stuckWindowMillis: 900,
  stuckDistance: 0.5,
  reservationHorizonMillis: 2_000
});

function clampParameter(name: ParameterName, value: number): number {
  const [minimum, maximum] = AGENT_PROFILE_LIMITS[name];
  const finiteValue = Number.isFinite(value) ? value : BALANCED_PARAMETERS[name];
  return Math.max(minimum, Math.min(maximum, finiteValue));
}

export function defineAgentProfile(
  id: AgentProfileId,
  label: string,
  parameters: Partial<AgentProfileParameters> = {}
): AgentProfile {
  if (id.length === 0 || label.length === 0) {
    throw new Error("Profile id and label must not be empty");
  }
  const bounded = {} as Record<ParameterName, number>;
  for (const name of Object.keys(BALANCED_PARAMETERS) as ParameterName[]) {
    bounded[name] = clampParameter(name, parameters[name] ?? BALANCED_PARAMETERS[name]);
  }
  return Object.freeze({
    id,
    label,
    parameters: Object.freeze(bounded) as AgentProfileParameters
  });
}

export const CAUTIOUS_AGENT_PROFILE = defineAgentProfile("cautious", "Cautious", {
  reactionDelayMillis: 260,
  mistakeRate: 0.035,
  mistakeSeverity: 0.15,
  targetStickiness: 0.72,
  caution: 0.92,
  exploration: 0.18,
  teamwork: 0.62,
  prediction: 0.64
});

export const BALANCED_AGENT_PROFILE = defineAgentProfile("balanced", "Balanced");

export const BOLD_AGENT_PROFILE = defineAgentProfile("bold", "Bold", {
  reactionDelayMillis: 125,
  mistakeRate: 0.08,
  mistakeSeverity: 0.32,
  targetStickiness: 0.44,
  caution: 0.18,
  exploration: 0.62,
  prediction: 0.62
});

export const HELPER_AGENT_PROFILE = defineAgentProfile("helper", "Helper", {
  reactionDelayMillis: 210,
  mistakeRate: 0.04,
  targetStickiness: 0.68,
  caution: 0.67,
  exploration: 0.28,
  teamwork: 0.96,
  prediction: 0.58
});

export const EXPLORER_AGENT_PROFILE = defineAgentProfile("explorer", "Explorer", {
  reactionDelayMillis: 190,
  mistakeRate: 0.075,
  mistakeSeverity: 0.3,
  targetStickiness: 0.25,
  caution: 0.36,
  exploration: 0.96,
  teamwork: 0.42,
  prediction: 0.48
});

export const CHAOTIC_AGENT_PROFILE = defineAgentProfile("chaotic", "Chaotic", {
  reactionDelayMillis: 85,
  mistakeRate: 0.32,
  mistakeSeverity: 0.88,
  targetStickiness: 0.12,
  caution: 0.1,
  exploration: 1,
  teamwork: 0.16,
  prediction: 0.2,
  replanIntervalMillis: 140
});

export const EXPERT_AGENT_PROFILE = defineAgentProfile("expert", "Expert", {
  reactionDelayMillis: 45,
  mistakeRate: 0.008,
  mistakeSeverity: 0.05,
  targetStickiness: 0.78,
  caution: 0.74,
  exploration: 0.52,
  teamwork: 0.86,
  prediction: 0.98,
  memoryDecayPerSecond: 0.025,
  replanIntervalMillis: 110,
  stuckWindowMillis: 450,
  reservationHorizonMillis: 3_500
});

export const AGENT_PROFILES: Readonly<Record<string, AgentProfile>> = Object.freeze({
  cautious: CAUTIOUS_AGENT_PROFILE,
  balanced: BALANCED_AGENT_PROFILE,
  bold: BOLD_AGENT_PROFILE,
  helper: HELPER_AGENT_PROFILE,
  explorer: EXPLORER_AGENT_PROFILE,
  chaotic: CHAOTIC_AGENT_PROFILE,
  expert: EXPERT_AGENT_PROFILE
});

export function getAgentProfile(id: string): AgentProfile {
  const profile = AGENT_PROFILES[id];
  if (profile === undefined) {
    throw new Error(`Unknown agent profile: ${id}`);
  }
  return profile;
}

export function blendAgentProfiles(
  id: AgentProfileId,
  label: string,
  first: AgentProfile,
  second: AgentProfile,
  secondWeight: number
): AgentProfile {
  const weight = Math.max(0, Math.min(1, secondWeight));
  const parameters = {} as Record<ParameterName, number>;
  for (const name of Object.keys(BALANCED_PARAMETERS) as ParameterName[]) {
    parameters[name] = first.parameters[name] * (1 - weight) + second.parameters[name] * weight;
  }
  return defineAgentProfile(id, label, parameters);
}
