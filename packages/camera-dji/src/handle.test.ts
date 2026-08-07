import { describe, expect, test } from "@jest/globals";
import {
  BleAdvertisementPacket,
  type BleCharacteristic,
  type BleDevice,
} from "@srenauld/camera-core";

import { DJI_OSMO_NANO_CAPABILITIES } from "./capabilities";
import { DjiOsmoNanoHandle, type DjiOsmoNanoOptions } from "./handle";
import { encodeDuml, parseDuml, type DumlPacket } from "./protocol/duml";

class AsyncValues implements AsyncIterable<Uint8Array> {
  private values: Uint8Array[] = [];
  private waiter?: (result: IteratorResult<Uint8Array>) => void;

  push(value: Uint8Array): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { value, done: false };
        return new Promise<IteratorResult<Uint8Array>>((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

class FakeNotifyCharacteristic implements BleCharacteristic {
  readonly uuid = "fff4";
  readonly values = new AsyncValues();

  write(): Promise<void> {
    return Promise.reject(new Error("FFF4 is notify-only"));
  }
  subscribe(): AsyncIterable<Uint8Array> {
    return this.values;
  }

  emit(packet: DumlPacket, splitAt?: number): void {
    const bytes = encodeDuml(packet);
    if (splitAt === undefined) this.values.push(bytes);
    else {
      this.values.push(bytes.slice(0, splitAt));
      this.values.push(bytes.slice(splitAt));
    }
  }
}

class FakeWriteCharacteristic implements BleCharacteristic {
  readonly uuid = "fff5";
  readonly writes: DumlPacket[] = [];
  onWrite?: (packet: DumlPacket) => void;

  async write(bytes: Uint8Array): Promise<void> {
    const packet = parseDuml(bytes);
    this.writes.push(packet);
    this.onWrite?.(packet);
  }
  subscribe(): AsyncIterable<Uint8Array> {
    throw new Error("FFF5 is write-only");
  }
}

class FakeDevice implements BleDevice {
  connected = true;
  readonly id = "dji-test";
  readonly notify = new FakeNotifyCharacteristic();
  readonly write = new FakeWriteCharacteristic();

  async *characteristics(): AsyncGenerator<BleCharacteristic, void, void> {
    yield this.notify;
    yield this.write;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

const advertisement = new BleAdvertisementPacket({
  id: "dji-test",
  manufacturer: new Uint8Array([0xaa, 0xbb]),
  serviceUuids: ["fff0"],
});

async function openHandle(
  device: FakeDevice,
  options: DjiOsmoNanoOptions,
): Promise<DjiOsmoNanoHandle> {
  const handle = new DjiOsmoNanoHandle(device, advertisement, options);
  await handle.initialize();
  return handle;
}

function response(
  request: DumlPacket,
  payload = new Uint8Array([0]),
): DumlPacket {
  return {
    sender: 1,
    receiver: 2,
    sequence: request.sequence,
    flags: 0xc0,
    commandSet: request.commandSet,
    command: request.command,
    payload,
  };
}

function status(phase: number): DumlPacket {
  return {
    sender: 1,
    receiver: 2,
    sequence: 0,
    flags: 0xc0,
    commandSet: 2,
    command: 0x80,
    payload: new Uint8Array([1, 2, 0x80, phase]),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("Condition was not reached");
}

describe("DjiOsmoNanoHandle", () => {
  test("encodes every advertised mode exactly and rejects modes outside the matrix", async () => {
    const device = new FakeDevice();
    device.write.onWrite = (packet) => device.notify.emit(response(packet));
    const handle = await openHandle(device, {
      clock: { now: () => 0 },
      delay: async () => undefined,
    });

    for (const mode of DJI_OSMO_NANO_CAPABILITIES.modes)
      await handle.setup(mode);
    const formatWrites = device.write.writes.filter(
      (packet) => packet.commandSet === 2 && packet.command === 0x18,
    );
    expect(formatWrites).toHaveLength(39);
    const resolutionByte = {
      "1080p:16:9": 0x0a,
      "1080p:4:3": 0x0c,
      "2.7k:16:9": 0x2d,
      "2.7k:4:3": 0x5f,
      "4k:16:9": 0x10,
      "4k:4:3": 0x67,
    } as const;
    const fpsByte = {
      24: 1,
      25: 2,
      30: 3,
      48: 4,
      50: 5,
      60: 6,
      120: 7,
      240: 8,
    } as const;
    for (const [mode, write] of DJI_OSMO_NANO_CAPABILITIES.modes.map(
      (mode, index) => [mode, formatWrites[index]!] as const,
    )) {
      const key =
        `${mode.resolution}:${mode.aspectRatio}` as keyof typeof resolutionByte;
      expect(write.payload).toEqual(
        new Uint8Array([
          resolutionByte[key],
          fpsByte[mode.frameRate],
          0,
          mode.family === "slow-motion" ? (mode.slowMotionFactor ?? 0) : 0,
          0,
        ]),
      );
    }
    expect(
      formatWrites.find(
        (packet) =>
          Buffer.from(packet.payload).toString("hex") === "1006000000",
      ),
    ).toBeDefined();
    expect(
      formatWrites.find(
        (packet) =>
          Buffer.from(packet.payload).toString("hex") === "0a08000800",
      ),
    ).toBeDefined();

    await expect(
      handle.setup({
        family: "video",
        resolution: "4k",
        aspectRatio: "4:3",
        frameRate: 60,
      }),
    ).rejects.toThrow("Unsupported");
  });

  test("writes explicitly requested stabilization and colour values", async () => {
    const device = new FakeDevice();
    device.write.onWrite = (packet) => device.notify.emit(response(packet));
    const handle = await openHandle(device, {
      clock: { now: () => 0 },
      delay: async () => undefined,
    });
    await handle.setup({
      family: "video",
      resolution: "4k",
      aspectRatio: "16:9",
      frameRate: 60,
      stabilization: "off",
      colorProfile: "normal-10bit",
    });
    expect(
      device.write.writes.find((packet) => packet.command === 0x8e)?.payload,
    ).toEqual(new Uint8Array([1, 1, 8, 0, 1, 0]));
    expect(
      device.write.writes.find((packet) => packet.command === 0x42)?.payload,
    ).toEqual(new Uint8Array([0x3f]));
  });

  test("record resolves only at the fragmented 81 active notification", async () => {
    const device = new FakeDevice();
    let now = 100;
    const handle = await openHandle(device, {
      clock: { now: () => now },
      delay: async () => undefined,
    });
    device.write.onWrite = (packet) => {
      device.notify.emit(response(packet), 7);
    };

    const recording = handle.record();
    await waitUntil(() => device.write.writes.length === 1);
    let resolved = false;
    void recording.then(() => {
      resolved = true;
    });
    device.notify.emit(status(0x41));
    await flush();
    expect(resolved).toBe(false);

    now = 1_419;
    device.notify.emit(status(0x81), 5);
    await expect(recording).resolves.toEqual({ recordingActiveAt: 1_419 });
  });

  test("record resolves at the active notification when the command acknowledgement is absent", async () => {
    const device = new FakeDevice();
    let now = 321;
    const handle = await openHandle(device, {
      clock: { now: () => now },
      commandTimeoutMs: 20,
      delay: async () => undefined,
    });
    device.write.onWrite = () => undefined;

    const recording = handle.record();
    await waitUntil(() => device.write.writes.length === 1);
    device.notify.emit(status(0x81));

    await expect(recording).resolves.toEqual({ recordingActiveAt: 321 });
    now = 322;
  });

  test("recognises the phase in the leading fragment of a long status notification", async () => {
    const device = new FakeDevice();
    const handle = await openHandle(device, {
      clock: { now: () => 654 },
      commandTimeoutMs: 20,
      delay: async () => undefined,
    });
    device.write.onWrite = () => undefined;

    const recording = handle.record();
    await waitUntil(() => device.write.writes.length === 1);
    device.notify.emit(status(0x81), 15);

    await expect(recording).resolves.toEqual({ recordingActiveAt: 654 });
  });

  test("stop resolves at c1, not the later idle notification", async () => {
    const device = new FakeDevice();
    let now = 0;
    const handle = await openHandle(device, {
      clock: { now: () => now },
      delay: async () => undefined,
    });
    device.write.onWrite = (packet) => device.notify.emit(response(packet));
    const stopping = handle.stop();
    await waitUntil(() => device.write.writes.length === 1);
    now = 244;
    device.notify.emit(status(0xc1));
    await expect(stopping).resolves.toBeUndefined();
    device.notify.emit(status(0x01));
  });

  test("recognises a recording status envelope after a notification prefix", async () => {
    const device = new FakeDevice();
    const handle = await openHandle(device, {
      clock: { now: () => 0 },
      delay: async () => undefined,
    });
    device.write.onWrite = (packet) => device.notify.emit(response(packet));
    const recording = handle.record();
    await waitUntil(() => device.write.writes.length === 1);
    device.notify.emit({
      sender: 1,
      receiver: 2,
      sequence: 0,
      flags: 0xc0,
      commandSet: 2,
      command: 0x80,
      payload: new Uint8Array([0xaa, 0x01, 0x02, 0x80, 0x81]),
    });
    await expect(recording).resolves.toEqual({ recordingActiveAt: 0 });
  });

  test("recognises the direct phase byte used by macOS FFF4 notifications", async () => {
    const device = new FakeDevice();
    const handle = await openHandle(device, {
      clock: { now: () => 0 },
      delay: async () => undefined,
    });
    device.write.onWrite = (packet) => device.notify.emit(response(packet));
    const recording = handle.record();
    await waitUntil(() => device.write.writes.length === 1);
    device.notify.emit({
      sender: 1,
      receiver: 2,
      sequence: 0,
      flags: 0xc0,
      commandSet: 2,
      command: 0x80,
      payload: new Uint8Array([0x81, 0x02, 0x80, 0x01]),
    });
    await expect(recording).resolves.toEqual({ recordingActiveAt: 0 });
  });
});
