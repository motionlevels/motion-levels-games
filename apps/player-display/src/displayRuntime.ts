export type GamesDisplayRenderState = {
  status: "loading" | "ready" | "fallback" | "error";
  expectedRevision: string;
  loadedRevision: string;
  attempt: number;
  error: string;
};

const retryDelaysMillis = [0, 250, 500, 1000, 2000, 5000, 10_000] as const;

export function runtimeRetryDelayMillis(attempt: number): number {
  const normalized = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return retryDelaysMillis[Math.min(normalized, retryDelaysMillis.length - 1)];
}

export function displayErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message.trim();
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  return "No se pudo cargar la pantalla del juego";
}

export function shouldReportDisplayClient(pathname: string): boolean {
  return !/^\/gateways\/[^/]+\/display(?:\/|$)/u.test(pathname);
}
