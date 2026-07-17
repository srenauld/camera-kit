#!/usr/bin/env node

import fs from "node:fs";

const capturePath = process.argv[2];
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const sessionArgument = process.argv.find((argument) => argument.startsWith("--session="));
const limit = limitArgument ? Number.parseInt(limitArgument.slice(8), 10) : Number.POSITIVE_INFINITY;
const selectedSession = sessionArgument?.slice(10).toLowerCase();

if (!capturePath || !Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
  console.error("usage: analyze-wifi.mjs <capture.pcap> [--session=ffff] [--limit=100]");
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
let position = 24;
let emitted = 0;

while (
  emitted < limit &&
  fs.readSync(fd, packetHeader, 0, packetHeader.length, position) === packetHeader.length
) {
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
  const destinationAddress = [...packet.subarray(ipOffset + 16, ipOffset + 20)].join(".");
  const udpOffset = ipOffset + ipHeaderLength;
  const sourcePort = packet.readUInt16BE(udpOffset);
  const destinationPort = packet.readUInt16BE(udpOffset + 2);
  const direction =
    destinationAddress === "192.168.2.1" && destinationPort === 9004
      ? "outbound"
      : sourceAddress === "192.168.2.1" && sourcePort === 9004
        ? "inbound"
        : undefined;
  if (!direction) continue;

  const payload = packet.subarray(udpOffset + 8);
  if (payload.length < 4) continue;
  const session = payload.subarray(2, 4).toString("hex");
  if (selectedSession && session !== selectedSession) continue;

  const declaredLength = payload[0] | ((payload[1] & 0x0f) << 8);
  const dumlOffset = payload.indexOf(0x55);
  let duml;
  if (dumlOffset >= 0 && dumlOffset + 3 <= payload.length) {
    const dumlLength = payload[dumlOffset + 1] | ((payload[dumlOffset + 2] & 0x03) << 8);
    if (dumlLength >= 13 && dumlOffset + dumlLength <= payload.length) {
      const bytes = payload.subarray(dumlOffset, dumlOffset + dumlLength);
      duml = {
        offset: dumlOffset,
        sender: bytes[4],
        receiver: bytes[5],
        sequence: bytes.readUInt16LE(6),
        flags: bytes[8],
        commandSet: bytes[9],
        command: bytes[10],
        payload: bytes.subarray(11, -2).toString("hex"),
        hex: bytes.toString("hex"),
      };
    }
  }

  console.log(
    JSON.stringify({
      timestamp: new Date(timestamp * 1_000).toISOString(),
      direction,
      sourcePort,
      destinationPort,
      capturedLength: payload.length,
      declaredLength,
      type: payload[1] & 0xf0,
      session,
      channel: payload.length > 6 ? payload[6] : undefined,
      header: payload.subarray(0, Math.min(20, payload.length)).toString("hex"),
      payloadPrefix: payload.subarray(Math.min(20, payload.length), Math.min(52, payload.length)).toString("hex"),
      duml,
    }),
  );
  emitted += 1;
}

fs.closeSync(fd);
