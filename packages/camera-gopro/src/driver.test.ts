import {
  BleAdvertisementPacket,
  type BleCharacteristic,
  type BleDevice,
} from "@mandltv/camera-core";

import { createGoproHero11Driver } from "./driver";

class Device implements BleDevice {
  connected = true;
  disconnects = 0;
  readonly id = "gopro";

  async *characteristics(): AsyncGenerator<BleCharacteristic> {}

  async disconnect(): Promise<void> {
    this.connected = false;
    this.disconnects += 1;
  }
}

function packet(manufacturer: number[]): BleAdvertisementPacket {
  return new BleAdvertisementPacket({
    id: "gopro",
    manufacturer: new Uint8Array(manufacturer),
    serviceUuids: ["fea6"],
  });
}

test("matches only the HERO11 manufacturer advertisement", () => {
  const driver = createGoproHero11Driver();
  expect(driver.matches(packet([0xf2, 0x02, 0, 0, 58]))).toBe(true);
  expect(driver.matches(packet([0xf2, 0x02, 0, 0, 57]))).toBe(false);
  expect(driver.matches(packet([0xf2]))).toBe(false);
  expect(driver.matches(packet([0x01, 0x02, 0, 0, 58]))).toBe(false);
});

test("disconnects when GoPro session initialization fails", async () => {
  const device = new Device();
  const driver = createGoproHero11Driver();
  await expect(
    driver.open(device, packet([0xf2, 0x02, 0, 0, 58])),
  ).rejects.toThrow("characteristic");
  expect(device.disconnects).toBe(1);
});
