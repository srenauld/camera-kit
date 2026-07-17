import type { BleAdvertisementPacket } from "../../ble/advertisement-packet";
import type { BleDevice } from "./device";

export type BleHandler = {
  close(): Promise<void>;
  connect(
    advertisement: BleAdvertisementPacket,
    options?: ConnectionOptions,
  ): Promise<BleDevice>;
  scan(options?: BleScanOptions): AsyncGenerator<BleAdvertisementPacket>;
};

export type BleScanOptions = Readonly<{
  allowDuplicates?: boolean;
  serviceUuids?: readonly string[];
  signal?: AbortSignal;
}>;

export type ConnectionOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;
