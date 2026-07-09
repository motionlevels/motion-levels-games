import React from "react";
import { FramePreviewPanel, GameDisplayShell, MetricPanel, MetricRow } from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type GameSnapshot } from "@motion-levels-games/game-sdk";

export function PlayerDisplay({
  snapshot,
  frame
}: {
  snapshot: GameSnapshot;
  frame?: Frame;
}) {
  const target = snapshot.matchTarget ?? 5;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display hello-world-display">
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Meta" tone="green" value={`${snapshot.score}/${target}`} />
            <MetricPanel label="Tiempo" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
            <MetricPanel label="Objetivos" tone="blue" value={snapshot.activeTargets} />
          </MetricRow>
          <MetricPanel
            className="ml-solo-message"
            label="Mensaje"
            tone={snapshot.success ? "green" : "cyan"}
            value={snapshot.lastEventMessage || "Pisa la baldosa verde"}
          />
        </div>

        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Recorrido en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
