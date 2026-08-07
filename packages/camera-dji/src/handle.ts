import type {
  DjiColorProfile,
  DjiOsmoNanoCapabilities,
  DjiOsmoNanoSettings,
  DjiRecordingPhase,
  DjiStabilization,
} from "./types";
import type {
  BleAdvertisementPacket,
  BleCharacteristic,
  BleDevice,
  CameraHandle,
  MonotonicClock,
  RecordingStart,
} from "@srenauld/camera-core";

import { CameraDisconnectedError } from "@srenauld/camera-core";

import { DJI_OSMO_NANO_CAPABILITIES, isSupportedMode } from "./capabilities";
import {
  DumlFragmentCollector,
  type DumlPacket,
  encodeDuml,
} from "./protocol/duml";

const FFF4 = "fff4";
const FFF5 = "fff5";
const HEX_RADIX = 16;
const STATUS_COMMAND = 0x80;
const STATUS_START = 0x41;
const STATUS_ACTIVE = 0x81;
const STATUS_STOPPING = 0xc1;
const STATUS_IDLE = 0x01;
const STATUS_FRAGMENT_LENGTH = 15;
const DUML_START = 0x55;
const COMMAND_TIMEOUT = 1000;
const MODE_SETTLE = 5000;
const RECORDING_TIMEOUT = 4000;
const MAX_SEQUENCE = 0xff_ff;
const CLOSE_TIMEOUT = 1000;
const COMMAND_SET = 0x02;
const SET_FAMILY_COMMAND = 0xe1;
const SET_FORMAT_COMMAND = 0x18;
const SET_STABILIZATION_COMMAND = 0x8e;
const SET_COLOR_COMMAND = 0x42;
const STABILIZATION_PARAMETER_ID = 0x08;

export type DjiOsmoNanoOptions = Readonly<{
  clock?: MonotonicClock;
  commandTimeoutMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  modeSettleMs?: number;
  recordingStateTimeoutMs?: number;
}>;

