/** @jsxRuntime automatic */
import type { CSSProperties, ReactNode } from "react";
import type { GamePlayer, GameSnapshot, HexColor } from "@motion-levels-games/game-sdk";
import { usePlayerDisplayRuntime } from "./player-display-runtime.tsx";

export { FloorPreview, FramePreviewPanel, floorTileAfterKeyboardNavigation } from "./floor-preview.tsx";
export type { FloorPreviewCell, FloorPreviewFrame, FloorPreviewProps } from "./floor-preview.tsx";
export type { FloorInputMode } from "./floor-input-painter.ts";
export { PlayerDisplayRuntimeProvider, usePlayerDisplayRuntime } from "./player-display-runtime.tsx";
export { LivesMeter } from "./lives-meter.tsx";
export type { LivesMeterProps } from "./lives-meter.tsx";

export type Tone = "amber" | "blue" | "cyan" | "green" | "magenta" | "pink" | "red" | "yellow" | "neutral";
export type DisplayIconName = "clock" | "players" | "target" | "tiles";
export type DisplayPlayer = Pick<GamePlayer, "label" | "score" | "color">;
export type RoundSummary = {
  index: number;
  winnerIndex?: number;
  winnerLabel?: string;
  hits?: number;
};
export type LaneEndpoint = {
  color?: string;
  label: ReactNode;
  value?: ReactNode;
};
/** Visual coordinates normalized from the track's left/top edges to 0..1. */
export type TrajectoryPoint = {
  x: number;
  y: number;
};
export type TrajectoryImpact = {
  position: TrajectoryPoint;
  side: "left" | "right";
};

// Player-facing displays are Spanish only. Phase enums stay in English in code
// (they drive logic and class names); this maps them to Spanish for the pill.
const phaseLabels: Record<string, string> = {
  ready: "Listo",
  waiting: "En espera",
  starting: "Preparados",
  running: "En juego",
  paused: "En pausa",
  finished: "Terminado"
};

export function phaseLabel(phase: string): string {
  return phaseLabels[phase] ?? phase;
}

export function GameDisplayShell({
  title,
  phase,
  variant = "default",
  accent,
  className = "",
  contentClassName = "",
  children
}: {
  title: string;
  phase: string;
  variant?: "default" | "versus";
  accent?: string;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}) {
  const runtime = usePlayerDisplayRuntime();
  const isPaused = runtime.paused;
  const displayedPhase = isPaused ? "paused" : phase;

  return (
    <section
      className={`ml-display-shell ml-tv-display ml-tv-display-${variant}${isPaused ? " is-paused" : ""} ${className}`.trim()}
      aria-label={`Pantalla de ${title}`}
      data-display-phase={displayedPhase}
      data-display-root="true"
      data-display-variant={variant}
      data-paused={isPaused || undefined}
      style={accent ? { "--ml-accent": accent } as CSSProperties : undefined}
    >
      <header className="ml-display-header ml-tv-header">
        <div className="ml-tv-brand" aria-hidden="true">
          <span className="ml-tv-brand-mark" />
          <span className="ml-tv-brand-name">
            <b>Motion</b>
            <b>Levels</b>
          </span>
        </div>
        <div className="ml-tv-title">
          <h1>{title}</h1>
        </div>
        <span className={`ml-status-pill ml-status-${displayedPhase}`}>{phaseLabel(displayedPhase)}</span>
      </header>
      <div
        className={`ml-display-content ${contentClassName}`.trim()}
        data-display-containment="content"
      >
        {children}
      </div>
    </section>
  );
}

export function PlayerReadyOverlay({ snapshot }: { snapshot: GameSnapshot }) {
  if (snapshot.phase !== "waiting" && snapshot.phase !== "starting") {
    return null;
  }

  const readyPlayers = snapshot.readyPlayers ?? 0;
  const requiredPlayers = Math.max(snapshot.requiredPlayers ?? snapshot.playerCount, 1);
  const starting = snapshot.phase === "starting";
  const countdown = Math.max(1, Math.ceil((snapshot.countdownMillis ?? 0) / 1_000));

  return (
    <section
      aria-label={starting ? "El juego está a punto de empezar" : "Esperando jugadores"}
      className={`ml-player-ready-overlay is-${snapshot.phase}`}
      data-display-containment="ready-overlay"
    >
      <div className="ml-player-ready-pulse" aria-hidden="true" data-display-geometry="ignore">
        <i />
        <i />
        <i />
      </div>
      <span>{starting ? "Todos listos" : "Esperando jugadores"}</span>
      <strong>{starting ? countdown : `${readyPlayers}/${requiredPlayers}`}</strong>
      <b>{starting ? "El juego está a punto de empezar" : "Entra y permanece en la zona iluminada"}</b>
    </section>
  );
}

