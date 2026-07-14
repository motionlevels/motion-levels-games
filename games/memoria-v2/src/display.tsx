/** @jsxRuntime automatic */
import { FramePreviewPanel, GameDisplayShell, LivesMeter, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { MemoriaV2Snapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: MemoriaV2Snapshot; frame?: Frame }) {
  const message = snapshot.memoryStage === "memorize" ? `Memoriza · ${formatClock(snapshot.stageMillis)}` : snapshot.lastEventMessage;
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ml-solo-display">
        <PlayerReadyOverlay snapshot={snapshot} />
        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Nivel" tone="blue" value={`${snapshot.level}/${snapshot.totalLevels}`} />
            <MetricPanel label="Aciertos" tone="green" value={`${snapshot.claimedTargets}/${snapshot.totalTargets}`} />
            <MetricPanel label="Vidas" tone="red" value={<LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives} />} />
          </MetricRow>
          <MetricPanel className="ml-solo-message" label="Memoria" tone={snapshot.success ? "green" : snapshot.memoryStage === "game-loss" ? "red" : "yellow"} value={message} />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Figura en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}
