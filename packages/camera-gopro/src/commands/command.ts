import { GoproCommChannels } from "../handle";

export abstract class Command<T> {
  abstract execute(channels: GoproCommChannels): Promise<T>;
}
