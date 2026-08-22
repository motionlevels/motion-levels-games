export type LivesSnapshotContract = {
  lives: number;
  maxLives?: number;
};

/** Return actionable contract violations without throwing so CLI validators can aggregate them. */
export function livesSnapshotContractProblems(
  snapshot: LivesSnapshotContract,
  context = "snapshot"
): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(snapshot.lives) || snapshot.lives < -1) {
    problems.push(`${context}.lives must be an integer greater than or equal to -1; received ${formatValue(snapshot.lives)}`);
    return problems;
  }

  if (snapshot.lives === -1) {
    if (snapshot.maxLives !== undefined) {
      problems.push(
        `${context}.maxLives must be omitted when lives is -1 (the -1 sentinel means the game has no lives mechanic); received ${formatValue(snapshot.maxLives)}`
      );
    }
    return problems;
  }

  const maxLives = snapshot.maxLives;
  if (typeof maxLives !== "number" || !Number.isFinite(maxLives) || !Number.isInteger(maxLives)) {
    problems.push(
      `${context}.maxLives is required and must be a finite integer when lives is ${snapshot.lives}; received ${formatValue(maxLives)}`
    );
    return problems;
  }
  if (maxLives < snapshot.lives) {
    problems.push(
      `${context}.maxLives must be greater than or equal to lives (${snapshot.lives}); received ${maxLives}`
    );
  }
  return problems;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return JSON.stringify(value);
}
