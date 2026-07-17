import {
  DjiFrameRate,
  type DjiOsmoNanoCapabilities,
  type DjiOsmoNanoVideoMode,
  DjiSlowMotionFactor,
} from "./types";

const normal = (
  resolution: DjiOsmoNanoVideoMode["resolution"],
  aspectRatio: DjiOsmoNanoVideoMode["aspectRatio"],
  frameRates: readonly DjiOsmoNanoVideoMode["frameRate"][],
): readonly DjiOsmoNanoVideoMode[] =>
  frameRates.map((frameRate) => ({
    aspectRatio,
    family: "video",
    frameRate,
    resolution,
  }));

const normalFps = [
  DjiFrameRate.FPS24,
  DjiFrameRate.FPS25,
  DjiFrameRate.FPS30,
  DjiFrameRate.FPS48,
  DjiFrameRate.FPS50,
  DjiFrameRate.FPS60,
] as const;
const slowModes: readonly DjiOsmoNanoVideoMode[] = [
  {
    aspectRatio: "16:9",
    family: "slow-motion",
    frameRate: DjiFrameRate.FPS120,
    resolution: "4k",
    slowMotionFactor: DjiSlowMotionFactor.Four,
  },
  {
    aspectRatio: "16:9",
    family: "slow-motion",
    frameRate: DjiFrameRate.FPS120,
    resolution: "2.7k",
    slowMotionFactor: DjiSlowMotionFactor.Four,
  },
  {
    aspectRatio: "16:9",
    family: "slow-motion",
    frameRate: DjiFrameRate.FPS120,
    resolution: "1080p",
    slowMotionFactor: DjiSlowMotionFactor.Four,
  },
  {
    aspectRatio: "16:9",
    family: "slow-motion",
    frameRate: DjiFrameRate.FPS240,
    resolution: "1080p",
    slowMotionFactor: DjiSlowMotionFactor.Eight,
  },
];

export const DJI_OSMO_NANO_CAPABILITIES: DjiOsmoNanoCapabilities =
  Object.freeze({
    fovs: ["standard"],
    modes: Object.freeze([
      ...normal("4k", "4:3", [
        DjiFrameRate.FPS24,
        DjiFrameRate.FPS25,
        DjiFrameRate.FPS30,
        DjiFrameRate.FPS48,
        DjiFrameRate.FPS50,
      ]),
      ...normal("4k", "16:9", normalFps),
      ...normal("2.7k", "4:3", normalFps),
      ...normal("2.7k", "16:9", normalFps),
      ...normal("1080p", "4:3", normalFps),
      ...normal("1080p", "16:9", normalFps),
      ...slowModes,
    ]),
  });

export function isSupportedMode(mode: DjiOsmoNanoVideoMode): boolean {
  return DJI_OSMO_NANO_CAPABILITIES.modes.some(
    (candidate) =>
      candidate.family === mode.family &&
      candidate.resolution === mode.resolution &&
      candidate.aspectRatio === mode.aspectRatio &&
      candidate.frameRate === mode.frameRate &&
      candidate.slowMotionFactor === mode.slowMotionFactor,
  );
}
