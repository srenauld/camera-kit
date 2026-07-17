/**
 * The shared portion of a camera video mode. Drivers choose the concrete
 * values and may add their own required fields through structural typing.
 */
export type CameraCapabilities<TMode = VideoCapability> = Readonly<{
  modes: readonly TMode[];
}>;

export type VideoCapability<
  Resolution = string,
  AspectRatio = string,
  FrameRate = number,
> = Readonly<{
  aspectRatio: AspectRatio;
  frameRate: FrameRate;
  resolution: Resolution;
}>;

/** A monotonic clock used to align camera events with host-side sensors. */
export type MonotonicClock = {
  now(): number;
};

/** Timestamp sampled when the camera reports that recording is active. */
export type CameraHandle<
  Kind extends string = string,
  TMode = VideoCapability,
> = {
  close(): Promise<void>;
  getCapabilities(): CameraCapabilities<TMode>;

  readonly id: string;
  readonly kind: Kind;
  readonly model: string;
  record(): Promise<RecordingStart>;
  setup(mode: TMode): Promise<void>;
  readonly state: CameraSessionState;
  stop(): Promise<void>;
};

export type CameraSessionState =
  "closed" | "closing" | "connected" | "disconnected";

export type RecordingStart = Readonly<{
  recordingActiveAt: number;
}>;
