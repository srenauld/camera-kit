import type { BleAdvertisementPacket } from "../../ble/advertisement-packet";
import type { BleDevice } from "../../types/ble/device";
import type { BleHandler, ConnectionOptions } from "../../types/ble/handler";
import type { CameraHandle } from "../../types/camera";

export type BleCameraDiscoveryOptions<Drivers extends readonly DriverShape[]> =
  {
    ble: BleHandler;
    drivers: Drivers;
  };

export type CameraDriver<
  Kind extends string,
  Mode,
  Session extends CameraHandle<Kind, Mode>,
> = Readonly<{
  kind: Kind;
  matches(advertisement: BleAdvertisementPacket): boolean;
  model: string;
  open(
    device: BleDevice,
    advertisement: BleAdvertisementPacket,
  ): Promise<Session>;
  serviceUuids: readonly string[];
}>;

export type DiscoveredCamera<
  Kind extends string,
  Session extends CameraHandle<Kind, unknown>,
> = Readonly<{
  advertisement: BleAdvertisementPacket;
  connect(options?: ConnectionOptions): Promise<Session>;
  id: string;
  kind: Kind;
  model: string;
}>;

export type DiscoveryFor<Driver> =
  Driver extends CameraDriver<infer Kind, infer Mode, infer Session>
    ? Session extends CameraHandle<Kind, Mode>
      ? DiscoveredCamera<Kind, Session>
      : never
    : never;

export type DriverShape = CameraDriver<
  string,
  unknown,
  CameraHandle<string, unknown>
>;
