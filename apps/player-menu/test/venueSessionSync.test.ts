import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMenuMirrorEnvelope } from "../src/menuMirror.ts";
import {
  clearedVenueSessionProjection,
  commitVenueSessionRecordingScope,
  venueSessionRecordingCanRequest,
  venueSessionRecordingScope,
  venueSessionSyncDecision,
  type VenueSessionObservation,
} from "../src/venueSessionSync.ts";

const inactiveMenu = {
  sessionActive: false,
  sessionId: "",
  sessionStartedUnix: 0,
  teamName: "",
};

const activeMenu = {
  sessionActive: true,
  sessionId: "venue-session-a",
  sessionStartedUnix: 123,
  teamName: "Equipo A",
};

describe("venue session synchronization", () => {
  it("hydrates a kiosk after a remote session begins", () => {
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "venue-session-a",
      venueSessionStartedUnix: 123,
      teamName: "Equipo A",
    }, null, inactiveMenu);

    assert.equal(decision.action, "hydrate");
  });

  it("keeps a venue visit open when only the game exits", () => {
    const previous: VenueSessionObservation = { runId: "runtime-a", venueSessionId: "venue-session-a" };
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "venue-session-a",
      venueSessionStartedUnix: 123,
      teamName: "Equipo A",
    }, previous, activeMenu);

    assert.equal(decision.action, "none");
  });

  it("leaves detailed menu edits with the kiosk during the same session", () => {
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "venue-session-a",
      venueSessionStartedUnix: 123,
      teamName: "Nombre anterior del runtime",
    }, { runId: "runtime-a", venueSessionId: "venue-session-a" }, {
      ...activeMenu,
      teamName: "Nombre editado en el quiosco",
    });

    assert.equal(decision.action, "none");
  });

  it("hydrates an authoritative recording-policy change within the same session", () => {
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "venue-session-a",
      venueSessionStartedUnix: 123,
      teamName: "Equipo A",
      venueSessionRecordingPolicy: { scope: "run" },
    }, { runId: "runtime-a", venueSessionId: "venue-session-a" }, {
      ...activeMenu,
      recordingPolicy: "visit" as const,
    });

    assert.equal(decision.action, "hydrate");
  });

  it("does not rehydrate when the session and recording policy already match", () => {
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "venue-session-a",
      venueSessionStartedUnix: 123,
      teamName: "Equipo A",
      venueSessionRecordingPolicy: { scope: "selection" },
    }, { runId: "runtime-a", venueSessionId: "venue-session-a" }, {
      ...activeMenu,
      recordingPolicy: "selection" as const,
    });

    assert.equal(decision.action, "none");
  });

  it("keeps requested policy separate from effective recording availability", () => {
    assert.equal(venueSessionRecordingScope({
      venueSessionRecordingAvailable: false,
      venueSessionRecordingEnabled: false,
      venueSessionRecordingPolicy: { scope: "run" },
    }), "run");
    assert.equal(venueSessionRecordingScope({
      venueSessionRecordingAvailable: false,
      venueSessionRecordingEnabled: false,
    }, "selection"), "selection");
    assert.equal(venueSessionRecordingScope({
      venueSessionRecordingEnabled: false,
    }), "off");
  });

  it("allows an explicit retry when recording is configured but currently degraded", () => {
    assert.equal(venueSessionRecordingCanRequest({
      venueSessionRecordingConfigured: true,
      venueSessionRecordingAvailable: false,
      venueSessionRecordingEnabled: false,
    }), true);
    assert.equal(venueSessionRecordingCanRequest({
      venueSessionRecordingConfigured: false,
      venueSessionRecordingAvailable: false,
    }), false);
    assert.equal(venueSessionRecordingCanRequest({ venueSessionRecordingAvailable: false }), false);
    assert.equal(venueSessionRecordingCanRequest({ venueSessionRecordingAvailable: true }), true);
  });

  it("uses engine authority on success and restores the previous scope on failure", async () => {
    const authoritative = await commitVenueSessionRecordingScope(
      "visit",
      "run",
      async () => ({ venueSessionRecordingPolicy: { scope: "selection" as const } }),
      () => "falló",
    );
    assert.deepEqual(authoritative, {
      ok: true,
      scope: "selection",
      status: { venueSessionRecordingPolicy: { scope: "selection" } },
    });

    const restored = await commitVenueSessionRecordingScope(
      "off",
      "visit",
      async () => { throw new Error("network"); },
      () => "No se pudo guardar; restaurado",
    );
    assert.deepEqual(restored, {
      error: "No se pudo guardar; restaurado",
      ok: false,
      scope: "off",
      status: null,
    });
  });

  it("clears the kiosk mirror after a remote close in the same runtime", () => {
    const previous: VenueSessionObservation = { runId: "runtime-a", venueSessionId: "venue-session-a" };
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "",
      venueSessionStartedUnix: 0,
      teamName: "",
    }, previous, activeMenu);

    assert.equal(decision.action, "clear");

    const staleKioskMenu = {
      ...activeMenu,
      players: [{ id: 7, name: "Jugador remoto" }],
      recordingEnabled: false,
    };
    const cleanKioskMenu = {
      ...staleKioskMenu,
      ...clearedVenueSessionProjection([{ id: 1, name: "" }]),
    };
    const remoteMirror = resolveMenuMirrorEnvelope({
      version: 2,
      updatedUnixMillis: 200,
      snapshot: { menu: cleanKioskMenu },
    }, 1, 100);

    assert.equal(remoteMirror.accepted, true);
    assert.equal(remoteMirror.snapshot?.menu.sessionActive, false);
    assert.equal(remoteMirror.snapshot?.menu.teamName, "");
    assert.deepEqual(remoteMirror.snapshot?.menu.players, [{ id: 1, name: "" }]);
    assert.equal(remoteMirror.snapshot?.menu.recordingPolicy, "selection");
  });

  it("recovers persisted kiosk state into a freshly restarted runtime", () => {
    const previous: VenueSessionObservation = { runId: "runtime-before-restart", venueSessionId: "venue-session-a" };
    const decision = venueSessionSyncDecision({
      runId: "runtime-after-restart",
      venueSessionId: "",
      venueSessionStartedUnix: 0,
      teamName: "",
    }, previous, activeMenu);

    assert.equal(decision.action, "recover");
  });

  it("does not resurrect stale kiosk state after a browser-only reload", () => {
    const previous: VenueSessionObservation = { runId: "runtime-a", venueSessionId: "" };
    const decision = venueSessionSyncDecision({
      runId: "runtime-a",
      venueSessionId: "",
      venueSessionStartedUnix: 0,
      teamName: "",
    }, previous, activeMenu);

    assert.equal(decision.action, "clear");
  });
});
