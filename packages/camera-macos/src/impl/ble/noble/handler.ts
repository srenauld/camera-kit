import noble from "@abandonware/noble";
import {
  BleAdvertisementExpiredError,
  BleAdvertisementPacket,
  type BleDevice,
  type BleHandler,
  BleHandlerClosedError,
  type BleScanOptions,
  canonicalBleUuid,
  type ConnectionOptions,
} from "@srenauld/camera-core";

import { NobleDevice } from "./device";

type Deferred = {
  promise: Promise<void>;
  reject: (reason: unknown) => void;
  resolve: () => void;
};

type ScanListener = {
  allowDuplicates: boolean;
  closed: boolean;
  queue: BleAdvertisementPacket[];
  seen: Set<string>;
  serviceUuids: readonly string[];
  waiting?: Deferred;
};

const CLOSE_TIMEOUT_MS = 1000;

export class NobleBleHandler implements BleHandler {
  private closed = false;
  private readonly connections = new Map<string, Promise<NobleDevice>>();
  private readonly issuedAdvertisements = new WeakSet<BleAdvertisementPacket>();
  private readonly listeners = new Set<ScanListener>();
  private readonly peripherals = new Map<string, noble.Peripheral>();
  private scanning = false;
  private scanStarting?: Promise<void>;

