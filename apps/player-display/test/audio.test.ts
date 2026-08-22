import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { audioEventKey, cueVoices, gameAudioURL, loadAudioTestSample } from "../src/audio.ts";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("audioEventKey", () => {
  const base = {
    runId: "runtime-1",
    sessionId: "session-1",
    lastEventCue: "hit",
    lastEventMessage: "Punto",
    lastEventUnixNanos: 123,
  };

  it("prefers the stable runtime sequence and ignores cue-less state", () => {
    assert.equal(audioEventKey({ ...base, lastEventSequence: 7 }), "runtime-1:session-1:7");
    assert.equal(audioEventKey({ ...base, lastEventCue: "none", lastEventSequence: 8 }), null);
    assert.equal(audioEventKey({ ...base, lastEventCue: "", lastEventSequence: 8 }), null);
  });

  it("uses the timestamp contract for older runtimes", () => {
    assert.equal(audioEventKey(base), "runtime-1:session-1:123:hit:Punto");
    assert.equal(audioEventKey({ ...base, lastEventUnixNanos: 0 }), null);
  });
});

describe("cueVoices", () => {
  it("gives common gameplay cues distinct envelopes", () => {
    assert.equal(cueVoices("none").length, 0);
    assert.equal(cueVoices("tick").length, 1);
    assert.equal(cueVoices("start").length, 3);
    assert.equal(cueVoices("doubleCoin").length, 3);
    assert.equal(cueVoices("win").length, 4);
    assert.ok(cueVoices("fail")[0]!.frequency > cueVoices("fail").at(-1)!.frequency);
    assert.notDeepEqual(cueVoices("hit"), cueVoices("damage"));
  });
});

describe("gameAudioURL", () => {
  it("keeps revision-owned audio inside the display asset root", () => {
    assert.equal(gameAudioURL("audio/duelo/music/waiting-loop.mp3").href, "http://127.0.0.1/display/audio/duelo/music/waiting-loop.mp3");
    assert.throws(() => gameAudioURL("../private.mp3"), /invalid/u);
    assert.throws(() => gameAudioURL("https://example.com/music.mp3"), /invalid/u);
  });
});

