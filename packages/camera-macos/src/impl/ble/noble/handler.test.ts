import { EventEmitter } from "node:events";

const nobleEvents = new EventEmitter();
const noble = Object.assign(nobleEvents, {
  _state: "poweredOn",
  initialized: false,
  startScanning: jest.fn(
    (
      _uuids: string[],
      _duplicates: boolean,
      callback: (error?: Error) => void,
    ) => {
      callback();
      nobleEvents.emit("scanStart");
    },
  ),
  stopScanning: jest.fn(() => nobleEvents.emit("scanStop")),
  _bindings: { stop: jest.fn() },
});

jest.mock("@abandonware/noble", () => ({ __esModule: true, default: noble }));

import { NobleBleHandler } from "./handler";

function peripheral(id: string, serviceUuid: string) {
  const value = Object.assign(new EventEmitter(), {
    id,
    rssi: -40,
    state: "disconnected",
    advertisement: {
      localName: id,
      manufacturerData: Buffer.from([1]),
      serviceUuids: [serviceUuid],
    },
    connectAsync: jest.fn(async () => {
      value.state = "connected";
    }),
    disconnectAsync: jest.fn(async () => {
      value.state = "disconnected";
    }),
    discoverAllServicesAndCharacteristicsAsync: jest.fn(async () => ({
      characteristics: [],
    })),
  });
  return value;
}

test("multiplexes simultaneous protocol scans over one unfiltered native scan", async () => {
  const handler = new NobleBleHandler();
  const dji = handler.scan({ serviceUuids: ["fff0"] });
  const gopro = handler.scan({ serviceUuids: ["fea6"] });
  const djiNext = dji.next();
  const goproNext = gopro.next();
  noble.emit("discover", peripheral("dji", "FFF0"));
  noble.emit("discover", peripheral("gopro", "FEA6"));
  await expect(djiNext).resolves.toMatchObject({
    done: false,
    value: { id: "dji" },
  });
  await expect(goproNext).resolves.toMatchObject({
    done: false,
    value: { id: "gopro" },
  });
  expect(noble.startScanning).toHaveBeenCalledTimes(1);
  expect(noble.startScanning).toHaveBeenCalledWith(
    [],
    true,
    expect.any(Function),
  );
  await dji.return?.(undefined);
  expect(noble.stopScanning).not.toHaveBeenCalled();
  await gopro.return?.(undefined);
  expect(noble.stopScanning).toHaveBeenCalled();
  await handler.close();
  expect(noble.listenerCount("discover")).toBe(0);
});

test("connects only advertisements emitted by this handler", async () => {
  const handler = new NobleBleHandler();
  const iterator = handler.scan();
  const next = iterator.next();
  const native = peripheral("camera", "fff0");
  noble.emit("discover", native);
  const packet = (await next).value!;
  const first = handler.connect(packet);
  const second = handler.connect(packet);
  expect(await second).toBe(await first);
  expect(native.connectAsync).toHaveBeenCalledTimes(1);
  await iterator.return?.(undefined);
  await handler.close();
  expect(native.disconnectAsync).toHaveBeenCalled();
});

test("rejects unsupported adapter states", async () => {
  const handler = new NobleBleHandler();
  noble._state = "poweredOff";
  const iterator = handler.scan();
  const pending = iterator.next();
  noble.emit("stateChange", "poweredOff");
  await expect(pending).rejects.toThrow("poweredOff");
  await handler.close();
  noble._state = "poweredOn";
});
