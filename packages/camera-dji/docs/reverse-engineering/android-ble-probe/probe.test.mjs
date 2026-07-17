import assert from "node:assert/strict";
import test from "node:test";
import { encodeDuml, parseDuml } from "../protocol.mjs";

const start = encodeDuml({
  sender: 0x02, receiver: 0x01, sequence: 0xd4ae, flags: 0x40,
  commandSet: 0x02, command: 0x02, payload: [0x01],
});

test("probe fixture is a complete checksum-valid DUML frame", () => {
  assert.equal(start.toString("hex"), "550e04660201aed4400202014f2f");
  assert.deepEqual(parseDuml(start), {
    sender: 0x02, receiver: 0x01, sequence: 0xd4ae, flags: 0x40,
    commandSet: 0x02, command: 0x02, payload: Buffer.from([0x01]),
  });
});

test("probe refuses a frame whose final checksum byte changes", () => {
  const corrupt = Buffer.from(start);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => parseDuml(corrupt), /CRC-16/);
});
