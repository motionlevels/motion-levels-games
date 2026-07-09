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
      <MetricRow columns={4}>
        <MetricPanel label="Time" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
        <MetricPanel label="Score" tone="pink" value={snapshot.score} />
        <MetricPanel label="Targets" tone="cyan" value={snapshot.activeTargets} />
        <MetricPanel label="Players" tone="green" value={snapshot.playerCount} />
      </MetricRow>

      {frame ? <FramePreviewPanel frame={frame} /> : null}
    </GameDisplayShell>
  );
}
