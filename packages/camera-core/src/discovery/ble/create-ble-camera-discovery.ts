import type { BleCameraDiscoveryOptions, DriverShape } from "./types";

import { BleCameraDiscovery } from "./ble-camera-discovery";

export function createBleCameraDiscovery<
  const Drivers extends readonly DriverShape[],
>(options: BleCameraDiscoveryOptions<Drivers>): BleCameraDiscovery<Drivers> {
  return new BleCameraDiscovery(options);
}
