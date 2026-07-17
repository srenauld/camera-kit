import type { GoProHero11Mode } from "./delegates/types";
import type {
  BleAdvertisementPacket,
  BleDevice,
  CameraDriver,
} from "@mandltv/camera-core";

import { GoproHero11Handle, type GoproHero11Options } from "./handle";

const GOPRO_SERVICE = "fea6";
const COMPANY_ID_LENGTH = 2;
const MANUFACTURER_ID = 0xf2;
const PRODUCT_ID = 0x02;
const HERO_11_MODEL_ID = 58;

export type GoproHero11Driver = CameraDriver<
  "gopro-hero11",
  GoProHero11Mode,
  GoproHero11Handle
>;

export function createGoproHero11Driver(
  options: GoproHero11Options = {},
): GoproHero11Driver {
  return {
    kind: "gopro-hero11",
    matches(advertisement): boolean {
      const manufacturer = advertisement.manufacturer;
      const company = manufacturer.subarray(0, COMPANY_ID_LENGTH);
      return (
        advertisement.hasServiceUuid(GOPRO_SERVICE) &&
        company.length === COMPANY_ID_LENGTH &&
        company[0] === MANUFACTURER_ID &&
        company[1] === PRODUCT_ID &&
        manufacturer[4] === HERO_11_MODEL_ID
      );
    },
    model: "GoPro HERO11",
    async open(
      device: BleDevice,
      advertisement: BleAdvertisementPacket,
    ): Promise<GoproHero11Handle> {
      const handle = new GoproHero11Handle(device, advertisement, options);
      try {
        await handle.initialize();
        return handle;
      } catch (error) {
        await handle.close();
        throw error;
      }
    },
    serviceUuids: [GOPRO_SERVICE],
  };
}
