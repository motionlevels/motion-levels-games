/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import { FramePreviewPanel, GameDisplayShell, MetricPanel, MetricRow, PlayerReadyOverlay } from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { TetrisPieceSnapshot, TetrisSnapshot } from "./game.ts";

export function PlayerDisplay({ snapshot, frame }: { snapshot: TetrisSnapshot; frame?: Frame }) {
  const result = resultCopy(snapshot);
  return <GameDisplayShell title={snapshot.label} phase={snapshot.phase}><div className={`tetris-display is-${snapshot.result}`}>
    <PlayerReadyOverlay snapshot={snapshot} />
    <section className="tetris-summary">
      <div className="tetris-callout"><span>{result.eyebrow}</span><strong>{result.title}</strong><b>{result.caption}</b></div>
      <MetricRow columns={4} className="tetris-metrics"><MetricPanel label="Puntos" tone="cyan" value={snapshot.score} /><MetricPanel label="Líneas" tone="yellow" value={`${snapshot.lines}/${snapshot.linesTarget}`} /><MetricPanel label="Nivel" tone="magenta" value={snapshot.level} /><MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} /></MetricRow>
    </section>
    <section className="tetris-main">
      {frame ? <FramePreviewPanel className="tetris-floor" frame={frame} label="Pista de Tetris" /> : null}
      <aside className="tetris-side"><PieceCard label="Pieza activa" piece={snapshot.activePiece} /><PieceCard label="Siguiente" piece={snapshot.nextPiece} /><article className="tetris-controls"><span>Control físico</span><strong>← Rotar · Guiar · Rotar →</strong><b>Baja al fondo para soltar</b></article></aside>
    </section>
    <footer className="tetris-event"><span>{snapshot.result === "line-clear" ? "¡Línea!" : "Último evento"}</span><strong key={snapshot.motionEventId}>{snapshot.lastEventMessage}</strong><b>{eventDetail(snapshot)}</b></footer>
  </div></GameDisplayShell>;
}

function PieceCard({ label, piece }: { label: string; piece: TetrisPieceSnapshot }) {
  return <article className="tetris-piece-card" style={{ "--tetris-piece": piece.color } as CSSProperties}><span>{label}</span><div>{piece.cells.map(([x,y], index) => <i key={index} style={{ gridColumn: x + 1, gridRow: y + 1 }} />)}</div><strong>{shapeNames[piece.shape] ?? "Pieza"}</strong></article>;
}
const shapeNames = ["I", "O", "T", "S", "Z", "J", "L"];
function resultCopy(snapshot: TetrisSnapshot) {
  if (snapshot.result === "game-win") return { eyebrow: "Objetivo completado", title: "¡Tetris superado!", caption: `${snapshot.lines} líneas y ${snapshot.score} puntos` };
  if (snapshot.result === "game-loss") return { eyebrow: "Fin de partida", title: "Las piezas llegaron arriba", caption: "La pista se reinicia en unos segundos" };
  if (snapshot.result === "line-clear") return { eyebrow: "Línea eliminada", title: `+${snapshot.lastClearCount === 4 ? 800 : snapshot.lastClearCount * 100}`, caption: "La pista baja y el nivel continúa" };
  return { eyebrow: `Nivel ${snapshot.level}`, title: "Guía la pieza", caption: "Usa todo el suelo para mover, rotar y soltar" };
}
function eventDetail(snapshot: TetrisSnapshot) {
  if (snapshot.phase === "finished") return `${snapshot.lines} ${snapshot.lines === 1 ? "línea total" : "líneas totales"}`;
  if (snapshot.lastClearCount > 0) return `${snapshot.lastClearCount} ${snapshot.lastClearCount === 1 ? "línea" : "líneas"}`;
  return `Objetivo ${snapshot.linesTarget}`;
}
