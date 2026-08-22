/** @jsxRuntime automatic */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const MAX_HEART_SLOTS = 20;
const LIFE_CHANGE_DURATION_MILLIS = 1_100;
const reportedDiagnostics = new Set<string>();

export type LivesMeterProps = {
  className?: string;
  lives: number;
  maxLives: number;
};

type NormalizedLives = {
  columns: number;
  compact: boolean;
  diagnostics: string[];
  remainingLives: number;
  renderedSlots: number;
  rows: number;
  totalLives: number;
};

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function livesGrid(slotCount: number): { columns: number; rows: number } {
  if (slotCount <= 0) {
    return { columns: 1, rows: 1 };
  }

  if (slotCount <= 5) {
    return { columns: slotCount, rows: 1 };
  }

  const rows = slotCount <= 12 ? 2 : slotCount <= 18 ? 3 : 4;
  return { columns: Math.ceil(slotCount / rows), rows };
}

/**
 * Keeps bad snapshot data from creating unbounded DOM or geometry while
 * preserving enough detail for a developer-facing diagnostic.
 */
export function normalizeLivesForDisplay(lives: number, maxLives: number): NormalizedLives {
  const diagnostics: string[] = [];

  if (!Number.isFinite(maxLives)) {
    diagnostics.push(`maxLives must be finite; received ${String(maxLives)}`);
  } else if (!Number.isInteger(maxLives)) {
    diagnostics.push(`maxLives must be an integer; received ${maxLives}`);
  }

  if (!Number.isFinite(lives)) {
    diagnostics.push(`lives must be finite; received ${String(lives)}`);
  } else if (!Number.isInteger(lives)) {
    diagnostics.push(`lives must be an integer; received ${lives}`);
  }

  const totalLives = Math.max(0, finiteInteger(maxLives, 0));
  const unclampedLives = finiteInteger(lives, 0);
  const remainingLives = Math.min(totalLives, Math.max(0, unclampedLives));

  if (maxLives < 0) {
    diagnostics.push(`maxLives must not be negative; received ${maxLives}`);
  }
  if (lives < 0) {
    diagnostics.push(`lives must not be negative; received ${lives}`);
  }
  if (unclampedLives > totalLives) {
    diagnostics.push(`lives (${unclampedLives}) exceeds maxLives (${totalLives})`);
  }

  const compact = totalLives > MAX_HEART_SLOTS;
  if (compact) {
    diagnostics.push(`maxLives (${totalLives}) exceeds the ${MAX_HEART_SLOTS}-slot visual limit; using a compact count`);
  }

  const renderedSlots = compact ? 0 : totalLives;
  const { columns, rows } = livesGrid(renderedSlots);

  return {
    columns,
    compact,
    diagnostics,
    remainingLives,
    renderedSlots,
    rows,
    totalLives
  };
}

function reportLivesDiagnostic(diagnostic: string): void {
  const runtimeFlags = globalThis as typeof globalThis & { mlDisplayDevelopment?: boolean };
  const development = runtimeFlags.mlDisplayDevelopment === true;

  if (diagnostic.length === 0 || !development) {
    return;
  }

  if (reportedDiagnostics.has(diagnostic)) {
    return;
  }

  reportedDiagnostics.add(diagnostic);
  console.error(`[display-kit] Invalid LivesMeter input: ${diagnostic}`);
}

function HeartIcon() {
  return (
    <svg
      aria-hidden="true"
      className="ml-life-heart-svg"
      focusable="false"
      viewBox="0 0 32 30"
    >
      <path d="M16 28.2 3.8 16.7C-2 11.1.7 1.8 8.6 1.8c3.3 0 5.8 1.8 7.4 4.2 1.6-2.4 4.1-4.2 7.4-4.2 7.9 0 10.6 9.3 4.8 14.9L16 28.2Z" />
    </svg>
  );
}

export function LivesMeter({ className = "", lives, maxLives }: LivesMeterProps) {
  const normalized = normalizeLivesForDisplay(lives, maxLives);
  const {
    columns,
    compact,
    diagnostics,
    remainingLives,
    renderedSlots,
    rows,
    totalLives
  } = normalized;
  const previousLivesRef = useRef(remainingLives);
  const changeSequenceRef = useRef(0);
  const [lifeChange, setLifeChange] = useState<{
    from: number;
    id: number;
    to: number;
  } | null>(null);
  const diagnosticMessage = diagnostics.join("; ");

  useEffect(() => {
    reportLivesDiagnostic(diagnosticMessage);
  }, [diagnosticMessage]);

  useEffect(() => {
    const previousLives = previousLivesRef.current;
    previousLivesRef.current = remainingLives;

    if (previousLives === remainingLives) {
      return;
    }

    changeSequenceRef.current += 1;
    const nextChange = {
      from: previousLives,
      id: changeSequenceRef.current,
      to: remainingLives
    };
    setLifeChange(nextChange);

    const clearChange = window.setTimeout(() => {
      setLifeChange((currentChange) => currentChange?.id === nextChange.id ? null : currentChange);
    }, LIFE_CHANGE_DURATION_MILLIS);

    return () => window.clearTimeout(clearChange);
  }, [remainingLives]);

  const meterStyle = {
    "--ml-life-columns": columns,
    "--ml-life-rows": rows
  } as CSSProperties;

  return (
    <div
      aria-label={`${remainingLives} de ${totalLives} vidas restantes`}
      className={`ml-lives-meter${compact ? " is-compact" : ""}${totalLives === 0 ? " is-empty" : ""} ${className}`.trim()}
      data-display-containment="lives"
      data-life-columns={columns}
      data-life-mode={compact ? "compact" : "slots"}
      data-life-remaining={remainingLives}
      data-life-rows={rows}
      data-life-total={totalLives}
      data-lives-meter="true"
      role="img"
      style={meterStyle}
    >
      {compact ? (
        <span className="ml-lives-summary" data-life-summary="true">
          <span className="ml-lives-summary-heart" aria-hidden="true"><HeartIcon /></span>
          <strong>× {remainingLives}</strong>
          <span>de {totalLives}</span>
        </span>
      ) : renderedSlots === 0 ? (
        <span className="ml-lives-empty" aria-hidden="true">0</span>
      ) : Array.from({ length: renderedSlots }, (_, index) => {
        const remaining = index < remainingLives;
        const changed = lifeChange
          && index >= Math.min(lifeChange.from, lifeChange.to)
          && index < Math.max(lifeChange.from, lifeChange.to);
        const changeClass = changed
          ? lifeChange.to > lifeChange.from
            ? "is-regained"
            : "is-losing"
          : "";

        return (
          <span
            aria-hidden="true"
            className={`ml-life-heart ${remaining ? "is-remaining" : "is-lost"}`}
            data-life-slot={index + 1}
            data-life-state={remaining ? "remaining" : "lost"}
            key={index}
          >
            <span
              className={`ml-life-heart-visual ${changeClass}`.trim()}
              data-display-scale-envelope="1.25"
              data-life-change={changeClass || undefined}
              style={{ "--ml-heart-index": index } as CSSProperties}
            >
              <HeartIcon />
            </span>
          </span>
        );
      })}
    </div>
  );
}
