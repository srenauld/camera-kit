import noble from '@abandonware/noble';
import type { BleScanner } from '@srenauld/camera-core';
import { NobleDevice } from './device';
import type { BleDevice } from '@srenauld/camera-core';


type Deferred = {
    resolve: () => void;
    promise: Promise<void>;
};

function createDeferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { resolve, promise };
}

type ScanListener = {
    uuids: string[];
    allowDuplicates: boolean;
    queue: noble.Peripheral[];
    seen: Set<string>;
    closed: boolean;
    waiting: Deferred | null;
};
type ScanListenerList = Record<string, ScanListener>;
export class NobleScanner implements BleScanner {
    scanListeners: ScanListenerList = {};
    private scanning: boolean = false;
    constructor() {
        noble.on('scanStart', () => {
            this.scanning = true;
        });
        noble.on('scanStop', () => {
            this.scanning = false;
        });
        noble.on('discover', (peripheral) => this.onDiscover(peripheral));
    }
    private matchesFilter(
        peripheral: noble.Peripheral,
        uuids: string[]
    ): boolean {
        if (uuids.length === 0) return true;

        const advertised = peripheral.advertisement.serviceUuids ?? [];
        const advertisedSet = new Set(advertised.map((x) => x.toLowerCase()));

        return uuids.some((uuid) => advertisedSet.has(uuid.toLowerCase()));
    }
    private onDiscover(peripheral: noble.Peripheral) {
        for (const listener of Object.values(this.scanListeners)) {
            if (listener.closed) continue;
            if (!this.matchesFilter(peripheral, listener.uuids)) continue;

            if (!listener.allowDuplicates) {
                if (listener.seen.has(peripheral.id)) continue;
                listener.seen.add(peripheral.id);
            }

            listener.queue.push(peripheral);

            if (listener.waiting) {
                listener.waiting.resolve();
                listener.waiting = null;
            }
        }
    }
    private async ensureScanning(
        uuids: string[],
        allowDuplicates: boolean
    ): Promise<void> {
        if (this.scanning) return;

        if (noble._state !== 'poweredOn') {
            await new Promise<void>((resolve, reject) => {
                const onStateChange = (state: string) => {
                    if (state === 'poweredOn') {
                        noble.removeListener('stateChange', onStateChange);
                        resolve();
                    } else if (
                        state === 'unsupported' ||
                        state === 'unauthorized' ||
                        state === 'poweredOff'
                    ) {
                        noble.removeListener('stateChange', onStateChange);
                        reject(new Error(`Bluetooth adapter state: ${state}`));
                    }
                };

                noble.on('stateChange', onStateChange);
            });
        }

        await new Promise<void>((resolve, reject) => {
            noble.startScanning(uuids, allowDuplicates, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    private maybeStopScanning() {
        const hasOpenListeners = Object.values(this.scanListeners).some(
            (listener) => !listener.closed
        );

        if (!hasOpenListeners && this.scanning) {
            noble.stopScanning();
        }
    }
    async *scan(options?: {
        uuids?: string[];
        allowDuplicates?: boolean;
        signal?: AbortSignal;
    }): AsyncGenerator<BleDevice, void, void> {
        const id = Math.random().toString(36).slice(2);
        const uuids = options?.uuids ?? [];
        const allowDuplicates = options?.allowDuplicates ?? false;

        this.scanListeners[id] = {
            uuids,
            allowDuplicates,
            queue: [],
            seen: new Set<string>(),
            closed: false,
            waiting: null,
        };

        const listener = this.scanListeners[id];
        const abort = () => {
            listener.closed = true;
            if (listener.waiting) {
                listener.waiting.resolve();
                listener.waiting = null;
            }
        };
        if (options?.signal?.aborted) abort();
        options?.signal?.addEventListener("abort", abort, { once: true });

        await this.ensureScanning(uuids, true);

        try {
            while (!listener.closed) {
                if (listener.queue.length > 0) {
                    yield new NobleDevice(listener.queue.shift()!);
                    continue;
                }

                listener.waiting = createDeferred();
                await listener.waiting.promise;
            }
        } finally {
            listener.closed = true;

            if (listener.waiting) {
                listener.waiting.resolve();
                listener.waiting = null;
            }

            delete this.scanListeners[id];
            options?.signal?.removeEventListener("abort", abort);
            this.maybeStopScanning();
        }
    }
}
