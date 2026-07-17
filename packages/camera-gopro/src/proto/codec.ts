import { MessageCodec, MessageCollector } from "../command-channel";
import { GoProHero11PacketCollector } from "./collector";

const LOW_BYTE_MASK = 0b1111_1111;
const BYTE_SHIFT = 8;
const LENGTH_HIGH_MASK = 0b111;
const INITIAL_FRAME_FLAG = 0b0010_0000;
const CONTINUATION_FRAME_FLAG = 0b1000_0000;
const FRAME_CHUNK_SIZE = 18;

function chunkUint8Array(input: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("size must be a positive integer");
  }

  const chunks: Uint8Array[] = [];

  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }

  return chunks;
}

const wrapInitial = (packet: Uint8Array, totalLength: number) => {
  const lengthByteLow = totalLength & LOW_BYTE_MASK;
  const lengthByteHigh = (totalLength >> BYTE_SHIFT) & LENGTH_HIGH_MASK;
  const header = INITIAL_FRAME_FLAG | lengthByteHigh;
  return new Uint8Array([header, lengthByteLow, ...packet]);
};
const wrapContinuation = (packet: Uint8Array) => {
  return new Uint8Array([CONTINUATION_FRAME_FLAG, ...packet]);
};
export class GoProMessageCodec implements MessageCodec {
  createCollector(): MessageCollector {
    return new GoProHero11PacketCollector();
  }
  encode(command: Uint8Array): { bytes: Uint8Array }[] {
    const totalLength = command.length;
    const chunks = chunkUint8Array(command, FRAME_CHUNK_SIZE);
    return [
      wrapInitial(chunks[0], totalLength),
      ...chunks.slice(1).map(wrapContinuation),
    ].map((r) => ({ bytes: r }));
  }
}
