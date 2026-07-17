export type BleCharacteristic = {
  subscribe(): AsyncIterable<Uint8Array>;
  readonly uuid: string;
  write(data: Uint8Array): Promise<void>;
};
export type BleDevice = {
  characteristics(): AsyncGenerator<BleCharacteristic, void, void>;
  readonly connected: boolean;
  disconnect(): Promise<void>;
  readonly id: string;
};
