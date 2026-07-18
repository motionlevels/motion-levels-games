/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { EquilibrioSnapshot } from "./game.ts";

const equilibrioStyles = `
.equilibrio-display{background:radial-gradient(circle at 50% 50%,rgba(95,255,158,.14),transparent 36%),linear-gradient(135deg,#031118,#07151a 48%,#17051a);display:grid;gap:26px;grid-template-columns:minmax(0,1fr) 430px;inset:0;overflow:hidden;padding:38px 44px;position:absolute}
.equilibrio-main{align-content:center;display:grid;gap:30px;justify-items:center;min-width:0}
.equilibrio-level{color:#c7d5dd;font-size:24px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
.equilibrio-level strong{color:#fff;font-size:34px;margin-left:12px}
.equilibrio-scale{align-items:end;display:grid;gap:20px;grid-template-columns:1fr 100px 1fr;width:min(100%,940px)}
.equilibrio-side{align-items:center;background:rgba(4,17,25,.9);border:4px solid var(--side);border-radius:28px;box-shadow:0 0 48px color-mix(in srgb,var(--side) 22%,transparent);display:flex;flex-direction:column;justify-content:center;min-height:280px;opacity:.58;padding:28px;text-align:center;transition:.18s ease}
.equilibrio-side.is-occupied{background:color-mix(in srgb,var(--side) 22%,#061019);box-shadow:0 0 80px color-mix(in srgb,var(--side) 48%,transparent);opacity:1;transform:translateY(-10px)}
.equilibrio-side span{color:#b9c8d1;font-size:22px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
.equilibrio-side strong{color:#fff;font-size:62px;line-height:1;margin-top:18px}
.equilibrio-pivot{align-items:center;display:flex;flex-direction:column;justify-content:flex-end}
.equilibrio-pivot i{background:linear-gradient(#5fff9e,#35d7ff);border-radius:999px 999px 10px 10px;height:260px;position:relative;width:34px}
.equilibrio-pivot i::after{background:#fff;border-radius:999px;bottom:0;box-shadow:0 0 35px #5fff9e;content:"";height:var(--balance-progress);left:0;position:absolute;width:100%}
.equilibrio-pivot b{border-left:55px solid transparent;border-right:55px solid transparent;border-top:80px solid #7b8d95;height:0;width:0}
.equilibrio-hold{color:#fff;font-size:30px;font-weight:900;min-height:42px;text-align:center}
.equilibrio-sidebar{align-content:center;display:grid;gap:18px}
.equilibrio-metric{background:rgba(5,17,23,.88);border:1px solid rgba(255,255,255,.12);border-radius:22px;display:grid;gap:8px;padding:22px 25px}
.equilibrio-metric span{color:#9eb1bb;font-size:19px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
.equilibrio-metric strong{color:#fff;font-size:58px;line-height:1}
.equilibrio-stability strong{color:var(--stability-color)}
.equilibrio-stability-bar{background:#16252b;border-radius:999px;height:13px;overflow:hidden}.equilibrio-stability-bar i{background:var(--stability-color);display:block;height:100%;width:var(--stability-width)}
.equilibrio-event{background:rgba(95,255,158,.09);border:1px solid rgba(95,255,158,.3);border-radius:20px;color:#fff;font-size:25px;font-weight:900;min-height:86px;padding:22px}
.equilibrio-overlay{align-content:center;background:#061116;display:grid;inset:0;justify-items:center;padding:60px;position:absolute;text-align:center;z-index:5}
.equilibrio-overlay strong{color:#fff;font-size:clamp(76px,8vw,140px);line-height:.95}.equilibrio-overlay span{color:#bcefd1;font-size:32px;font-weight:900;margin-top:24px}
.equilibrio-overlay.is-round{animation:equilibrioRound .8s ease-in-out infinite alternate;background:linear-gradient(125deg,#06304a,#0f5338,#483a0b,#3d0c39)}
.equilibrio-overlay.is-win{animation:equilibrioWin 1.2s linear infinite;background:linear-gradient(110deg,#06304a,#0f5338,#6c5810,#6b145e,#06304a);background-size:250% 100%}
.equilibrio-overlay.is-fail strong{color:#ff667e}
@keyframes equilibrioRound{from{filter:saturate(.85)}to{filter:saturate(1.3);transform:scale(1.015)}}@keyframes equilibrioWin{from{background-position:0 0}to{background-position:100% 0}}
@media(prefers-reduced-motion:reduce){.equilibrio-display *{animation:none!important;transition:none!important}}
`;

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
        <style>{equilibrioStyles}</style>
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
