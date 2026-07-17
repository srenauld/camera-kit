#!/usr/bin/env node

// Reassemble raw DUML notifications recorded by android-ble-probe.  The app
// logs individual ATT values, which may split a DUML frame at the negotiated
// ATT MTU boundary.  Input logs are evidence and deliberately remain ignored.
import fs from "node:fs";
import { findDumlPackets } from "./protocol.mjs";

const source = process.argv[2];
if (!source) {
  console.error("usage: decode-ble-probe-log.mjs <duml-ble-probe.jsonl>");
  process.exit(2);
}

const buffers = new Map();
for (const line of fs.readFileSync(source, "utf8").split("\n")) {
  if (!line) continue;
  const entry = JSON.parse(line);
  if (entry.event !== "notification") continue;
  const match = /^characteristic=([^;]+);value=([0-9a-f]+)$/.exec(entry.frame);
  if (!match) continue;
  const [, characteristic, hex] = match;
  const combined = Buffer.concat([buffers.get(characteristic) ?? Buffer.alloc(0), Buffer.from(hex, "hex")]);
  const packets = findDumlPackets(combined);
  let consumed = 0;
  for (const packet of packets) {
    consumed = Math.max(consumed, packet.offset + packet.raw.length);
    console.log(JSON.stringify({
      monotonicMs: entry.monotonicMs,
      characteristic,
      sequence: `0x${packet.sequence.toString(16).padStart(4, "0")}`,
      commandSet: `0x${packet.commandSet.toString(16).padStart(2, "0")}`,
      command: `0x${packet.command.toString(16).padStart(2, "0")}`,
      payload: packet.payload.toString("hex"),
    }));
  }
  buffers.set(characteristic, combined.subarray(Math.max(consumed, combined.length - 1024)));
}
