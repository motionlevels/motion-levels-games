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

const tiraSogaStyles = `
.tira-soga-display {
  display: grid;
  gap: 18px;
  grid-template-rows: minmax(220px, .72fr) minmax(150px, .42fr) 108px minmax(210px, .54fr);
  min-height: 0;
  position: relative;
}
.tira-soga-scoreboard .ml-player-score-panel > strong { font-size: clamp(132px, 9vw, 190px); }
.tira-soga-scoreboard .ml-versus-center strong { font-size: clamp(64px, 4.6vw, 92px); }
.tira-soga-arena {
  align-items: stretch;
  background: linear-gradient(90deg, rgba(255,28,40,.17), rgba(7,10,17,.92) 31%, rgba(7,10,17,.92) 69%, rgba(20,92,255,.2));
  border: 1px solid rgba(255,255,255,.2);
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 150px;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.tira-soga-team {
  align-content: center;
  display: grid;
  font-size: 28px;
  font-weight: 950;
  letter-spacing: .1em;
  text-align: center;
  text-transform: uppercase;
}
.tira-soga-team.is-red { background: rgba(255,28,40,.2); color: #ff7b84; }
.tira-soga-team.is-blue { background: rgba(20,92,255,.22); color: #79a0ff; }
.tira-soga-track {
  align-self: center;
  height: 78px;
  margin: 0 42px;
  position: relative;
}
.tira-soga-rope {
  background: repeating-linear-gradient(105deg, #8d571d 0 8px, #f4c56a 8px 16px, #b87527 16px 24px);
  box-shadow: 0 0 24px rgba(244,197,106,.32);
  height: 18px;
  left: 0;
  position: absolute;
  right: 0;
  top: 30px;
}
.tira-soga-center {
  background: rgba(255,255,255,.65);
  bottom: 2px;
  left: 50%;
  position: absolute;
  top: 2px;
  width: 2px;
}
.tira-soga-knot {
  background: #fff7d6;
  border: 6px solid #d99331;
  border-radius: 50%;
  box-shadow: 0 0 0 7px rgba(255,159,28,.16), 0 0 30px rgba(255,247,214,.8);
  height: 42px;
  left: var(--tira-soga-rope-x);
  position: absolute;
  top: 18px;
  transform: translateX(-50%);
  transition: left 160ms cubic-bezier(.2,.9,.2,1);
  width: 42px;
  z-index: 2;
}
.tira-soga-caption {
  bottom: 8px;
  color: #fff;
  font-size: 25px;
  font-weight: 950;
  left: 190px;
  letter-spacing: .04em;
  position: absolute;
  right: 190px;
  text-align: center;
  text-shadow: 0 2px 12px #000;
}
.tira-soga-result {
  align-content: center;
  background: rgba(3,6,12,.88);
  display: grid;
  inset: 0;
  justify-items: center;
  position: absolute;
  z-index: 4;
}
.tira-soga-result strong { color: #fff; font-size: 54px; line-height: 1; }
.tira-soga-result span { color: #f4c56a; font-size: 21px; font-weight: 900; margin-top: 10px; text-transform: uppercase; }
.tira-soga-display.is-phase-waiting .tira-soga-knot {
  animation: tira-soga-waiting 1.25s ease-in-out infinite;
}
.tira-soga-display.is-phase-starting .tira-soga-rope {
  animation: tira-soga-starting .36s linear infinite;
}
.tira-soga-result.is-round-win {
  animation: tira-soga-round-win .52s ease-in-out infinite alternate;
  background: rgba(3,6,12,.82);
}
.tira-soga-result.is-game-win {
  animation: tira-soga-game-win .8s ease-in-out infinite alternate;
  background: linear-gradient(110deg, rgba(3,6,12,.9), rgba(244,197,106,.24), rgba(3,6,12,.9));
  background-size: 220% 100%;
}
.tira-soga-result.is-game-win strong { font-size: 68px; }
@keyframes tira-soga-waiting {
  0%, 100% { box-shadow: 0 0 0 5px rgba(255,159,28,.12), 0 0 18px rgba(255,247,214,.5); }
  50% { box-shadow: 0 0 0 12px rgba(255,159,28,.25), 0 0 38px rgba(255,247,214,.95); }
}
@keyframes tira-soga-starting {
  from { background-position: 0 0; }
  to { background-position: 24px 0; }
}
@keyframes tira-soga-round-win {
  from { box-shadow: inset 0 0 35px rgba(244,197,106,.2); }
  to { box-shadow: inset 0 0 90px rgba(244,197,106,.58); }
}
@keyframes tira-soga-game-win {
  from { background-position: 0 0; }
  to { background-position: 100% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .tira-soga-display .tira-soga-knot,
  .tira-soga-display .tira-soga-rope,
  .tira-soga-display .tira-soga-result {
    animation: none !important;
    transition: none !important;
  }
}
.tira-soga-metrics .ml-metric { padding-block: 20px; }
.tira-soga-metrics .ml-metric-value { font-size: 52px; }
.tira-soga-rounds {
  gap: 8px;
  grid-template-rows: auto 5px minmax(76px, 1fr);
  padding: 14px 18px 16px;
}
.tira-soga-rounds .ml-round-strip-title { gap: 4px; }
.tira-soga-rounds .ml-round-strip-title > span { font-size: 20px; }
.tira-soga-rounds .ml-round-strip-title small { font-size: 13px; }
.tira-soga-rounds .ml-round-strip-count strong { font-size: 36px; }
.tira-soga-rounds .ml-round-strip-count span { font-size: 15px; }
.tira-soga-rounds .ml-round-card {
  align-content: start;
  gap: 5px;
  padding: 9px 12px 12px;
}
.tira-soga-rounds .ml-round-card-head span { font-size: 14px; }
.tira-soga-rounds .ml-round-card strong {
  font-size: 21px;
  line-height: 1.05;
}
.tira-soga-rounds .ml-round-card b {
  font-size: 12px;
  line-height: 1.15;
  white-space: normal;
}
`;

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
        <style>{tiraSogaStyles}</style>
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