  constructor() {
    noble.on("scanStart", this.onScanStart);
    noble.on("scanStop", this.onScanStop);
    noble.on("discover", this.onDiscover);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.listeners) {
      listener.closed = true;
      listener.waiting?.resolve();
    }
    this.listeners.clear();
    if (this.scanning || this.scanStarting) {
      const stopped = new Promise<void>((resolve) => {
        noble.once("scanStop", resolve);
      });
      noble.stopScanning();
      await Promise.race([stopped, timeout(CLOSE_TIMEOUT_MS)]);
    }
    const devices = await Promise.allSettled(this.connections.values());
    await Promise.allSettled(
      devices.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.disconnect()] : [],
      ),
    );
    this.connections.clear();
    this.peripherals.clear();
    const native = noble as unknown as {
      _bindings?: { stop?: () => void };
      _state?: string;
      initialized?: boolean;
    };
    if (native.initialized && native._state === "poweredOn")
      native._bindings?.stop?.();
    noble.removeListener("scanStart", this.onScanStart);
    noble.removeListener("scanStop", this.onScanStop);
    noble.removeListener("discover", this.onDiscover);
  }

  connect(
    advertisement: BleAdvertisementPacket,
    options: ConnectionOptions = {},
  ): Promise<BleDevice> {
    if (this.closed)
      return Promise.reject(new BleHandlerClosedError("BLE handler is closed"));
    if (!this.issuedAdvertisements.has(advertisement))
      return Promise.reject(
        new BleAdvertisementExpiredError(
          `Advertisement ${advertisement.id} was not emitted by this handler`,
        ),
      );
    const existing = this.connections.get(advertisement.id);
    if (existing) return existing;
    const peripheral = this.peripherals.get(advertisement.id);
    if (!peripheral)
      return Promise.reject(
        new BleAdvertisementExpiredError(
          `Advertisement ${advertisement.id} is no longer available`,
        ),
      );

    const opening = (async (): Promise<NobleDevice> => {
      if (peripheral.state !== "connected")
        await withConnectionOptions(peripheral.connectAsync(), options);
      return new NobleDevice(peripheral, () => {
        if (this.connections.get(advertisement.id) === pending)
          this.connections.delete(advertisement.id);
      });
    })();
    const pending = opening.catch(async (error: unknown) => {
      this.connections.delete(advertisement.id);
      if (peripheral.state === "connected")
        await peripheral.disconnectAsync().catch(() => undefined);
      throw error;
    });
    this.connections.set(advertisement.id, pending);
    return pending;
  }

  async *scan(
    options: BleScanOptions = {},
  ): AsyncGenerator<BleAdvertisementPacket> {
    if (this.closed) throw new BleHandlerClosedError("BLE handler is closed");
    const listener: ScanListener = {
      allowDuplicates: options.allowDuplicates ?? false,
      closed: false,
      queue: [],
      seen: new Set(),
      serviceUuids: options.serviceUuids?.map(canonicalBleUuid) ?? [],
    };
    this.listeners.add(listener);
    const abort = (): void => {
      listener.closed = true;
      listener.waiting?.resolve();
      listener.waiting = undefined;
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.ensureScanning();
      while (!listener.closed) {
        const advertisement = listener.queue.shift();
        if (advertisement) {
          yield advertisement;
          continue;
        }
        listener.waiting = deferred();
        await listener.waiting.promise;
      }
    } finally {
      listener.closed = true;
      listener.waiting?.resolve();
      this.listeners.delete(listener);
      options.signal?.removeEventListener("abort", abort);
      this.maybeStopScanning();
    }
  }

  private async ensureScanning(): Promise<void> {
    if (this.scanning) return;
    if (this.scanStarting) return this.scanStarting;
    this.scanStarting = (async () => {
      if (noble._state !== "poweredOn") await this.waitForPoweredOn();
      if (this.closed) throw new BleHandlerClosedError("BLE handler is closed");
      await new Promise<void>((resolve, reject) => {
        noble.startScanning([], true, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    })();
    try {
      await this.scanStarting;
    } finally {
      this.scanStarting = undefined;
    }
  }

  private matches(
    advertisement: BleAdvertisementPacket,
    serviceUuids: readonly string[],
  ): boolean {
    return (
      serviceUuids.length === 0 ||
      serviceUuids.some((uuid) => advertisement.hasServiceUuid(uuid))
    );
  }

  private maybeStopScanning(): void {
    if (this.listeners.size === 0 && this.scanning) noble.stopScanning();
  }

  private readonly onDiscover = (peripheral: noble.Peripheral): void => {
    this.peripherals.set(peripheral.id, peripheral);
    const advertisement = new BleAdvertisementPacket({
      id: peripheral.id,
      localName: peripheral.advertisement.localName,
      manufacturer: peripheral.advertisement.manufacturerData,
      rssi: peripheral.rssi,
      serviceUuids: peripheral.advertisement.serviceUuids,
    });
    this.issuedAdvertisements.add(advertisement);
    for (const listener of this.listeners) {
      if (
        listener.closed ||
        !this.matches(advertisement, listener.serviceUuids)
      )
        continue;
      if (!listener.allowDuplicates && listener.seen.has(peripheral.id))
        continue;
      listener.seen.add(peripheral.id);
      listener.queue.push(advertisement);
      listener.waiting?.resolve();
      listener.waiting = undefined;
    }
  };

  private readonly onScanStart = (): void => {
    this.scanning = true;
  };

  private readonly onScanStop = (): void => {
    this.scanning = false;
  };

  private waitForPoweredOn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onStateChange = (state: string): void => {
        if (state === "poweredOn") {
          noble.removeListener("stateChange", onStateChange);
          resolve();
        } else if (
          state === "unsupported" ||
          state === "unauthorized" ||
          state === "poweredOff"
        ) {
          noble.removeListener("stateChange", onStateChange);
          reject(new Error(`Bluetooth adapter state: ${state}`));
        }
      };
      noble.on("stateChange", onStateChange);
    });
  }
}

function abortSignalReason(signal?: AbortSignal): unknown {
  return signal ? (Reflect.get(signal, "reason") as unknown) : undefined;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function timeout(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

function withConnectionOptions<T>(
  promise: Promise<T>,
  options: ConnectionOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(
        toError(abortSignalReason(options.signal), "BLE connection aborted"),
      );
      return;
    }
    const abort = (): void => {
      cleanup();
      reject(
        toError(abortSignalReason(options.signal), "BLE connection aborted"),
      );
    };
    const timeoutHandle =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            cleanup();
            reject(
              new Error(
                `BLE connection timed out after ${options.timeoutMs}ms`,
              ),
            );
          }, options.timeoutMs);
    const cleanup = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", abort);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(toError(error, "BLE connection failed"));
      },
    );
  });
}
