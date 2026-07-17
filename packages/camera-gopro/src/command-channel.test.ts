import {
  BleCommandChannel,
  withTimeout,
  type MessageCodec,
} from "./command-channel";

function characteristic(values: Uint8Array[]): {
  write: jest.Mock;
  subscribe: () => AsyncIterable<Uint8Array>;
} {
  return {
    write: jest.fn(async () => undefined),
    subscribe: () => ({
      async *[Symbol.asyncIterator]() {
        yield* values;
      },
    }),
  };
}

const codec: MessageCodec = {
  createCollector: () => {
    let data: Uint8Array = new Uint8Array();
    return {
      push(value) {
        data = value;
        return { done: true, message: data };
      },
    };
  },
  encode: (command) => [{ bytes: command }],
};

test("writes frames and resolves the collected response", async () => {
  const request = characteristic([]);
  const response = characteristic([new Uint8Array([0x90])]);
  const channel = new BleCommandChannel(request as any, response as any, codec);
  await channel.init();

  await expect(channel.write(new Uint8Array([1, 2]))).resolves.toEqual(
    new Uint8Array([0x90]),
  );
  expect(request.write).toHaveBeenCalledWith(new Uint8Array([1, 2]));
});

test("rejects closed response streams and prevents use before init", async () => {
  const request = characteristic([]);
  const closed = characteristic([]);
  const channel = new BleCommandChannel(request as any, closed as any, codec);
  await expect(channel.write(new Uint8Array([1]))).rejects.toThrow(
    "not initialized",
  );
  await channel.init();
  await expect(channel.write(new Uint8Array([1]))).rejects.toThrow(
    "stream closed",
  );
});

test("supports abort and timeout errors", async () => {
  const never = new Promise<void>(() => undefined);
  const controller = new AbortController();
  controller.abort();
  await expect(
    withTimeout(never, 100, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(withTimeout(never, 1)).rejects.toMatchObject({
    name: "TimeoutError",
  });
});
