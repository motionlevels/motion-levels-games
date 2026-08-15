/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { FramePreviewPanel, GameDisplayShell } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { AnimationSnapshot } from "./game.ts";

const styles = `
.animation-display{background:radial-gradient(circle at 72% 26%,color-mix(in srgb,var(--animation-accent) 24%,transparent),transparent 38%),linear-gradient(140deg,#03050a,#090d18 58%,#05050d);border:1px solid color-mix(in srgb,var(--animation-accent) 22%,rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.06);display:grid;gap:48px;grid-template-columns:minmax(0,1fr) minmax(820px,1.06fr);height:100%;min-height:0;overflow:hidden;padding:30px 34px 28px 42px;position:relative}.animation-copy{display:grid;grid-template-rows:minmax(0,1fr) auto;min-width:0;position:relative;z-index:1}.animation-copy-main{align-self:center;min-width:0}.animation-kicker{color:var(--animation-accent);font-size:22px;font-weight:900;letter-spacing:.17em;text-transform:uppercase}.animation-copy h2{color:#fff;font-size:clamp(72px,4.5vw,86px);letter-spacing:-.06em;line-height:.9;margin:22px 0 28px;max-width:820px;overflow-wrap:break-word;white-space:normal}.animation-copy p{color:#c2ccdc;font-size:28px;font-weight:750;line-height:1.32;margin:0;max-width:760px;white-space:normal}.animation-palette{display:flex;gap:12px;margin-top:38px}.animation-palette i{background:var(--swatch);border:3px solid rgba(255,255,255,.2);border-radius:999px;box-shadow:0 0 24px color-mix(in srgb,var(--swatch) 60%,transparent);height:28px;width:82px}.animation-stage{align-items:center;display:grid;gap:42px;grid-template-columns:minmax(350px,.88fr) minmax(390px,1fr);min-height:0;position:relative;z-index:1}.animation-floor{align-content:center;background:rgba(2,7,13,.82);border:1px solid color-mix(in srgb,var(--animation-accent) 34%,rgba(255,255,255,.08));box-shadow:0 26px 68px -34px rgba(0,0,0,.9),0 0 42px color-mix(in srgb,var(--animation-accent) 12%,transparent);min-height:0;padding:24px 18px}.animation-floor>span{color:#c6d2e3;font-size:20px;letter-spacing:.13em}.animation-floor .ml-floor-preview{border-color:color-mix(in srgb,var(--animation-accent) 44%,rgba(255,255,255,.1));box-shadow:0 20px 46px rgba(0,0,0,.5),0 0 30px color-mix(in srgb,var(--animation-accent) 14%,transparent);height:auto;width:340px}.animation-countdown{align-self:center;aspect-ratio:1;border:1px solid color-mix(in srgb,var(--animation-accent) 38%,transparent);border-radius:50%;display:grid;justify-self:center;max-width:430px;place-items:center;position:relative;width:100%}.animation-countdown::before,.animation-countdown::after{border:5px solid var(--animation-accent);border-left-color:transparent;border-radius:50%;content:"";inset:8%;position:absolute}.animation-countdown::after{border-color:color-mix(in srgb,var(--animation-accent) 45%,transparent);border-right-color:transparent;inset:22%}.animation-countdown-copy{display:grid;gap:10px;justify-items:center;max-width:240px;position:relative;text-align:center;z-index:1}.animation-countdown-copy span,.animation-countdown-copy small{font-weight:900;text-transform:uppercase}.animation-countdown-copy span{color:var(--animation-accent);font-size:20px;letter-spacing:.12em}.animation-countdown-copy strong{color:#fff;font-size:84px;letter-spacing:-.07em;line-height:1}.animation-countdown-copy small{color:#9ba9bd;font-size:16px;letter-spacing:.09em;line-height:1.25;white-space:normal}.animation-display.is-live .animation-countdown::before{animation:animation-spin 5s linear infinite}.animation-display.is-live .animation-countdown::after{animation:animation-spin 3.5s linear reverse infinite}.animation-meta{align-items:center;color:#8b9ab0;display:flex;flex-wrap:wrap;font-size:18px;font-weight:800;gap:20px;margin-top:30px;text-transform:uppercase}.animation-meta b{color:#fff}.animation-meta i{background:var(--animation-accent);border-radius:50%;box-shadow:0 0 12px var(--animation-accent);height:8px;width:8px}@keyframes animation-spin{to{transform:rotate(1turn)}}@media(prefers-reduced-motion:reduce){.animation-countdown::before,.animation-countdown::after{animation:none!important}}
`;

export function PlayerDisplay({ snapshot, frame }: { snapshot: AnimationSnapshot; frame?: Frame }) {
  const accent = readableAccent(snapshot.palette);
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

function readableAccent(palette: readonly string[]): string {
  const accent = palette[1] ?? palette[0] ?? "#42ffd2";
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(accent);
  if (!match) return accent;
  const [, red = "ff", green = "ff", blue = "ff"] = match;
  const brightness = (Number.parseInt(red, 16) * 299 + Number.parseInt(green, 16) * 587 + Number.parseInt(blue, 16) * 114) / 1_000;
  return brightness < 48 ? "#8fa2bd" : accent;
}

function countdownAriaLabel(snapshot: AnimationSnapshot): string {
  return snapshot.rotationActive
    ? `La siguiente animación empieza en ${formatClock(snapshot.rotationRemainingMillis)}`
    : "Animación fija sin cambio automático";
}