export function CountdownValue({
  label = "Cuenta atrás",
  value
}: {
  label?: string;
  value: number;
}) {
  const normalizedValue = Math.max(1, Math.ceil(Number.isFinite(value) ? value : 1));
  return (
    <span
      key={normalizedValue}
      aria-label={`${label}: ${normalizedValue}`}
      className="ml-countdown-value"
      data-countdown-value={normalizedValue}
    >
      {normalizedValue}
    </span>
  );
}

export function MetricPanel({
  emphasis = "default",
  label,
  value,
  tone = "cyan",
  className = ""
}: {
  emphasis?: "default" | "strong";
  label: string;
  value: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <article
      className={`ml-metric ml-metric-${tone}${emphasis === "strong" ? " is-strong" : ""} ${className}`.trim()}
      data-display-containment="metric"
    >
      <span className="ml-metric-label">{label}</span>
      <strong className="ml-metric-value">{value}</strong>
    </article>
  );
}

export function MetricRow({
  children,
  columns = 3,
  className = ""
}: {
  children?: ReactNode;
  columns?: number;
  className?: string;
}) {
  const normalizedColumns = Math.min(8, Math.max(1, Math.trunc(Number.isFinite(columns) ? columns : 1)));

  return (
    <section
      className={`ml-metric-row ${className}`.trim()}
      data-display-containment="metric-row"
      style={{ "--ml-metric-columns": normalizedColumns } as CSSProperties}
    >
      {children}
    </section>
  );
}

export function IconStat({
  icon,
  label,
  tone = "neutral",
  value
}: {
  icon: DisplayIconName;
  label: string;
  tone?: Tone;
  value: ReactNode;
}) {
  return (
    <span
      aria-label={`${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}`.trim()}
      className={`ml-icon-stat ml-icon-stat-${tone}`}
      data-display-tone={tone}
    >
      <DisplayIcon name={icon} />
      <strong>{value}</strong>
    </span>
  );
}

export function IconStatStrip({
  children,
  label = "Datos de la partida"
}: {
  children?: ReactNode;
  label?: string;
}) {
  return <span aria-label={label} className="ml-icon-stat-strip">{children}</span>;
}

export function DifficultyStars({
  label,
  level,
  max = 3
}: {
  label: string;
  level: number;
  max?: number;
}) {
  const normalizedMax = Math.min(5, Math.max(1, Math.trunc(Number.isFinite(max) ? max : 3)));
  const normalizedLevel = Math.min(normalizedMax, Math.max(0, Math.trunc(Number.isFinite(level) ? level : 0)));

  return (
    <span
      aria-label={`Dificultad: ${label}`}
      className="ml-difficulty-stars"
      data-difficulty-level={normalizedLevel}
      data-display-tone="amber"
    >
      {Array.from({ length: normalizedMax }, (_, index) => (
        <svg
          aria-hidden="true"
          className={index < normalizedLevel ? "is-active" : ""}
          key={index}
          viewBox="0 0 24 24"
        >
          <path d="m12 2.9 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.09l-5.56 2.93 1.06-6.2L3 9.43l6.22-.9L12 2.9Z" />
        </svg>
      ))}
    </span>
  );
}

export function DisplayIcon({ name }: { name: DisplayIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="ml-display-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      {name === "clock" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v5l3.25 2" />
        </>
      ) : name === "target" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" />
        </>
      ) : name === "players" ? (
        <>
          <circle cx="9" cy="9" r="3" />
          <circle cx="17" cy="10" r="2.25" />
          <path d="M3.5 19c.7-3.1 2.6-4.7 5.5-4.7s4.8 1.6 5.5 4.7" />
          <path d="M14 15.2c2.9-.8 5.2.5 6 3.3" />
        </>
      ) : (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </>
      )}
    </svg>
  );
}

