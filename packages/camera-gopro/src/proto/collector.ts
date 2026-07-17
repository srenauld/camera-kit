import { MessageCollector } from "../command-channel";
import { Response } from "./response";
const CONTINUATION_FLAG = 0b1;
const BIT_SHIFT = 7;
const FRAME_TYPE_SHIFT = 5;
const FRAME_TYPE_MASK = 0b0110_0000;
const LENGTH_MASK = 0b0001_1111;
const BYTE_SHIFT = 8;
export class GoProHero11PacketCollector implements MessageCollector {
  private currentFrame: null | Response = null;
  push(
    data: Uint8Array,
  ):
    | { done: false }
    | ({ done: true; error: Error } | { done: true; message: Uint8Array }) {
    if (((data[0] >> BIT_SHIFT) & CONTINUATION_FLAG) === CONTINUATION_FLAG) {
      // Continuation message
      if (!this.currentFrame)
        return { done: true, error: new Error("No currently active frame") };
      try {
        const result = this.currentFrame.append(data.slice(1));
        if (result) {
          this.currentFrame = null;
          return { done: true, message: result };
        }
      } catch (error) {
        if (error instanceof Error) return { done: true, error: error };
        return { done: true, error: new Error("An unknown error occured") };
      }
      return { done: false };
    }
    // New message. Parse
    const payloadTypeBits: 0 | 1 | 2 | 3 = Math.max(
      Math.min((data[0] & FRAME_TYPE_MASK) >> FRAME_TYPE_SHIFT, 3),
      0,
    ) as 0 | 1 | 2 | 3;
    try {
      switch (payloadTypeBits) {
        case 0: {
          const packetLengthShort = data[0] & LENGTH_MASK;
          this.currentFrame = new Response(packetLengthShort);
          const resultShort = this.currentFrame.append(data.slice(1));
          if (resultShort) {
            this.currentFrame = null;
            return { done: true, message: resultShort };
          }
          return { done: false };
        }
        case 1: {
          const packetLengthMed =
            (data[0] & LENGTH_MASK) * Math.pow(2, BYTE_SHIFT) + data[1];
          this.currentFrame = new Response(packetLengthMed);
          const resultMed = this.currentFrame.append(data.slice(2));
          if (resultMed) {
            this.currentFrame = null;
            return { done: true, message: resultMed };
          }
          return { done: false };
        }
        case 2: {
          const packetLengthLong = data[1] * Math.pow(2, BYTE_SHIFT) + data[2];
          this.currentFrame = new Response(packetLengthLong);
          const packetLong = this.currentFrame.append(data.slice(3));
          if (packetLong) {
            this.currentFrame = null;
            return { done: true, message: packetLong };
          }
          return { done: false };
        }
        case 3: {
          // Skip this. Reserved
          return { done: false };
        }
      }
    } catch (error) {
      if (error instanceof Error) return { done: true, error: error };
      return { done: true, error: new Error("An unknown error occured") };
    }
  }
}
