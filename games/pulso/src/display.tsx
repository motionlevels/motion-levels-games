/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import { pulsePads, type PulseSnapshot } from "./game.ts";

const pulsoStyles = `
.pulso-display { --pulso-energy:#5fff9e; background:radial-gradient(circle at 50% 42%,rgba(255,59,215,.18),transparent 34%),linear-gradient(145deg,#050410,#0a071b 52%,#03040d); display:grid; gap:22px; grid-template-columns:minmax(0,1fr) 430px; grid-template-rows:minmax(0,1fr) auto; inset:0; overflow:hidden; padding:32px 38px 28px; position:absolute; }
.pulso-stage { align-content:center; display:grid; justify-items:center; min-width:0; position:relative; }
.pulso-beat { align-items:center; aspect-ratio:1; background:radial-gradient(circle,rgba(255,255,255,.12),rgba(255,59,215,.08) 46%,transparent 70%); border:5px solid rgba(255,255,255,.14); border-radius:50%; box-shadow:0 0 80px rgba(255,59,215,.2),inset 0 0 60px rgba(53,215,255,.1); display:flex; flex-direction:column; justify-content:center; position:relative; width:min(50vh,560px); }
.pulso-beat::before { border:7px solid rgba(255,255,255,.82); border-radius:50%; content:""; inset:calc(7% + var(--pulso-note-progress)*36%); opacity:calc(.28 + var(--pulso-note-progress)*.72); position:absolute; }
.pulso-beat small { color:#a9abc4; font-size:22px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
.pulso-beat strong { color:#fff; font-size:clamp(100px,8vw,150px); letter-spacing:-.09em; line-height:.9; margin:13px 0 5px; text-shadow:0 0 35px rgba(255,59,215,.5); }
.pulso-beat span { color:#ffd9f8; font-size:28px; font-weight:900; }
.pulso-pads { display:grid; gap:14px; grid-template-columns:repeat(2,1fr); width:min(66vw,740px); }
.pulso-pad { align-items:center; background:rgba(15,15,37,.82); border:3px solid rgba(255,255,255,.08); border-radius:18px; display:flex; min-height:74px; opacity:.44; padding:12px 18px; transition:.14s ease; }
.pulso-pad i { background:var(--pulso-pad); border-radius:10px; box-shadow:0 0 24px var(--pulso-pad); height:32px; margin-right:15px; width:32px; }
.pulso-pad strong { color:#fff; font-size:24px; }
.pulso-pad.is-active { border-color:var(--pulso-pad); box-shadow:0 0 30px color-mix(in srgb,var(--pulso-pad) 38%,transparent); opacity:1; transform:scale(1.025); }
.pulso-pad.is-hit { background:rgba(255,255,255,.2); }
.pulso-sidebar { align-content:center; display:grid; gap:16px; min-width:0; }
.pulso-metric { background:rgba(12,12,31,.88); border:1px solid rgba(255,255,255,.11); border-radius:20px; display:grid; gap:7px; padding:18px 22px; }
.pulso-metric span { color:#9c9db8; font-size:18px; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
.pulso-metric strong { color:#fff; font-size:50px; line-height:1; }
.pulso-energy { overflow:hidden; position:relative; }
.pulso-energy::after { background:linear-gradient(90deg,#ff3151,#ffe176 45%,#5fff9e); bottom:0; content:""; height:8px; left:0; position:absolute; width:var(--pulso-energy-width); }
.pulso-energy strong { color:var(--pulso-energy); }
.pulso-sidebar-row { display:grid; gap:16px; grid-template-columns:1fr 1fr; }
.pulso-sidebar-row .pulso-metric strong { font-size:38px; }
.pulso-event { background:rgba(255,59,215,.11); border:1px solid rgba(255,59,215,.34); border-radius:20px; color:#fff; font-size:25px; font-weight:900; min-height:72px; padding:19px 22px; }
.pulso-footer { align-items:center; background:rgba(5,5,16,.9); border:1px solid rgba(255,255,255,.1); border-radius:17px; display:grid; gap:18px; grid-column:1/-1; grid-template-columns:auto 1fr auto; padding:14px 20px; }
.pulso-footer span,.pulso-footer b { color:#a9abc4; font-size:19px; }
.pulso-progress { background:#17172a; border-radius:999px; height:15px; overflow:hidden; }
.pulso-progress i { background:linear-gradient(90deg,#35d7ff,#ff3bd7,#ffe176,#5fff9e); display:block; height:100%; width:var(--pulso-track-progress); }
.pulso-result { align-content:center; background:#07040f; display:grid; inset:0; justify-items:center; position:absolute; z-index:5; }
.pulso-result strong { color:#fff; font-size:clamp(74px,7vw,126px); line-height:.95; text-align:center; }
.pulso-result span { color:#ff9bea; font-size:29px; font-weight:900; margin-top:20px; text-transform:uppercase; }
.pulso-result.is-win { animation:pulsoWin 1.1s linear infinite; background:linear-gradient(115deg,#050611,#123044,#422348,#3b3521,#050611); background-size:240% 100%; }
.pulso-result.is-fail strong { color:#ff6a82; }
.pulso-display.is-running .pulso-beat { animation:pulsoBeat .58s ease-in-out infinite alternate; }
@keyframes pulsoBeat { from { box-shadow:0 0 60px rgba(255,59,215,.14),inset 0 0 40px rgba(53,215,255,.08); } to { box-shadow:0 0 105px rgba(255,59,215,.3),inset 0 0 75px rgba(53,215,255,.16); } }
@keyframes pulsoWin { from { background-position:0 0; } to { background-position:100% 0; } }
@media (prefers-reduced-motion:reduce) { .pulso-display *, .pulso-display *::before, .pulso-display *::after { animation:none!important; transition:none!important; } }
`;

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
        <style>{pulsoStyles}</style>
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
