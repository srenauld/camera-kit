const BLUETOOTH_BASE_SUFFIX = "00001000800000805f9b34fb";
const HEX_UUID = /^[\da-f]+$/;
const SHORT_UUID_LENGTH = 4;
const UUID_32_LENGTH = 8;
const UUID_128_LENGTH = 32;

export function canonicalBleUuid(value: string): string {
  const compact = value.toLowerCase().replaceAll("-", "");
  if (
    !HEX_UUID.test(compact) ||
    ![SHORT_UUID_LENGTH, UUID_128_LENGTH, UUID_32_LENGTH].includes(
      compact.length,
    )
  )
    throw new Error(`Invalid BLE UUID: ${value}`);
  if (compact.length === SHORT_UUID_LENGTH) return compact;
  if (compact.length === UUID_32_LENGTH && compact.startsWith("0000"))
    return compact.slice(SHORT_UUID_LENGTH);
  if (
    compact.length === UUID_128_LENGTH &&
    compact.startsWith("0000") &&
    compact.endsWith(BLUETOOTH_BASE_SUFFIX)
  )
    return compact.slice(SHORT_UUID_LENGTH, UUID_32_LENGTH);
  return compact;
}
