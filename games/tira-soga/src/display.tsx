/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import {
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  PlayerReadyOverlay,
  RoundStrip,
  VersusScoreboard
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { TiraSogaSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({
  snapshot
}: {
  snapshot: TiraSogaSnapshot;
  frame?: Frame;
}) {
  const [red, blue] = snapshot.players;
  const redPlayer = red ?? { label: "Rojo", score: 0, color: "#ff1c28" };
  const bluePlayer = blue ?? { label: "Azul", score: 0, color: "#145cff" };
  const currentRound = snapshot.currentRound ?? 1;
  const totalRounds = snapshot.totalRounds ?? 5;
  const pressesPerAdvance = snapshot.pressesPerAdvance ?? 1;
  const ropePosition = snapshot.ropePosition ?? 0;
  const ropeLimit = snapshot.ropeLimit ?? 6;
  const rounds = snapshot.rounds ?? [];
  const ropePercent = 50 + (ropePosition / Math.max(ropeLimit, 1)) * 43;
  const winnerLabel = snapshot.winnerIndex === 0 ? "Rojo" : "Azul";
  const roundWinnerLabel = snapshot.roundWinnerIndex === 0 ? "Rojo" : "Azul";
  const hasRoundResult = snapshot.phase !== "finished" && snapshot.roundWinnerIndex !== -1;
  const readyVisible = snapshot.phase === "waiting" || snapshot.phase === "starting";
  const centerLabel = snapshot.phase === "waiting"
    ? "Listos"
    : snapshot.phase === "starting"
      ? "Empieza en"
      : "Ronda";
  const centerValue = snapshot.phase === "waiting"
    ? `${snapshot.readyPlayers ?? 0}/${snapshot.requiredPlayers ?? 2}`
    : snapshot.phase === "starting"
      ? formatClock(snapshot.countdownMillis ?? 0)
      : `${currentRound}/${totalRounds}`;
  const centerCaption = readyVisible
    ? snapshot.phase === "waiting" ? "en posición" : "preparados"
    : `${snapshot.difficultyLabel ?? "Medio"} · ${pressesPerAdvance} ${pressesPerAdvance === 1 ? "pisada" : "pisadas"} por avance`;
  const caption = snapshot.phase === "finished"
    ? `Victoria ${winnerLabel}`
    : hasRoundResult
      ? `Ronda para ${roundWinnerLabel.toLowerCase()}`
      : ropePosition === 0
        ? "¡Pisad vuestro campo para tirar!"
        : ropePosition < 0
          ? "Rojo toma ventaja"
          : "Azul toma ventaja";

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase} variant="versus">
      <div
        className={`tira-soga-display is-phase-${snapshot.phase}`}
        style={{ "--tira-soga-rope-x": `${ropePercent}%` } as CSSProperties}
      >
        <PlayerReadyOverlay snapshot={snapshot} />
        <VersusScoreboard
          className="tira-soga-scoreboard"
          left={redPlayer}
          right={bluePlayer}
          target={snapshot.matchTarget ?? 3}
          centerLabel={centerLabel}
          centerValue={centerValue}
          centerCaption={centerCaption}
        />

        <section className="tira-soga-arena" aria-label={`Posición de la soga: ${ropePosition}`}>
          <span className="tira-soga-team is-red">Rojo</span>
          <div className="tira-soga-track" aria-hidden="true">
            <i className="tira-soga-rope" />
            <i className="tira-soga-center" />
            <i className="tira-soga-knot" />
          </div>
          <span className="tira-soga-team is-blue">Azul</span>
          <strong className="tira-soga-caption">{caption}</strong>
          {snapshot.phase === "finished" ? (
            <div className="tira-soga-result is-game-win">
              <strong>¡Gana {winnerLabel}!</strong>
              <span>Resultado final {redPlayer.score} – {bluePlayer.score}</span>
            </div>
          ) : hasRoundResult ? (
            <div className="tira-soga-result is-round-win">
              <strong>Ronda para {roundWinnerLabel}</strong>
              <span>Siguiente ronda en breve</span>
            </div>
          ) : null}
        </section>

        <MetricRow columns={4} className="tira-soga-metrics">
          <MetricPanel label="Pisadas rojas" tone="red" value={snapshot.redPresses ?? 0} />
          <MetricPanel label="Avance rojo" tone="amber" value={`${snapshot.redProgress ?? 0}/${pressesPerAdvance}`} />
          <MetricPanel label="Avance azul" tone="cyan" value={`${snapshot.blueProgress ?? 0}/${pressesPerAdvance}`} />
          <MetricPanel label="Pisadas azules" tone="blue" value={snapshot.bluePresses ?? 0} />
        </MetricRow>

        <RoundStrip
          className="tira-soga-rounds"
          activeCaption="Soga en juego"
          activeLabel="En juego"
          activeRound={snapshot.phase === "finished" ? null : currentRound}
          rounds={rounds}
          totalRounds={totalRounds}
        />
      </div>
    </GameDisplayShell>
  );
}
