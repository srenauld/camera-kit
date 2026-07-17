import type { BleAdvertisementPacket } from "../../ble/advertisement-packet";
import type { CameraDiscoverOptions } from "../../kit/types";
import type { ConnectionOptions } from "../../types/ble/handler";
import type { CameraHandle } from "../../types/camera";
import type {
  BleCameraDiscoveryOptions,
  DiscoveryFor,
  DriverShape,
} from "./types";

import { CameraKitClosedError } from "../../errors";
import { CameraSessionRegistry } from "../session-registry";
import { BleCameraDiscoveryResult } from "./discovered-camera";
import { BleDiscoveryLifetime } from "./discovery-lifetime";

export class BleCameraDiscovery<const Drivers extends readonly DriverShape[]> {
  private closed = false;
  private readonly discoveries = new Set<BleDiscoveryLifetime>();
  private readonly sessions = new CameraSessionRegistry();

  constructor(private readonly options: BleCameraDiscoveryOptions<Drivers>) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(
      [...this.discoveries].map((discovery) => discovery.close()),
    );
    this.discoveries.clear();
    await this.sessions.close();
    await this.options.ble.close();
  }

  async *discover(
    options: CameraDiscoverOptions = {},
  ): AsyncGenerator<DiscoveryFor<Drivers[number]>> {
    this.assertOpen();
    const lifetime = new BleDiscoveryLifetime(
      this.options.ble,
      this.options.drivers,
      options,
    );
    this.discoveries.add(lifetime);
    const seen = new Set<string>();
    try {
      for await (const advertisement of lifetime.iterator)
        yield* this.match(advertisement, options.allowDuplicates, seen);
    } finally {
      this.discoveries.delete(lifetime);
      await lifetime.close();
    }
  }

  private assertOpen(): void {
    if (this.closed)
      throw new CameraKitClosedError("Camera discovery is closed");
  }

  private async connect<Session extends CameraHandle<string, unknown>>(
    driver: DriverShape,
    advertisement: BleAdvertisementPacket,
    options?: ConnectionOptions,
  ): Promise<Session> {
    this.assertOpen();
    return this.sessions.connect(advertisement.id, async () => {
      const device = await this.options.ble.connect(advertisement, options);
      try {
        return (await driver.open(device, advertisement)) as Session;
      } catch (error) {
        await device.disconnect().catch(() => undefined);
        throw error;
      }
    });
  }

  private *match(
    advertisement: BleAdvertisementPacket,
    allowDuplicates: boolean | undefined,
    seen: Set<string>,
  ): Generator<DiscoveryFor<Drivers[number]>> {
    for (const driver of this.options.drivers) {
      if (!matchesServices(driver, advertisement)) continue;
      if (!driver.matches(advertisement)) continue;
      const key = `${driver.kind}:${advertisement.id}`;
      if (!allowDuplicates && seen.has(key)) continue;
      seen.add(key);
      yield new BleCameraDiscoveryResult(
        advertisement,
        driver.kind,
        driver.model,
        (options) => this.connect(driver, advertisement, options),
      ) as unknown as DiscoveryFor<Drivers[number]>;
    }
  }
}

function matchesServices(
  driver: DriverShape,
  advertisement: BleAdvertisementPacket,
): boolean {
  return (
    driver.serviceUuids.length === 0 ||
    driver.serviceUuids.some((uuid) => advertisement.hasServiceUuid(uuid))
  );
}
