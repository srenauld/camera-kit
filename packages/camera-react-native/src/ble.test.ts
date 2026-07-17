import { expect, test } from "@jest/globals";

import {
  ReactNativeBleCharacteristic,
  ReactNativeBleDevice,
  ReactNativeBleHandler,
} from "./ble";

test("handler emits advertisement packets and locally filters/deduplicates", async () => {
  let listener: ((error: Error | null, device: any | null) => void) | undefined;
  let starts = 0;
  let stops = 0;
  const manager = {
    state: async () => "PoweredOn",
    startDeviceScan: async (
      _uuids: unknown,
      _options: unknown,
      callback: typeof listener,
    ) => {
      starts += 1;
      listener = callback;
    },
    stopDeviceScan: async () => {
      stops += 1;
    },
  };
  const handler = new ReactNativeBleHandler(manager as any);
  const iterator = handler.scan({ serviceUuids: ["fff0"] });
  const first = iterator.next();
  while (!listener) await new Promise<void>((resolve) => setImmediate(resolve));
  listener!(null, {
    id: "other",
    serviceUUIDs: ["fea6"],
    manufacturerData: null,
  });
  listener!(null, {
    id: "dji",
    serviceUUIDs: ["FFF0"],
    manufacturerData: "AQI=",
  });
  const result = await first;
  expect(result.done).toBe(false);
  expect(result.value!.id).toBe("dji");
  expect(result.value!.manufacturer).toEqual(new Uint8Array([1, 2]));
  listener!(null, {
    id: "dji",
    serviceUUIDs: ["fff0"],
    manufacturerData: "AQI=",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await iterator.return?.(undefined);
  expect(starts).toBe(1);
  expect(stops).toBe(1);
  await handler.close();
});

test("handler connects an emitted packet once and does not destroy the manager", async () => {
  let listener: ((error: Error | null, device: any | null) => void) | undefined;
  const disconnectedListeners: Array<() => void> = [];
  const native: any = {
    id: "dji",
    localName: "Osmo",
    manufacturerData: "AQI=",
    serviceUUIDs: ["fff0"],
    connect: jest.fn(async () => native),
    discoverAllServicesAndCharacteristics: jest.fn(async () => native),
    onDisconnected: jest.fn((callback: () => void) => {
      disconnectedListeners.push(callback);
      return { remove: jest.fn() };
    }),
    cancelConnection: jest.fn(async () => undefined),
    services: jest.fn(async () => []),
  };
  const manager = {
    state: async () => "PoweredOn",
    startDeviceScan: async (
      _uuids: unknown,
      _options: unknown,
      callback: typeof listener,
    ) => {
      listener = callback;
    },
    stopDeviceScan: jest.fn(async () => undefined),
    destroy: jest.fn(),
  };
  const handler = new ReactNativeBleHandler(manager as any);
  const iterator = handler.scan();
  const next = iterator.next();
  while (!listener) await new Promise<void>((resolve) => setImmediate(resolve));
  listener(null, native);
  const packet = (await next).value!;
  const first = handler.connect(packet);
  const second = handler.connect(packet);
  expect(await second).toBe(await first);
  expect(native.connect).toHaveBeenCalledTimes(1);
  await iterator.return?.(undefined);
  await handler.close();
  expect(native.cancelConnection).toHaveBeenCalled();
  expect(manager.destroy).not.toHaveBeenCalled();
});

test("uses write without response when the characteristic supports it", async () => {
  let withoutResponse: string | undefined;
  const characteristic = new ReactNativeBleCharacteristic({
    uuid: "fff5",
    isWritableWithoutResponse: true,
    isWritableWithResponse: false,
    writeWithoutResponse: async (value: string) => {
      withoutResponse = value;
      return {} as any;
    },
    writeWithResponse: async () => {
      throw new Error("unexpected response write");
    },
  } as any);

  await characteristic.write(new Uint8Array([0x55, 0xaa]));
  expect(withoutResponse).toBe("Vao=");
});

test("falls back to write with response and rejects unwritable characteristics", async () => {
  let written: string | undefined;
  const characteristic = new ReactNativeBleCharacteristic({
    uuid: "fff5",
    isWritableWithoutResponse: false,
    isWritableWithResponse: true,
    writeWithoutResponse: async () => {
      throw new Error("unexpected write");
    },
    writeWithResponse: async (value: string) => {
      written = value;
      return {} as any;
    },
  } as any);
  await characteristic.write(new Uint8Array([1]));
  expect(written).toBe("AQ==");

  const unwritable = new ReactNativeBleCharacteristic({ uuid: "fff5" } as any);
  await expect(unwritable.write(new Uint8Array([1]))).rejects.toThrow(
    "does not support writes",
  );
});

test("characteristic subscriptions deliver notifications and remove monitors", async () => {
  let callback:
    | ((error: Error | null, changed: { value: string } | null) => void)
    | undefined;
  const remove = jest.fn();
  const characteristic = new ReactNativeBleCharacteristic({
    uuid: "fff5",
    monitor: jest.fn((listener) => {
      callback = listener;
      return { remove };
    }),
  } as any);
  const iterator = characteristic.subscribe()[Symbol.asyncIterator]();
  const pending = iterator.next();
  callback!(null, { value: "AgM=" });
  await expect(pending).resolves.toEqual({
    done: false,
    value: new Uint8Array([2, 3]),
  });
  await iterator.return?.();
  expect(remove).toHaveBeenCalled();
});

test("connected device discovers characteristics and handles disconnects", async () => {
  const disconnected = jest.fn();
  const native = {
    id: "dji",
    manufacturerData: "AQI=",
    serviceUUIDs: ["fff0"],
    onDisconnected: jest.fn((listener) => {
      disconnected.mockImplementation(listener);
      return { remove: jest.fn() };
    }),
    services: jest.fn(async () => [{ uuid: "fff0" }]),
    characteristicsForService: jest.fn(async () => [{ uuid: "fff5" }]),
    cancelConnection: jest.fn(async () => undefined),
  };
  const device = new ReactNativeBleDevice(native as any);
  expect(device.id).toBe("dji");
  expect(device.connected).toBe(true);
  const found = [];
  for await (const characteristic of device.characteristics())
    found.push(characteristic.uuid);
  expect(found).toEqual(["fff5"]);
  disconnected();
  expect(device.connected).toBe(false);
  await device.disconnect();
  await expect(async () => {
    for await (const _characteristic of device.characteristics()) return;
  }).rejects.toThrow("not connected");
});
