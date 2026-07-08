import React from "react";
import { FloorPreview, GameDisplayShell, MetricPanel } from "@motion-levels-games/display-kit";
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
      <div className="example-display-grid">
        <MetricPanel label="Time" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
        <MetricPanel label="Score" tone="pink" value={snapshot.score} />
        <MetricPanel label="Targets" tone="cyan" value={snapshot.activeTargets} />
        <MetricPanel label="Players" tone="green" value={snapshot.playerCount} />
      </div>

      {frame ? (
        <div className="example-display-floor">
          <span className="example-display-caption">Floor preview</span>
          <FloorPreview frame={frame} />
        </div>
      ) : null}
    </GameDisplayShell>
  );
}
