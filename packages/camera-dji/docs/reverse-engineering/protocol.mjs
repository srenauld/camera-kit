const reflectedCrc = (bytes, initial, polynomial, width) => {
  let crc = initial;
  const mask = (1 << width) - 1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ polynomial : crc >>> 1;
    }
  }
  return crc & mask;
};

export const crc8 = (bytes) => reflectedCrc(bytes, 0x77, 0x8c, 8);
export const crc16 = (bytes) => reflectedCrc(bytes, 0x3692, 0x8408, 16);

export const wifiHeaderChecksum = (bytes) => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 7) throw new Error("Wi-Fi header checksum needs seven bytes");
  let checksum = 0;
  for (let index = 0; index < 7; index += 1) checksum ^= bytes[index];
  return checksum;
};

export const parseDuml = (bytes) => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 13 || bytes[0] !== 0x55) throw new Error("Invalid DUML prefix or length");
  const declaredLength = bytes[1] | ((bytes[2] & 0x03) << 8);
  if (declaredLength !== bytes.length) throw new Error("DUML length mismatch");
  if (crc8(bytes.subarray(0, 3)) !== bytes[3]) throw new Error("Invalid DUML header CRC-8");
  if (crc16(bytes.subarray(0, -2)) !== bytes.readUInt16LE(bytes.length - 2)) {
    throw new Error("Invalid DUML packet CRC-16");
  }
  return {
    sender: bytes[4],
    receiver: bytes[5],
    sequence: bytes.readUInt16LE(6),
    flags: bytes[8],
    commandSet: bytes[9],
    command: bytes[10],
    payload: bytes.subarray(11, -2),
  };
};

export const encodeDuml = ({ sender, receiver, sequence, flags, commandSet, command, payload = [] }) => {
  payload = Buffer.from(payload);
  const length = 13 + payload.length;
  if (length > 0x3ff) throw new Error("DUML packet exceeds its 10-bit length field");
  const bytes = Buffer.alloc(length);
  bytes[0] = 0x55;
  bytes[1] = length & 0xff;
  bytes[2] = 0x04 | ((length >>> 8) & 0x03);
  bytes[3] = crc8(bytes.subarray(0, 3));
  bytes[4] = sender;
  bytes[5] = receiver;
  bytes.writeUInt16LE(sequence, 6);
  bytes[8] = flags;
  bytes[9] = commandSet;
  bytes[10] = command;
  payload.copy(bytes, 11);
  bytes.writeUInt16LE(crc16(bytes.subarray(0, -2)), length - 2);
  return bytes;
};

export const findDumlPackets = (bytes, start = 0) => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const packets = [];
  for (let offset = start; offset + 13 <= bytes.length; offset += 1) {
    if (bytes[offset] !== 0x55) continue;
    const length = bytes[offset + 1] | ((bytes[offset + 2] & 0x03) << 8);
    if (length < 13 || offset + length > bytes.length) continue;
    const raw = bytes.subarray(offset, offset + length);
    try {
      packets.push({ offset, raw, ...parseDuml(raw) });
      offset += length - 1;
    } catch {
      // H.264 and opaque capability data can contain 0x55 by chance.
    }
  }
  return packets;
};

const assertSession = (session) => {
  if (!Number.isInteger(session) || session < 0 || session > 0xffff) {
    throw new Error("Wi-Fi session must be an unsigned 16-bit integer");
  }
};

export const encodeWifiHandshake = (session) => {
  assertSession(session);
  const bytes = Buffer.from(
    "3080000000000000487f64006400c005140000640000019001c005140000640014006400c00514000064000101040102",
    "hex",
  );
  bytes.writeUInt16BE(session, 2);
  bytes[7] = wifiHeaderChecksum(bytes);
  return bytes;
};

export const encodeWifiCommand = ({ session, transmitCursor, ordinal, duml }) => {
  assertSession(session);
  if (!Number.isInteger(transmitCursor) || transmitCursor < 0 || transmitCursor > 0xffff) {
    throw new Error("Wi-Fi transmit cursor must be an unsigned 16-bit integer");
  }
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 0xffff) {
    throw new Error("Wi-Fi ordinal must be an unsigned 16-bit integer");
  }
  duml = Buffer.from(duml);
  parseDuml(duml);
  const length = 20 + duml.length;
  if (length > 0x0fff) throw new Error("Wi-Fi packet exceeds its 12-bit length field");
  const bytes = Buffer.alloc(length);
  bytes[0] = length & 0xff;
  bytes[1] = 0x80 | ((length >>> 8) & 0x0f);
  bytes.writeUInt16BE(session, 2);
  bytes.writeUInt16LE(transmitCursor, 4);
  bytes[6] = 5;
  bytes.writeUInt16LE((transmitCursor - 8) & 0xffff, 8);
  bytes.writeUInt16LE(transmitCursor, 10);
  bytes.writeUInt16LE(ordinal, 16);
  bytes[7] = wifiHeaderChecksum(bytes);
  duml.copy(bytes, 20);
  return bytes;
};

