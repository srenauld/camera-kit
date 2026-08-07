import { BleAdvertisementPacket, type BleDevice } from "@srenauld/camera-core";
import { GoproCommChannels, GoproHero11Handle } from "../handle";
import { Hero11Delegate } from "./hero-11";
import type { GoProHero11Mode } from "./types";

describe("Hero11Delegate", () => {
  it("maps each advertised mode directly to its settings command", async () => {
    const delegate = new Hero11Delegate();
    const write = jest
      .fn<Promise<Uint8Array>, [Uint8Array]>()
      .mockResolvedValue(new Uint8Array());
    const channels = { settings: { write } } as unknown as GoproCommChannels;

    for (const mode of delegate.capabilities.modes) {
      const command = delegate.applySettings(mode);
      expect(command.settings).toBe(mode);
      await command.execute(channels);
    }

    expect(write).toHaveBeenCalledTimes(delegate.capabilities.modes.length * 3);
    expect(delegate.capabilities.modes.length).toBeGreaterThan(0);
  });

  it("rejects a structurally valid but unadvertised mode before connecting", async () => {
    const disconnect = jest.fn<Promise<void>, []>().mockResolvedValue();
    const device = {
      connected: true,
      disconnect,
      id: "gopro",
      async *characteristics() {},
    } as BleDevice;
    const advertisement = new BleAdvertisementPacket({
      id: "gopro",
      manufacturer: Buffer.alloc(12),
      serviceUuids: ["fea6"],
    });
    const handle = new GoproHero11Handle(device, advertisement);
    const unsupported: GoProHero11Mode = {
      resolution: "4k",
      aspectRatio: "16:9",
      frameRate: 60,
      lens: "ultra-wide",
      levellingType: "smooth",
    };

    await expect(handle.setup(unsupported)).rejects.toThrow(
      "Unsupported GoPro Hero 11 capability",
    );
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("keeps setup paired with the handle-specific capability type", () => {
    const handle = null as unknown as GoproHero11Handle;
    if (false) {
      void handle.setup(handle.getCapabilities().modes[0]!);
      // @ts-expect-error Hero 11 setup requires its extended capability fields.
      void handle.setup({
        resolution: "4k",
        aspectRatio: "16:9",
        frameRate: 60,
      });
    }
    expect(true).toBe(true);
  });
});