type PendingRequest = {
  readonly reject: (reason: Error) => void;
  readonly resolve: (packet: DumlPacket) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

type PhaseWaiter = {
  readonly afterVersion: number;
  readonly phase: DjiRecordingPhase;
  readonly reject: (reason: Error) => void;
  readonly resolve: (at: number) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

function commandError(packet: DumlPacket): Error | null {
  const status = packet.payload[0];
  if (status === 0) return null;
  return new Error(
    `DJI command ${packet.commandSet.toString(HEX_RADIX)}/${packet.command.toString(HEX_RADIX)} failed with status 0x${status.toString(HEX_RADIX).padStart(2, "0")}`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normaliseUuid(uuid: string): string {
  return uuid
    .toLowerCase()
    .replaceAll("-", "")
    .replace(/^0{4}/, "")
    .slice(0, 4);
}

function phaseForStatus(packet: DumlPacket): DjiRecordingPhase | undefined {
  if (packet.commandSet !== COMMAND_SET || packet.command !== STATUS_COMMAND)
    return undefined;
  if (
    packet.payload.length >= 3 &&
    packet.payload[1] === COMMAND_SET &&
    packet.payload[2] === STATUS_COMMAND &&
    packet.payload[0] !== STATUS_IDLE
  ) {
    return recordingPhase(packet.payload[0]);
  }
  for (let index = 0; index + 3 < packet.payload.length; index += 1) {
    if (
      packet.payload[index] !== STATUS_IDLE ||
      packet.payload[index + 1] !== COMMAND_SET ||
      packet.payload[index + 2] !== STATUS_COMMAND
    )
      continue;
    return recordingPhase(packet.payload[index + 3]);
  }
  return undefined;
}

function phaseForStatusFragment(
  value: Uint8Array,
): DjiRecordingPhase | undefined {
  if (
    value.length < STATUS_FRAGMENT_LENGTH ||
    value[0] !== DUML_START ||
    value[9] !== COMMAND_SET ||
    value[10] !== STATUS_COMMAND
  )
    return undefined;
  if (
    value[11] === STATUS_IDLE &&
    value[12] === COMMAND_SET &&
    value[13] === STATUS_COMMAND
  )
    return recordingPhase(value[14]);
  return recordingPhase(value[11]);
}

function recordingPhase(value: number): DjiRecordingPhase | undefined {
  switch (value) {
    case STATUS_ACTIVE: {
      return "recording";
    }
    case STATUS_IDLE: {
      return "idle";
    }
    case STATUS_START: {
      return "starting";
    }
    case STATUS_STOPPING: {
      return "stopping";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Clean-room BLE controller for an Osmo Nano. Wi-Fi preview and media APIs are
 * deliberately outside this v1 handle.
 */
export class DjiOsmoNanoHandle implements CameraHandle<
  "dji-osmo-nano",
  DjiOsmoNanoSettings
> {
  readonly id: string;
  readonly kind = "dji-osmo-nano" as const;
  readonly model = "DJI Osmo Nano";

  get state(): "closed" | "closing" | "connected" | "disconnected" {
    if (this.closed) return "closed";
    if (this.closing) return "closing";
    return this.device.connected ? "connected" : "disconnected";
  }
  private closed = false;
  private closing = false;
  private readonly collector = new DumlFragmentCollector();
  private lastFamily?: DjiOsmoNanoSettings["family"];
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly options: Required<DjiOsmoNanoOptions>;
  private readonly pending = new Map<number, PendingRequest>();
  private phase?: DjiRecordingPhase;
  private phaseVersion = 0;
  private phaseWaiters = new Set<PhaseWaiter>();
  private responseIterator?: AsyncIterator<Uint8Array>;
  private responseTask?: Promise<void>;
  private sequence = 1;

  private writeCharacteristic?: BleCharacteristic;

  constructor(
    private readonly device: BleDevice,
    advertisement: BleAdvertisementPacket,
    options: DjiOsmoNanoOptions = {},
  ) {
    this.options = {
      clock: options.clock ?? {
        now: () =>
          typeof performance === "undefined" ? Date.now() : performance.now(),
      },
      commandTimeoutMs: options.commandTimeoutMs ?? COMMAND_TIMEOUT,
      delay: options.delay ?? delay,
      modeSettleMs: options.modeSettleMs ?? MODE_SETTLE,
      recordingStateTimeoutMs:
        options.recordingStateTimeoutMs ?? RECORDING_TIMEOUT,
    };
    this.id = advertisement.id;
  }

  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.rejectAll(new Error("DJI camera handle closed"));
    const closeNotifications = this.responseIterator?.return?.();
    if (closeNotifications)
      await Promise.race([closeNotifications, delay(CLOSE_TIMEOUT)]);
    this.responseIterator = undefined;
    if (this.responseTask)
      await Promise.race([this.responseTask, delay(CLOSE_TIMEOUT)]).catch(
        () => undefined,
      );
    this.responseTask = undefined;
    this.writeCharacteristic = undefined;
    await Promise.race([this.device.disconnect(), delay(CLOSE_TIMEOUT)]).catch(
      () => undefined,
    );
    this.closing = false;
    this.closed = true;
  }

  getCapabilities(): DjiOsmoNanoCapabilities {
    return DJI_OSMO_NANO_CAPABILITIES;
  }

  async initialize(): Promise<void> {
    this.assertConnected();
    let notify: BleCharacteristic | undefined;
    for await (const characteristic of this.device.characteristics()) {
      if (normaliseUuid(characteristic.uuid) === FFF4) notify = characteristic;
      if (normaliseUuid(characteristic.uuid) === FFF5)
        this.writeCharacteristic = characteristic;
    }
    if (!notify || !this.writeCharacteristic)
      throw new Error("DJI FFF4/FFF5 characteristics were not found");

    this.responseIterator = notify.subscribe()[Symbol.asyncIterator]();
    this.responseTask = this.pumpNotifications(this.responseIterator);
  }

  async record(): Promise<RecordingStart> {
    return this.enqueue(() => this.recordInternal());
  }

  async setup(settings: DjiOsmoNanoSettings): Promise<void> {
    return this.enqueue(() => this.setupInternal(settings));
  }

  async stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal());
  }

  private assertConnected(): void {
    if (this.closed || this.closing || !this.device.connected)
      throw new CameraDisconnectedError(
        `DJI camera ${this.id} is disconnected`,
      );
  }

  private createPhaseWaiter(phase: DjiRecordingPhase): {
    cancel: (reason: unknown) => void;
    promise: Promise<number>;
  } {
    const afterVersion = this.phaseVersion;
    let waiter: PhaseWaiter;
    const promise = new Promise<number>((resolve, reject) => {
      waiter = {
        afterVersion,
        phase,
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.phaseWaiters.delete(waiter);
          reject(
            new Error(`Timed out waiting for DJI recording phase ${phase}`),
          );
        }, this.options.recordingStateTimeoutMs),
      };
      this.phaseWaiters.add(waiter);
    });
    return {
      cancel: (reason: unknown) => {
        this.phaseWaiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.reject(
          reason instanceof Error
            ? reason
            : new Error("Recording operation failed"),
        );
      },
      promise,
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationQueue.then(operation, operation);
    this.operationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private nextSequence(): number {
    const current = this.sequence;
    this.sequence = (this.sequence + 1) & MAX_SEQUENCE;
    if (this.sequence === 0) this.sequence = 1;
    return current;
  }

  private onPacket(packet: DumlPacket): void {
    const phase = phaseForStatus(packet);
    if (phase) this.setPhase(phase);

    const pending = this.pending.get(packet.sequence);
    if (!pending) return;
    this.pending.delete(packet.sequence);
    clearTimeout(pending.timeout);
    pending.resolve(packet);
  }

  private async pumpNotifications(
    iterator: AsyncIterator<Uint8Array>,
  ): Promise<void> {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        const fragmentPhase = phaseForStatusFragment(next.value);
        if (fragmentPhase) this.setPhase(fragmentPhase);
        for (const packet of this.collector.push(next.value))
          this.onPacket(packet);
      }
      if (!this.closing && !this.closed)
        this.rejectAll(new Error("DJI notification stream closed"));
    } catch (error) {
      this.rejectAll(
        error instanceof Error
          ? error
          : new Error("DJI notification stream failed"),
      );
    }
  }

  private async recordInternal(): Promise<RecordingStart> {
    this.assertConnected();
    if (this.phase === "recording" || this.phase === "starting")
      throw new Error("Camera is already recording");
    const active = this.createPhaseWaiter("recording");
    try {
      const command = this.request(COMMAND_SET, 0x02, new Uint8Array([0x01]));
      const first = await Promise.race([
        command.then(() => ({ kind: "ack" as const })),
        active.promise.then((recordingActiveAt) => ({
          kind: "active" as const,
          recordingActiveAt,
        })),
      ]);
      if (first.kind === "active")
        return { recordingActiveAt: first.recordingActiveAt };
      return { recordingActiveAt: await active.promise };
    } catch (error) {
      active.cancel(error);
      throw error;
    }
  }

  private rejectAll(reason: Error): void {
    for (const [sequence, pending] of this.pending) {
      this.pending.delete(sequence);
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    for (const waiter of this.phaseWaiters) {
      this.phaseWaiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.reject(reason);
    }
  }

  private async request(
    commandSet: number,
    command: number,
    payload: Uint8Array,
  ): Promise<DumlPacket> {
    if (!this.writeCharacteristic) throw new Error("Camera is not connected");
    const sequence = this.nextSequence();
    const response = new Promise<DumlPacket>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(sequence);
        reject(
          new Error(
            `Timed out waiting for DJI command ${commandSet.toString(HEX_RADIX)}/${command.toString(HEX_RADIX)}`,
          ),
        );
      }, this.options.commandTimeoutMs);
      this.pending.set(sequence, { reject, resolve, timeout });
    });

    try {
      await this.writeCharacteristic.write(
        encodeDuml({
          command,
          commandSet,
          flags: 0x40,
          payload,
          receiver: 0x01,
          sender: 0x02,
          sequence,
        }),
      );
    } catch (error) {
      const pending = this.pending.get(sequence);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(sequence);
        pending.reject(
          error instanceof Error ? error : new Error("BLE write failed"),
        );
      }
    }
    const packet = await response;
    const error = commandError(packet);
    if (error) throw error;
    return packet;
  }

  private setPhase(phase: DjiRecordingPhase): void {
    this.phase = phase;
    this.phaseVersion += 1;
    const at = this.options.clock.now();
    for (const waiter of this.phaseWaiters) {
      if (waiter.phase !== phase || waiter.afterVersion >= this.phaseVersion)
        continue;
      this.phaseWaiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(at);
    }
  }

  private async setupInternal(settings: DjiOsmoNanoSettings): Promise<void> {
    if (!isSupportedMode(settings)) {
      throw new Error(
        "Unsupported DJI Osmo Nano capability. Pass a mode returned by getCapabilities().",
      );
    }
    this.assertConnected();
    const familyChanged = this.lastFamily !== settings.family;
    await this.request(
      COMMAND_SET,
      SET_FAMILY_COMMAND,
      new Uint8Array([settings.family === "video" ? 0x01 : 0x00]),
    );
    if (familyChanged) {
      await this.options.delay(this.options.modeSettleMs);
    }
    this.lastFamily = settings.family;
    await this.request(COMMAND_SET, SET_FORMAT_COMMAND, encodeFormat(settings));
    if (settings.stabilization !== undefined) {
      await this.request(
        COMMAND_SET,
        SET_STABILIZATION_COMMAND,
        encodeStabilization(settings.stabilization),
      );
    }
    if (settings.colorProfile !== undefined) {
      await this.request(
        COMMAND_SET,
        SET_COLOR_COMMAND,
        new Uint8Array([colorProfileValue(settings.colorProfile)]),
      );
    }
  }

  private async stopInternal(): Promise<void> {
    this.assertConnected();
    const stopping = this.createPhaseWaiter("stopping");
    try {
      await this.request(COMMAND_SET, 0x02, new Uint8Array([0x00]));
      await stopping.promise;
    } catch (error) {
      stopping.cancel(error);
      throw error;
    }
  }
}

