/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell, LivesMeter, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import { guardianLanes, guardianesMaxLives, type GuardianesSnapshot } from "./game.ts";

const guardianesStyles = `
.guardianes-display{background:radial-gradient(circle at 50% 70%,rgba(53,215,255,.18),transparent 34%),linear-gradient(155deg,#020613,#071025 55%,#120516);display:grid;gap:24px;grid-template-columns:minmax(0,1fr) 430px;inset:0;overflow:hidden;padding:34px 40px 30px;position:absolute}
.guardianes-stage{align-content:center;display:grid;gap:24px;min-width:0}
.guardianes-title{color:#d8e8f1;font-size:25px;font-weight:900;letter-spacing:.12em;text-align:center;text-transform:uppercase}
.guardianes-lanes{display:grid;gap:15px;grid-template-columns:repeat(4,1fr);height:510px}
.guardianes-lane{background:linear-gradient(180deg,rgba(255,49,81,.18),rgba(8,14,32,.9) 48%,color-mix(in srgb,var(--lane) 10%,#070d1d));border:3px solid rgba(255,255,255,.09);border-radius:24px;display:grid;grid-template-rows:1fr auto;overflow:hidden;position:relative}
.guardianes-threat{background:#ff3151;border-radius:15px;box-shadow:0 0 35px #ff3151;height:74px;left:18%;position:absolute;top:calc(var(--threat-progress)*70% + 5%);transform:rotate(45deg);width:64%}
.guardianes-threat::after{background:#fff;border-radius:8px;content:"";inset:24%;position:absolute}
.guardianes-shield{align-items:center;background:#0b1427;border-top:4px solid var(--lane);display:flex;flex-direction:column;justify-content:center;min-height:130px;opacity:.52;padding:15px;text-align:center;transition:.15s ease}
.guardianes-shield.is-active{background:color-mix(in srgb,var(--lane) 30%,#081226);box-shadow:inset 0 0 55px var(--lane);opacity:1}
.guardianes-shield i{background:var(--lane);border-radius:999px 999px 20px 20px;box-shadow:0 0 26px var(--lane);height:46px;width:70px}.guardianes-shield strong{color:#fff;font-size:24px;margin-top:10px}
.guardianes-sidebar{align-content:center;display:grid;gap:17px}
.guardianes-card{background:rgba(5,12,29,.9);border:1px solid rgba(255,255,255,.12);border-radius:22px;display:grid;gap:8px;padding:20px 24px}.guardianes-card span{color:#9baec5;font-size:18px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.guardianes-card strong{color:#fff;font-size:56px;line-height:1}
.guardianes-lives .ml-lives-meter{justify-content:flex-start;margin-top:7px}
.guardianes-progress{background:#152038;border-radius:999px;height:14px;overflow:hidden}.guardianes-progress i{background:linear-gradient(90deg,#35d7ff,#ff3bd7,#ffe176,#5fff9e);display:block;height:100%;width:var(--guardian-progress)}
.guardianes-event{background:rgba(53,215,255,.09);border:1px solid rgba(53,215,255,.3);border-radius:20px;color:#fff;font-size:24px;font-weight:900;min-height:84px;padding:21px}
.guardianes-result{align-content:center;background:#050814;display:grid;inset:0;justify-items:center;padding:60px;position:absolute;text-align:center;z-index:5}.guardianes-result strong{color:#fff;font-size:clamp(78px,8vw,142px);line-height:.94}.guardianes-result span{color:#b8eefd;font-size:31px;font-weight:900;margin-top:25px}
.guardianes-result.is-win{animation:guardianesWin 1.15s linear infinite;background:linear-gradient(110deg,#06304a,#48113f,#66530e,#145234,#06304a);background-size:250% 100%}.guardianes-result.is-fail strong{color:#ff637d}
@keyframes guardianesWin{from{background-position:0 0}to{background-position:100% 0}}@media(prefers-reduced-motion:reduce){.guardianes-display *{animation:none!important;transition:none!important}}
`;

export function PlayerDisplay({ snapshot }: { snapshot: GuardianesSnapshot; frame?: Frame }) {
  const style = { "--guardian-progress": `${(snapshot.threatIndex / Math.max(snapshot.threatCount, 1)) * 100}%` } as CSSProperties;
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <div className="guardianes-display" style={style}>
        <style>{guardianesStyles}</style>
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
