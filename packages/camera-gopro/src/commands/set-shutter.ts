import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const HEX_RADIX = 16;

export class SetShutter extends Command<boolean> {
  constructor(private readonly enabled: boolean) {
    super();
  }

  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const response = await channels.command.write(
      new Uint8Array([0x03, 0x01, this.enabled ? 0x01 : 0x00]),
      { timeoutMs: 10_000 },
    );
    if (response.length >= 2 && response[1] !== 0x00)
      throw new Error(
        `GoPro shutter command failed with status 0x${response[1].toString(HEX_RADIX)}`,
      );
    return true;
  }
}
