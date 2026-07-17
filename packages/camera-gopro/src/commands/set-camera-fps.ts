import type { GoProFrameRate } from "../delegates/types";

import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const fps_bytes: Partial<Record<GoProFrameRate, number>> = {
  "100": 2,
  "120": 1,
  "200": 13,
  "24": 10,
  "240": 0,
  "25": 9,
  "30": 8,
  "50": 6,
  "60": 5,
};
export class SetCameraFPS extends Command<boolean> {
  constructor(private readonly fps: GoProFrameRate) {
    super();
  }
  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const presetResolution = fps_bytes[this.fps];
    if (presetResolution === undefined)
      throw new Error(
        `Unknown aspect ratio ${this.fps}. Possible values ${Object.keys(fps_bytes)}`,
      );

    const result = await channels.settings.write(
      new Uint8Array([3, 1, presetResolution]),
      { timeoutMs: 10_000 },
    );
    if (result.length === 2 && result[1] == 0x01) return false;
    return true;
  }
}
