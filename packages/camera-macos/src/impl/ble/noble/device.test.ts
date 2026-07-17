import { EventEmitter } from "node:events";

import { NobleDevice } from "./device";

test("exposes a connected peripheral and disconnects idempotently", async () => {
  const peripheral = Object.assign(new EventEmitter(), {
    id: "camera",
    state: "connected",
    disconnectAsync: jest.fn(async () => {
      peripheral.state = "disconnected";
    }),
    discoverAllServicesAndCharacteristicsAsync: jest.fn(async () => ({
      characteristics: [],
    })),
  });
  const onClosed = jest.fn();
  const device = new NobleDevice(peripheral as any, onClosed);
  expect(device.id).toBe("camera");
  expect(device.connected).toBe(true);
  await device.characteristics().next();
  await device.disconnect();
  await device.disconnect();
  expect(peripheral.disconnectAsync).toHaveBeenCalledTimes(1);
  expect(onClosed).toHaveBeenCalledTimes(1);
});
