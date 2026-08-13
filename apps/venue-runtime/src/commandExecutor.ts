const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Serializes mutations and makes UUID-addressed retries idempotent. */
export class SerializedCommandExecutor<Result> {
  private tail: Promise<void> = Promise.resolve();
  private readonly results = new Map<string, Result>();
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
      const cached = normalized ? this.results.get(normalized) : undefined;
      if (cached !== undefined) return structuredClone(cached);
      const result = await action();
      if (normalized) {
        this.results.set(normalized, structuredClone(result));
        this.order.push(normalized);
        if (this.order.length > this.maxCachedResults) {
          const expired = this.order.shift();
          if (expired) this.results.delete(expired);
        }
      }
      return structuredClone(result);
    });
    this.tail = execution.then(() => undefined, () => undefined);
    return execution;
  }
}
