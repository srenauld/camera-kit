#!/usr/bin/env node

import fs from "node:fs";

const usage = () => {
  console.error(
    "usage: extract-duml.mjs <capture.pcap> <iso-timestamp=label> [...] " +
      "[--window-ms=1000] [--direction=outbound|inbound|both]",
  );
  process.exit(2);
};

const args = process.argv.slice(2);
const capturePath = args.shift();
if (!capturePath) usage();

let windowMs = 1_000;
let direction = "outbound";
const markers = [];
for (const arg of args) {
  if (arg.startsWith("--window-ms=")) {
    windowMs = Number.parseInt(arg.slice("--window-ms=".length), 10);
    continue;
  }
  if (arg.startsWith("--direction=")) {
    direction = arg.slice("--direction=".length);
    if (!["outbound", "inbound", "both"].includes(direction)) usage();
    continue;
  }

  const separator = arg.lastIndexOf("=");
  if (separator < 0) usage();
  const instant = Date.parse(arg.slice(0, separator));
  if (!Number.isFinite(instant)) usage();
  markers.push({ instant, label: arg.slice(separator + 1) });
}
if (markers.length === 0 || !Number.isFinite(windowMs)) usage();

const fd = fs.openSync(capturePath, "r");
const globalHeader = Buffer.alloc(24);
fs.readSync(fd, globalHeader, 0, globalHeader.length, 0);

const magic = globalHeader.readUInt32LE(0);
const littleEndian = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
const nanosecondTimestamps = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
if (!littleEndian) {
  throw new Error("Only little-endian classic PCAP files are currently supported");
}

const linkType = globalHeader.readUInt32LE(20);
if (linkType !== 113) {
  throw new Error(`Expected Linux cooked capture v1 (DLT 113), got DLT ${linkType}`);
}

const packetHeader = Buffer.alloc(16);
let position = 24;
const seenByMarker = new Map(markers.map(({ label }) => [label, new Set()]));

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

const validDuml = (packet) =>
  // RefIn/RefOut are true, so the fast reflected form uses bit-reversed init values.
  reflectedCrc(packet.subarray(0, 3), 0x77, 0x8c, 8) === packet[3] &&
  reflectedCrc(packet.subarray(0, -2), 0x3692, 0x8408, 16) === packet.readUInt16LE(packet.length - 2);

while (fs.readSync(fd, packetHeader, 0, packetHeader.length, position) === packetHeader.length) {
  const seconds = packetHeader.readUInt32LE(0);
  const fraction = packetHeader.readUInt32LE(4);
  const capturedLength = packetHeader.readUInt32LE(8);
  position += packetHeader.length;

  const timestampMs = seconds * 1_000 + fraction / (nanosecondTimestamps ? 1_000_000 : 1_000);
  const matchingMarkers = markers.filter(
    ({ instant }) => timestampMs >= instant && timestampMs <= instant + windowMs,
  );
  if (matchingMarkers.length === 0) {
    position += capturedLength;
    continue;
  }

  const packet = Buffer.alloc(capturedLength);
  fs.readSync(fd, packet, 0, capturedLength, position);
  position += capturedLength;

  const ipOffset = 16;
  if (packet.length < ipOffset + 28 || (packet[ipOffset] >> 4) !== 4) continue;
  const ipHeaderLength = (packet[ipOffset] & 0x0f) * 4;
  if (packet[ipOffset + 9] !== 17) continue;
  const sourceAddress = [...packet.subarray(ipOffset + 12, ipOffset + 16)].join(".");
  const destinationAddress = [...packet.subarray(ipOffset + 16, ipOffset + 20)].join(".");
  const udpOffset = ipOffset + ipHeaderLength;
  const sourcePort = packet.readUInt16BE(udpOffset);
  const destinationPort = packet.readUInt16BE(udpOffset + 2);
  const packetDirection =
    sourceAddress === "192.168.2.199" && destinationAddress === "192.168.2.1" && destinationPort === 9004
      ? "outbound"
      : sourceAddress === "192.168.2.1" && destinationAddress === "192.168.2.199" && sourcePort === 9004
        ? "inbound"
        : undefined;
  if (packetDirection === undefined || (direction !== "both" && direction !== packetDirection)) continue;

  const udpPayload = packet.subarray(udpOffset + 8);
  for (let dumlOffset = 0; dumlOffset + 13 <= udpPayload.length; dumlOffset += 1) {
    if (udpPayload[dumlOffset] !== 0x55) continue;
    const declaredLength =
      udpPayload[dumlOffset + 1] | ((udpPayload[dumlOffset + 2] & 0x03) << 8);
    if (declaredLength < 13 || dumlOffset + declaredLength > udpPayload.length) continue;

    const duml = udpPayload.subarray(dumlOffset, dumlOffset + declaredLength);
    if (!validDuml(duml)) continue;
    const hex = duml.toString("hex");
    for (const marker of matchingMarkers) {
      const seen = seenByMarker.get(marker.label);
      const identity = `${packetDirection}:${hex}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const payload = duml.subarray(11, duml.length - 2);
      console.log(
        JSON.stringify({
          marker: marker.label,
          deltaMs: Math.round((timestampMs - marker.instant) * 1_000) / 1_000,
          timestamp: new Date(timestampMs).toISOString(),
          direction: packetDirection,
          wrapper: udpPayload.subarray(0, dumlOffset).toString("hex"),
          duml: hex,
          sender: duml[4],
          receiver: duml[5],
          sequence: duml.readUInt16LE(6),
          flags: duml[8],
          commandSet: duml[9],
          command: duml[10],
          payload: payload.toString("hex"),
        }),
      );
    }
  }
}

fs.closeSync(fd);
