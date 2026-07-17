const CRC8_INITIAL = 0x77;
const CRC16_INITIAL = 0x36_92;
const BIT_COUNT = 8;
const CRC16_POLYNOMIAL = 0x84_08;
const CRC8_POLYNOMIAL = 0x8c;
const BYTE_MASK = 0xff;
const HEADER_LENGTH = 13;
const MAX_PACKET_LENGTH = 0x3_ff;
const DUML_START = 0x55;
const PAYLOAD_OFFSET = 11;

export type DumlPacket = Readonly<{
  command: number;
  commandSet: number;
  flags: number;
  payload: Uint8Array;
  receiver: number;
  sender: number;
  sequence: number;
}>;

export function crc16(bytes: Uint8Array): number {
  let value = CRC16_INITIAL;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < BIT_COUNT; bit += 1) {
      value =
        (value & 1) === 1 ? (value >>> 1) ^ CRC16_POLYNOMIAL : value >>> 1;
    }
  }
  return value & (BYTE_MASK | (BYTE_MASK << BIT_COUNT));
}

export function crc8(bytes: Uint8Array): number {
  let value = CRC8_INITIAL;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < BIT_COUNT; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ CRC8_POLYNOMIAL : value >>> 1;
    }
  }
  return value & BYTE_MASK;
}

export function encodeDuml(packet: DumlPacket): Uint8Array {
  const length = HEADER_LENGTH + packet.payload.length;
  if (length > MAX_PACKET_LENGTH)
    throw new RangeError("DUML packets cannot exceed 1023 bytes");

  const value = new Uint8Array(length);
  value[0] = DUML_START;
  value[1] = length & BYTE_MASK;
  value[2] = 0x04 | ((length >>> BIT_COUNT) & 0x03);
  value[3] = crc8(value.subarray(0, 3));
  value[4] = packet.sender;
  value[5] = packet.receiver;
  value[6] = packet.sequence & BYTE_MASK;
  value[7] = packet.sequence >>> BIT_COUNT;
  value[8] = packet.flags;
  value[9] = packet.commandSet;
  value[10] = packet.command;
  value.set(packet.payload, PAYLOAD_OFFSET);
  const checksum = crc16(value.subarray(0, length - 2));
  value[length - 2] = checksum & BYTE_MASK;
  value[length - 1] = checksum >>> BIT_COUNT;
  return value;
}

export function parseDuml(value: Uint8Array): DumlPacket {
  if (value.length < HEADER_LENGTH || value[0] !== DUML_START)
    throw new Error("Invalid DUML frame");
  const length = value[1] | ((value[2] & 0x03) << BIT_COUNT);
  if (length !== value.length) throw new Error("DUML length mismatch");
  if (crc8(value.subarray(0, 3)) !== value[3])
    throw new Error("DUML CRC-8 mismatch");
  const expected = value[length - 2] | (value[length - 1] << BIT_COUNT);
  if (crc16(value.subarray(0, length - 2)) !== expected)
    throw new Error("DUML CRC-16 mismatch");
  return {
    command: value[10],
    commandSet: value[9],
    flags: value[8],
    payload: value.slice(PAYLOAD_OFFSET, length - 2),
    receiver: value[5],
    sender: value[4],
    sequence: value[6] | (value[7] << BIT_COUNT),
  };
}

function append(left: Uint8Array, right: Uint8Array): Uint8Array {
  const value = new Uint8Array(left.length + right.length);
  value.set(left);
  value.set(right, left.length);
  return value;
}

/** Reassembles arbitrary ATT notification fragments and resynchronises after noise. */
export class DumlFragmentCollector {
  private pending: Uint8Array = new Uint8Array();

  push(fragment: Uint8Array): DumlPacket[] {
    this.pending = append(this.pending, fragment);
    const packets: DumlPacket[] = [];

    while (this.pending.length > 0) {
      const start = this.pending.indexOf(DUML_START);
      if (start === -1) {
        this.pending = new Uint8Array();
        break;
      }
      if (start > 0) this.pending = this.pending.slice(start);
      if (this.pending.length < 3) break;

      const length = this.pending[1] | ((this.pending[2] & 0x03) << BIT_COUNT);
      if (length < HEADER_LENGTH) {
        this.pending = this.pending.slice(1);
        continue;
      }
      if (this.pending.length < length) break;

      const candidate = this.pending.slice(0, length);
      try {
        const packet = parseDuml(candidate);
        packets.push(packet);
        this.pending = this.pending.slice(length);
      } catch {
        // A corrupt/injected candidate can contain the start of the next frame.
        // Discard only this candidate's prefix so a later 0x55 can resynchronise.
        this.pending = this.pending.slice(1);
      }
    }
    return packets;
  }
}
