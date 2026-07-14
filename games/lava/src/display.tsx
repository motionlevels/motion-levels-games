/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, LivesMeter, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { LavaSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: LavaSnapshot; frame?: Frame }) {
  return <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
    <div className="ml-solo-display"><PlayerReadyOverlay snapshot={snapshot} />
      <div className="ml-solo-summary"><MetricRow columns={3} className="ml-solo-number-row">
        <MetricPanel label="Plataformas" tone="green" value={snapshot.score} />
        <MetricPanel label="Tiempo" tone="cyan" value={formatClock(snapshot.remainingMillis)} />
        <MetricPanel label="Vidas" tone="red" value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />} />
      </MetricRow><MetricPanel className="ml-solo-message" label="Equipo" tone={snapshot.success ? "green" : snapshot.lives === 0 ? "red" : "yellow"} value={snapshot.lastEventMessage || "Pisa solo las plataformas verdes"} /></div>
      {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Lava en el suelo" /> : null}
    </div>
  </GameDisplayShell>;
}
