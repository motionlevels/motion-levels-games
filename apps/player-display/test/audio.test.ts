import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audioEventKey, cueVoices } from "../src/audio.ts";

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
});

function fakeAudioContext(initialState: AudioContextState): {
  context: AudioContext;
  resolveResume: () => void;
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
  const context = {
    currentTime: 0,
    destination: {},
    get state() { return state; },
    set onstatechange(value: ((this: BaseAudioContext, ev: Event) => unknown) | null) { void value; },
    createGain: () => gain,
    createOscillator: () => ({}) as OscillatorNode,
    resume: () => resume,
    close: async () => { state = "closed"; },
  } as unknown as AudioContext;
  return { context, resolveResume };
}
