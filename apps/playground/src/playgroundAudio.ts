import type { PlayerExperienceState } from "@motion-levels-games/player-experience";

type PlaygroundAudioState = Pick<PlayerExperienceState,
  "audioEnabled" | "audioMuted" | "lastEventSequence" | "music" | "musicVolume" |
  "narration" | "narrationSequence" | "narrationStopSequence" | "narrationVolume" | "runId" | "sessionId" |
  "sound" | "soundPlaybackRate" | "soundVolume"
>;

const effectMinimumIntervalMillis = 55;
const maximumConcurrentEffects = 6;
type AudioFactory = (source: string) => HTMLAudioElement;
type Clock = () => number;

/** Development-only preview output; venue playback remains owned by player-display. */
export class PlaygroundAudioOutput {
  private music: HTMLAudioElement | null = null;
  private musicReference = "";
  private lastEventKey = "";
  private lastNarrationKey = "";
  private lastNarrationStopSequence: number | null = null;
  private latest: PlaygroundAudioState | null = null;
  private unlocked = false;
  private readonly effectPool = new Map<string, HTMLAudioElement[]>();
  private readonly activeEffects = new Set<HTMLAudioElement>();
  private readonly activeNarrations = new Set<HTMLAudioElement>();
  private lastEffectAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly createAudio: AudioFactory = (source) => new Audio(source),
    private readonly now: Clock = () => performance.now(),
  ) {}

  sync(state: PlaygroundAudioState): void {
    this.latest = state;
    const enabled = state.audioEnabled && !state.audioMuted;
    this.syncMusic(enabled ? state.music : "", state.musicVolume);
    const narrationStopSequence = Number(state.narrationStopSequence ?? 0);
    if (this.lastNarrationStopSequence === null) {
      this.lastNarrationStopSequence = narrationStopSequence;
    } else if (narrationStopSequence !== this.lastNarrationStopSequence) {
      this.lastNarrationStopSequence = narrationStopSequence;
      this.cancelNarration();
    }
    const eventKey = `${state.runId}:${state.sessionId}:${state.lastEventSequence ?? 0}`;
    if (!this.lastEventKey) {
      this.lastEventKey = eventKey;
    } else if (enabled && this.unlocked && state.sound && eventKey !== this.lastEventKey) {
      this.lastEventKey = eventKey;
      this.playOneShot(state.sound, state.soundVolume ?? 1, false, state.soundPlaybackRate ?? 1);
    } else if (!state.sound || eventKey === this.lastEventKey) {
      this.lastEventKey = eventKey;
    }
    const narrationKey = `${state.runId}:${state.sessionId}:${state.narrationSequence ?? 0}:${state.narration ?? ""}`;
    if (enabled && this.unlocked && state.narration && Number(state.narrationSequence) > 0 && narrationKey !== this.lastNarrationKey) {
      this.lastNarrationKey = narrationKey;
      this.playOneShot(state.narration, state.narrationVolume ?? 1, true);
    }
  }

  unlock(): void {
    this.unlocked = true;
    if (this.latest) this.sync(this.latest);
  }

  dispose(): void {
    this.music?.pause();
    for (const samples of this.effectPool.values()) {
      for (const sample of samples) sample.pause();
    }
    for (const narration of this.activeNarrations) narration.pause();
    this.music = null;
    this.latest = null;
    this.activeEffects.clear();
    this.activeNarrations.clear();
    this.effectPool.clear();
  }

  private syncMusic(reference: string, volume: number): void {
    const normalized = normalizeReference(reference);
    if (!normalized) {
      this.music?.pause();
      return;
    }
    if (this.musicReference !== normalized) {
      this.music?.pause();
      const music = this.createAudio(audioURL(normalized));
      music.loop = true;
      music.preload = "auto";
      this.music = music;
      this.musicReference = normalized;
    }
    if (!this.music) return;
    this.music.volume = clampVolume(volume);
    if (this.unlocked && this.music.paused) void this.music.play().catch(() => {});
  }

  private playOneShot(reference: string, volume: number, narration: boolean, playbackRate = 1): void {
    const normalized = normalizeReference(reference);
    if (!normalized || !this.unlocked) return;
    if (!narration) {
      const now = this.now();
      if (now - this.lastEffectAt < effectMinimumIntervalMillis
        || this.activeEffects.size >= maximumConcurrentEffects) return;
      this.lastEffectAt = now;
    }
    const sample = narration
      ? this.createAudio(audioURL(normalized))
      : this.effectSample(normalized);
    if (!sample) return;
    if (!narration) sample.currentTime = 0;
    sample.volume = clampVolume(volume);
    sample.playbackRate = clampPlaybackRate(playbackRate);
    if (narration && this.music) this.music.volume = clampVolume((this.latest?.musicVolume ?? 0) * 0.28);
    if (!narration) this.activeEffects.add(sample);
    if (narration) this.activeNarrations.add(sample);
    const finish = () => {
      if (!narration) this.activeEffects.delete(sample);
      if (narration) this.activeNarrations.delete(sample);
      if (narration && this.music) this.music.volume = clampVolume(this.latest?.musicVolume ?? 0);
    };
    sample.addEventListener("ended", finish, { once: true });
    void sample.play().catch(finish);
  }

  private cancelNarration(): void {
    for (const narration of this.activeNarrations) {
      narration.pause();
      narration.currentTime = 0;
    }
    this.activeNarrations.clear();
    if (this.music) this.music.volume = clampVolume(this.latest?.musicVolume ?? 0);
  }

  private effectSample(reference: string): HTMLAudioElement | null {
    const samples = this.effectPool.get(reference) ?? [];
    const available = samples.find((sample) => !this.activeEffects.has(sample));
    if (available) return available;
    if (samples.length >= maximumConcurrentEffects) return null;
    const sample = this.createAudio(audioURL(reference));
    sample.preload = "auto";
    samples.push(sample);
    this.effectPool.set(reference, samples);
    return sample;
  }
}

function audioURL(reference: string): string {
  const base = typeof document === "undefined" ? "http://127.0.0.1/" : document.baseURI;
  return new URL(`${import.meta.env?.BASE_URL ?? "/"}${reference}`, base).href;
}

function normalizeReference(value: string): string {
  const reference = String(value ?? "").trim().replace(/^\.\//u, "");
  return /^audio\/[a-z0-9][a-z0-9_./-]*\.(?:mp3|ogg|wav)$/u.test(reference) && !reference.includes("..")
    ? reference
    : "";
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampPlaybackRate(value: number): number {
  return Math.max(0.75, Math.min(1.25, Number.isFinite(value) ? value : 1));
}
