/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, LivesMeter, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { ArkanoidSnapshot } from "./game.ts";

export function PlayerDisplay({
  snapshot,
  frame
}: {
  snapshot: ArkanoidSnapshot;
  frame?: Frame;
}) {
  const message = snapshot.phase === "ready"
    ? "Pisa abajo para mover y lanzar"
    : snapshot.lastEventMessage || "Rompe todos los bloques";
  const messageTone = snapshot.success
    ? "green"
    : snapshot.phase === "finished"
      ? "red"
      : snapshot.phase === "ready"
        ? "yellow"
        : "cyan";
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display arkanoid-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Bloques" tone="pink" value={`${snapshot.score}/${snapshot.totalBricks}`} />
            <MetricPanel
              label="Vidas"
              tone="neutral"
              value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />}
            />
            <MetricPanel label="Tiempo" tone="yellow" value={formatClock(snapshot.elapsedMillis)} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Estado" tone={messageTone} value={message} />
        </div>

        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Juego en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
