import { expect, test } from "@jest/globals";

import {
  BleAdvertisementPacket,
  CameraAlreadyConnectedError,
  CameraKit,
  CameraKitClosedError,
  canonicalBleUuid,
  createBleCameraDiscovery,
  createCameraKit,
  type BleDevice,
  type BleHandler,
  type BleScanOptions,
  type CameraDriver,
  type CameraHandle,
  type ConnectionOptions,
} from "./index";

type TestMode = Readonly<{
  aspectRatio: "16:9";
  frameRate: 30;
  resolution: "4k";
}>;

type TestSession = CameraHandle<"test-camera", TestMode>;

const advertisement = (id = "camera-1") =>
  new BleAdvertisementPacket({
    id,
    manufacturer: new Uint8Array([1, 2]),
    serviceUuids: ["0000FFF0-0000-1000-8000-00805F9B34FB"],
  });

class FakeDevice implements BleDevice {
  connected = true;
  disconnects = 0;

  constructor(readonly id: string) {}

  async *characteristics() {}

  async disconnect(): Promise<void> {
    this.connected = false;
    this.disconnects += 1;
  }
}

class FakeHandler implements BleHandler {
  closed = false;
  connects = 0;
  readonly devices: FakeDevice[] = [];

  constructor(
    private readonly advertisements: readonly BleAdvertisementPacket[],
  ) {}

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.devices.map((device) => device.disconnect()));
  }

  async connect(
    packet: BleAdvertisementPacket,
    _options?: ConnectionOptions,
  ): Promise<BleDevice> {
    this.connects += 1;
    const device = new FakeDevice(packet.id);
    this.devices.push(device);
    return device;
  }

  async *scan(
    options?: BleScanOptions,
  ): AsyncGenerator<BleAdvertisementPacket> {
    for (const packet of this.advertisements) yield packet;
    if (this.advertisements.length === 0 && options?.signal?.aborted) return;
    if (this.advertisements.length === 0 && options?.signal)
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
  }
}

function session(device: BleDevice): TestSession {
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      await device.disconnect();
    },
    getCapabilities: () => ({
      modes: [{ aspectRatio: "16:9", frameRate: 30, resolution: "4k" }],
    }),
    id: device.id,
    kind: "test-camera",
    model: "Test Camera",
    record: async () => ({ recordingActiveAt: 1 }),
    setup: async () => undefined,
    get state() {
      if (closed) return "closed";
      return device.connected ? "connected" : "disconnected";
    },
    stop: async () => undefined,
  };
}

const driver: CameraDriver<"test-camera", TestMode, TestSession> = {
  kind: "test-camera",
  matches: (packet) => packet.manufacturer[0] === 1,
  model: "Test Camera",
  open: async (device) => session(device),
  serviceUuids: ["fff0"],
};

test("canonicalizes only Bluetooth-base UUID aliases", () => {
  expect(canonicalBleUuid("0000FFF0-0000-1000-8000-00805F9B34FB")).toBe("fff0");
  expect(canonicalBleUuid("b5f90072-aa8d-11e3-9046-0002a5d5c51b")).toBe(
    "b5f90072aa8d11e390460002a5d5c51b",
  );
  expect(advertisement().hasServiceUuid("fff0")).toBe(true);
});

test("CameraKit is a real orchestrator over an independent discovery source", async () => {
  const source = {
    close: jest.fn(async () => undefined),
    async *discover() {
      yield "camera";
    },
  };
  const kit = new CameraKit(source);
  await expect(kit.discover().next()).resolves.toEqual({
    done: false,
    value: "camera",
  });
  await kit.close();
  expect(source.close).toHaveBeenCalled();
  expect(() => kit.discover()).toThrow(CameraKitClosedError);
});

test("matches advertisements without connecting and preserves the driver type", async () => {
  const handler = new FakeHandler([advertisement()]);
  const kit = createCameraKit(
    createBleCameraDiscovery({ ble: handler, drivers: [driver] as const }),
  );
  const found = await kit.discover().next();
  expect(found.value?.kind).toBe("test-camera");
  expect(handler.connects).toBe(0);
  if (found.value?.kind === "test-camera") {
    const camera = await found.value.connect();
    await camera.setup(camera.getCapabilities().modes[0]!);
  }
  await kit.close();
});

test("deduplicates connection attempts and permits reconnect after close", async () => {
  const handler = new FakeHandler([advertisement()]);
  const kit = createCameraKit(
    createBleCameraDiscovery({ ble: handler, drivers: [driver] as const }),
  );
  const discovered = (await kit.discover().next()).value!;
  const first = discovered.connect();
  const second = discovered.connect();
  expect(await second).toBe(await first);
  expect(handler.connects).toBe(1);
  await expect(discovered.connect()).rejects.toBeInstanceOf(
    CameraAlreadyConnectedError,
  );
  await (await first).close();
  const replacement = await discovered.connect();
  expect(handler.connects).toBe(2);
  await replacement.close();
  await kit.close();
});

test("times out an idle discovery and closes all owned resources", async () => {
  const handler = new FakeHandler([]);
  const kit = createCameraKit(
    createBleCameraDiscovery({ ble: handler, drivers: [driver] as const }),
  );
  await expect(kit.discover({ timeoutMs: 1 }).next()).resolves.toEqual({
    done: true,
    value: undefined,
  });
  await kit.close();
  expect(handler.closed).toBe(true);
});
