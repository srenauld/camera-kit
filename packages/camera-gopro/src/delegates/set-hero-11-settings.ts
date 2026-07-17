import type { GoproCommChannels } from "../handle";
import type { GoProHero11Mode } from "./types";

import { Command } from "../commands/command";
import { SetCameraFPS } from "../commands/set-camera-fps";
import { SetResolution } from "../commands/set-resolution";
import { SetVideoLens } from "../commands/set-video-lens";

export class SetHero11Settings extends Command<boolean> {
  constructor(readonly settings: GoProHero11Mode) {
    super();
  }

  override async execute(channels: GoproCommChannels): Promise<boolean> {
    await new SetResolution(
      this.settings.resolution,
      this.settings.aspectRatio,
    ).execute(channels);
    await new SetCameraFPS(this.settings.frameRate).execute(channels);
    await new SetVideoLens(this.settings.lens).execute(channels);
    return true;
  }
}
