/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { GameDisplayShell } from "@motion-levels-games/display-kit";
import type { Frame } from "@motion-levels-games/game-sdk";
import type { AnimationSnapshot } from "./game.ts";

const styles = `
.animation-display{background:radial-gradient(circle at 72% 28%,color-mix(in srgb,var(--animation-accent) 25%,transparent),transparent 34%),linear-gradient(140deg,#03050a,#090d18 58%,#05050d);display:grid;grid-template-columns:minmax(0,1fr) 360px;inset:0;overflow:hidden;padding:52px;position:absolute}.animation-copy{align-content:center;display:grid;min-width:0}.animation-kicker{color:var(--animation-accent);font-size:22px;font-weight:900;letter-spacing:.17em;text-transform:uppercase}.animation-copy h2{color:#fff;font-size:clamp(92px,8vw,154px);letter-spacing:-.07em;line-height:.82;margin:22px 0 30px;max-width:1080px}.animation-copy p{color:#b9c4d8;font-size:27px;font-weight:700;line-height:1.35;margin:0;max-width:780px}.animation-palette{display:flex;gap:12px;margin-top:42px}.animation-palette i{background:var(--swatch);border:3px solid rgba(255,255,255,.2);border-radius:999px;box-shadow:0 0 24px color-mix(in srgb,var(--swatch) 60%,transparent);height:26px;width:78px}.animation-orbit{align-self:center;aspect-ratio:1;border:1px solid color-mix(in srgb,var(--animation-accent) 38%,transparent);border-radius:50%;display:grid;place-items:center;position:relative;width:100%}.animation-orbit::before,.animation-orbit::after{border:4px solid var(--animation-accent);border-left-color:transparent;border-radius:50%;content:"";inset:11%;position:absolute}.animation-orbit::after{border-color:color-mix(in srgb,var(--animation-accent) 45%,transparent);border-right-color:transparent;inset:24%}.animation-orbit strong{color:#fff;font-size:78px;letter-spacing:-.08em}.animation-display.is-live .animation-orbit::before{animation:animation-spin 5s linear infinite}.animation-display.is-live .animation-orbit::after{animation:animation-spin 3.5s linear reverse infinite}.animation-meta{align-items:center;bottom:32px;color:#8090a8;display:flex;font-size:18px;font-weight:800;gap:20px;left:52px;position:absolute;text-transform:uppercase}.animation-meta b{color:#fff}.animation-meta i{background:var(--animation-accent);border-radius:50%;box-shadow:0 0 12px var(--animation-accent);height:8px;width:8px}@keyframes animation-spin{to{transform:rotate(1turn)}}@media(prefers-reduced-motion:reduce){.animation-orbit::before,.animation-orbit::after{animation:none!important}}
`;

export function PlayerDisplay({ snapshot }: { snapshot: AnimationSnapshot; frame?: Frame }) {
  const accent = readableAccent(snapshot.palette);
  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <section className="animation-display is-live" style={{ "--animation-accent": accent } as CSSProperties}>
        <style>{styles}</style>
        <div className="animation-copy">
          <span className="animation-kicker">Experiencia ambiental</span>
          <h2>{snapshot.animationLabel}</h2>
          <p>{snapshot.lastEventMessage}</p>
          <div className="animation-palette" aria-label="Paleta de color">
            {snapshot.palette.map((color) => <i key={color} style={{ "--swatch": color } as CSSProperties} />)}
          </div>
        </div>
        <div className="animation-orbit"><strong>{String(snapshot.rotationIndex + 1).padStart(2, "0")}</strong></div>
        <footer className="animation-meta"><i /><b>En directo</b><span>{snapshot.rotationSize} animaciones</span><span>{snapshot.activeTargets} interacciones</span></footer>
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
