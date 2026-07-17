import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const HEX_RADIX = 16;

export class SetPairingComplete extends Command<boolean> {
  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const response = await channels.settings.write(
      new Uint8Array([0x01, 0x01, 0x04]),
      { timeoutMs: 10_000 },
    );
    if (response.length >= 2 && response[1] !== 0x00)
      throw new Error(
        `GoPro pairing completion failed with status 0x${response[1].toString(HEX_RADIX)}`,
      );
    return true;
  }
}
