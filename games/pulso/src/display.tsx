/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import { pulsePads, type PulseSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot }: { snapshot: PulseSnapshot; frame?: Frame }) {
  const phaseClass = snapshot.phase === "finished" ? "finished" : snapshot.phase;
  const energyColor = snapshot.energy > 55 ? "#5fff9e" : snapshot.energy > 25 ? "#ffe176" : "#ff3151";
  const style = {
    "--pulso-energy": energyColor,
    "--pulso-energy-width": `${snapshot.energy}%`,
    "--pulso-note-progress": snapshot.noteProgress,
    "--pulso-track-progress": `${(snapshot.noteIndex / Math.max(snapshot.noteCount, 1)) * 100}%`
  } as CSSProperties;
  return (
    <GameDisplayShell title={snapshot.label} phase={phaseClass}>
      <div className={`pulso-display is-${snapshot.phase}`} style={style}>
        <PlayerReadyOverlay snapshot={snapshot} />
        <section className="pulso-stage">
          <div className="pulso-beat">
            <small>{noteLabel(snapshot)}</small>
            <strong>{snapshot.combo > 0 ? `x${snapshot.combo}` : "0"}</strong>
            <span>{snapshot.combo > 0 ? "combo" : "busca el pulso"}</span>
          </div>
          <div className="pulso-pads">
            {pulsePads.map((pad, index) => {
              const active = snapshot.noteZones.includes(index);
              const hit = snapshot.hitZones.includes(index);
              return <article className={`pulso-pad${active ? " is-active" : ""}${hit ? " is-hit" : ""}`} key={pad.label} style={{ "--pulso-pad": pad.color } as CSSProperties}><i /><strong>{pad.label}</strong></article>;
            })}
          </div>
        </section>
        <aside className="pulso-sidebar">
          <article className="pulso-metric pulso-energy"><span>Energía</span><strong>{snapshot.energy}%</strong></article>
          <article className="pulso-metric"><span>Precisión</span><strong>{snapshot.accuracy}%</strong></article>
          <div className="pulso-sidebar-row"><article className="pulso-metric"><span>Sección</span><strong>{snapshot.section}/4</strong></article><article className="pulso-metric"><span>Tiempo</span><strong>{formatClock(snapshot.remainingMillis)}</strong></article></div>
          <div className="pulso-event">{snapshot.lastEventMessage || "La pista está lista"}</div>
        </aside>
        <footer className="pulso-footer"><span>Pista</span><div className="pulso-progress"><i /></div><b>{snapshot.noteIndex}/{snapshot.noteCount}</b></footer>
        {snapshot.phase === "finished" ? <div className={`pulso-result ${snapshot.success ? "is-win" : "is-fail"}`}><strong>{snapshot.success ? "¡Pista completada!" : "Sin energía"}</strong><span>{snapshot.success ? `Combo máximo x${snapshot.maxCombo} · Precisión ${snapshot.accuracy}%` : "Recupera el ritmo y vuelve a intentarlo"}</span></div> : null}
      </div>
    </GameDisplayShell>
  );
}

function noteLabel(snapshot: PulseSnapshot): string {
  if (snapshot.phase === "waiting") return "Pista preparada";
  if (snapshot.phase === "starting") return "Todos listos";
  if (snapshot.noteKind === "hold") return "Mantén la zona";
  if (snapshot.noteKind === "chord") return "Acorde simultáneo";
  return "Siguiente pulso";
}
