import type { BleAdvertisementPacket } from "../../ble/advertisement-packet";
import type { ConnectionOptions } from "../../types/ble/handler";
import type { CameraHandle } from "../../types/camera";
import type { DiscoveredCamera } from "./types";

export class BleCameraDiscoveryResult<
  Kind extends string,
  Session extends CameraHandle<Kind, unknown>,
> implements DiscoveredCamera<Kind, Session> {
  get id(): string {
    return this.advertisement.id;
  }

  constructor(
    readonly advertisement: BleAdvertisementPacket,
    readonly kind: Kind,
    readonly model: string,
    private readonly open: (options?: ConnectionOptions) => Promise<Session>,
  ) {}

  connect(options?: ConnectionOptions): Promise<Session> {
    return this.open(options);
  }
}
