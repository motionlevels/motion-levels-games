import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { audioEventKey, cueVoices, loadAudioTestSample } from "../src/audio.ts";

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
});

function fakeAudioContext(initialState: AudioContextState): {
  context: AudioContext;
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
  const context = {
    currentTime: 0,
    destination: {},
    get state() { return state; },
    set onstatechange(value: ((this: BaseAudioContext, ev: Event) => unknown) | null) { void value; },
    createGain: () => gain,
    createBufferSource: () => {
      const source = {
        buffer: null,
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
    resume: () => resume,
    close: async () => { state = "closed"; },
  } as unknown as AudioContext;
  return { context, resolveResume, sources };
}
