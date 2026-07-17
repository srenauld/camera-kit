import { GoProHero11PacketCollector } from "./collector";

describe("GoPro hero 11 collector", () => {
  describe("Short packets", () => {
    it("Parses a short header", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(new Uint8Array([0x02, 0x01, 0x00]));
      expect(result.done).toBe(true);
      expect((result as any).message).toEqual(new Uint8Array([0x01, 0x00]));
    });
    it("Returns an error on overrun", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(new Uint8Array([0x02, 0x01, 0x00, 0x03]));
      expect(result.done).toBe(true);
      expect((result as any).message).toBeUndefined;
      expect((result as any).error).toBeInstanceOf(Error);
    });
  });
  describe("Medium packets packets", () => {
    it("Parses a medium header", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(
        new Uint8Array([0b00100000, 0b00000010, 0x01, 0x00]),
      );
      expect(result.done).toBe(true);
      expect((result as any).message).toEqual(new Uint8Array([0x01, 0x00]));
    });
    it("Returns an error on overrun", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(
        new Uint8Array([0b00100000, 0b00000010, 0x01, 0x00, 0x03]),
      );
      expect(result.done).toBe(true);
      expect((result as any).message).toBeUndefined;
      expect((result as any).error).toBeInstanceOf(Error);
    });
  });
  describe("Long packets packets", () => {
    it("Parses a long header", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(new Uint8Array([0b01000000, 0, 2, 1, 0]));
      expect(result.done).toBe(true);
      expect((result as any).message).toEqual(new Uint8Array([0x01, 0x00]));
    });
    it("Returns an error on overrun", () => {
      const collector = new GoProHero11PacketCollector();
      const result = collector.push(
        new Uint8Array([0b01000000, 0, 2, 0x01, 0x00, 0x03]),
      );
      expect(result.done).toBe(true);
      expect((result as any).message).toBeUndefined;
      expect((result as any).error).toBeInstanceOf(Error);
    });
  });
});
