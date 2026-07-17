import { NobleCharacteristic } from "./characteristic";

function fakeCharacteristic() {
  const listeners = new Map<string, (...args: any[]) => void>();
  return {
    uuid: "fff5",
    on: jest.fn((event: string, listener: (...args: any[]) => void) =>
      listeners.set(event, listener),
    ),
    off: jest.fn((event: string) => listeners.delete(event)),
    subscribe: jest.fn((callback: (error?: Error) => void) => callback()),
    unsubscribe: jest.fn((callback: () => void) => callback()),
    write: jest.fn(
      (
        _data: Buffer,
        _withoutResponse: boolean,
        callback: (error?: Error) => void,
      ) => callback(),
    ),
    emitData: (data: number[]) =>
      listeners.get("data")?.(Buffer.from(data), true),
  };
}

test("subscribes, receives notifications, and unsubscribes cleanly", async () => {
  const native = fakeCharacteristic();
  const characteristic = new NobleCharacteristic(native as any);
  const iterator = characteristic.subscribe()[Symbol.asyncIterator]();
  const pending = iterator.next();
  native.emitData([1, 2]);
  await expect(pending).resolves.toEqual({
    done: false,
    value: new Uint8Array([1, 2]),
  });
  await iterator.return?.();
  expect(native.unsubscribe).toHaveBeenCalled();
  expect(native.off).toHaveBeenCalledWith("data", expect.any(Function));
});

test("writes without response and propagates native errors", async () => {
  const native = fakeCharacteristic();
  const characteristic = new NobleCharacteristic(native as any);
  await characteristic.write(new Uint8Array([3]));
  expect(native.write).toHaveBeenCalledWith(
    Buffer.from([3]),
    true,
    expect.any(Function),
  );

  native.write.mockImplementation(
    (
      _data: Buffer,
      _withoutResponse: boolean,
      callback: (error: Error) => void,
    ) => callback(new Error("write failed")),
  );
  await expect(characteristic.write(new Uint8Array([3]))).rejects.toThrow(
    "write failed",
  );
});
