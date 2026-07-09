import React from "react";
import { GameDisplayShell, MetricPanel } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { PingPongSnapshot } from "./game.ts";

export function PlayerDisplay({
  snapshot
}: {
  snapshot: PingPongSnapshot;
  frame?: Frame;
}) {
  const [red, blue] = snapshot.players;

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="ping-pong-display">
        <section className="ping-pong-scoreboard" aria-label="Score">
          <PlayerScore label={red?.label ?? "Rojo"} score={red?.score ?? 0} color="red" target={snapshot.matchTarget} />
          <div className="ping-pong-center">
            <span>{snapshot.phase === "starting" ? "Starts in" : "Rally"}</span>
            <strong>{snapshot.phase === "starting" ? formatClock(snapshot.countdownMillis) : snapshot.roundHits}</strong>
          </div>
          <PlayerScore label={blue?.label ?? "Azul"} score={blue?.score ?? 0} color="blue" target={snapshot.matchTarget} />
        </section>

        <div className="ping-pong-metrics">
          <MetricPanel label="Target" tone="yellow" value={snapshot.matchTarget} />
          <MetricPanel label="Ready" tone="green" value={`${snapshot.activeTargets}/2`} />
          <MetricPanel label="Last" tone="pink" value={snapshot.lastRoundWinner || "-"} />
        </div>

        <ol className="ping-pong-round-list" aria-label="Rounds">
          {snapshot.rounds.slice(-5).map((round) => (
            <li className={round.winnerIndex === 0 ? "red" : "blue"} key={round.index}>
              <span>#{round.index}</span>
              <strong>{round.winnerLabel}</strong>
              <b>{round.hits}</b>
            </li>
          ))}
          {snapshot.rounds.length === 0 ? (
            <li className="pending">
              <span>#1</span>
              <strong>Pending</strong>
              <b>0</b>
            </li>
          ) : null}
        </ol>
      </div>
    </GameDisplayShell>
  );
}

function PlayerScore({
  label,
  score,
  color,
  target
}: {
  label: string;
  score: number;
  color: "red" | "blue";
  target: number;
}) {
  const progress = `${Math.min(100, (score / Math.max(target, 1)) * 100)}%`;

  return (
    <article className={`ping-pong-player ${color}`}>
      <span>{label}</span>
      <strong>{score}</strong>
      <div className="ping-pong-score-track" aria-hidden="true">
        <i style={{ width: progress }} />
      </div>
    </article>
  );
}
