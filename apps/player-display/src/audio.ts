import type { PlayerExperienceState } from "@motion-levels-games/player-experience";

export type AudioOutputState = "disabled" | "checking" | "ready" | "suspended" | "failed";

export type CueVoice = {
  durationSeconds: number;
  endFrequency: number;
  frequency: number;
  gain: number;
  offsetSeconds: number;
  type: OscillatorType;
};

type AudioEventStatus = Pick<PlayerExperienceState,
  "lastEventCue" | "lastEventMessage" | "lastEventSequence" | "lastEventUnixNanos" | "runId" | "sessionId"
>;

type AudioContextFactory = () => AudioContext;
type TestSampleLoader = (context: AudioContext, signal: AbortSignal) => Promise<AudioBuffer>;
type ActiveAudioTest = {
  controller: AbortController;
  cancelPlayback: (() => void) | null;
};
const testSampleTimeoutMillis = 3_000;

export function audioEventKey(status: AudioEventStatus): string | null {
  if (!status.lastEventCue || status.lastEventCue === "none") return null;
  if (Number.isSafeInteger(status.lastEventSequence) && Number(status.lastEventSequence) > 0) {
    return `${status.runId}:${status.sessionId}:${status.lastEventSequence}`;
  }
  if (Number(status.lastEventUnixNanos) > 0) {
    return `${status.runId}:${status.sessionId}:${status.lastEventUnixNanos}:${status.lastEventCue}:${status.lastEventMessage}`;
  }
  return null;
}

export function cueVoices(rawCue: string): CueVoice[] {
  const cue = normalizeCue(rawCue);
  switch (cue) {
    case "none":
    case "":
      return [];
    case "ready":
      return sequence([523, 659], 0.09, 0.085, 0.13, "sine");
    case "start":
      return sequence([440, 554, 659], 0.085, 0.075, 0.15, "triangle");
    case "coin":
      return sequence([880, 1319], 0.07, 0.045, 0.12, "sine");
    case "double-coin":
      return sequence([880, 1175, 1568], 0.065, 0.04, 0.12, "sine");
    case "score":
    case "hit":
    case "pressure":
      return [voice(620, 880, 0.075, 0, 0.11, "triangle")];
    case "round-win":
    case "line-clear":
      return sequence([523, 659, 784], 0.1, 0.065, 0.14, "triangle");
    case "win":
      return sequence([523, 659, 784, 1047], 0.16, 0.1, 0.17, "triangle");
    case "miss":
    case "damage":
      return [voice(230, 115, 0.16, 0, 0.14, "sawtooth")];
    case "fail":
    case "defeat":
      return sequence([294, 220, 147], 0.16, 0.105, 0.14, "sawtooth");
    case "shield":
      return [voice(360, 720, 0.18, 0, 0.1, "sine")];
    case "tick":
      return [voice(1050, 880, 0.035, 0, 0.055, "square")];
    case "move":
    case "hold":
    case "turn":
      return [voice(330, 392, 0.055, 0, 0.07, "triangle")];
    default:
      return [voice(480, 600, 0.065, 0, 0.08, "sine")];
  }
}

export class VenueAudioOutput {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private muted = true;
  private configured = false;
  private outputState: AudioOutputState = "disabled";
  private lastCueAt = new Map<string, number>();
  private activeVoices = new Set<OscillatorNode>();
  private activeTests = new Set<ActiveAudioTest>();
  private testSample: { generation: number; buffer: AudioBuffer } | null = null;
  private generation = 0;

  constructor(
    private readonly onStateChange: (state: AudioOutputState) => void,
    private readonly createContext: AudioContextFactory = defaultAudioContext,
    private readonly loadTestSample: TestSampleLoader = defaultTestSample,
  ) {}

