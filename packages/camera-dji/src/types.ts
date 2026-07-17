import type { CameraCapabilities, VideoCapability } from "@mandltv/camera-core";

export enum DjiFrameRate {
  FPS24 = 24,
  FPS25 = 25,
  FPS30 = 30,
  FPS48 = 48,
  FPS50 = 50,
  FPS60 = 60,
  FPS120 = 120,
  FPS240 = 240,
}
export enum DjiSlowMotionFactor {
  Four = 4,
  Eight = 8,
}
export type DjiAspectRatio = "16:9" | "4:3";
export type DjiColorProfile = "d-log-m-10bit" | "normal-10bit" | "normal-8bit";
export type DjiOsmoNanoVideoMode = Readonly<{
  family: DjiRecordingFamily;
  slowMotionFactor?: DjiSlowMotionFactor;
}> &
  VideoCapability<DjiResolution, DjiAspectRatio, DjiFrameRate>;
export type DjiRecordingFamily = "slow-motion" | "video";
export type DjiResolution = "1080p" | "2.7k" | "4k";

export type DjiStabilization =
  "horizon-balancing" | "horizon-correction" | "off" | "rock-steady";

/**
 * A requested configuration. The video fields must exactly match a capability row;
 * stabilization and colour are sent only when explicitly present.
 */
export type DjiOsmoNanoCapabilities = CameraCapabilities<DjiOsmoNanoVideoMode> &
  Readonly<{
    fovs: readonly ["standard"];
  }>;

export type DjiOsmoNanoSettings = DjiOsmoNanoVideoMode &
  Readonly<{
    colorProfile?: DjiColorProfile;
    stabilization?: DjiStabilization;
  }>;

export type DjiRecordingPhase = "idle" | "recording" | "starting" | "stopping";
