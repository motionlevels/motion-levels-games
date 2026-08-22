import type { PlaygroundScenarioRecordingOptions } from "./playgroundApi.ts";

const contactSheetKeyframeCount = 6;

export type NormalizedScenarioRecordingOptions = {
  durationMillis: number;
  frameIntervalMillis: number;
  leadInMillis: number;
};

export function normalizeScenarioRecordingOptions(
  defaults: PlaygroundScenarioRecordingOptions,
  options: PlaygroundScenarioRecordingOptions = {}
): NormalizedScenarioRecordingOptions {
  const durationMillis = boundedInteger(
    options.durationMillis ?? defaults.durationMillis,
    100,
    20_000,
    "recording duration"
  );
  const frameIntervalMillis = boundedInteger(
    options.frameIntervalMillis ?? defaults.frameIntervalMillis ?? 100,
    50,
    1_000,
    "recording frame interval"
  );
  const leadInMillis = boundedInteger(
    options.leadInMillis ?? defaults.leadInMillis ?? 0,
    0,
    5_000,
    "recording lead-in"
  );

  const frameCount = scenarioRecordingTimeline({
    durationMillis,
    frameIntervalMillis,
    leadInMillis
  }).length;
  if (frameCount > 240) {
    throw new Error("Scenario recordings may contain at most 240 frames");
  }

  return { durationMillis, frameIntervalMillis, leadInMillis };
}

export function scenarioRecordingTimeline(
  options: NormalizedScenarioRecordingOptions
): number[] {
  const offsets: number[] = [];
  for (let atMillis = -options.leadInMillis; atMillis < 0; atMillis += options.frameIntervalMillis) {
    offsets.push(atMillis);
  }
  for (let atMillis = 0; atMillis < options.durationMillis; atMillis += options.frameIntervalMillis) {
    offsets.push(atMillis);
  }
  return offsets;
}

export function scenarioContactSheetIndices(frameCount: number): number[] {
  if (frameCount <= 0) return [];
  if (frameCount <= contactSheetKeyframeCount) {
    return Array.from({ length: frameCount }, (_, index) => index);
  }
  return Array.from({ length: contactSheetKeyframeCount }, (_, index) => (
    Math.round(index * (frameCount - 1) / (contactSheetKeyframeCount - 1))
  ));
}

function boundedInteger(value: number | undefined, min: number, max: number, label: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  const normalized = Math.round(value);
  if (normalized < min || normalized > max) {
    throw new Error(`${label} must be between ${min} and ${max}ms`);
  }
  return normalized;
}