  configure(enabled: boolean, muted: boolean): void {
    const wasEnabled = this.enabled;
    const wasMuted = this.muted;
    this.enabled = enabled;
    this.muted = muted;
    if (!enabled) {
      void this.close("disabled");
      this.configured = true;
      return;
    }
    const context = this.ensureContext();
    if (!context) return;
    const generation = this.generation;
    this.applyMasterGain(context);
    void this.resume(context, generation).then((ready) => {
      if (!ready) return;
      if (this.configured && wasEnabled && wasMuted && !this.muted) this.playCue("ready");
      this.configured = true;
    });
  }

  playCue(cue: string): void {
    if (!this.enabled || this.muted) return;
    const voices = cueVoices(cue);
    if (!voices.length) return;
    const normalizedCue = normalizeCue(cue);
    const now = performance.now();
    const throttleMillis = normalizedCue === "tick" || normalizedCue === "move" ? 45 : 18;
    if (now - (this.lastCueAt.get(normalizedCue) ?? Number.NEGATIVE_INFINITY) < throttleMillis) return;
    this.lastCueAt.set(normalizedCue, now);
    const context = this.ensureContext();
    if (!context) return;
    const generation = this.generation;
    void this.resume(context, generation).then((ready) => {
      if (ready) this.schedule(context, voices, generation);
    });
  }

  async playTestPhrase(onStarted?: () => void): Promise<boolean> {
    if (!this.enabled) return false;
    const context = this.ensureContext();
    if (!context) return false;
    const generation = this.generation;
    const test: ActiveAudioTest = {
      controller: new AbortController(),
      cancelPlayback: null,
    };
    this.activeTests.add(test);
    try {
      if (!await this.resume(context, generation) || test.controller.signal.aborted) return false;
      const sample = await this.testSampleFor(context, generation, test.controller.signal);
      if (!this.isCurrent(context, generation) || test.controller.signal.aborted) return false;
      return await this.scheduleTestSample(context, sample, test, onStarted);
    } catch {
      return false;
    } finally {
      this.activeTests.delete(test);
    }
  }

  /** Stops every diagnostic phrase without closing or muting gameplay audio. */
  cancelTestPhrase(): void {
    for (const test of this.activeTests) {
      test.controller.abort();
      test.cancelPlayback?.();
    }
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.muted = true;
    await this.close("disabled");
  }

  private ensureContext(): AudioContext | null {
    if (this.context && this.context.state !== "closed") return this.context;
    try {
      const context = this.createContext();
      const generation = ++this.generation;
      const master = context.createGain();
      master.connect(context.destination);
      context.onstatechange = () => this.reportContextState(context, generation);
      this.context = context;
      this.master = master;
      this.applyMasterGain(context);
      this.reportContextState(context, generation);
      return context;
    } catch {
      this.setOutputState("failed");
      return null;
    }
  }

  private async resume(context: AudioContext, generation: number): Promise<boolean> {
    try {
      if (context.state === "suspended") await context.resume();
      if (!this.isCurrent(context, generation)) return false;
      this.reportContextState(context, generation);
      return context.state === "running";
    } catch {
      if (this.isCurrent(context, generation)) this.setOutputState("failed");
      return false;
    }
  }