export function VersusScoreboard({
  left,
  right,
  target,
  centerLabel,
  centerValue,
  centerCaption,
  className = ""
}: {
  left: DisplayPlayer;
  right: DisplayPlayer;
  target: number;
  centerLabel: string;
  centerValue: ReactNode;
  centerCaption?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`ml-versus-scoreboard ${className}`.trim()}
      aria-label="Marcador"
      data-display-containment="versus-scoreboard"
    >
      <PlayerScorePanel player={left} side="red" target={target} />
      <article className="ml-versus-center">
        <span>{centerLabel}</span>
        <strong>{centerValue}</strong>
        {centerCaption !== undefined && centerCaption !== null ? <b>{centerCaption}</b> : null}
      </article>
      <PlayerScorePanel player={right} side="blue" target={target} />
    </section>
  );
}

export function PlayerScorePanel({
  player,
  side,
  target
}: {
  player: DisplayPlayer;
  side: "red" | "blue";
  target: number;
}) {
  const progress = Math.max(0, Math.min(1, player.score / Math.max(target, 1)));

  return (
    <article
      className={`ml-player-score-panel ml-player-score-${side}`}
      data-display-containment="player-score"
      style={{
        "--ml-player": player.color,
        "--ml-player-rgb": hexToRgb(player.color),
        "--ml-score-progress": progress
      } as CSSProperties}
    >
      <div className="ml-player-score-head">
        <span>{player.label}</span>
        <b>{player.score}/{target}</b>
      </div>
      <strong>{player.score}</strong>
      <div className="ml-player-score-track" aria-hidden="true">
        <i />
      </div>
    </article>
  );
}

