/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import {
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  MetricPanel,
  MetricRow
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame, type GameSnapshot } from "@motion-levels-games/game-sdk";

import type { PublishedLevelSnapshot } from "./types.ts";

/** Shared Spanish TV display for platform-authored level games. */
export function PublishedLevelPlayerDisplay({
  snapshot: rawSnapshot,
  frame
}: {
  snapshot: GameSnapshot;
  frame?: Frame;
}) {
  const snapshot = rawSnapshot as PublishedLevelSnapshot;
  const countdown = Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000));
  const maxLives = Math.max(1, snapshot.maxLives ?? snapshot.lives);
  const lifeScale = Math.min(1, 3.3 / maxLives);
  const lifeStyle = {
    display: "block",
    transform: `scale(${lifeScale})`,
    transformOrigin: "left center",
    width: `${100 / lifeScale}%`
  } satisfies CSSProperties;
  const phase = snapshot.phase === "countdown" ? "starting" : snapshot.phase;
  const clockMillis = snapshot.mode === "challenge" && snapshot.remainingMillis > 0
    ? snapshot.remainingMillis
    : snapshot.elapsedMillis;

  return (
    <GameDisplayShell title={snapshot.label} phase={phase}>
      <div className={`ml-solo-display published-level-display is-${snapshot.phase}`}>
        {snapshot.phase === "countdown" ? (
          <section
            aria-label="El nivel está a punto de empezar"
            className="ml-player-ready-overlay is-starting"
          >
            <div className="ml-player-ready-pulse" aria-hidden="true"><i /><i /><i /></div>
            <span>{snapshot.levelLabel || "Siguiente nivel"}</span>
            <strong>{countdown}</strong>
            <b>Busca una zona verde y prepárate</b>
          </section>
        ) : null}

        <div className="ml-solo-summary">
          <MetricRow columns={3} className="ml-solo-number-row">
            <MetricPanel label="Puntos" tone="green" value={snapshot.score} />
            <MetricPanel
              label="Vidas"
              tone="red"
              value={(
                <span style={lifeStyle}>
                  <LivesMeter lives={snapshot.lives} maxLives={maxLives} />
                </span>
              )}
            />
            <MetricPanel label="Tiempo" tone="cyan" value={formatClock(clockMillis)} />
          </MetricRow>
          <MetricPanel
            className="ml-solo-message"
            label={messageLabel(snapshot)}
            tone={snapshot.phase === "finished" ? snapshot.success ? "green" : "red" : "blue"}
            value={messageValue(snapshot)}
          />
        </div>
        {frame ? <FramePreviewPanel className="ml-solo-floor" frame={frame} label="Juego en el suelo" /> : null}
      </div>
    </GameDisplayShell>
  );
}

function messageLabel(snapshot: PublishedLevelSnapshot): string {
  if (snapshot.phase === "finished") return snapshot.success ? "Resultado" : "Reintento";
  return snapshot.levelCount > 1
    ? `Nivel ${Math.max(1, snapshot.levelNumber)} de ${snapshot.levelCount}`
    : "Misión";
}

function messageValue(snapshot: PublishedLevelSnapshot): string {
  if (snapshot.phase === "finished") {
    if (snapshot.success) {
      return snapshot.isFinalLevel ? "¡Juego completado!" : "¡Nivel superado!";
    }
    const seconds = Math.max(1, Math.ceil(snapshot.resultMillis / 1_000));
    return `Vuelve a intentarlo en ${seconds}`;
  }
  const currentMillis = snapshot.phase === "countdown"
    ? snapshot.attemptStartedMillis - snapshot.countdownMillis
    : snapshot.attemptStartedMillis + snapshot.elapsedMillis;
  const recentSemanticEvent = ["coin", "doubleCoin", "damage"].includes(snapshot.lastEventCue)
    && currentMillis - snapshot.lastEventMillis <= 2_500;
  if (recentSemanticEvent && snapshot.lastEventMessage) return snapshot.lastEventMessage;
  if (snapshot.objectivesRemaining > 0) {
    return snapshot.objectivesRemaining === 1 ? "Queda 1 objetivo" : `Quedan ${snapshot.objectivesRemaining} objetivos`;
  }
  return snapshot.levelDescription || "Recoge los objetivos y evita las baldosas rojas";
}
