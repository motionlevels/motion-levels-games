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
import type { HelloWorldSnapshot } from "./game.ts";

export function PlayerDisplay({
  snapshot,
  frame
}: {
  snapshot: HelloWorldSnapshot;
  frame?: Frame;
}) {
  const target = snapshot.matchTarget ?? 5;
  const finished = snapshot.phase === "finished";
  const statusTone = snapshot.success ? "green" : snapshot.lastEventCue === "fail" ? "red" : "cyan";
  const restartSeconds = Math.max(1, Math.ceil(snapshot.celebrationMillis / 1_000));
  const statusValue = finished ? "Preparando una nueva partida" : snapshot.lastEventMessage || "Verde suma, rojo resta una vida";

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Meta" tone="green" value={`${snapshot.score}/${target}`} />
            <MetricPanel label="Vidas" tone="red" value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />} />
            <MetricPanel label="Tiempo" tone="yellow" value={formatClock(snapshot.remainingMillis)} />
          </MetricRow>
          <MetricPanel
            className="ml-solo-message"
            label={finished ? snapshot.success ? "Victoria" : "Fin de la partida" : "Estado"}
            tone={statusTone}
            value={statusValue}
          />
        </div>

        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Recorrido en el suelo" /> : null}
        <ResultOverlay
          eyebrow={snapshot.success ? "Victoria" : "Fin de la partida"}
          message={snapshot.success
            ? `Meta alcanzada · ${snapshot.score}/${target} · Reinicio en ${restartSeconds}`
            : `${snapshot.lastEventMessage}. Reinicio en ${restartSeconds}`}
          title={snapshot.success ? "¡Ganaste!" : "Sin vidas"}
          tone={snapshot.success ? "green" : "red"}
          visible={finished}
        />
      </div>
    </GameDisplayShell>
  );
}
