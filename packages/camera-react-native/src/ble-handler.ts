import {
  BleAdvertisementExpiredError,
  BleAdvertisementPacket,
  type BleDevice,
  type BleHandler,
  BleHandlerClosedError,
  type BleScanOptions,
  canonicalBleUuid,
  type ConnectionOptions,
} from "@mandltv/camera-core";
import { type BleManager, type Device } from "react-native-ble-plx";

import { base64ToBytes } from "./base64";
import { ReactNativeBleDevice } from "./ble-device";

type Deferred = {
  promise: Promise<void>;
  reject: (reason: unknown) => void;
  resolve: () => void;
};
type ScanListener = {
  readonly allowDuplicates: boolean;
  closed: boolean;
  error?: Error;
  readonly queue: BleAdvertisementPacket[];
  readonly seen: Set<string>;
  readonly serviceUuids: readonly string[];
  waiting?: Deferred;
};

const POWERED_ON = "PoweredOn" as Awaited<ReturnType<BleManager["state"]>>;

export class ReactNativeBleHandler implements BleHandler {
  private closed = false;
  private readonly connections = new Map<
    string,
    Promise<ReactNativeBleDevice>
  >();
  private readonly issuedAdvertisements = new WeakSet<BleAdvertisementPacket>();
  private readonly listeners = new Set<ScanListener>();
  private nativeScanRunning = false;
  private nativeScanStarting?: Promise<void>;
  private readonly peripherals = new Map<string, Device>();

  constructor(private readonly manager: BleManager) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.listeners) {
      listener.closed = true;
      listener.waiting?.resolve();
    }
    this.listeners.clear();
    if (this.nativeScanRunning || this.nativeScanStarting) {
      this.nativeScanRunning = false;
      await this.manager.stopDeviceScan();
    }
    const devices = await Promise.allSettled(this.connections.values());
    await Promise.allSettled(
      devices.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.disconnect()] : [],
      ),
    );
    this.connections.clear();
    this.peripherals.clear();
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

    const opening = (async (): Promise<ReactNativeBleDevice> => {
      const connected = await withConnectionOptions(
        peripheral.connect(),
        options,
      );
      const discovered = await withConnectionOptions(
        connected.discoverAllServicesAndCharacteristics(),
        options,
      );
      return new ReactNativeBleDevice(discovered, () => {
        if (this.connections.get(advertisement.id) === pending)
          this.connections.delete(advertisement.id);
      });
    })();
    const pending = opening.catch(async (error: unknown) => {
      this.connections.delete(advertisement.id);
      await peripheral.cancelConnection().catch(() => undefined);
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
      await this.ensureScan();
      while (!listener.closed) {
        if (listener.error) throw listener.error;
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
      await this.maybeStop();
    }
  }

  private async ensureScan(): Promise<void> {
    if (this.nativeScanRunning) return;
    if (this.nativeScanStarting) return this.nativeScanStarting;
    this.nativeScanStarting = (async () => {
      const state = await this.manager.state();
      if (state !== POWERED_ON)
        throw new Error(`Bluetooth adapter state: ${state}`);
      await this.manager.startDeviceScan(
        null,
        { allowDuplicates: true },
        this.onDevice,
      );
      this.nativeScanRunning = true;
    })();
    try {
      await this.nativeScanStarting;
    } finally {
      this.nativeScanStarting = undefined;
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

  private async maybeStop(): Promise<void> {
    if (this.listeners.size > 0 || !this.nativeScanRunning) return;
    this.nativeScanRunning = false;
    await this.manager.stopDeviceScan();
  }

  private readonly onDevice = (
    error: Error | null,
    device: Device | null,
  ): void => {
    if (error) {
      for (const listener of this.listeners) {
        listener.error = error;
        listener.waiting?.reject(error);
        listener.waiting = undefined;
      }
      return;
    }
    if (!device) return;
    this.peripherals.set(device.id, device);
    const advertisement = new BleAdvertisementPacket({
      id: device.id,
      localName: device.localName ?? device.name ?? undefined,
      manufacturer: base64ToBytes(device.manufacturerData),
      rssi: device.rssi ?? undefined,
      serviceUuids: device.serviceUUIDs ?? [],
    });
    this.issuedAdvertisements.add(advertisement);
    for (const listener of this.listeners) {
      if (
        listener.closed ||
        !this.matches(advertisement, listener.serviceUuids)
      )
        continue;
      if (!listener.allowDuplicates && listener.seen.has(device.id)) continue;
      listener.seen.add(device.id);
      listener.queue.push(advertisement);
      listener.waiting?.resolve();
      listener.waiting = undefined;
    }
  };
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
    const timeout =
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
      if (timeout) clearTimeout(timeout);
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
