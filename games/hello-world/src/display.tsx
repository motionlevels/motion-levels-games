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
      <MetricRow columns={4}>
        <MetricPanel label="Goal" tone="green" value={`${snapshot.score}/${target}`} />
        <MetricPanel label="Time" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
        <MetricPanel label="Cue" tone={snapshot.success ? "green" : "cyan"} value={snapshot.lastEventMessage || "Ready"} />
        <MetricPanel label="Targets" tone="blue" value={snapshot.activeTargets} />
      </MetricRow>

      {frame ? <FramePreviewPanel frame={frame} label="Example floor" /> : null}
    </GameDisplayShell>
  );
}