export function RoundStrip({
  rounds,
  totalRounds,
  activeRound,
  activeLabel = "Ronda actual",
  activeCaption = "Punto en curso",
  fallbackLabel = "Pendiente",
  className = ""
}: {
  rounds: RoundSummary[];
  totalRounds?: number;
  activeRound?: number | null;
  activeLabel?: string;
  activeCaption?: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const roundCount = Math.max(rounds.length, totalRounds ?? 0, 1);
  const roundByIndex = new Map(rounds.map((round) => [round.index, round]));
  const allRounds = Array.from({ length: roundCount }, (_, index) => {
    const roundIndex = index + 1;
    return roundByIndex.get(roundIndex) ?? { index: roundIndex, winnerLabel: fallbackLabel, hits: 0 };
  });
  const defaultActiveRound = rounds.length < roundCount ? rounds.length + 1 : null;
  const resolvedActiveRound = activeRound === undefined ? defaultActiveRound : activeRound;
  const focusRound = resolvedActiveRound ?? Math.max(rounds.length, 1);
  const visibleLimit = 12;
  const visibleStart = Math.min(
    Math.max(0, focusRound - Math.ceil(visibleLimit / 2)),
    Math.max(0, roundCount - visibleLimit)
  );
  const visibleRounds = allRounds.slice(visibleStart, visibleStart + visibleLimit);
  const visibleRangeLabel = roundCount > visibleRounds.length
    ? `Rondas ${visibleRounds[0]?.index}-${visibleRounds.at(-1)?.index} de ${roundCount}`
    : "Historial del partido";
  const stripStyle = {
    "--ml-round-count": visibleRounds.length,
    "--ml-round-progress": `${Math.min(1, rounds.length / roundCount) * 100}%`
  } as CSSProperties;

  return (
    <section
      className={`ml-round-strip ${className}`.trim()}
      aria-label="Rondas"
      data-display-containment="round-strip"
      style={stripStyle}
    >
      <div className="ml-round-strip-head">
        <div className="ml-round-strip-title">
          <span>Rondas</span>
          <small>{visibleRangeLabel}</small>
        </div>
        <div className="ml-round-strip-count" aria-label={`${rounds.length} de ${roundCount} rondas jugadas`}>
          <strong>{rounds.length}</strong>
          <span>de {roundCount}</span>
        </div>
      </div>
      <div className="ml-round-progress" aria-hidden="true"><i /></div>
      <div className="ml-round-list">
        {visibleRounds.map((round) => {
          const completed = round.winnerIndex === 0 || round.winnerIndex === 1;
          const current = !completed && round.index === resolvedActiveRound;
          const stateClass = round.winnerIndex === 0
            ? "is-red"
            : round.winnerIndex === 1
              ? "is-blue"
              : current
                ? "is-current"
                : "is-pending";
          const hits = round.hits ?? 0;

          return (
            <article className={`ml-round-card ${stateClass}`} key={round.index}>
              <div className="ml-round-card-head">
                <span>R{round.index}</span>
                <i aria-hidden="true" />
              </div>
              <strong>{completed ? (round.winnerLabel || fallbackLabel) : current ? activeLabel : fallbackLabel}</strong>
              {completed ? <b>{hits} {hits === 1 ? "golpe" : "golpes"}</b> : null}
              {current ? <b>{activeCaption}</b> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function DisplayStage({
  children,
  className = "",
  detail,
  emphasis = "default",
  eyebrow,
  headingLayout = "stacked",
  label,
  title,
  tone = "neutral"
}: {
  children?: ReactNode;
  className?: string;
  detail?: ReactNode;
  emphasis?: "default" | "strong";
  eyebrow?: ReactNode;
  headingLayout?: "inline" | "stacked" | "status-right";
  label?: string;
  title?: ReactNode;
  tone?: Tone;
}) {
  const resolvedLabel = label ?? (typeof title === "string" ? title : undefined);
  const hasHeader = eyebrow !== undefined || title !== undefined || detail !== undefined;

  return (
    <section
      aria-label={resolvedLabel}
      className={`ml-display-stage ml-display-stage-${tone}${emphasis === "strong" ? " is-strong" : ""}${headingLayout === "inline" ? " is-heading-inline" : headingLayout === "status-right" ? " is-heading-status-right" : ""} ${className}`.trim()}
      data-display-containment="stage"
      data-display-tone={tone}
    >
      {hasHeader ? (
        <header className="ml-display-stage-header">
          <div className="ml-display-stage-heading">
            {eyebrow !== undefined ? <span>{eyebrow}</span> : null}
            {title !== undefined ? <h2>{title}</h2> : null}
          </div>
          {detail !== undefined ? <div className="ml-display-stage-detail">{detail}</div> : null}
        </header>
      ) : null}
      <div className="ml-display-stage-content" data-display-containment="stage-content">
        {children}
      </div>
    </section>
  );
}

export function StageWithSidebar({
  className = "",
  label = "Juego y datos de la partida",
  side = "right",
  sidebar,
  sidebarLabel = "Datos de la partida",
  stage
}: {
  className?: string;
  label?: string;
  side?: "left" | "right";
  sidebar: ReactNode;
  sidebarLabel?: string;
  stage: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={`ml-stage-with-sidebar is-sidebar-${side} ${className}`.trim()}
      data-display-containment="stage-layout"
    >
      <div className="ml-stage-with-sidebar-main" data-display-containment="stage-main">{stage}</div>
      <aside
        aria-label={sidebarLabel}
        className="ml-stage-with-sidebar-panel"
        data-display-containment="stage-sidebar"
      >
        {sidebar}
      </aside>
    </section>
  );
}

export function DisplayStack({
  bottom,
  children,
  className = "",
  gap = "default",
  label,
  top
}: {
  bottom?: ReactNode;
  children?: ReactNode;
  className?: string;
  gap?: "compact" | "default" | "spacious";
  label?: string;
  top?: ReactNode;
}) {
  const rows = top !== undefined && bottom !== undefined
    ? "auto minmax(0, 1fr) auto"
    : top !== undefined
      ? "auto minmax(0, 1fr)"
      : bottom !== undefined
        ? "minmax(0, 1fr) auto"
        : "minmax(0, 1fr)";

  return (
    <section
      aria-label={label}
      className={`ml-display-stack is-gap-${gap} ${className}`.trim()}
      data-display-containment="display-stack"
      style={{ "--ml-display-stack-rows": rows } as CSSProperties}
    >
      {top !== undefined ? (
        <div className="ml-display-stack-top" data-display-containment="stack-top">{top}</div>
      ) : null}
      <div className="ml-display-stack-main" data-display-containment="stack-main">{children}</div>
      {bottom !== undefined ? (
        <div className="ml-display-stack-bottom" data-display-containment="stack-bottom">{bottom}</div>
      ) : null}
    </section>
  );
}

export function EventRail({
  className = "",
  detail,
  icon,
  label = "Estado",
  message,
  tone = "neutral"
}: {
  className?: string;
  detail?: ReactNode;
  icon?: ReactNode;
  label?: ReactNode;
  message: ReactNode;
  tone?: Tone;
}) {
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={`ml-event-rail ml-event-rail-${tone} ${className}`.trim()}
      data-display-containment="event-rail"
      data-display-tone={tone}
      role="status"
    >
      {icon !== undefined ? (
        <span className="ml-event-rail-icon" aria-hidden="true" data-display-geometry="ignore">{icon}</span>
      ) : null}
      <div className="ml-event-rail-copy">
        <span>{label}</span>
        <strong>{message}</strong>
      </div>
      {detail !== undefined ? <div className="ml-event-rail-detail">{detail}</div> : null}
    </section>
  );
}

export function ResultOverlay({
  accent,
  children,
  className = "",
  eyebrow = "Resultado",
  message,
  title,
  tone = "neutral",
  variant = "default",
  visible = true
}: {
  accent?: HexColor;
  children?: ReactNode;
  className?: string;
  eyebrow?: ReactNode;
  message?: ReactNode;
  title: ReactNode;
  tone?: Tone;
  variant?: "default" | "victory";
  visible?: boolean;
}) {
  if (!visible) {
    return null;
  }

  return (
    <section
      aria-atomic="true"
      aria-live="assertive"
      className={`ml-result-overlay ml-result-overlay-${tone} ml-result-overlay-${variant} ${className}`.trim()}
      data-display-contained-by="content"
      data-display-containment="result-overlay"
      data-display-tone={tone}
      data-result-variant={variant}
      role="status"
      style={accent ? ({ "--ml-tone": accent } as CSSProperties) : undefined}
    >
      <div className="ml-result-overlay-glow" aria-hidden="true" data-display-geometry="ignore" />
      <div className="ml-result-overlay-card" data-display-containment="result-card">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
        {message !== undefined ? <p>{message}</p> : null}
        {children !== undefined ? <div className="ml-result-overlay-extra">{children}</div> : null}
      </div>
    </section>
  );
}

export function ProgressMeter({
  ariaValueText,
  className = "",
  label,
  max,
  size = "default",
  tone = "cyan",
  value,
  valueLabel
}: {
  ariaValueText?: string;
  className?: string;
  label?: ReactNode;
  max: number;
  size?: "compact" | "default" | "large";
  tone?: Tone;
  value: number;
  valueLabel?: ReactNode;
}) {
  const normalizedMax = Number.isFinite(max) && max > 0 ? max : 1;
  const normalizedValue = Math.min(normalizedMax, Math.max(0, Number.isFinite(value) ? value : 0));
  const progress = normalizedValue / normalizedMax;

  return (
    <div
      aria-valuemax={normalizedMax}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      aria-valuetext={ariaValueText}
      className={`ml-progress-meter ml-progress-meter-${tone} is-${size} ${className}`.trim()}
      data-display-containment="progress-meter"
      data-display-tone={tone}
      data-progress-max={normalizedMax}
      data-progress-meter="true"
      data-progress-value={normalizedValue}
      role="progressbar"
      style={{ "--ml-progress": progress } as CSSProperties}
    >
      {label !== undefined || valueLabel !== undefined ? (
        <div className="ml-progress-meter-head">
          {label !== undefined ? <span>{label}</span> : <span />}
          {valueLabel !== undefined ? <strong>{valueLabel}</strong> : null}
        </div>
      ) : null}
      <div className="ml-progress-meter-track" aria-hidden="true"><i /></div>
    </div>
  );
}

export function PlayerRoster({
  children,
  className = "",
  columns = 4,
  label = "Jugadores",
  rows
}: {
  children?: ReactNode;
  className?: string;
  columns?: number;
  label?: string;
  rows?: number;
}) {
  const normalizedColumns = Math.min(8, Math.max(1, Math.trunc(Number.isFinite(columns) ? columns : 1)));
  const normalizedRows = rows === undefined
    ? undefined
    : Math.min(8, Math.max(1, Math.trunc(Number.isFinite(rows) ? rows : 1)));

  return (
    <section
      aria-label={label}
      className={`ml-player-roster ${className}`.trim()}
      data-display-containment="player-roster"
      data-roster-columns={normalizedColumns}
      data-roster-rows={normalizedRows}
      style={{
        "--ml-roster-columns": normalizedColumns,
        "--ml-roster-rows": normalizedRows
      } as CSSProperties}
    >
      {children}
    </section>
  );
}

export function PlayerCard({
  ariaLabel,
  badge,
  className = "",
  emphasis = "default",
  featured = false,
  footer,
  headingAlign = "start",
  player,
  rank,
  scoreUnit = "puntos",
  state = "default",
  status,
  target
}: {
  ariaLabel?: string;
  badge?: ReactNode;
  className?: string;
  emphasis?: "default" | "score";
  featured?: boolean;
  footer?: ReactNode;
  headingAlign?: "center" | "start";
  player: DisplayPlayer;
  rank?: number;
  scoreUnit?: string;
  state?: "default" | "ready";
  status?: ReactNode;
  target?: number;
}) {
  const validTarget = target !== undefined && Number.isFinite(target) && target > 0 ? target : undefined;
  const resolvedScoreUnit = scoreUnit.trim() || "puntos";
  const labelLength = typeof player.label === "string" ? player.label.trim().length : 0;
  const labelClass = labelLength > 28
    ? "is-label-extra-long"
    : labelLength > 18
      ? "is-label-long"
      : "";

  return (
    <article
      aria-label={ariaLabel ?? `${player.label}: ${player.score} ${resolvedScoreUnit}`}
      className={`ml-player-card${featured ? " is-featured" : ""}${emphasis === "score" ? " is-score-emphasis" : ""}${headingAlign === "center" ? " is-heading-centered" : ""}${state === "ready" ? " is-ready" : ""} ${labelClass} ${className}`.trim()}
      data-display-containment="player-card"
      data-player-featured={featured || undefined}
      data-player-state={state}
      style={{
        "--ml-player": player.color,
        "--ml-player-rgb": hexToRgb(player.color)
      } as CSSProperties}
    >
      <header className="ml-player-card-head">
        <i aria-hidden="true" />
        <strong>{player.label}</strong>
        {rank !== undefined ? <b>#{Math.max(1, Math.trunc(rank))}</b> : badge !== undefined ? <b>{badge}</b> : null}
      </header>
      <div className="ml-player-card-score">
        <strong>{player.score}</strong>
        {status !== undefined ? <span>{status}</span> : null}
      </div>
      {validTarget !== undefined ? (
        <ProgressMeter
          ariaValueText={`${player.score} de ${validTarget} ${resolvedScoreUnit}`}
          className="ml-player-card-progress"
          max={validTarget}
          tone="neutral"
          value={player.score}
        />
      ) : null}
      {footer !== undefined ? <footer>{footer}</footer> : null}
    </article>
  );
}

function LaneEndpointView({ endpoint, side }: { endpoint: LaneEndpoint; side: "left" | "right" }) {
  return (
    <div
      className={`ml-trajectory-endpoint is-${side}`}
      style={endpoint.color ? {
        "--ml-endpoint": endpoint.color,
        "--ml-endpoint-rgb": hexToRgb(endpoint.color)
      } as CSSProperties : undefined}
    >
      <i aria-hidden="true" />
      <span>{endpoint.label}</span>
      {endpoint.value !== undefined ? <strong>{endpoint.value}</strong> : null}
    </div>
  );
}

export function TrajectoryLane({
  ariaLabel = "Trayectoria entre dos lados",
  caption,
  className = "",
  direction = "idle",
  impact,
  left,
  marker,
  pace = 0,
  position,
  right,
  trail = []
}: {
  ariaLabel?: string;
  caption?: ReactNode;
  className?: string;
  direction?: "idle" | "left" | "right";
  impact?: TrajectoryImpact | null;
  left: LaneEndpoint;
  marker?: ReactNode;
  pace?: number;
  position: TrajectoryPoint;
  right: LaneEndpoint;
  /** Ordered from the newest sample to the oldest sample. */
  trail?: readonly TrajectoryPoint[];
}) {
  const normalizedPosition = normalizeTrajectoryPoint(position);
  const normalizedTrail = trail
    .slice(0, 12)
    .map((point) => normalizeTrajectoryPoint(point, normalizedPosition));
  const normalizedImpact = impact ? {
    position: normalizeTrajectoryPoint(impact.position, normalizedPosition),
    side: impact.side
  } : null;
  const normalizedPace = normalizedCoordinate(pace, 0);
  const leftColor = left.color ?? "#ff364a";
  const rightColor = right.color ?? "#2f73ff";

  return (
    <section
      aria-label={ariaLabel}
      className={`ml-trajectory-lane is-moving-${direction}${normalizedImpact ? ` is-impact-${normalizedImpact.side}` : ""} ${className}`.trim()}
      data-display-containment="trajectory-lane"
      data-lane-direction={direction}
      data-lane-impact={normalizedImpact?.side}
      data-lane-pace={normalizedPace}
      data-lane-position={`${normalizedPosition.x},${normalizedPosition.y}`}
      data-lane-position-x={normalizedPosition.x}
      data-lane-position-y={normalizedPosition.y}
      style={{
        "--ml-lane-left": leftColor,
        "--ml-lane-left-rgb": hexToRgb(leftColor),
        "--ml-lane-position-x": `${normalizedPosition.x * 100}%`,
        "--ml-lane-position-y": `${normalizedPosition.y * 100}%`,
        "--ml-lane-right": rightColor,
        "--ml-lane-right-rgb": hexToRgb(rightColor),
        "--ml-lane-transition-duration": `${Math.round(150 - normalizedPace * 60)}ms`
      } as CSSProperties}
    >
      <header className="ml-trajectory-lane-head">
        <LaneEndpointView endpoint={left} side="left" />
        <LaneEndpointView endpoint={right} side="right" />
      </header>
      <div
        className="ml-trajectory-track"
        data-display-containment="trajectory-track"
      >
        <div className="ml-trajectory-track-line" aria-hidden="true" />
        {normalizedTrail.map((point, index) => (
          <i
            aria-hidden="true"
            className="ml-trajectory-trail-point"
            data-display-item="trajectory-trail"
            data-lane-trail-position={`${point.x},${point.y}`}
            data-lane-trail-x={point.x}
            data-lane-trail-y={point.y}
            key={`${index}-${point.x}-${point.y}`}
            style={{
              "--ml-lane-trail-opacity": (normalizedTrail.length - index) / (normalizedTrail.length + 1),
              "--ml-lane-trail-x": `${point.x * 100}%`,
              "--ml-lane-trail-y": `${point.y * 100}%`
            } as CSSProperties}
          />
        ))}
        <div className="ml-trajectory-marker" data-display-item="trajectory-marker" data-lane-marker="true">
          {marker ?? <span className="ml-trajectory-marker-core" aria-hidden="true" />}
        </div>
        {normalizedImpact ? (
          <div
            aria-hidden="true"
            className={`ml-trajectory-impact is-${normalizedImpact.side}`}
            data-display-geometry="ignore"
            data-lane-impact-x={normalizedImpact.position.x}
            data-lane-impact-y={normalizedImpact.position.y}
            key={`${normalizedImpact.side}-${normalizedImpact.position.x}-${normalizedImpact.position.y}`}
            style={{
              "--ml-lane-impact-x": `${normalizedImpact.position.x * 100}%`,
              "--ml-lane-impact-y": `${normalizedImpact.position.y * 100}%`
            } as CSSProperties}
          />
        ) : null}
      </div>
      {caption !== undefined ? <footer>{caption}</footer> : null}
    </section>
  );
}

function normalizedCoordinate(value: number, fallback = 0.5): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : fallback));
}

function normalizeTrajectoryPoint(
  point: TrajectoryPoint,
  fallback: TrajectoryPoint = { x: 0.5, y: 0.5 }
): TrajectoryPoint {
  return {
    x: normalizedCoordinate(point.x, fallback.x),
    y: normalizedCoordinate(point.y, fallback.y)
  };
}

function hexToRgb(color: string): string {
  const hex = color.replace("#", "").trim();
  const normalized = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);

  if (!Number.isFinite(value)) {
    return "255, 255, 255";
  }

  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
