import type { Command } from "../commands/command";
import type { CameraCapabilities, VideoCapability } from "@srenauld/camera-core";

export enum GoProFrameRate {
  FPS24 = 24,
  FPS25 = 25,
  FPS30 = 30,
  FPS50 = 50,
  FPS60 = 60,
  FPS100 = 100,
  FPS110 = 110,
  FPS120 = 120,
  FPS200 = 200,
  FPS240 = 240,
}
export type CameraDelegate = {
  applySettings(mode: GoProHero11Mode): Command<boolean>;
  readonly capabilities: GoProHero11Capabilities;
  getCurrentSettings(): GoProHero11Mode;
};
export type GoProAspectRatio = "1:1" | "16:9" | "4:3" | "8:7" | "9:16";
export type GoProHero11Capabilities = CameraCapabilities<GoProHero11Mode>;
export type GoProHero11Mode = Readonly<{
  lens: GoProLens;
  levellingType: GoProLevellingType;
}> &
  VideoCapability<GoProResolution, GoProAspectRatio, GoProFrameRate>;

export type GoProLens = "telephoto" | "ultra-wide" | "wide";

export type GoProLevellingType = "lock" | "none" | "smooth";

export type GoProResolution = "1080" | "2.7k" | "4k" | "5.3k";