// This is specifically the first reliable data packet after a fresh handshake.
export const encodeFirstWifiCommand = ({ session, duml }) =>
  encodeWifiCommand({ session, transmitCursor: 0x7f50, ordinal: 0x0101, duml });

export const acknowledgeWifiDatagram = (bytes, { transmitCursor } = {}) => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 34 || bytes[6] !== 1) {
    throw new Error("Only camera reliable-data channel 1 packets can be acknowledged");
  }
  const acknowledgement = Buffer.from(bytes.subarray(0, 34));
  acknowledgement[0] = 34;
  acknowledgement[1] = 0x80;
  acknowledgement[6] = 4;
  acknowledgement[7] = wifiHeaderChecksum(acknowledgement);
  if (transmitCursor !== undefined) acknowledgement.writeUInt16LE(transmitCursor, 26);
  acknowledgement[32] = 0;
  acknowledgement[33] = 0;
  return acknowledgement;
};

export const parseWifiDatagram = (bytes) => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 4) throw new Error("Wi-Fi datagram is too short");
  const declaredLength = bytes[0] | ((bytes[1] & 0x0f) << 8);
  if (declaredLength !== bytes.length) throw new Error("Wi-Fi datagram length mismatch");
  const result = {
    length: declaredLength,
    type: bytes[1] & 0xf0,
    session: bytes.readUInt16BE(2),
    channel: bytes.length > 6 ? bytes[6] : undefined,
    header: bytes.subarray(0, Math.min(20, bytes.length)),
    payload: bytes.subarray(Math.min(20, bytes.length)),
  };
  const dumlStart = result.channel === 1 ? 34 : result.channel === 3 || result.channel === 5 ? 20 : undefined;
  result.dumlPackets = dumlStart === undefined ? [] : findDumlPackets(bytes, dumlStart);
  result.duml = result.dumlPackets[0];
  return result;
};

export const parseVideoDatagram = (bytes) => {
  const wrapper = parseWifiDatagram(bytes);
  if (wrapper.channel !== 2 || bytes.length < 20) throw new Error("Not a video-channel datagram");
  const startsAccessUnit =
    bytes.length >= 36 && bytes[20] === 0 && bytes[21] === 0 && bytes[22] === 1 && bytes[23] === 0xff;
  return {
    wrapper,
    transportSequence: bytes.readUInt16LE(4),
    fragmentClass: bytes.readUInt16LE(16),
    fragmentIndex: bytes.readUInt16LE(18),
    startsAccessUnit,
    videoHeader: startsAccessUnit ? bytes.subarray(20, 36) : undefined,
    annexB: bytes.subarray(startsAccessUnit ? 36 : 20),
  };
};

export const createVideoAssembler = () => {
  let fragments;
  let expectedSequence;
  const reset = () => {
    fragments = undefined;
    expectedSequence = undefined;
  };
  return {
    push(bytes) {
      const fragment = parseVideoDatagram(bytes);
      let completed;
      let lost = false;
      if (fragment.startsAccessUnit) {
        if (fragments) completed = Buffer.concat(fragments);
        fragments = [fragment.annexB];
      } else if (!fragments || fragment.transportSequence !== expectedSequence) {
        lost = fragments !== undefined;
        reset();
        return { fragment, completed, lost };
      } else {
        fragments.push(fragment.annexB);
      }
      expectedSequence = (fragment.transportSequence + 8) & 0xffff;
      return { fragment, completed, lost };
    },
    flush() {
      const completed = fragments ? Buffer.concat(fragments) : undefined;
      reset();
      return completed;
    },
  };
};

export const parseMediaFragment = (payload) => {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  if (payload.length < 10 || payload[0] !== 0x4a || payload[1] !== 0x01) {
    throw new Error("Invalid media-list fragment prefix");
  }
  const lengthAndFlags = payload.readUInt16LE(2);
  const length = lengthAndFlags & 0x0fff;
  if (length !== payload.length) throw new Error("Media-list fragment length mismatch");
  return {
    transactionId: payload.readUInt16LE(4),
    index: payload.readUInt32LE(6),
    final: (lengthAndFlags & 0x1000) !== 0,
    body: payload.subarray(10),
  };
};

