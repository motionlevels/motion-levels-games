/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, LivesMeter, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { SaltosSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: SaltosSnapshot; frame?: Frame }) {
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Saltos" tone="green" value={snapshot.score} />
            <MetricPanel label="Tiempo" tone="cyan" value={formatClock(snapshot.remainingMillis)} />
            <MetricPanel label="Vida" tone="red" value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Objetivo" tone={snapshot.success ? "green" : "yellow"} value={snapshot.lastEventMessage || "Salta del azul al verde"} />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Juego en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
