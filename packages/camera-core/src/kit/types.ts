export type CameraDiscoverOptions = Readonly<{
  allowDuplicates?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type CameraDiscoverySource<Discovery> = {
  close(): Promise<void>;
  discover(options?: CameraDiscoverOptions): AsyncGenerator<Discovery>;
};

export type DiscoverOptions = CameraDiscoverOptions;
