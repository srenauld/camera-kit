import type { DjiOsmoNanoSettings } from "./types";
import type {
  BleAdvertisementPacket,
  BleDevice,
  CameraDriver,
} from "@srenauld/camera-core";

import { DjiOsmoNanoHandle, type DjiOsmoNanoOptions } from "./handle";

const DJI_SERVICE = "fff0";

export type DjiOsmoNanoDriver = CameraDriver<
  "dji-osmo-nano",
  DjiOsmoNanoSettings,
  DjiOsmoNanoHandle
>;

export function createDjiOsmoNanoDriver(
  options: DjiOsmoNanoOptions = {},
): DjiOsmoNanoDriver {
  return {
    kind: "dji-osmo-nano",
    matches: (advertisement) => advertisement.hasServiceUuid(DJI_SERVICE),
    model: "DJI Osmo Nano",
    async open(
      device: BleDevice,
      advertisement: BleAdvertisementPacket,
    ): Promise<DjiOsmoNanoHandle> {
      const handle = new DjiOsmoNanoHandle(device, advertisement, options);
      try {
        await handle.initialize();
        return handle;
      } catch (error) {
        await handle.close();
        throw error;
      }
    },
    serviceUuids: [DJI_SERVICE],
  };
}
