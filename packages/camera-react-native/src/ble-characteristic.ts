import type { BleCharacteristic } from "@srenauld/camera-core";
import type { Characteristic, Subscription } from "react-native-ble-plx";

import { base64ToBytes, bytesToBase64 } from "./base64";

export class ReactNativeBleCharacteristic implements BleCharacteristic {
  get uuid(): string {
    return this.characteristic.uuid;
  }

  constructor(private readonly characteristic: Characteristic) {}

  subscribe(): AsyncIterable<Uint8Array> {
    const characteristic = this.characteristic;
    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        const queue: Uint8Array[] = [];
        let closed = false;
        let failure: Error | undefined;
        let waiter:
          | {
              reject: (reason: unknown) => void;
              resolve: (result: IteratorResult<Uint8Array>) => void;
            }
          | undefined;
        let subscription: Subscription | undefined;

        const flush = (): void => {
          if (!waiter || queue.length === 0) return;
          const current = waiter;
          waiter = undefined;
          const value = queue.shift();
          if (value) current.resolve({ done: false, value });
        };

        subscription = characteristic.monitor((error, changed) => {
          if (closed) return;
          if (error) {
            failure = error;
            if (waiter) {
              const current = waiter;
              waiter = undefined;
              current.reject(error);
            }
            return;
          }
          if (!changed) return;
          try {
            queue.push(base64ToBytes(changed.value));
            flush();
          } catch (error_) {
            failure =
              error_ instanceof Error
                ? error_
                : new Error("Invalid BLE notification");
            if (waiter) {
              const current = waiter;
              waiter = undefined;
              current.reject(failure);
            }
          }
        });

        const close = (): IteratorResult<Uint8Array> => {
          closed = true;
          subscription?.remove();
          subscription = undefined;
          if (waiter) {
            const current = waiter;
            waiter = undefined;
            current.resolve({ done: true, value: undefined as never });
          }
          return { done: true, value: undefined as never };
        };

        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (failure) throw failure;
            const value = queue.shift();
            if (value) return { done: false, value };
            if (closed) return { done: true, value: undefined as never };
            return new Promise<IteratorResult<Uint8Array>>(
              (resolve, reject) => {
                waiter = { reject, resolve };
              },
            );
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            return close();
          },
          async throw(reason?: unknown): Promise<IteratorResult<Uint8Array>> {
            close();
            throw reason;
          },
        };
      },
    };
  }

  async write(data: Uint8Array): Promise<void> {
    const encoded = bytesToBase64(data);
    if (this.characteristic.isWritableWithoutResponse) {
      await this.characteristic.writeWithoutResponse(encoded);
      return;
    }
    if (this.characteristic.isWritableWithResponse) {
      await this.characteristic.writeWithResponse(encoded);
      return;
    }
    throw new Error(`Characteristic ${this.uuid} does not support writes`);
  }
}
