import type { BleCharacteristic } from "@mandltv/camera-core";

import { Characteristic } from "@abandonware/noble";

export class NobleCharacteristic implements BleCharacteristic {
  get uuid() {
    return this.characteristic.uuid;
  }

  constructor(private readonly characteristic: Characteristic) {}

  subscribe(): AsyncIterable<Uint8Array> {
    const ch = this.characteristic;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        const queue: Uint8Array[] = [];
        let pendingResolve: ((r: IteratorResult<Uint8Array>) => void) | null =
          null;
        let pendingReject: ((error: unknown) => void) | null = null;
        let closed = false;

        const flush = () => {
          if (pendingResolve && queue.length > 0) {
            const resolve = pendingResolve;
            pendingResolve = null;
            pendingReject = null;
            const value = queue.shift();
            if (value) resolve({ done: false, value });
          }
        };

        const onData = (data: Buffer, _isNotification?: boolean) => {
          if (closed) return;
          queue.push(new Uint8Array(data));
          flush();
        };

        const ready = new Promise<void>((resolve, reject) => {
          ch.on("data", onData);
          ch.subscribe((error: unknown) => {
            if (error) {
              ch.off("data", onData);
              reject(
                error instanceof Error
                  ? error
                  : new Error("BLE subscription failed"),
              );
              return;
            }
            resolve();
          });
        });

        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            await ready;
            const value = queue.shift();
            if (value) return { done: false, value };
            if (closed) return { done: true, value: undefined as never };
            return new Promise<IteratorResult<Uint8Array>>(
              (resolve, reject) => {
                pendingResolve = resolve;
                pendingReject = reject;
              },
            );
          },

          async return(): Promise<IteratorResult<Uint8Array>> {
            closed = true;
            if (pendingResolve) {
              const resolve = pendingResolve;
              pendingResolve = null;
              pendingReject = null;
              resolve({ done: true, value: undefined as never });
            }
            ch.off("data", onData);
            await new Promise<void>((resolve) => {
              ch.unsubscribe(() => {
                resolve();
              });
            }).catch(() => {});
            return { done: true, value: undefined as never };
          },

          async throw(error?: unknown): Promise<IteratorResult<Uint8Array>> {
            closed = true;
            if (pendingReject) {
              const reject = pendingReject;
              pendingResolve = null;
              pendingReject = null;
              reject(
                error instanceof Error
                  ? error
                  : new Error("BLE notification stream failed"),
              );
            }
            ch.off("data", onData);
            await new Promise<void>((resolve) => {
              ch.unsubscribe(() => {
                resolve();
              });
            }).catch(() => {});
            throw error;
          },
        };
      },
    };
  }

  async write(data: Uint8Array): Promise<void> {
    const ch = this.characteristic;
    const withoutResponse = true;
    await new Promise<void>((resolve, reject) => {
      ch.write(Buffer.from(data), withoutResponse, (error: unknown) => {
        if (error) {
          reject(
            error instanceof Error ? error : new Error("BLE write failed"),
          );
          return;
        }
        resolve();
      });
    });
  }
}
