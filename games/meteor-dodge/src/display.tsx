import React from "react";
import {
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  MetricPanel,
  MetricRow,
  PlayerReadyOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { MeteorDodgeSnapshot } from "./game.ts";

export function PlayerDisplay({
  snapshot,
  frame
}: {
  snapshot: MeteorDodgeSnapshot;
  frame?: Frame;
}) {
  const message = snapshot.phase === "finished"
    ? snapshot.success
      ? "¡Tormenta superada!"
      : "La tormenta te alcanzó"
    : snapshot.lastEventMessage || "Esquiva las zonas rojas";
  const messageTone = snapshot.success ? "green" : snapshot.lives === 0 ? "red" : "cyan";

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display meteor-dodge-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Esquivados" tone="cyan" value={snapshot.dodgedMeteors} />
            <MetricPanel
              label="Vidas"
              tone="neutral"
              value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />}
            />
            <MetricPanel label="Tiempo" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Estado" tone={messageTone} value={message} />
        </div>

        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Tormenta en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
