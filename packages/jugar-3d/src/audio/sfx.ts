/**
 * Lightweight WebAudio synth for game cues — no audio assets shipped.
 * Cue names come straight from the real games' GameEvent.cue values.
 */
export class SoundBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedState = false;
  private lastCueAt = new Map<string, number>();

  get muted(): boolean {
    return this.mutedState;
  }

  setMuted(muted: boolean): void {
    this.mutedState = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
  }

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  cue(cue: string): void {
    const name = cue.toLowerCase();
    // Some games emit bursts of identical cues; keep them from stacking.
    const now = performance.now();
    const last = this.lastCueAt.get(name) ?? -Infinity;
    if (now - last < 90) {
      return;
    }
    this.lastCueAt.set(name, now);

    switch (name) {
      case "start":
        this.arpeggio([392, 523.25, 659.25], 0.09, "triangle", 0.5);
        break;
      case "win":
        this.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.13, "triangle", 0.6);
        break;
      case "fail":
        this.arpeggio([311.13, 246.94, 196], 0.16, "sawtooth", 0.35);
        break;
      case "hit":
        this.coin();
        break;
      case "miss":
        this.buzz(140, 0.18);
        break;
      default:
        this.blip(660, 0.07, 0.25);
        break;
    }
  }

  step(): void {
    this.blip(220 + Math.random() * 40, 0.035, 0.12, "sine");
  }

  jump(): void {
    this.sweep(240, 520, 0.16, 0.2);
  }

  ui(): void {
    this.blip(880, 0.05, 0.2);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedState ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private voice(): { ctx: AudioContext; out: GainNode } | null {
    const ctx = this.ensureContext();
    if (ctx.state !== "running" || !this.master) {
      return null;
    }
    const out = ctx.createGain();
    out.connect(this.master);
    return { ctx, out };
  }

  private blip(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType = "square"
  ): void {
    const voice = this.voice();
    if (!voice) return;
    const { ctx, out } = voice;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    out.gain.setValueAtTime(gain, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private sweep(from: number, to: number, duration: number, gain: number): void {
    const voice = this.voice();
    if (!voice) return;
    const { ctx, out } = voice;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    out.gain.setValueAtTime(gain, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private coin(): void {
    const voice = this.voice();
    if (!voice) return;
    const { ctx, out } = voice;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(987.77, ctx.currentTime);
    osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.07);
    out.gain.setValueAtTime(0.22, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  private buzz(frequency: number, duration: number): void {
    const voice = this.voice();
    if (!voice) return;
    const { ctx, out } = voice;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.55, ctx.currentTime + duration);
    out.gain.setValueAtTime(0.28, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private arpeggio(
    frequencies: number[],
    noteMillis: number,
    type: OscillatorType,
    gain: number
  ): void {
    const voice = this.voice();
    if (!voice) return;
    const { ctx, out } = voice;
    frequencies.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();
      const at = ctx.currentTime + index * noteMillis;
      osc.type = type;
      osc.frequency.value = frequency;
      noteGain.gain.setValueAtTime(0, at);
      noteGain.gain.linearRampToValueAtTime(gain * 0.4, at + 0.012);
      noteGain.gain.exponentialRampToValueAtTime(0.001, at + noteMillis * 2.4);
      osc.connect(noteGain);
      noteGain.connect(out);
      osc.start(at);
      osc.stop(at + noteMillis * 2.6);
    });
  }
}

export const soundBank = new SoundBank();
