export function reportDisplayError(onError: ((reason: unknown) => void) | undefined, error: unknown): void {
  if (!onError) return;
  queueMicrotask(() => onError(error));
}
