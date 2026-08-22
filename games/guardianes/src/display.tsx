/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, LivesMeter, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import { guardianLanes, guardianesMaxLives, type GuardianesSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot }: { snapshot: GuardianesSnapshot; frame?: Frame }) {
  const style = { "--guardian-progress": `${(snapshot.threatIndex / Math.max(snapshot.threatCount, 1)) * 100}%` } as CSSProperties;
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="guardianes-display" style={style}>
        <PlayerReadyOverlay snapshot={snapshot} />
        <main className="guardianes-stage">
          <div className="guardianes-title">Activa el escudo antes del impacto</div>
          <section className="guardianes-lanes">
            {guardianLanes.map((lane, index) => {
              const threat = snapshot.threats.find((candidate) => candidate.lane === index);
              const active = snapshot.shieldLanes.includes(index);
              return <article className="guardianes-lane" key={lane.label} style={{ "--lane": lane.color } as CSSProperties}>{threat ? <i className="guardianes-threat" style={{ "--threat-progress": threat.progress } as CSSProperties} /> : null}<div /><div className={`guardianes-shield${active ? " is-active" : ""}`}><i /><strong>{lane.label}</strong></div></article>;
            })}
          </section>
        </main>
        <aside className="guardianes-sidebar">
          <article className="guardianes-card guardianes-lives"><span>Vidas del núcleo</span><LivesMeter lives={snapshot.lives} maxLives={snapshot.maxLives ?? guardianesMaxLives} /></article>
          <article className="guardianes-card"><span>Amenazas bloqueadas</span><strong>{snapshot.blockedThreats}/{snapshot.threatCount}</strong><div className="guardianes-progress"><i /></div></article>
          <article className="guardianes-card"><span>Tiempo</span><strong>{formatClock(snapshot.remainingMillis)}</strong></article>
          <div className="guardianes-event">{snapshot.lastEventMessage || "Los escudos están preparados"}</div>
        </aside>
        {snapshot.phase === "finished" ? <div className={`guardianes-result ${snapshot.success ? "is-win" : "is-fail"}`}><strong>{snapshot.success ? "¡Núcleo protegido!" : "Defensas superadas"}</strong><span>{snapshot.success ? `${snapshot.blockedThreats} amenazas bloqueadas` : "Coordina los escudos y vuelve a intentarlo"}</span></div> : null}
      </div>
    </GameDisplayShell>
  );
}
