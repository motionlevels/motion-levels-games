export function reportDisplayError(callback: ((reason: unknown) => void) | undefined, reason: unknown): void {
  if (callback) queueMicrotask(() => callback(reason));
}