function colorProfileValue(value: DjiColorProfile): number {
  return { "d-log-m-10bit": 0x3d, "normal-10bit": 0x3f, "normal-8bit": 0x00 }[
    value
  ];
}

function encodeFormat(settings: DjiOsmoNanoSettings): Uint8Array {
  const resolution: Record<string, number> = {
    "1080p:16:9": 0x0a,
    "1080p:4:3": 0x0c,
    "2.7k:16:9": 0x2d,
    "2.7k:4:3": 0x5f,
    "4k:16:9": 0x10,
    "4k:4:3": 0x67,
  };
  const fps = {
    120: 7,
    24: 1,
    240: 8,
    25: 2,
    30: 3,
    48: 4,
    50: 5,
    60: 6,
  } as const;
  const key = `${settings.resolution}:${settings.aspectRatio}`;
  return new Uint8Array([
    resolution[key],
    fps[settings.frameRate],
    0,
    settings.family === "slow-motion" ? (settings.slowMotionFactor ?? 0) : 0,
    0,
  ]);
}

function encodeStabilization(value: DjiStabilization): Uint8Array {
  const values = {
    "horizon-balancing": 0x04,
    "horizon-correction": 0x07,
    off: 0x00,
    "rock-steady": 0x01,
  } as const;
  return new Uint8Array([
    0x01,
    0x01,
    STABILIZATION_PARAMETER_ID,
    0x00,
    0x01,
    values[value],
  ]);
}
