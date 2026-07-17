import type { Command } from "./commands/command";
import type {
  GoProHero11Capabilities,
  GoProHero11Mode,
} from "./delegates/types";
import type {
  BleAdvertisementPacket,
  BleCharacteristic,
  BleDevice,
  CameraHandle,
  MonotonicClock,
  RecordingStart,
} from "@mandltv/camera-core";

import { CameraDisconnectedError } from "@mandltv/camera-core";

import { BleCommandChannel } from "./command-channel";
import { CheckStatus } from "./commands/check-status";
import { SetPairingComplete } from "./commands/set-pairing-complete";
import { SetShutter } from "./commands/set-shutter";
import { Hero11Delegate } from "./delegates/hero-11";
import { GoProMessageCodec } from "./proto/codec";
// import { BleCommandChannel } from "./command-channel";

const COMMAND_CHANNEL = "b5f90072aa8d11e390460002a5d5c51b";
const COMMAND_RTN_CHANNEL = "b5f90073aa8d11e390460002a5d5c51b";
const QUERY_CHANNEL = "b5f90076aa8d11e390460002a5d5c51b";
const QUERY_RTN_CHANNEL = "b5f90077aa8d11e390460002a5d5c51b";
const SETTINGS_CHANNEL = "b5f90074aa8d11e390460002a5d5c51b";
const SETTINGS_RTN_CHANNEL = "b5f90075aa8d11e390460002a5d5c51b";
const CLOSE_TIMEOUT = 1000;

export type GoproCommChannels = {
  command: BleCommandChannel;
  query: BleCommandChannel;
  settings: BleCommandChannel;
};

export type GoproHero11Options = Readonly<{ clock?: MonotonicClock }>;
const zipChannel = async (
  write: BleCharacteristic,
  notify: BleCharacteristic,
) => {
  const channel = new BleCommandChannel(write, notify, new GoProMessageCodec());
  await channel.init();
  return channel;
};
export class GoproHero11Handle implements CameraHandle<
  "gopro-hero11",
  GoProHero11Mode
> {
  readonly id: string;
  readonly kind = "gopro-hero11" as const;
  readonly model = "GoPro HERO11";
  get state(): "closed" | "closing" | "connected" | "disconnected" {
    if (this.closed) return "closed";
    if (this.closing) return "closing";
    return this.device.connected ? "connected" : "disconnected";
  }
  private readonly clock: MonotonicClock;
  private closed = false;
  private closing = false;
  private communicationChannels: GoproCommChannels | null = null;
  private delegate = new Hero11Delegate();
  private operationQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly device: BleDevice,
    private readonly advertisement: BleAdvertisementPacket,
    options: GoproHero11Options = {},
  ) {
    this.id = advertisement.id;
    this.clock = options.clock ?? {
      now: () =>
        typeof performance === "undefined" ? Date.now() : performance.now(),
    };
  }
  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    const channels = this.communicationChannels;
    this.communicationChannels = null;
    if (channels)
      await Promise.allSettled([
        channels.command.close(),
        channels.query.close(),
        channels.settings.close(),
      ]);
    await Promise.race([
      this.device.disconnect(),
      new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT)),
    ]).catch(() => undefined);
    this.closing = false;
    this.closed = true;
  }
  getCapabilities(): GoProHero11Capabilities {
    return this.delegate.capabilities;
  }
  async initialize(): Promise<void> {
    this.assertConnected();
    await this.setupChannels();
    await this.awaitReady();
    if (this.isPairing()) {
      // Open GoPro's Set Pairing State setting marks this client as completed and
      // dismisses the camera's one-time pairing UI.
      await this.execute(new SetPairingComplete());
    }
  }
  record(): Promise<RecordingStart> {
    return this.enqueue(async () => {
      this.assertConnected();
      await this.execute(new SetShutter(true));
      return { recordingActiveAt: this.clock.now() };
    });
  }
  async setup(mode: GoProHero11Mode): Promise<void> {
    return this.enqueue(() => this.setupInternal(mode));
  }
  stop(): Promise<void> {
    return this.enqueue(async () => {
      this.assertConnected();
      await this.execute(new SetShutter(false));
    });
  }
  private assertConnected(): void {
    if (this.closed || this.closing || !this.device.connected)
      throw new CameraDisconnectedError(
        `GoPro camera ${this.id} is disconnected`,
      );
  }
  private async awaitReady() {
    for (;;) {
      const rtn = await this.execute(new CheckStatus()).catch(
        (_error: unknown) => {
          return false;
        },
      );
      if (rtn) {
        return true;
      }
    }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationQueue.then(operation, operation);
    this.operationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  private async execute<T>(command: Command<T>): Promise<T> {
    const channels = this.communicationChannels;
    if (!channels) throw new Error("Initialize channels first");
    const result = await command.execute(channels);
    return result;
  }
  private isPairing() {
    const pairingByte = this.advertisement.manufacturer[3];
    if (pairingByte & 4) return true;
    return false;
  }
  private isSupportedMode(mode: GoProHero11Mode): boolean {
    return this.delegate.capabilities.modes.some((advertised) => {
      const advertisedEntries = Object.entries(advertised);
      const requestedEntries = Object.entries(mode);
      return (
        advertisedEntries.length === requestedEntries.length &&
        advertisedEntries.every(
          ([key, value]) => mode[key as keyof GoProHero11Mode] === value,
        )
      );
    });
  }

  private async setupChannels() {
    const characteristics: Record<string, BleCharacteristic> = {};
    for await (const char of this.device.characteristics()) {
      characteristics[char.uuid.toLowerCase()] = char;
    }
    const requireCharacteristic = (uuid: string): BleCharacteristic => {
      if (!Object.hasOwn(characteristics, uuid))
        throw new Error(`GoPro characteristic ${uuid} was not found`);
      return characteristics[uuid];
    };
    const [command, query, settings] = await Promise.all([
      zipChannel(
        requireCharacteristic(COMMAND_CHANNEL),
        requireCharacteristic(COMMAND_RTN_CHANNEL),
      ),
      zipChannel(
        requireCharacteristic(QUERY_CHANNEL),
        requireCharacteristic(QUERY_RTN_CHANNEL),
      ),
      zipChannel(
        requireCharacteristic(SETTINGS_CHANNEL),
        requireCharacteristic(SETTINGS_RTN_CHANNEL),
      ),
    ]);
    this.communicationChannels = {
      command,
      query,
      settings,
    };
  }

  private async setupInternal(mode: GoProHero11Mode): Promise<void> {
    if (!this.isSupportedMode(mode)) {
      throw new Error(
        "Unsupported GoPro Hero 11 capability. Pass a mode returned by getCapabilities().",
      );
    }
    this.assertConnected();
    const outputCommand = this.delegate.applySettings(mode);
    await this.execute(outputCommand);
  }
}