describe("VenueAudioOutput", () => {
  it("ignores a stale resume after the output is reconfigured", async () => {
    const states: string[] = [];
    const first = fakeAudioContext("suspended");
    const second = fakeAudioContext("running");
    const contexts = [first.context, second.context];
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput((state) => states.push(state), () => contexts.shift()!);

    output.configure(true, false);
    output.configure(false, true);
    output.configure(true, false);
    first.resolveResume();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(states.at(-1), "ready");
    await output.dispose();
  });

  it("plays the recorded test phrase through the output even when game audio is muted", async () => {
    const fake = fakeAudioContext("running");
    const sample = { duration: 0.42 } as AudioBuffer;
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(() => {}, () => fake.context, async () => sample);

    output.configure(true, true);
    let started = 0;
    const result = output.playTestPhrase(() => { started += 1; });
    await new Promise((resolve) => setImmediate(resolve));

    const source = fake.sources[0];
    assert.ok(source);
    assert.equal(source.buffer, sample);
    assert.equal(source.started, true);
    assert.equal(started, 1);
    source.onended?.call(source as unknown as AudioBufferSourceNode, new Event("ended"));
    assert.equal(await result, true);
    await output.dispose();
  });

  it("reports a failed test when the recorded phrase cannot be loaded", async () => {
    const fake = fakeAudioContext("running");
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(
      () => {},
      () => fake.context,
      async () => { throw new Error("missing sample"); },
    );
    output.configure(true, false);
    assert.equal(await output.playTestPhrase(), false);
    await output.dispose();
  });

  it("cancels a deferred phrase load before any source can start", async () => {
    const fake = fakeAudioContext("running");
    const sample = { duration: 0.42 } as AudioBuffer;
    let resolveSample!: (buffer: AudioBuffer) => void;
    let loaderSignal: AbortSignal | null = null;
    const deferredSample = new Promise<AudioBuffer>((resolve) => { resolveSample = resolve; });
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(
      () => {},
      () => fake.context,
      async (_context, signal) => {
        loaderSignal = signal;
        return deferredSample;
      },
    );
    output.configure(true, false);

    const result = output.playTestPhrase();
    await new Promise((resolve) => setImmediate(resolve));
    output.cancelTestPhrase();
    resolveSample(sample);

    assert.equal(loaderSignal?.aborted, true);
    assert.equal(await result, false);
    assert.equal(fake.sources.length, 0, "a cancelled deferred load must never reach source.start");
    await output.dispose();
  });

  it("stops a phrase which is already playing", async () => {
    const fake = fakeAudioContext("running");
    const sample = { duration: 0.42 } as AudioBuffer;
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(() => {}, () => fake.context, async () => sample);
    output.configure(true, false);

    const result = output.playTestPhrase();
    await new Promise((resolve) => setImmediate(resolve));
    const source = fake.sources[0];
    assert.ok(source?.started);

    output.cancelTestPhrase();

    assert.equal(source.stopped, true);
    assert.equal(await result, false);
    await output.dispose();
  });

  it("aborts a stalled recorded-phrase request", async () => {
    const fake = fakeAudioContext("running");
    globalThis.fetch = ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    })) as typeof fetch;

    await assert.rejects(
      loadAudioTestSample(fake.context, new URL("http://127.0.0.1/audio/probando.wav"), 5),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });

  it("drops dense effects once the bounded Web Audio voice budget is full", async () => {
    const fake = fakeAudioContext("running");
    const sample = { duration: 0.68 } as AudioBuffer;
    let now = 0;
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
    fake.decodeBuffer = sample;
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(
      () => {},
      () => fake.context,
      async () => sample,
      () => now,
    );
    output.configure(true, false);

    for (let effect = 0; effect < 9; effect += 1) {
      now += 60;
      output.playEffect("audio/duelo/sfx/tile-claim.mp3", 0.55, 1, "tile-claim");
      await new Promise((resolve) => setImmediate(resolve));
    }

    assert.equal(fake.sources.length, 6, "dense effects must be dropped instead of creating an audio backlog");
    fake.sources[0]!.onended?.call(fake.sources[0]!, new Event("ended"));
    now += 60;
    output.playEffect("audio/duelo/sfx/tile-claim.mp3", 0.55, 1, "tile-claim");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fake.sources.length, 7, "the next effect may play as soon as a voice is free");
    await output.dispose();
  });

  it("stops an active narration immediately", async () => {
    const fake = fakeAudioContext("running");
    fake.decodeBuffer = { duration: 18.715 } as AudioBuffer;
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
    const { VenueAudioOutput } = await import("../src/audio.ts");
    const output = new VenueAudioOutput(() => {}, () => fake.context);
    output.configure(true, false);

    output.playNarration("audio/duelo/narration/intro.mp3", 0.9);
    await new Promise((resolve) => setImmediate(resolve));
    const source = fake.sources[0];
    assert.ok(source?.started);

    output.cancelNarration();

    assert.equal(source.stopped, true);
    await output.dispose();
  });
});

function fakeAudioContext(initialState: AudioContextState): {
  context: AudioContext;
  decodeBuffer?: AudioBuffer;
  resolveResume: () => void;
  sources: Array<AudioBufferSourceNode & { started: boolean; stopped: boolean }>;
} {
  let state = initialState;
  let resolveResume = () => {};
  const resume = new Promise<void>((resolve) => {
    resolveResume = () => {
      state = "running";
      resolve();
    };
  });
  const gain = {
    connect() {},
    disconnect() {},
    gain: { setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  } as unknown as GainNode;
  const sources: Array<AudioBufferSourceNode & { started: boolean; stopped: boolean }> = [];
  const result: {
    context: AudioContext;
    decodeBuffer?: AudioBuffer;
    resolveResume: () => void;
    sources: Array<AudioBufferSourceNode & { started: boolean; stopped: boolean }>;
  } = { context: undefined as unknown as AudioContext, resolveResume, sources };
  const context = {
    currentTime: 0,
    destination: {},
    get state() { return state; },
    set onstatechange(value: ((this: BaseAudioContext, ev: Event) => unknown) | null) { void value; },
    createGain: () => gain,
    createBufferSource: () => {
      const source = {
        buffer: null,
        playbackRate: { setValueAtTime() {} },
        started: false,
        stopped: false,
        onended: null,
        connect() {},
        disconnect() {},
        start() { source.started = true; },
        stop() { source.stopped = true; },
      } as unknown as AudioBufferSourceNode & { started: boolean; stopped: boolean };
      sources.push(source);
      return source;
    },
    createOscillator: () => ({}) as OscillatorNode,
    decodeAudioData: async () => result.decodeBuffer ?? ({ duration: 0.1 } as AudioBuffer),
    resume: () => resume,
    close: async () => { state = "closed"; },
  } as unknown as AudioContext;
  result.context = context;
  return result;
}