export const reassembleMediaList = (payloads) => {
  const parsed = payloads.map(parseMediaFragment);
  if (parsed.length === 0) throw new Error("No media-list fragments");
  const transactionId = parsed[0].transactionId;
  if (parsed.some((fragment) => fragment.transactionId !== transactionId)) {
    throw new Error("Mixed media-list transactions");
  }
  const finalFragments = parsed.filter((fragment) => fragment.final);
  if (finalFragments.length !== 1) throw new Error("Expected exactly one final media-list fragment");
  const finalIndex = finalFragments[0].index;
  const byIndex = new Map();
  for (const fragment of parsed) {
    if (fragment.index > finalIndex) throw new Error("Fragment follows the final fragment");
    if (byIndex.has(fragment.index)) throw new Error(`Duplicate media-list fragment ${fragment.index}`);
    byIndex.set(fragment.index, fragment.body);
  }
  const bodies = [];
  for (let index = 0; index <= finalIndex; index += 1) {
    const body = byIndex.get(index);
    if (!body) throw new Error(`Missing media-list fragment ${index}`);
    bodies.push(body);
  }
  return { transactionId, body: Buffer.concat(bodies) };
};

const readTypedPath = (body, searchStart, type, maximumDistance) => {
  const searchEnd = Math.min(body.length, searchStart + maximumDistance);
  for (let offset = searchStart; offset + 6 <= searchEnd; offset += 1) {
    if (body[offset] !== 0x1a || body[offset + 5] !== type) continue;
    const length = body.readUInt32LE(offset + 1);
    const valueStart = offset + 6;
    const containerEnd = valueStart + length;
    if (containerEnd > body.length) continue;
    const terminator = body.indexOf(0, valueStart);
    const valueEnd = terminator >= valueStart && terminator < containerEnd ? terminator : containerEnd;
    const value = body.subarray(valueStart, valueEnd).toString("ascii");
    if (!/^(DCIM|MISC)\//.test(value)) continue;
    return { offset, value };
  }
  return undefined;
};

const findFilenameOccurrences = (body) => {
  const occurrences = [];
  const text = body.toString("latin1");
  const expression = /DJI_\d{14}_\d{4}_[A-Z]\.(?:MP4|JPG)/g;
  for (const match of text.matchAll(expression)) {
    occurrences.push({ offset: match.index, filename: match[0] });
  }
  return occurrences;
};

const findRecordIndex = (body, filenameOffset) => {
  for (let offset = filenameOffset - 1; offset >= Math.max(0, filenameOffset - 64); offset -= 1) {
    if (body[offset] !== 0x8a || body[offset + 1] !== 0x01 || offset + 10 > body.length) continue;
    const index = body.readUInt32LE(offset + 2);
    if (body.readUInt32LE(offset + 6) === (index | 0x4000)) return index;
  }
  return undefined;
};

export const parseMediaEntries = (body) => {
  if (!Buffer.isBuffer(body)) body = Buffer.from(body);
  if (body.length < 4) throw new Error("Media-list body is too short");
  const declaredCount = body.readUInt32LE(0);
  const entries = findFilenameOccurrences(body).map(({ offset, filename }) => {
    const original = readTypedPath(body, offset + filename.length, 1, 96);
    const thumbnail = original && readTypedPath(body, original.offset + 6 + original.value.length, 2, 128);
    if (!original || !thumbnail) throw new Error(`Missing paths for media entry ${filename}`);
    const extension = filename.slice(filename.lastIndexOf("."));
    const timestampMatch = /^DJI_(\d{14})_/.exec(filename);
    return {
      fileIndex: findRecordIndex(body, offset),
      filename,
      mediaType: extension === ".MP4" ? "video" : "photo",
      originalBasePath: original.value,
      originalPath: `${original.value}${extension}`,
      lowResolutionPath: extension === ".MP4" ? `${original.value}.lrf` : undefined,
      thumbnailBasePath: thumbnail.value,
      timestamp: timestampMatch?.[1],
    };
  });
  if (entries.length !== declaredCount) {
    throw new Error(`Media-list count mismatch: declared ${declaredCount}, decoded ${entries.length}`);
  }
  return entries;
};

export const makeMediaFragment = ({ transactionId, index, final = false, body }) => {
  body = Buffer.from(body);
  const length = 10 + body.length;
  if (length > 0x0fff) throw new Error("Media fragment exceeds its 12-bit length field");
  const payload = Buffer.alloc(length);
  payload[0] = 0x4a;
  payload[1] = 0x01;
  payload.writeUInt16LE(length | (final ? 0x1000 : 0), 2);
  payload.writeUInt16LE(transactionId, 4);
  payload.writeUInt32LE(index, 6);
  body.copy(payload, 10);
  return payload;
};
