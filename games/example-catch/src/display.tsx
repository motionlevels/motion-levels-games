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
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display example-catch-display">
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Tiempo" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
            <MetricPanel label="Puntos" tone="pink" value={snapshot.score} />
            <MetricPanel label="Objetivos" tone="cyan" value={snapshot.activeTargets} />
          </MetricRow>
          <MetricPanel
            className="ml-solo-message"
            label="Mensaje"
            tone={snapshot.success ? "green" : "cyan"}
            value={snapshot.lastEventMessage || "Pisa la baldosa azul"}
          />
        </div>

        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Objetivo en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
