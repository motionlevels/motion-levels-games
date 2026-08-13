import { performance } from "node:perf_hooks";
import type { RunnerMethod, RunnerTelemetry } from "./protocol.ts";

const methods = ["init", "input", "control", "tick", "status"] as const;

export class RunnerTelemetryCollector {
  private readonly startedAt = performance.now();
  private requestsTotal = 0;
  private errorsTotal = 0;
  private readonly methodTotals = new Map<RunnerMethod, number>();
  private lastMethod: RunnerMethod | "invalid" = "invalid";
  private lastRequestDurationMicros = 0;

  observe(method: RunnerMethod | "invalid", startedAt: number, failed = false): RunnerTelemetry {
    this.requestsTotal += 1;
    if (failed) this.errorsTotal += 1;
    if (method !== "invalid") {
      this.methodTotals.set(method, (this.methodTotals.get(method) ?? 0) + 1);
    }
    this.lastMethod = method;
    this.lastRequestDurationMicros = Math.max(0, Math.round((performance.now() - startedAt) * 1_000));
    return this.snapshot();
  }

  snapshot(): RunnerTelemetry {
    const memory = process.memoryUsage();
    const totals = Object.fromEntries(methods.map((method) => [`${method}Total`, this.methodTotals.get(method) ?? 0]));
    return {
      uptimeMillis: Math.max(0, Math.round(performance.now() - this.startedAt)),
      requestsTotal: this.requestsTotal,
      errorsTotal: this.errorsTotal,
      ...totals,
      lastMethod: this.lastMethod,
      lastRequestDurationMicros: this.lastRequestDurationMicros,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed
    } as RunnerTelemetry;
  }
}
