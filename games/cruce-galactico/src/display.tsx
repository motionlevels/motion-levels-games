/** @jsxRuntime automatic */
import {
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  MetricPanel,
  MetricRow,
  PlayerReadyOverlay,
  ResultOverlay
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { GalacticCrossingSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: GalacticCrossingSnapshot; frame?: Frame }) {
  const message = snapshot.phase === "finished"
    ? snapshot.success ? "¡Portal alcanzado!" : "La misión ha terminado"
    : snapshot.lastEventMessage || "Avanza hacia el control verde";
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Controles" tone="green" value={`${snapshot.checkpoint}/${snapshot.checkpointTarget}`} />
            <MetricPanel label="Vidas" tone="neutral" value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />} />
            <MetricPanel label="Tiempo" tone="cyan" value={formatClock(snapshot.remainingMillis)} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Misión" tone={snapshot.success ? "green" : snapshot.lives === 0 ? "red" : "blue"} value={message} />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Corredores en el suelo" /> : null}
        <ResultOverlay
          eyebrow={snapshot.success ? "Misión cumplida" : "Fin de la misión"}
          message={snapshot.success ? "El portal está abierto" : snapshot.lastEventMessage}
          title={snapshot.success ? "¡Portal alcanzado!" : "Misión terminada"}
          tone={snapshot.success ? "green" : "red"}
          visible={snapshot.phase === "finished" || snapshot.celebrating}
        />
      </div>
    </GameDisplayShell>
  );
}
