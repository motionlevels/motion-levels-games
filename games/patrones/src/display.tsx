/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { PatronesSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: PatronesSnapshot; frame?: Frame }) {
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Aciertos" tone="green" value={snapshot.claimedTargets} />
            <MetricPanel label="Objetivos" tone="blue" value={snapshot.totalTargets} />
            <MetricPanel label="Tiempo" tone="cyan" value={formatClock(snapshot.remainingMillis)} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Patrón" tone={snapshot.success ? "green" : "yellow"} value={snapshot.lastEventMessage || "Reconstruye el patrón azul"} />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Patrón en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
