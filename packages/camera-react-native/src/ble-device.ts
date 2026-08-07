import type { Device, Subscription } from "react-native-ble-plx";

import { type BleCharacteristic, type BleDevice } from "@srenauld/camera-core";

import { ReactNativeBleCharacteristic } from "./ble-characteristic";

export class ReactNativeBleDevice implements BleDevice {
  get connected(): boolean {
    return this.connectedState;
  }

  get id(): string {
    return this.device.id;
  }

  private connectedState = true;
  private disconnectSubscription?: Subscription;
  constructor(
    private device: Device,
    private readonly onClosed: () => void = () => undefined,
  ) {
    this.disconnectSubscription = this.device.onDisconnected(() => {
      this.connectedState = false;
      this.onClosed();
    });
  }

  async *characteristics(): AsyncGenerator<BleCharacteristic, void, void> {
    if (!this.connectedState) throw new Error("BLE device is not connected");
    const services = await this.device.services();
    for (const service of services) {
      const characteristics = await this.device.characteristicsForService(
        service.uuid,
      );
      for (const characteristic of characteristics)
        yield new ReactNativeBleCharacteristic(characteristic);
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = undefined;
    if (!this.connectedState) return;
    await this.device.cancelConnection();
    this.connectedState = false;
    this.onClosed();
  }
}
