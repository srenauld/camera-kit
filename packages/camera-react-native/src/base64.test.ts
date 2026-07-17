import { expect, test } from "@jest/globals";

import { base64ToBytes, bytesToBase64 } from "./base64";

test("base64 conversion preserves arbitrary BLE bytes without Buffer", () => {
  const input = new Uint8Array([0, 1, 2, 252, 253, 254, 255]);
  expect(bytesToBase64(input)).toBe("AAEC/P3+/w==");
  expect([...base64ToBytes("AAEC/P3+/w==")]).toEqual([...input]);
});

test("empty advertisement data becomes an empty byte array", () => {
  expect([...base64ToBytes(null)]).toEqual([]);
});
