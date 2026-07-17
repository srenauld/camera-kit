const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_QUARTET_SIZE = 4;
const BASE64_NIBBLE_MASK = 0x0f;
const BASE64_BYTE_MASK = 0x3f;

export function base64ToBytes(value: null | string | undefined): Uint8Array {
  if (!value) return new Uint8Array();
  const input = value.replaceAll(/\s/g, "");
  if (input.length % BASE64_QUARTET_SIZE !== 0)
    throw new Error("Invalid base64 data from BLE device");
  const output: number[] = [];
  for (let index = 0; index < input.length; index += BASE64_QUARTET_SIZE) {
    const chars = input.slice(index, index + BASE64_QUARTET_SIZE);
    const values = [0, 1, 2, 3].map((offset) => {
      const character = chars[offset];
      return character === "=" ? 0 : alphabet.indexOf(character);
    });
    if (values.some((entry) => entry < 0))
      throw new Error("Invalid base64 data from BLE device");
    output.push((values[0] << 2) | (values[1] >> 4));
    if (chars[2] !== "=")
      output.push(((values[1] & BASE64_NIBBLE_MASK) << 4) | (values[2] >> 2));
    if (chars[3] !== "=") output.push(((values[2] & 3) << 6) | values[3]);
  }
  return new Uint8Array(output);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasSecondByte = index + 1 < bytes.length;
    const hasThirdByte = index + 2 < bytes.length;
    const b = hasSecondByte ? bytes[index + 1] : 0;
    const c = hasThirdByte ? bytes[index + 2] : 0;
    result += alphabet[a >> 2];
    result += alphabet[((a & 3) << 4) | (b >> 4)];
    result += hasSecondByte
      ? alphabet[((b & BASE64_NIBBLE_MASK) << 2) | (c >> 6)]
      : "=";
    result += hasThirdByte ? alphabet[c & BASE64_BYTE_MASK] : "=";
  }
  return result;
}
