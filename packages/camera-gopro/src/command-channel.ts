import type { BleCharacteristic } from "@mandltv/camera-core";

export type MessageCodec = {
  createCollector(): MessageCollector;
  encode(command: Uint8Array): Frame[];
};
export type MessageCollector = {
  push(data: Uint8Array): CollectorResult;
};

export type RequestResponseChannel = {
  write(
    command: Uint8Array,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Uint8Array>;
};

type CollectorResult = CollectorResultDone | CollectorResultWaiting;
type CollectorResultData = {
  done: true;
  message: Uint8Array;
};
type CollectorResultDone = CollectorResultData | CollectorResultError;
type CollectorResultError = {
  done: true;
  error: Error;
};
type CollectorResultWaiting = {
  done: false;
};
type Frame = {
  bytes: Uint8Array;
};
export class BleCommandChannel implements RequestResponseChannel {
  private closed = false;
  private failed?: Error;

  private queue: Promise<void> = Promise.resolve();
  private responseStream?: AsyncIterator<Uint8Array>;
  constructor(
    private readonly requestChar: BleCharacteristic,
    private readonly responseChar: BleCharacteristic,
    private readonly codec: MessageCodec,
  ) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.responseStream?.return?.();
    this.responseStream = undefined;
  }

  async init() {
    if (this.closed) throw new Error("Channel is closed");
    this.responseStream = this.responseChar.subscribe()[Symbol.asyncIterator]();
  }

  write(
    command: Uint8Array,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Uint8Array> {
    const run = async () => {
      if (this.closed) throw new Error("Channel is closed");
      if (this.failed) throw this.failed;
      if (!this.responseStream) throw new Error("Channel not initialized");

      const frames = this.codec.encode(command);
      const collector = this.codec.createCollector();

      for (const frame of frames) {
        await this.requestChar.write(frame.bytes);
      }

      for (;;) {
        const next = await this.responseStream.next();
        if (next.done) throw new Error("Response stream closed");

        const result = collector.push(next.value);
        if (isDone(result)) {
          if (isError(result)) {
            throw result.error;
          } else {
            return result.message;
          }
        }
      }
    };

    const pending = withTimeout(
      this.queue.then(run, run),
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options?.signal,
    );
    void pending.catch((error: unknown) => {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        // A timed-out iterator may still consume a late response. Poison this channel rather
        // than associating that response with a later request.
        this.failed = error;
      }
    });
    this.queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(toError(abortSignalReason(signal), abortError()));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(timeoutError(timeoutMs));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(toError(abortSignalReason(signal), abortError()));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(toError(error, new Error("GoPro command failed")));
      },
    );
  });
}
function abortError(message = "Aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
function abortSignalReason(signal?: AbortSignal): unknown {
  return signal ? (Reflect.get(signal, "reason") as unknown) : undefined;
}
function isDone(r: CollectorResult): r is CollectorResultDone {
  return r.done;
}
function isError(r: CollectorResultDone): r is CollectorResultError {
  return "error" in r;
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`Timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function toError(value: unknown, fallback: Error): Error {
  return value instanceof Error ? value : fallback;
}

const DEFAULT_TIMEOUT_MS = 10_000;
