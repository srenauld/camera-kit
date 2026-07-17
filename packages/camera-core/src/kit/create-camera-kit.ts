import type { CameraDiscoverySource } from "./types";

import { CameraKit } from "./camera-kit";

export function createCameraKit<Discovery>(
  source: CameraDiscoverySource<Discovery>,
): CameraKit<Discovery> {
  return new CameraKit(source);
}
