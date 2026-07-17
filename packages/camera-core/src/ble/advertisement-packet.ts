import { canonicalBleUuid } from "./uuid";

export type BleAdvertisementPacketOptions = Readonly<{
  id: string;
  localName?: string;
  manufacturer?: Uint8Array;
  rssi?: number;
  serviceUuids?: readonly string[];
}>;

export class BleAdvertisementPacket {
  readonly id: string;
  readonly localName?: string;
  readonly rssi?: number;
  readonly serviceUuids: readonly string[];

  get manufacturer(): Uint8Array {
    return Uint8Array.from(this.manufacturerBytes);
  }

  private readonly manufacturerBytes: Uint8Array;

  constructor(options: BleAdvertisementPacketOptions) {
    if (options.id.length === 0)
      throw new Error("A BLE advertisement requires a stable transport id");
    this.id = options.id;
    this.localName = options.localName;
    this.manufacturerBytes = Uint8Array.from(
      options.manufacturer ?? new Uint8Array(),
    );
    this.rssi = options.rssi;
    this.serviceUuids = Object.freeze(
      (options.serviceUuids ?? []).map(canonicalBleUuid),
    );
  }

  hasServiceUuid(uuid: string): boolean {
    const expected = canonicalBleUuid(uuid);
    return this.serviceUuids.includes(expected);
  }
}
