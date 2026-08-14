/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { FramePreviewPanel, GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { AnimationSnapshot } from "./game.ts";

const styles = `
.animation-display{background:radial-gradient(circle at 70% 24%,color-mix(in srgb,var(--animation-accent) 24%,transparent),transparent 36%),linear-gradient(140deg,#03050a,#090d18 58%,#05050d);border:1px solid color-mix(in srgb,var(--animation-accent) 22%,rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.06);display:grid;gap:36px;grid-template-columns:minmax(0,1fr) 660px;height:100%;min-height:0;overflow:hidden;padding:34px 38px 30px 42px;position:relative}.animation-copy{display:grid;grid-template-rows:minmax(0,1fr) auto;min-width:0;position:relative;z-index:1}.animation-copy-main{align-self:center}.animation-kicker{color:var(--animation-accent);font-size:22px;font-weight:900;letter-spacing:.17em;text-transform:uppercase}.animation-copy h2{color:#fff;font-size:clamp(78px,6.2vw,118px);letter-spacing:-.065em;line-height:.86;margin:22px 0 28px;max-width:1040px;white-space:normal}.animation-copy p{color:#c2ccdc;font-size:28px;font-weight:750;line-height:1.32;margin:0;max-width:820px;white-space:normal}.animation-palette{display:flex;gap:12px;margin-top:38px}.animation-palette i{background:var(--swatch);border:3px solid rgba(255,255,255,.2);border-radius:999px;box-shadow:0 0 24px color-mix(in srgb,var(--swatch) 60%,transparent);height:26px;width:78px}.animation-stage{align-items:center;display:grid;gap:28px;grid-template-columns:300px minmax(0,1fr);min-height:0;position:relative;z-index:1}.animation-floor{align-content:center;background:rgba(2,7,13,.82);border:1px solid color-mix(in srgb,var(--animation-accent) 34%,rgba(255,255,255,.08));box-shadow:0 26px 68px -34px rgba(0,0,0,.9),0 0 42px color-mix(in srgb,var(--animation-accent) 12%,transparent);min-height:0;padding:26px 18px}.animation-floor>span{color:#c6d2e3;font-size:19px;letter-spacing:.13em}.animation-floor .ml-floor-preview{border-color:color-mix(in srgb,var(--animation-accent) 44%,rgba(255,255,255,.1));box-shadow:0 20px 46px rgba(0,0,0,.5),0 0 30px color-mix(in srgb,var(--animation-accent) 14%,transparent);height:auto;width:280px}.animation-countdown{align-self:center;aspect-ratio:1;border:1px solid color-mix(in srgb,var(--animation-accent) 38%,transparent);border-radius:50%;display:grid;place-items:center;position:relative;width:100%}.animation-countdown::before,.animation-countdown::after{border:4px solid var(--animation-accent);border-left-color:transparent;border-radius:50%;content:"";inset:8%;position:absolute}.animation-countdown::after{border-color:color-mix(in srgb,var(--animation-accent) 45%,transparent);border-right-color:transparent;inset:22%}.animation-countdown-copy{display:grid;gap:8px;justify-items:center;max-width:190px;position:relative;text-align:center;z-index:1}.animation-countdown-copy span,.animation-countdown-copy small{font-weight:900;text-transform:uppercase}.animation-countdown-copy span{color:var(--animation-accent);font-size:17px;letter-spacing:.12em}.animation-countdown-copy strong{color:#fff;font-size:70px;letter-spacing:-.07em;line-height:1}.animation-countdown-copy small{color:#9ba9bd;font-size:14px;letter-spacing:.09em;line-height:1.25;white-space:normal}.animation-display.is-live .animation-countdown::before{animation:animation-spin 5s linear infinite}.animation-display.is-live .animation-countdown::after{animation:animation-spin 3.5s linear reverse infinite}.animation-meta{align-items:center;color:#8b9ab0;display:flex;flex-wrap:wrap;font-size:18px;font-weight:800;gap:20px;margin-top:30px;text-transform:uppercase}.animation-meta b{color:#fff}.animation-meta i{background:var(--animation-accent);border-radius:50%;box-shadow:0 0 12px var(--animation-accent);height:8px;width:8px}@keyframes animation-spin{to{transform:rotate(1turn)}}@media(prefers-reduced-motion:reduce){.animation-countdown::before,.animation-countdown::after{animation:none!important}}
`;

export function PlayerDisplay({ snapshot, frame }: { snapshot: AnimationSnapshot; frame?: Frame }) {
  const accent = snapshot.palette[1] ?? snapshot.palette[0] ?? "#42ffd2";
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <section className="animation-display is-live" style={{ "--animation-accent": accent } as CSSProperties}>
        <style>{styles}</style>
        <div className="animation-copy">
          <div className="animation-copy-main">
            <span className="animation-kicker">Experiencia ambiental</span>
            <h2>{snapshot.animationLabel}</h2>
            <p>{snapshot.lastEventMessage}</p>
            <div className="animation-palette" aria-label="Paleta de color">
              {snapshot.palette.map((color) => <i key={color} style={{ "--swatch": color } as CSSProperties} />)}
            </div>
          </div>
          <footer className="animation-meta"><i /><b>En directo</b><span>{snapshot.rotationSize} animaciones</span><span>{snapshot.activeTargets} interacciones</span></footer>
        </div>
        <div className="animation-stage">
          {frame ? <FramePreviewPanel className="animation-floor" frame={frame} label="Suelo 16 × 32" /> : null}
          <div className="animation-countdown" aria-label={countdownAriaLabel(snapshot)}>
            <div className="animation-countdown-copy">
              <span>{snapshot.rotationActive ? "Cambio en" : "Reproducción"}</span>
              <strong>{snapshot.rotationActive ? formatClock(snapshot.rotationRemainingMillis) : "Fija"}</strong>
              <small>{snapshot.rotationActive ? "Siguiente animación" : "Sin cambio automático"}</small>
            </div>
          </div>
        </div>
      </section>
    </GameDisplayShell>
  );
}

function countdownAriaLabel(snapshot: AnimationSnapshot): string {
  return snapshot.rotationActive
    ? `La siguiente animación empieza en ${formatClock(snapshot.rotationRemainingMillis)}`
    : "Animación fija sin cambio automático";
}
