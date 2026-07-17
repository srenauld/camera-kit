import type { GoProLens } from "../delegates/types";

import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const lens_bytes: Partial<Record<GoProLens, number>> = {
  telephoto: 4,
  "ultra-wide": 3,
  wide: 0,
};
const SET_LENS_COMMAND = 121;
export class SetVideoLens extends Command<boolean> {
  constructor(private readonly lens: GoProLens) {
    super();
  }
  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const presetResolution = lens_bytes[this.lens];
    if (presetResolution === undefined)
      throw new Error(
        `Unknown aspect ratio ${this.lens}. Possible values ${Object.keys(lens_bytes)}`,
      );

    const result = await channels.settings.write(
      new Uint8Array([SET_LENS_COMMAND, 1, presetResolution]),
      { timeoutMs: 10_000 },
    );
    if (result.length === 2 && result[1] == 0x01) return false;
    return true;
  }
}
