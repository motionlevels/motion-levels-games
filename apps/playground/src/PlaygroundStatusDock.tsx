import type { RefObject } from "react";
import { ArrowUpToLine, Pause } from "lucide-react";
import type { GameEvent } from "@motion-levels-games/game-sdk";
import { eventKey } from "./eventStream.ts";
import { PhaseIndicator } from "./PhaseIndicator.tsx";
import { formatElapsedClock } from "./timeFormat.ts";

export type ActiveRunSetting = readonly [label: string, value: string];

export type PlaygroundStatusDockProps = {
  activeRunSettings: ActiveRunSetting[];
  autoFollow: boolean;
  clockMillis: number;
  eventStreamRef: RefObject<HTMLOListElement | null>;
  events: GameEvent[];
  fps: number;
  frameNumber: number;
  gameLabel: string;
  onAutoFollowChange: (enabled: boolean) => void;
  onEventStreamScroll: () => void;
  phase: string;
  score: number;
  targets: number;
};

export function PlaygroundStatusDock({
  activeRunSettings,
  autoFollow,
  clockMillis,
  eventStreamRef,
  events,
  fps,
  frameNumber,
  gameLabel,
  onAutoFollowChange,
  onEventStreamScroll,
  phase,
  score,
  targets
}: PlaygroundStatusDockProps) {
  return (
    <section className="status-dock" aria-label="Playground status">
      <article className="status-card status-card-runtime">
        <div className="status-card-head">
          <span>Runtime</span>
          <PhaseIndicator as="strong" className="runtime-state" phase={phase} />
        </div>
        <div className="status-runtime-summary">
          <span>Engine clock</span>
          <strong>{formatElapsedClock(clockMillis)}</strong>
          <small>{frameNumber.toLocaleString()} frames processed</small>
        </div>
        <dl className="status-metrics">
          <div>
            <dt>Clock</dt>
            <dd>{formatElapsedClock(clockMillis)}</dd>
          </div>
          <div>
            <dt>FPS</dt>
            <dd>{fps}</dd>
          </div>
          <div>
            <dt>Frame</dt>
            <dd>{frameNumber}</dd>
          </div>
        </dl>
      </article>

      <article className="status-card status-card-event">
        <div className="status-card-head">
          <span>Event stream</span>
          <div className="status-stream-controls">
            <code aria-label={`${events.length} retained events`}>{events.length}</code>
            <button
              aria-label={autoFollow ? "Disable event auto-follow" : "Enable event auto-follow"}
              aria-pressed={autoFollow}
              className={`status-stream-follow ${autoFollow ? "is-active" : ""}`}
              onClick={() => onAutoFollowChange(!autoFollow)}
              title={autoFollow ? "Auto-following newest events" : "Event auto-follow paused"}
              type="button"
            >
              {autoFollow ? <ArrowUpToLine aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          </div>
        </div>
        <ol
          className="status-event-history"
          aria-label="Live event stream"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={onEventStreamScroll}
          ref={eventStreamRef}
        >
          {events.length > 0 ? (
            events.map((event, index) => (
              <li key={eventKey(event, index)}>
                <time dateTime={`PT${Math.max(0, event.atMillis) / 1000}S`}>
                  {formatElapsedClock(event.atMillis)}
                </time>
                <strong>{event.cue}</strong>
                <span>{event.message}</span>
              </li>
            ))
          ) : (
            <li className="status-event-empty">No events yet</li>
          )}
        </ol>
      </article>

      <article className="status-card status-card-config">
        <div className="status-card-head">
          <span>Active run</span>
          <strong>{gameLabel}</strong>
        </div>
        <dl className="status-run-summary">
          <div>
            <dt>Score</dt>
            <dd>{score}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd>{targets}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{events.length}</dd>
          </div>
        </dl>
        <dl className="status-config-list">
          {activeRunSettings.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </section>
  );
}
