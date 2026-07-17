import type { BleAdvertisementPacket } from "../../ble/advertisement-packet";
import type { CameraDiscoverOptions } from "../../kit/types";
import type { BleHandler } from "../../types/ble/handler";
import type { DriverShape } from "./types";

export class BleDiscoveryLifetime {
  readonly controller = new AbortController();
  readonly iterator: AsyncGenerator<BleAdvertisementPacket>;

  private readonly timeout?: ReturnType<typeof setTimeout>;
  constructor(
    ble: BleHandler,
    drivers: readonly DriverShape[],
    private readonly options: CameraDiscoverOptions,
  ) {
    if (options.signal?.aborted) this.abortFromCaller();
    options.signal?.addEventListener("abort", this.abortFromCaller, {
      once: true,
    });
    this.timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.controller.abort();
          }, options.timeoutMs);
    this.iterator = ble.scan({
      allowDuplicates: options.allowDuplicates,
      serviceUuids: [
        ...new Set(drivers.flatMap((driver) => driver.serviceUuids)),
      ],
      signal: this.controller.signal,
    });
  }

  async close(): Promise<void> {
    if (this.timeout) clearTimeout(this.timeout);
    this.controller.abort();
    this.options.signal?.removeEventListener("abort", this.abortFromCaller);
    await this.iterator.return(undefined);
  }

  private readonly abortFromCaller = (): void => {
    this.controller.abort();
  };
}
