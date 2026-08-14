const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type CachedCommandOutcome<Result> =
  | { ok: true; result: Result }
  | { ok: false; error: unknown };

/** Serializes mutations and makes UUID-addressed retries idempotent. */
export class SerializedCommandExecutor<Result> {
  private tail: Promise<void> = Promise.resolve();
  private readonly outcomes = new Map<string, CachedCommandOutcome<Result>>();
  private readonly order: string[] = [];

  constructor(private readonly maxCachedResults = 256) {
    if (!Number.isSafeInteger(maxCachedResults) || maxCachedResults < 1) {
      throw new RangeError("maxCachedResults must be a positive safe integer");
    }
  }

  execute(commandId: string, action: () => Result | Promise<Result>): Promise<Result> {
    const normalized = commandId.trim().toLowerCase();
    if (normalized && !uuidPattern.test(normalized)) {
      return Promise.reject(new TypeError("commandId must be a UUID"));
    }
    const execution = this.tail.then(async () => {
      const cached = normalized ? this.outcomes.get(normalized) : undefined;
      if (cached) {
        if (!cached.ok) throw cached.error;
        return structuredClone(cached.result);
      }
      try {
        const result = await action();
        if (normalized) this.cache(normalized, { ok: true, result: structuredClone(result) });
        return structuredClone(result);
      } catch (error) {
        if (normalized) {
          // Preserve the original error instance so HTTP status mapping keeps
          // its concrete class when the command is retried.
          this.cache(normalized, { ok: false, error });
        }
        throw error;
      }
    });
    this.tail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  private cache(commandId: string, outcome: CachedCommandOutcome<Result>): void {
    this.outcomes.set(commandId, outcome);
    this.order.push(commandId);
    if (this.order.length > this.maxCachedResults) {
      const expired = this.order.shift();
      if (expired) this.outcomes.delete(expired);
    }
  }
}
