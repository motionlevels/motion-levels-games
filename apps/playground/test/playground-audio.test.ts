import assert from "node:assert/strict";
import { test } from "node:test";
import { PlaygroundAudioOutput } from "../src/playgroundAudio.ts";

class FakeAudio {
  currentTime = 0;
  loop = false;
  playbackRate = 1;
  preload = "";
  volume = 1;
  playCount = 0;
  pauseCount = 0;
  paused = true;
  private endedListeners: Array<() => void> = [];

  play(): Promise<void> {
    this.playCount += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCount += 1;
    this.paused = true;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "ended" || typeof listener !== "function") return;
    this.endedListeners.push(() => listener(new Event("ended")));
  }

  end(): void {
    const listeners = this.endedListeners.splice(0);
    for (const listener of listeners) listener();
  }
}

function audioState(sequence: number) {
  return {
    audioEnabled: true,
    audioMuted: false,
    lastEventSequence: sequence,
    music: "",
    musicVolume: 0,
    narration: "",
    narrationSequence: 0,
    narrationStopSequence: 0,
    narrationVolume: 0,
    runId: "run-1",
    sessionId: "session-1",
    sound: "audio/duelo/sfx/tile-claim.mp3",
    soundPlaybackRate: 1,
    soundVolume: 0.55,
  };
}

test("rapid tile effects are rate-limited, capped, and reuse a bounded sample pool", async () => {
  const samples: FakeAudio[] = [];
  let now = 0;
  const output = new PlaygroundAudioOutput(
    () => {
      const sample = new FakeAudio();
      samples.push(sample);
      return sample as unknown as HTMLAudioElement;
    },
    () => now,
  );

  output.sync(audioState(1));
  output.unlock();
  for (let sequence = 2; sequence <= 12; sequence += 1) {
    now += 60;
    output.sync(audioState(sequence));
  }
  await Promise.resolve();

  assert.equal(samples.length, 6, "the preview must never allocate an unbounded number of effect players");
  assert.equal(samples.reduce((total, sample) => total + sample.playCount, 0), 6);

  samples[0]!.end();
  now += 60;
  output.sync(audioState(13));
  await Promise.resolve();

  assert.equal(samples.length, 6, "an ended effect player should be reused");
  assert.equal(samples.reduce((total, sample) => total + sample.playCount, 0), 7);
  output.dispose();
});

test("effects arriving inside one audio interval are dropped immediately", async () => {
  const samples: FakeAudio[] = [];
  let now = 100;
  const output = new PlaygroundAudioOutput(
    () => {
      const sample = new FakeAudio();
      samples.push(sample);
      return sample as unknown as HTMLAudioElement;
    },
    () => now,
  );

  output.sync(audioState(1));
  output.unlock();
  output.sync(audioState(2));
  now += 10;
  output.sync(audioState(3));
  await Promise.resolve();

  assert.equal(samples.length, 1);
  assert.equal(samples[0]!.playCount, 1);
  output.dispose();
});

test("runtime refreshes do not replay music that is already running", async () => {
  const samples: FakeAudio[] = [];
  const output = new PlaygroundAudioOutput(() => {
    const sample = new FakeAudio();
    samples.push(sample);
    return sample as unknown as HTMLAudioElement;
  });
  const state = {
    ...audioState(1),
    music: "audio/duelo/music/playing-loop.mp3",
  };

  output.sync(state);
  output.unlock();
  for (let refresh = 0; refresh < 100; refresh += 1) output.sync(state);
  await Promise.resolve();

  assert.equal(samples.length, 1);
  assert.equal(samples[0]!.playCount, 1);
  output.dispose();
});

test("a runtime stop signal cancels the active narration without muting music", async () => {
  const samples: FakeAudio[] = [];
  const output = new PlaygroundAudioOutput(() => {
    const sample = new FakeAudio();
    samples.push(sample);
    return sample as unknown as HTMLAudioElement;
  });
  output.sync(audioState(1));
  output.unlock();
  output.sync({
    ...audioState(1),
    narration: "audio/duelo/narration/intro.mp3",
    narrationSequence: 1,
  });
  await Promise.resolve();
  const narration = samples[0];
  assert.equal(narration?.playCount, 1);

  output.sync({ ...audioState(1), narrationStopSequence: 1 });

  assert.equal(narration?.pauseCount, 1);
  assert.equal(narration?.currentTime, 0);
  output.dispose();
});
