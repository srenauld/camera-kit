import { GoproCommChannels } from "../handle";
import { Command } from "./command";

const CHECK_STATUS_COMMAND = 0x3c;

export class CheckStatus extends Command<boolean> {
  override async execute(channels: GoproCommChannels): Promise<boolean> {
    const result = await channels.command.write(
      new Uint8Array([CHECK_STATUS_COMMAND]),
      { timeoutMs: 10_000 },
    );
    if (result.length === 2 && result[1] == 0x01) return false;
    return true;
  }
}
