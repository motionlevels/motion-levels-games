import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimPlayerDisplayReload,
  playerDisplayReloadURL,
  revisionConvergenceDecision,
} from "../src/revisionConvergence.ts";

const oldRevision = "1".repeat(40);
const newRevision = "2".repeat(40);

describe("revisionConvergenceDecision", () => {
  it("ignores development builds and matching releases", () => {
    assert.equal(revisionConvergenceDecision({
      shellRevision: "development",
      sourceRevision: newRevision,
      lifecycle: "idle",
      renderStatus: "ready",
    }), "current");
    assert.equal(revisionConvergenceDecision({
      shellRevision: newRevision,
      sourceRevision: newRevision,
      lifecycle: "idle",
      renderStatus: "ready",
    }), "current");
  });

  it("waits for a healthy renderer and a non-playing lifecycle", () => {
    assert.equal(revisionConvergenceDecision({
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      lifecycle: "running",
      renderStatus: "ready",
    }), "defer");
    assert.equal(revisionConvergenceDecision({
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      lifecycle: "idle",
      renderStatus: "loading",
    }), "defer");
    assert.equal(revisionConvergenceDecision({
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      lifecycle: "waiting",
      renderStatus: "ready",
    }), "reload");
  });

  it("reloads a renderer that is already unable to show the game", () => {
    assert.equal(revisionConvergenceDecision({
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      lifecycle: "running",
      renderStatus: "fallback",
    }), "reload");
    assert.equal(revisionConvergenceDecision({
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      lifecycle: "paused",
      renderStatus: "error",
    }), "reload");
  });
});

describe("player display reload claim", () => {
  it("preserves the kiosk URL while cache-busting it with the target revision", () => {
    assert.equal(
      playerDisplayReloadURL("http://127.0.0.1/display/?kioskViewport=1920x1080", newRevision),
      `http://127.0.0.1/display/?kioskViewport=1920x1080&ml-display-revision=${newRevision}`,
    );
  });

  it("claims one reload per shell/target pair and cannot loop without storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const input = {
      currentURL: "http://127.0.0.1/display/",
      shellRevision: oldRevision,
      sourceRevision: newRevision,
      storage,
    };
    assert.equal(claimPlayerDisplayReload(input), true);
    assert.equal(claimPlayerDisplayReload(input), false);
    assert.equal(claimPlayerDisplayReload({
      ...input,
      currentURL: playerDisplayReloadURL(input.currentURL, newRevision),
      storage: undefined,
    }), false);
  });
});
