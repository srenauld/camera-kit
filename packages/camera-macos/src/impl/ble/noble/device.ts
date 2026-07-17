import { Peripheral } from "@abandonware/noble";
import { type BleCharacteristic, type BleDevice } from "@mandltv/camera-core";

import { NobleCharacteristic } from "./characteristic";

export class NobleDevice implements BleDevice {
  get connected() {
    return this.peripheral.state === "connected";
  }

  get id(): string {
    return this.peripheral.id;
  }

  private closed = false;

  constructor(
    private readonly peripheral: Peripheral,
    private readonly onClosed: () => void = () => undefined,
  ) {
    this.peripheral.on("disconnect", this.onDisconnect);
  }

  async *characteristics(): AsyncGenerator<BleCharacteristic, void, void> {
    const characteristics =
      await this.peripheral.discoverAllServicesAndCharacteristicsAsync();
    for (const characteristic of characteristics.characteristics) {
      yield new NobleCharacteristic(characteristic);
    }
  }

  async disconnect() {
    if (this.closed) return;
    this.closed = true;
    this.peripheral.removeListener("disconnect", this.onDisconnect);
    if (this.connected) await this.peripheral.disconnectAsync();
    this.onClosed();
  }

  private readonly onDisconnect = (): void => {
    this.closed = true;
    this.peripheral.removeListener("disconnect", this.onDisconnect);
    this.onClosed();
  };
}
