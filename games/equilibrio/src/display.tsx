/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { EquilibrioSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot }: { snapshot: EquilibrioSnapshot; frame?: Frame }) {
  const stabilityColor = snapshot.stability > 55 ? "#5fff9e" : snapshot.stability > 25 ? "#ffe176" : "#ff3151";
  const style = {
    "--balance-progress": `${Math.round((snapshot.holdMillis / Math.max(snapshot.holdTargetMillis, 1)) * 100)}%`,
    "--stability-color": stabilityColor,
    "--stability-width": `${snapshot.stability}%`
  } as CSSProperties;
  const shellPhase = snapshot.phase === "round-win" ? "running" : snapshot.phase;
  return (
    <GameDisplayShell title={snapshot.label} phase={shellPhase}>
      <div className="equilibrio-display" style={style}>
        <PlayerReadyOverlay snapshot={snapshot} />
        <main className="equilibrio-main">
          <div className="equilibrio-level">Nivel <strong>{snapshot.challengeIndex + 1}/{snapshot.challengeCount}</strong></div>
          <section className="equilibrio-scale">
            <article className={`equilibrio-side${snapshot.leftOccupied ? " is-occupied" : ""}`} style={{ "--side": "#35d7ff" } as CSSProperties}><span>Lado azul</span><strong>{snapshot.leftOccupied ? "Listo" : "Busca"}</strong></article>
            <div className="equilibrio-pivot"><i /><b /></div>
            <article className={`equilibrio-side${snapshot.rightOccupied ? " is-occupied" : ""}`} style={{ "--side": "#ff3bd7" } as CSSProperties}><span>Lado rosa</span><strong>{snapshot.rightOccupied ? "Listo" : "Busca"}</strong></article>
          </section>
          <div className="equilibrio-hold">{snapshot.leftOccupied && snapshot.rightOccupied ? "Mantén las dos plataformas" : "Ocupa las dos plataformas iluminadas"}</div>
        </main>
        <aside className="equilibrio-sidebar">
          <article className="equilibrio-metric equilibrio-stability"><span>Estabilidad</span><strong>{snapshot.stability}%</strong><div className="equilibrio-stability-bar"><i /></div></article>
          <article className="equilibrio-metric"><span>Tiempo</span><strong>{formatClock(snapshot.remainingMillis)}</strong></article>
          <div className="equilibrio-event">{snapshot.lastEventMessage || "La balanza está preparada"}</div>
        </aside>
        {snapshot.phase === "round-win" ? <div className="equilibrio-overlay is-round"><strong>¡Nivel equilibrado!</strong><span>{snapshot.score}/{snapshot.challengeCount} niveles completados</span></div> : null}
        {snapshot.phase === "finished" ? <div className={`equilibrio-overlay ${snapshot.success ? "is-win" : "is-fail"}`}><strong>{snapshot.success ? "¡Equilibrio perfecto!" : "Balanza inestable"}</strong><span>{snapshot.success ? `${snapshot.challengeCount} niveles completados` : "Coordina los dos lados y vuelve a intentarlo"}</span></div> : null}
      </div>
    </GameDisplayShell>
  );
}
