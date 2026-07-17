#!/usr/bin/env node

import fs from "node:fs";

const capturePath = process.argv[2];
if (!capturePath) {
  console.error("usage: analyze-preview.mjs <capture.pcap>");
  process.exit(2);
}

const fd = fs.openSync(capturePath, "r");
const globalHeader = Buffer.alloc(24);
fs.readSync(fd, globalHeader, 0, globalHeader.length, 0);

const magic = globalHeader.readUInt32LE(0);
const littleEndian = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
const nanosecondTimestamps = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
if (!littleEndian) throw new Error("Only little-endian classic PCAP is supported");
if (globalHeader.readUInt32LE(20) !== 113) {
  throw new Error("Expected Linux cooked capture v1 (DLT 113)");
}

const packetHeader = Buffer.alloc(16);
const slices = [];
const nalCounts = new Map();
const nalOffsetCounts = new Map();
let firstPacketAt;
let lastPacketAt;
let position = 24;

while (fs.readSync(fd, packetHeader, 0, packetHeader.length, position) === packetHeader.length) {
  const seconds = packetHeader.readUInt32LE(0);
  const fraction = packetHeader.readUInt32LE(4);
  const capturedLength = packetHeader.readUInt32LE(8);
  const timestamp = seconds + fraction / (nanosecondTimestamps ? 1_000_000_000 : 1_000_000);
  position += packetHeader.length;

  const packet = Buffer.alloc(capturedLength);
  fs.readSync(fd, packet, 0, capturedLength, position);
  position += capturedLength;

  const ipOffset = 16;
  if (packet.length < ipOffset + 28 || (packet[ipOffset] >> 4) !== 4) continue;
  const ipHeaderLength = (packet[ipOffset] & 0x0f) * 4;
  if (packet[ipOffset + 9] !== 17) continue;
  const sourceAddress = [...packet.subarray(ipOffset + 12, ipOffset + 16)].join(".");
  const udpOffset = ipOffset + ipHeaderLength;
  const destinationPort = packet.readUInt16BE(udpOffset + 2);
  if (sourceAddress !== "192.168.2.1" || destinationPort !== 46904) continue;

  firstPacketAt ??= timestamp;
  lastPacketAt = timestamp;
  const payload = packet.subarray(udpOffset + 8);
  for (let offset = 0; offset + 4 < payload.length; offset += 1) {
    let nalOffset;
    if (
      payload[offset] === 0 &&
      payload[offset + 1] === 0 &&
      payload[offset + 2] === 0 &&
      payload[offset + 3] === 1
    ) {
      nalOffset = offset + 4;
    } else if (
      payload[offset] === 0 &&
      payload[offset + 1] === 0 &&
      payload[offset + 2] === 1
    ) {
      nalOffset = offset + 3;
    } else {
      continue;
    }

    const type = payload[nalOffset] & 0x1f;
    nalCounts.set(type, (nalCounts.get(type) ?? 0) + 1);
    const offsetKey = `${offset}:${type}`;
    nalOffsetCounts.set(offsetKey, (nalOffsetCounts.get(offsetKey) ?? 0) + 1);
    // Every observed video access unit begins at byte 36 of the first envelope
    // fragment. Other zero runs in the reliable-UDP header can resemble Annex-B.
    if ((type === 1 || type === 5) && offset === 36) slices.push({ timestamp, type, offset });
    offset = nalOffset;
  }
}

fs.closeSync(fd);

const intervalsMs = slices.slice(1).map((slice, index) => (slice.timestamp - slices[index].timestamp) * 1_000);
const sortedIntervals = [...intervalsMs].sort((left, right) => left - right);
const percentile = (fraction) =>
  sortedIntervals.length === 0
    ? undefined
    : sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(sortedIntervals.length * fraction))];
const sliceDuration = slices.length > 1 ? slices.at(-1).timestamp - slices[0].timestamp : 0;

console.log(
  JSON.stringify(
    {
      captureDurationSeconds:
        firstPacketAt === undefined || lastPacketAt === undefined ? 0 : lastPacketAt - firstPacketAt,
      sliceNalCount: slices.length,
      firstToLastSliceSeconds: sliceDuration,
      observedSliceNalsPerSecond: sliceDuration > 0 ? (slices.length - 1) / sliceDuration : 0,
      intervalMs: {
        min: percentile(0),
        median: percentile(0.5),
        p95: percentile(0.95),
        max: sortedIntervals.at(-1),
      },
      nalUnitCounts: Object.fromEntries([...nalCounts.entries()].sort(([left], [right]) => left - right)),
      commonStartOffsets: Object.fromEntries(
        [...nalOffsetCounts.entries()]
          .sort(([, left], [, right]) => right - left)
          .slice(0, 20),
      ),
      caveat:
        "Slice NAL starts normally correspond to frames in this stream; decode the reconstructed stream for a codec-level frame count.",
    },
    null,
    2,
  ),
);
