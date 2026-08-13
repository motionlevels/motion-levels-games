import type { PresentedFrame } from "./controllerProtocol.ts";

export type LiveFloorJob = {
  controllerId: string;
  sessionId?: string;
  sequence: number;
  width: number;
  height: number;
  presentedUnixNanos: number;
  frameBase64: string;
};

export type LiveFloorPublisherOptions = {
  platformUrl?: string;
  platformToken?: string;
  controllerId?: string;
  fps?: number;
  timeoutMillis?: number;
  fetch?: typeof fetch;
  log?(message: string, error?: unknown): void;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const liveViewerHeaderBytes = 16;
const errorLogIntervalMillis = 10_000;

/**
 * Latest-value publisher for the controller's observed floor output. Game
 * state never enters this path: RGB and pressure come directly from the Go
 * controller's post-watchdog PresentedFrame.
 */
export class LiveFloorPublisher {
  private pending: LiveFloorJob | null = null;
  private latestObserved: LiveFloorJob | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private posting = false;
  private lastEnqueuedAt = 0;
  private lastPublishedAt = 0;
  private lastErrorAt = 0;
  private lastError = "";
  private readonly intervalMillis: number;
  private readonly timeoutMillis: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly controllerId: string,
    fps: number,
    timeoutMillis: number,
    private readonly log?: (message: string, error?: unknown) => void,
    fetchImplementation: typeof fetch = fetch
  ) {
    this.intervalMillis = 1000 / fps;
    this.timeoutMillis = timeoutMillis;
    this.fetchImplementation = fetchImplementation;
  }

  observe(
    frame: PresentedFrame,
    sessionId: string,
    observedAt = Date.now(),
    encoded: Uint8Array = encodeLiveViewerFrame(frame)
  ): void {
    this.latestObserved = {
      controllerId: this.controllerId,
      ...(uuidPattern.test(sessionId) ? { sessionId } : {}),
      sequence: safeInteger(frame.presentationSequence, "presentation sequence"),
      width: frame.width,
      height: frame.height,
      presentedUnixNanos: finiteNumber(frame.presentedUnixNanos, "presented timestamp"),
      frameBase64: Buffer.from(encoded).toString("base64")
    };
    this.schedule(observedAt);
  }

  status(): Record<string, unknown> {
    return {
      configured: true,
      controllerId: this.controllerId,
      targetFps: 1000 / this.intervalMillis,
      pending: this.latestObserved !== null || this.pending !== null || this.posting,
      lastPublishedUnixMillis: this.lastPublishedAt,
      lastError: this.lastError
    };
  }

  private schedule(observedAt: number): void {
    if (this.scheduleTimer) return;
    const waitMillis = this.lastEnqueuedAt > 0
      ? Math.max(0, this.lastEnqueuedAt + this.intervalMillis - observedAt)
      : 0;
    if (waitMillis > 0) {
      this.scheduleTimer = setTimeout(() => {
        this.scheduleTimer = null;
        this.enqueueLatest(Date.now());
      }, waitMillis);
      this.scheduleTimer.unref();
      return;
    }
    this.enqueueLatest(observedAt);
  }

  private enqueueLatest(now: number): void {
    const job = this.latestObserved;
    this.latestObserved = null;
    if (!job) return;
    this.lastEnqueuedAt = now;
    this.pending = job;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.posting) return;
    this.posting = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        try {
          await this.post(job);
          this.lastPublishedAt = Date.now();
          this.lastError = "";
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.logError(error);
        }
      }
    } finally {
      this.posting = false;
      if (this.pending) void this.drain();
      else if (this.latestObserved) this.schedule(Date.now());
    }
  }

  private async post(job: LiveFloorJob): Promise<void> {
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(this.timeoutMillis)
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`platform live-floor ingest returned HTTP ${response.status}`);
    }
    await response.body?.cancel().catch(() => undefined);
  }

  private logError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorAt < errorLogIntervalMillis) return;
    this.lastErrorAt = now;
    this.log?.("live-floor publish failed", error);
  }
}

export function createLiveFloorPublisher(options: LiveFloorPublisherOptions): LiveFloorPublisher | null {
  const platformUrl = String(options.platformUrl ?? "").trim().replace(/\/+$/u, "");
  const fps = finitePositive(options.fps ?? 5, "live-floor FPS", true);
  if (!platformUrl || fps === 0) return null;
  const url = new URL(platformUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("live-floor platform URL must use HTTP or HTTPS");
  }
  const controllerId = String(options.controllerId ?? "").trim();
  if (!controllerId) return null;
  if (!uuidPattern.test(controllerId)) throw new Error("live-floor controller ID must be a UUID");
  const token = String(options.platformToken ?? "").trim();
  if (!token) return null;
  const timeoutMillis = finitePositive(options.timeoutMillis ?? 2000, "live-floor timeout", false);
  return new LiveFloorPublisher(
    `${platformUrl}/api/live-floor/ingest`,
    token,
    controllerId,
    fps,
    timeoutMillis,
    options.log,
    options.fetch
  );
}

export function encodeLiveViewerFrame(frame: PresentedFrame): Uint8Array {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1) {
    throw new Error("presented frame dimensions must be positive integers");
  }
  if (frame.width > 0xffff || frame.height > 0xffff) throw new Error("presented frame dimensions exceed MLF1");
  const tileCount = frame.width * frame.height;
  if (frame.rgb.byteLength !== tileCount * 3) {
    throw new Error(`presented RGB payload is ${frame.rgb.byteLength} bytes, want ${tileCount * 3}`);
  }
  const pressureLength = Math.ceil(tileCount / 8);
  if (frame.pressureBits.byteLength !== pressureLength) {
    throw new Error(`presented pressure payload is ${frame.pressureBits.byteLength} bytes, want ${pressureLength}`);
  }
  const result = new Uint8Array(liveViewerHeaderBytes + frame.rgb.byteLength + frame.pressureBits.byteLength);
  result.set([77, 76, 70, 49], 0); // MLF1
  const view = new DataView(result.buffer);
  view.setUint32(4, Number(frame.presentationSequence & 0xffff_ffffn), true);
  view.setUint16(8, frame.width, true);
  view.setUint16(10, frame.height, true);
  view.setUint8(12, 1); // pressure bitset present
  view.setUint16(14, liveViewerHeaderBytes, true);
  result.set(frame.rgb, liveViewerHeaderBytes);
  result.set(frame.pressureBits, liveViewerHeaderBytes + frame.rgb.byteLength);
  return result;
}

function finitePositive(value: number, label: string, allowZero: boolean): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || (!allowZero && numeric === 0)) {
    throw new Error(`${label} must be ${allowZero ? "non-negative" : "positive"}`);
  }
  return numeric;
}

function safeInteger(value: bigint, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${label} exceeds JSON integer range`);
  return numeric;
}

function finiteNumber(value: bigint, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${label} is invalid`);
  return numeric;
}