  private schedule(context: AudioContext, voices: CueVoice[], generation: number): void {
    if (!this.isCurrent(context, generation) || !this.master || context.state !== "running") return;
    if (this.activeVoices.size > 28) return;
    const baseTime = context.currentTime + 0.008;
    for (const spec of voices) {
      const start = baseTime + spec.offsetSeconds;
      const end = start + spec.durationSeconds;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = spec.type;
      oscillator.frequency.setValueAtTime(spec.frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.endFrequency), end);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(spec.gain, start + Math.min(0.018, spec.durationSeconds / 3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      oscillator.onended = () => {
        this.activeVoices.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      };
      this.activeVoices.add(oscillator);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
  }

  private async testSampleFor(context: AudioContext, generation: number, signal: AbortSignal): Promise<AudioBuffer> {
    if (this.testSample?.generation === generation) return this.testSample.buffer;
    const buffer = await this.loadTestSample(context, signal);
    if (!signal.aborted && this.isCurrent(context, generation)) {
      this.testSample = { generation, buffer };
    }
    return buffer;
  }

  private scheduleTestSample(
    context: AudioContext,
    sample: AudioBuffer,
    test: ActiveAudioTest,
    onStarted?: () => void,
  ): Promise<boolean> {
    if (context.state !== "running" || test.controller.signal.aborted) return Promise.resolve(false);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const start = context.currentTime + 0.008;
    source.buffer = sample;
    source.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.78, start);
    return new Promise((resolve) => {
      let finished = false;
      const timeout = globalThis.setTimeout(
        () => finish(false),
        Math.max(750, Math.ceil((sample.duration + 0.5) * 1_000)),
      );
      const finish = (played: boolean) => {
        if (finished) return;
        finished = true;
        globalThis.clearTimeout(timeout);
        test.cancelPlayback = null;
        source.onended = null;
        source.disconnect();
        gain.disconnect();
        resolve(played);
      };
      test.cancelPlayback = () => {
        try {
          source.stop();
        } catch {
          // A source which already ended needs only its normal cleanup.
        }
        finish(false);
      };
      source.onended = () => finish(true);
      try {
        source.start(start);
        onStarted?.();
      } catch {
        finish(false);
      }
    });
  }

  private applyMasterGain(context: AudioContext): void {
    this.master?.gain.setTargetAtTime(this.muted ? 0 : 0.32, context.currentTime, 0.012);
  }

  private reportContextState(context: AudioContext, generation: number): void {
    if (!this.isCurrent(context, generation)) return;
    if (!this.enabled) return this.setOutputState("disabled");
    if (context.state === "running") return this.setOutputState("ready");
    if (context.state === "suspended") return this.setOutputState("suspended");
    this.setOutputState("failed");
  }

  private isCurrent(context: AudioContext, generation: number): boolean {
    return this.context === context && this.generation === generation;
  }

  private setOutputState(state: AudioOutputState): void {
    if (this.outputState === state) return;
    this.outputState = state;
    this.onStateChange(state);
  }

  private async close(finalState: AudioOutputState): Promise<void> {
    const context = this.context;
    this.generation += 1;
    this.context = null;
    this.master = null;
    this.testSample = null;
    this.activeVoices.clear();
    this.cancelTestPhrase();
    this.activeTests.clear();
    if (context) context.onstatechange = null;
    this.setOutputState(finalState);
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Closing is best-effort during a kiosk reload.
      }
    }
  }
}

function defaultAudioContext(): AudioContext {
  if (typeof globalThis.AudioContext !== "function") throw new Error("Web Audio is unavailable");
  return new globalThis.AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
}

async function defaultTestSample(context: AudioContext, signal: AbortSignal): Promise<AudioBuffer> {
  const base = typeof document === "undefined" ? "http://127.0.0.1/display/" : document.baseURI;
  const url = new URL(`${import.meta.env.BASE_URL}audio/probando.wav`, base);
  const buildRevision = typeof MOTION_LEVELS_PLAYER_DISPLAY_REVISION === "string"
    ? MOTION_LEVELS_PLAYER_DISPLAY_REVISION
    : "";
  if (buildRevision) url.searchParams.set("v", buildRevision);
  return loadAudioTestSample(context, url, testSampleTimeoutMillis, signal);
}

export async function loadAudioTestSample(
  context: AudioContext,
  url: URL,
  timeoutMillis = testSampleTimeoutMillis,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMillis));
  try {
    const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`audio test sample returned HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function normalizeCue(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[_\s]+/gu, "-")
    .toLowerCase();
}

function sequence(frequencies: number[], duration: number, spacing: number, gain: number, type: OscillatorType): CueVoice[] {
  return frequencies.map((frequency, index) => voice(frequency, frequency, duration, index * spacing, gain, type));
}

function voice(frequency: number, endFrequency: number, durationSeconds: number, offsetSeconds: number, gain: number, type: OscillatorType): CueVoice {
  return { durationSeconds, endFrequency, frequency, gain, offsetSeconds, type };
}
