#!/usr/bin/env node

import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: extract-att.mjs <btsnoop_hci.log>");
  process.exit(2);
}

const data = fs.readFileSync(path);
if (data.subarray(0, 8).toString("ascii") !== "btsnoop\0") {
  throw new Error("Not a btsnoop file");
}

const formatUuid = (bytes) => {
  const hex = Buffer.from(bytes).reverse().toString("hex");
  if (bytes.length === 2) return hex;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const renderDiscovery = (att) => {
  const opcode = att[0];
  if (opcode === 0x11) {
    const width = att[1];
    const entries = [];
    for (let offset = 2; offset + width <= att.length; offset += width) {
      entries.push({
        startHandle: att.readUInt16LE(offset),
        endHandle: att.readUInt16LE(offset + 2),
        uuid: formatUuid(att.subarray(offset + 4, offset + width)),
      });
    }
    return { kind: "services", entries };
  }
  if (opcode === 0x09) {
    const width = att[1];
    const entries = [];
    for (let offset = 2; offset + width <= att.length; offset += width) {
      entries.push({
        declarationHandle: att.readUInt16LE(offset),
        properties: att[offset + 2],
        valueHandle: att.readUInt16LE(offset + 3),
        uuid: formatUuid(att.subarray(offset + 5, offset + width)),
      });
    }
    return { kind: "characteristics", entries };
  }
  if (opcode === 0x05) {
    const format = att[1];
    const width = format === 1 ? 4 : 18;
    const entries = [];
    for (let offset = 2; offset + width <= att.length; offset += width) {
      entries.push({
        handle: att.readUInt16LE(offset),
        uuid: formatUuid(att.subarray(offset + 2, offset + width)),
      });
    }
    return { kind: "descriptors", entries };
  }
  return undefined;
};

let offset = 16;
while (offset + 24 <= data.length) {
  const includedLength = data.readUInt32BE(offset + 4);
  const flags = data.readUInt32BE(offset + 8);
  const packet = data.subarray(offset + 24, offset + 24 + includedLength);
  offset += 24 + includedLength;
  if (packet[0] !== 0x02 || packet.length < 10) continue;

  const handleAndFlags = packet.readUInt16LE(1);
  const connectionHandle = handleAndFlags & 0x0fff;
  const cid = packet.readUInt16LE(7);
  if (cid !== 0x0004) continue;
  const att = packet.subarray(9);
  const discovery = renderDiscovery(att);
  if (discovery) {
    console.log(JSON.stringify({ direction: flags & 1 ? "controller-to-host" : "host-to-controller", connectionHandle, ...discovery }));
  }
}
