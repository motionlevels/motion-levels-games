import type { ReactNode } from "react";
import type { PlayerExperienceRecordingGate } from "@motion-levels-games/player-experience";
import { recordingGateDisplayProjection } from "./recordingGate.ts";

export function RecordingGateDisplay({
  gate,
  children,
}: {
  gate: PlayerExperienceRecordingGate | undefined;
  children: ReactNode;
}) {
  const projection = recordingGateDisplayProjection(gate);
  return (
    <div className="recording-gate-display-host">
      {children}
      {projection?.blocking ? (
        <section
          className={`recording-gate-display-overlay state-${projection.state}`}
          role={projection.state === "timed_out" ? "alert" : "status"}
          aria-live={projection.state === "timed_out" ? "assertive" : "polite"}
          aria-atomic="true"
          aria-busy={projection.state === "arming" || undefined}
        >
          <div className="recording-gate-display-card">
            <div className="recording-gate-display-symbol" aria-hidden="true">
              {projection.state === "arming" ? <span /> : "!"}
            </div>
            <div className="recording-gate-display-copy">
              <span>Grabación por intento</span>
              <h1>{projection.title}</h1>
              <p>{projection.body}</p>
            </div>
          </div>
        </section>
      ) : projection?.state === "ready" ? (
        <div className="recording-gate-display-ready" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{projection.title}</strong>
            <small>{projection.body}</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}
