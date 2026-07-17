export class Response {
  private bytes = new Uint8Array();
  private remainingLen: number;

  constructor(readonly expectedLength: number) {
    this.remainingLen = expectedLength;
  }

  append(newData: Uint8Array): null | Uint8Array {
    if (this.remainingLen - newData.length < 0)
      throw new Error(
        `Invalid/data length mismatch. Received ${newData.length} bytes when expecting ${this.remainingLen}`,
      );
    const combined = new Uint8Array(this.bytes.length + newData.length);
    combined.set(this.bytes);
    combined.set(newData, this.bytes.length);
    this.bytes = combined;
    this.remainingLen -= newData.length;
    if (this.remainingLen !== 0) return null;
    return this.bytes;
  }
}
