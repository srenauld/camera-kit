import { GoProMessageCodec } from "./codec";

describe("GoPro TLV codec", () => {
  it("Properly encodes a simple message", () => {
    const codec = new GoProMessageCodec();
    const result = codec.encode(new Uint8Array([0x01, 0x00]));
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      bytes: new Uint8Array([0b00100000, 0b00000010, 0x01, 0x00]),
    });
  });
  it("Takes into account the 20 byte chunk limit", () => {
    const codec = new GoProMessageCodec();
    const data = [0x01, 0x00].concat(new Array(20).fill(0x03));
    const result = codec.encode(new Uint8Array(data));
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({
      bytes: new Uint8Array(
        [0b00100000, 22, 0x01, 0x00].concat(new Array(16).fill(0x03)),
      ),
    });
    expect(result[1]).toEqual({
      bytes: new Uint8Array([0b10000000].concat(new Array(4).fill(0x03))),
    });
  });
});
