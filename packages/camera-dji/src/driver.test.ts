import {
  BleAdvertisementPacket,
  type BleCharacteristic,
  type BleDevice,
} from "@srenauld/camera-core";

import { createDjiOsmoNanoDriver } from "./driver";

class Device implements BleDevice {
  connected = true;
  disconnects = 0;
  readonly id = "dji";

  async *characteristics(): AsyncGenerator<BleCharacteristic> {}

  async disconnect(): Promise<void> {
    this.connected = false;
    this.disconnects += 1;
  }
}

const packet = new BleAdvertisementPacket({
  id: "dji",
  serviceUuids: ["fff0"],
});

test("matches DJI advertisements without connecting", () => {
  const driver = createDjiOsmoNanoDriver();
  expect(driver.matches(packet)).toBe(true);
  expect(
    driver.matches(
      new BleAdvertisementPacket({ id: "other", serviceUuids: ["fea6"] }),
    ),
  ).toBe(false);
});

test("disconnects when DJI session initialization fails", async () => {
  const device = new Device();
  const driver = createDjiOsmoNanoDriver();
  await expect(driver.open(device, packet)).rejects.toThrow("characteristics");
  expect(device.disconnects).toBe(1);
});
