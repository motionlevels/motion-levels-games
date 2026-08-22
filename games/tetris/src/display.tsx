/** @jsxRuntime automatic */
import type { CSSProperties } from "react";
import {
  DisplayStack,
  DisplayStage,
  EventRail,
  FramePreviewPanel,
  GameDisplayShell,
  MetricPanel,
  MetricRow,
  PlayerReadyOverlay,
  ResultOverlay,
  StageWithSidebar
} from "@motion-levels-games/display-kit";
import { formatClock, type Frame } from "@motion-levels-games/game-sdk";
import type { TetrisPieceSnapshot, TetrisSnapshot } from "./game.ts";

if (typeof document !== "undefined") void import("./display.css");

export function PlayerDisplay({ snapshot, frame }: { snapshot: TetrisSnapshot; frame?: Frame }) {
  const result = resultCopy(snapshot);
  const resultTone = snapshot.result === "game-loss"
    ? "red"
    : snapshot.result === "line-clear"
      ? "yellow"
      : snapshot.result === "game-win"
        ? "green"
        : "cyan";

  return (
    <GameDisplayShell title={snapshot.label} phase={snapshot.phase}>
      <PlayerReadyOverlay snapshot={snapshot} />
      <DisplayStack
        bottom={(
          <EventRail
            detail={eventDetail(snapshot)}
            label={snapshot.result === "line-clear" ? "¡Línea!" : "Último evento"}
            message={<span key={snapshot.motionEventId}>{snapshot.lastEventMessage}</span>}
            tone={resultTone}
          />
        )}
        className="tetris-display"
        label="Partida de Tetris"
        top={(
          <DisplayStage detail={result.caption} eyebrow={result.eyebrow} title={result.title} tone={resultTone}>
            <MetricRow columns={4}>
              <MetricPanel label="Puntos" tone="cyan" value={snapshot.score} />
              <MetricPanel label="Líneas" tone="yellow" value={`${snapshot.lines}/${snapshot.linesTarget}`} />
              <MetricPanel label="Nivel" tone="magenta" value={snapshot.level} />
              <MetricPanel label="Tiempo" tone="amber" value={formatClock(snapshot.elapsedMillis)} />
            </MetricRow>
          </DisplayStage>
        )}
      >
        <StageWithSidebar
          label="Pista y piezas de Tetris"
          sidebar={(
            <>
              <div className="tetris-pieces">
                <PieceCard label="Pieza activa" piece={snapshot.activePiece} />
                <PieceCard label="Siguiente" piece={snapshot.nextPiece} />
              </div>
              <article className="tetris-controls">
                <span>Control físico</span>
                <strong>← Rotar · Guiar · Rotar →</strong>
                <b>Baja al fondo para soltar</b>
              </article>
            </>
          )}
          sidebarLabel="Piezas y controles"
          stage={(
            <DisplayStage eyebrow="Pista en directo" title="Tablero" tone={resultTone}>
              {frame
                ? <FramePreviewPanel className="tetris-floor" frame={frame} label="Pista de Tetris" />
                : <div className="tetris-floor-placeholder">Esperando imagen de la pista</div>}
            </DisplayStage>
          )}
        />
        <ResultOverlay
          eyebrow={result.eyebrow}
          message={result.caption}
          title={result.title}
          tone={resultTone}
          visible={snapshot.phase === "finished"}
        />
      </DisplayStack>
    </GameDisplayShell>
  );
}

function PieceCard({ label, piece }: { label: string; piece: TetrisPieceSnapshot }) {
  return (
    <article className="tetris-piece-card" style={{ "--tetris-piece": piece.color } as CSSProperties}>
      <span>{label}</span>
      <div>
        {piece.cells.map(([x, y], index) => (
          <i key={`${x}-${y}-${index}`} style={{ gridColumn: x + 1, gridRow: y + 1 }} />
        ))}
      </div>
      <strong>{shapeNames[piece.shape] ?? "Pieza"}</strong>
    </article>
  );
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
