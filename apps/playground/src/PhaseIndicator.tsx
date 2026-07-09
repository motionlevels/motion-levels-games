const phaseLabels: Record<string, string> = {
  waiting: "Standby",
  ready: "Ready",
  running: "Live",
  paused: "Paused",
  finished: "Finished"
};

type PhaseIndicatorProps = {
  as?: "span" | "strong";
  className?: string;
  phase: string;
};

export function PhaseIndicator({ as: Element = "span", className = "", phase }: PhaseIndicatorProps) {
  return (
    <Element className={`phase-indicator ${className}`.trim()} data-phase={phase}>
      <i aria-hidden="true" />
      {phaseLabels[phase] ?? phase}
    </Element>
  );
}
