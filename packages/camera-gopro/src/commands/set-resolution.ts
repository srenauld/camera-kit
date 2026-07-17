import type { GoProAspectRatio, GoProResolution } from "../delegates/types";

import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const resolutionBytes: {
  aspectRatio: GoProAspectRatio;
  byte: number;
  resolution: GoProResolution;
}[] = [
  { aspectRatio: "16:9", byte: 1, resolution: "4k" },
  { aspectRatio: "16:9", byte: 4, resolution: "2.7k" },
  { aspectRatio: "4:3", byte: 6, resolution: "2.7k" },
  { aspectRatio: "16:9", byte: 9, resolution: "1080" },
  { aspectRatio: "4:3", byte: 18, resolution: "4k" },
  { aspectRatio: "8:7", byte: 26, resolution: "5.3k" },
  { aspectRatio: "4:3", byte: 27, resolution: "5.3k" },
  { aspectRatio: "8:7", byte: 28, resolution: "4k" },
  { aspectRatio: "16:9", byte: 100, resolution: "5.3k" },
];
export class SetResolution extends Command<boolean> {
  constructor(
    private readonly resolution: GoProResolution,
    private readonly aspectRatio: GoProAspectRatio,
  ) {
    super();
  }
  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const presetResolution = resolutionBytes.find(
      (r) =>
        r.aspectRatio === this.aspectRatio && r.resolution === this.resolution,
    );
    if (presetResolution === undefined)
      throw new Error(
        `Unknown resolution+AR match ${this.resolution} - ${this.aspectRatio}.`,
      );

    const result = await channels.settings.write(
      new Uint8Array([2, 1, presetResolution.byte]),
      { timeoutMs: 10_000 },
    );
    if (result.length === 2 && result[1] == 0x01) return false;
    return true;
  }
}
