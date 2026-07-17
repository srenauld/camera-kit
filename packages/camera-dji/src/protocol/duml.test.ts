import { describe, expect, test } from "@jest/globals";

import { crc16, DumlFragmentCollector, encodeDuml, parseDuml } from "./duml";

const packet = () =>
  encodeDuml({
    sender: 0x01,
    receiver: 0x02,
    sequence: 0xb302,
    flags: 0xc0,
    commandSet: 0x02,
    command: 0x02,
    payload: new Uint8Array([0]),
  });

describe("DUML", () => {
  test("encodes the verified start-record frame", () => {
    const encoded = encodeDuml({
      sender: 0x02,
      receiver: 0x01,
      sequence: 0xd4ae,
      flags: 0x40,
      commandSet: 0x02,
      command: 0x02,
      payload: new Uint8Array([1]),
    });
    expect(Buffer.from(encoded).toString("hex")).toBe(
      "550e04660201aed4400202014f2f",
    );
    expect(parseDuml(encoded)).toMatchObject({
      sequence: 0xd4ae,
      commandSet: 2,
      command: 2,
    });
  });

  test("rejects a damaged packet checksum", () => {
    const damaged = packet();
    damaged[damaged.length - 1] ^= 1;
    expect(() => parseDuml(damaged)).toThrow("CRC-16");
    expect(crc16(packet().subarray(0, packet().length - 2))).toBeGreaterThan(0);
  });

  test("reassembles split ATT values, concatenated packets, and discards noise", () => {
    const first = packet();
    const second = encodeDuml({
      sender: 1,
      receiver: 2,
      sequence: 2,
      flags: 0xc0,
      commandSet: 2,
      command: 0xe1,
      payload: new Uint8Array([0]),
    });
    const collector = new DumlFragmentCollector();
    expect(
      collector.push(new Uint8Array([0x99, ...first.slice(0, 5)])),
    ).toEqual([]);
    const recovered = collector.push(
      new Uint8Array([...first.slice(5), ...second]),
    );
    expect(recovered.map((value) => value.sequence)).toEqual([0xb302, 2]);
  });

  test("resynchronises after a corrupt candidate without skipping a later frame", () => {
    const damaged = packet();
    damaged[damaged.length - 1] ^= 1;
    const valid = encodeDuml({
      sender: 1,
      receiver: 2,
      sequence: 3,
      flags: 0xc0,
      commandSet: 2,
      command: 0x80,
      payload: new Uint8Array([1, 2, 0x80, 0x81]),
    });
    const recovered = new DumlFragmentCollector().push(
      new Uint8Array([...damaged, ...valid]),
    );
    expect(recovered.map((value) => value.sequence)).toEqual([3]);
  });
});
