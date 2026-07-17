import type { CameraDiscoverOptions, CameraDiscoverySource } from "./types";

import { CameraKitClosedError } from "../errors";

export class CameraKit<Discovery> {
  private closed = false;

  constructor(private readonly source: CameraDiscoverySource<Discovery>) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.source.close();
  }

  discover(options?: CameraDiscoverOptions): AsyncGenerator<Discovery> {
    if (this.closed) throw new CameraKitClosedError("CameraKit is closed");
    return this.source.discover(options);
  }
}
