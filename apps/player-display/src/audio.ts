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
type Clock = () => number;
type ActiveAudioTest = {
  controller: AbortController;
  cancelPlayback: (() => void) | null;
};
type ActiveMusic = {
  gain: GainNode;
  reference: string;
  source: AudioBufferSourceNode;
  volume: number;
};
const testSampleTimeoutMillis = 3_000;
const gameAudioTimeoutMillis = 8_000;
const effectMinimumIntervalMillis = 55;
const maximumConcurrentEffects = 6;

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
    case "tile-claim":
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
  private activeSamples = new Set<AudioBufferSourceNode>();
  private activeEffects = new Set<AudioBufferSourceNode>();
  private activeNarrations = new Set<AudioBufferSourceNode>();
  private pendingEffects = 0;
  private lastEffectAt = Number.NEGATIVE_INFINITY;
  private activeTests = new Set<ActiveAudioTest>();
  private audioBuffers = new Map<string, Promise<AudioBuffer>>();
  private activeMusic: ActiveMusic | null = null;
  private requestedMusic = { reference: "", volume: 0 };
  private pendingNarration: { reference: string; token: number; volume: number } | null = null;
  private narrationAttempt: { reference: string; token: number; volume: number } | null = null;
  private narrationToken = 0;
  private testSample: { generation: number; buffer: AudioBuffer } | null = null;
  private generation = 0;

  constructor(
    private readonly onStateChange: (state: AudioOutputState) => void,
    private readonly createContext: AudioContextFactory = defaultAudioContext,
    private readonly loadTestSample: TestSampleLoader = defaultTestSample,
    private readonly now: Clock = () => performance.now(),
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
      this.flushPendingNarration();
    });
  }

  playCue(cue: string): void {
    if (!this.enabled || this.muted) return;
    const voices = cueVoices(cue);
    if (!voices.length) return;
    const normalizedCue = normalizeCue(cue);
    const now = this.now();
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

  setMusic(reference: string, volume: number): void {
    const normalizedReference = normalizeAudioReference(reference);
    const normalizedVolume = clampGain(volume);
    if (this.requestedMusic.reference === normalizedReference
      && this.requestedMusic.volume === normalizedVolume
      && (!normalizedReference || this.activeMusic?.reference === normalizedReference)) return;
    this.requestedMusic = { reference: normalizedReference, volume: normalizedVolume };
    if (!normalizedReference || !this.enabled) {
      this.stopMusic();
      return;
    }
    if (this.activeMusic?.reference === normalizedReference) {
      this.activeMusic.volume = normalizedVolume;
      this.activeMusic.gain.gain.setTargetAtTime(normalizedVolume, this.context?.currentTime ?? 0, 0.08);
      return;
    }
    const context = this.ensureContext();
    if (!context) return;
    const generation = this.generation;
    void this.audioBuffer(context, normalizedReference).then((buffer) => {
      if (!this.isCurrent(context, generation)
        || this.requestedMusic.reference !== normalizedReference) return;
      this.startMusic(context, normalizedReference, normalizedVolume, buffer);
    }).catch(() => {
      // A missing optional music asset must not break cue or narration output.
    });
  }

  playEffect(reference: string, volume: number, playbackRate: number, fallbackCue: string): void {
    if (!this.enabled || this.muted) return;
    const now = this.now();
    if (now - this.lastEffectAt < effectMinimumIntervalMillis
      || this.activeEffects.size + this.pendingEffects >= maximumConcurrentEffects) return;
    this.lastEffectAt = now;
    const normalizedReference = normalizeAudioReference(reference);
    if (!normalizedReference) {
      this.playCue(fallbackCue);
      return;
    }
    this.pendingEffects += 1;
    void this.playSample(normalizedReference, volume, false, playbackRate, true)
      .then((played) => {
        if (!played) this.playCue(fallbackCue);
      })
      .finally(() => {
        this.pendingEffects = Math.max(0, this.pendingEffects - 1);
      });
  }

  playNarration(reference: string, volume: number): void {
    const normalizedReference = normalizeAudioReference(reference);
    if (!normalizedReference) return;
    const normalizedVolume = clampGain(volume);
    this.cancelNarration();
    const token = ++this.narrationToken;
    this.pendingNarration = { reference: normalizedReference, token, volume: normalizedVolume };
    this.flushPendingNarration();
  }

  cancelNarration(): void {
    this.pendingNarration = null;
    this.narrationAttempt = null;
    this.narrationToken += 1;
    for (const source of this.activeNarrations) {
      try {
        source.stop();
      } catch {
        // A source that ended between observation and stop is already cancelled.
      }
    }
    this.activeNarrations.clear();
    const context = this.context;
    if (context) this.duckMusic(context, this.narrationToken, false);
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

  private async playSample(
    reference: string,
    volume: number,
    narration: boolean,
    playbackRate = 1,
    effect = false,
    expectedNarrationToken = 0,
  ): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    const generation = this.generation;
    if (!await this.resume(context, generation)) return false;
    let buffer: AudioBuffer;
    try {
      buffer = await this.audioBuffer(context, reference);
    } catch {
      return false;
    }
    if (!this.isCurrent(context, generation) || this.muted || !this.master
      || (narration && expectedNarrationToken !== this.narrationToken)) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const start = context.currentTime + 0.008;
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(clampPlaybackRate(playbackRate), start);
    source.connect(gain);
    gain.connect(this.master);
    gain.gain.setValueAtTime(clampGain(volume), start);
    const narrationToken = narration ? expectedNarrationToken : 0;
    if (narration) this.duckMusic(context, narrationToken, true);
    source.onended = () => {
      this.activeSamples.delete(source);
      this.activeEffects.delete(source);
      this.activeNarrations.delete(source);
      source.disconnect();
      gain.disconnect();
      if (narration) this.duckMusic(context, narrationToken, false);
    };
    this.activeSamples.add(source);
    if (effect) this.activeEffects.add(source);
    if (narration) this.activeNarrations.add(source);
    source.start(start);
    return true;
  }

  private flushPendingNarration(): void {
    const pending = this.pendingNarration;
    if (!pending || this.narrationAttempt || !this.enabled || this.muted) return;
    this.narrationAttempt = pending;
    void this.playSample(pending.reference, pending.volume, true, 1, false, pending.token).then((played) => {
      if (played && this.pendingNarration?.reference === pending.reference
        && this.pendingNarration.volume === pending.volume
        && this.pendingNarration.token === pending.token) {
        this.pendingNarration = null;
      }
    }).finally(() => {
      if (this.narrationAttempt === pending) this.narrationAttempt = null;
      if (this.pendingNarration && this.pendingNarration !== pending) this.flushPendingNarration();
    });
  }

  private audioBuffer(context: AudioContext, reference: string): Promise<AudioBuffer> {
    const url = gameAudioURL(reference);
    const key = url.href;
    const cached = this.audioBuffers.get(key);
    if (cached) return cached;
    const loading = loadGameAudioSample(context, url).catch((error) => {
      this.audioBuffers.delete(key);
      throw error;
    });
    this.audioBuffers.set(key, loading);
    return loading;
  }

  private startMusic(context: AudioContext, reference: string, volume: number, buffer: AudioBuffer): void {
    if (!this.master) return;
    const previous = this.activeMusic;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = context.currentTime;
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.master);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.65);
    source.onended = () => {
      if (this.activeMusic?.source === source) this.activeMusic = null;
      source.disconnect();
      gain.disconnect();
    };
    this.activeMusic = { gain, reference, source, volume };
    source.start(now + 0.008);
    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(Math.max(0.0001, previous.gain.gain.value), now);
      previous.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
      previous.source.stop(now + 0.7);
    }
  }

  private stopMusic(): void {
    const music = this.activeMusic;
    this.activeMusic = null;
    if (!music || !this.context) return;
    const now = this.context.currentTime;
    music.gain.gain.cancelScheduledValues(now);
    music.gain.gain.setTargetAtTime(0.0001, now, 0.08);
    try {
      music.source.stop(now + 0.4);
    } catch {
      // The source may already have completed during teardown.
    }
  }

  private duckMusic(context: AudioContext, token: number, active: boolean): void {
    const music = this.activeMusic;
    if (!music) return;
    if (!active && token !== this.narrationToken) return;
    const target = active ? Math.max(0.0001, music.volume * 0.28) : music.volume;
    music.gain.gain.setTargetAtTime(target, context.currentTime, active ? 0.08 : 0.28);
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
    this.master?.gain.setTargetAtTime(this.muted ? 0 : 0.85, context.currentTime, 0.012);
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
    this.audioBuffers.clear();
    this.activeMusic = null;
    this.requestedMusic = { reference: "", volume: 0 };
    this.pendingNarration = null;
    this.narrationAttempt = null;
    this.narrationToken += 1;
    this.activeVoices.clear();
    this.activeSamples.clear();
    this.activeEffects.clear();
    this.activeNarrations.clear();
    this.pendingEffects = 0;
    this.lastEffectAt = Number.NEGATIVE_INFINITY;
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

export function gameAudioURL(reference: string): URL {
  const normalized = normalizeAudioReference(reference);
  if (!normalized) throw new Error("game audio reference is invalid");
  const base = typeof document === "undefined" ? "http://127.0.0.1/display/" : document.baseURI;
  return new URL(`${import.meta.env?.BASE_URL ?? "./"}${normalized}`, base);
}

async function loadGameAudioSample(context: AudioContext, url: URL): Promise<AudioBuffer> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), gameAudioTimeoutMillis);
  try {
    const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`game audio returned HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  } finally {
    globalThis.clearTimeout(timeout);
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

function normalizeAudioReference(value: string): string {
  const reference = String(value ?? "").trim().replace(/^\.\//u, "");
  return /^audio\/[a-z0-9][a-z0-9_./-]*\.(?:mp3|ogg|wav)$/u.test(reference) && !reference.includes("..")
    ? reference
    : "";
}

function clampGain(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampPlaybackRate(value: number): number {
  return Math.max(0.75, Math.min(1.25, Number.isFinite(value) ? value : 1));
}

function sequence(frequencies: number[], duration: number, spacing: number, gain: number, type: OscillatorType): CueVoice[] {
  return frequencies.map((frequency, index) => voice(frequency, frequency, duration, index * spacing, gain, type));
}

function voice(frequency: number, endFrequency: number, durationSeconds: number, offsetSeconds: number, gain: number, type: OscillatorType): CueVoice {
  return { durationSeconds, endFrequency, frequency, gain, offsetSeconds, type };
}
