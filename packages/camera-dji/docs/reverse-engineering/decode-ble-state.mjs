#!/usr/bin/env node

// Decode the ATT/DUMl portion of an Android btsnoop HCI log.  This is kept
// deliberately offline: captures can include Bluetooth addresses and must not
// be checked in.  The output identifies raw DUML and the named 00/99 state
// records sent spontaneously by the camera.
import fs from "node:fs";
import { findDumlPackets } from "./protocol.mjs";

const source = process.argv[2];
if (!source) {
  console.error("usage: decode-ble-state.mjs <btsnoop_hci.log>");
  process.exit(2);
}

const bytes = fs.readFileSync(source);
if (bytes.subarray(0, 8).toString("ascii") !== "btsnoop\0") {
  throw new Error("Expected btsnoop HCI log");
}

const namedState = (payload) => {
  // 00/99 carries a compact key/value record.  The key is a NUL-terminated
  // printable string embedded in the payload; preserve the opaque tail rather
  // than pretending its integer layout is known.
  const match = /(?:cam|gimbal|battery|storage)_[a-z0-9_]+/.exec(payload.toString("latin1"));
  if (!match) return undefined;
  const name = match[0];
  const afterName = match.index + name.length;
  let valueOffset = afterName;
  while (valueOffset < payload.length && payload[valueOffset] === 0) valueOffset += 1;
  return { name, opaqueValue: payload.subarray(valueOffset).toString("hex") };
};

const partialL2cap = new Map();
const streams = new Map();
let position = 16;
let record = 0;
let event = 0;
while (position + 24 <= bytes.length) {
  const included = bytes.readUInt32BE(position + 4);
  const flags = bytes.readUInt32BE(position + 8);
  const packet = bytes.subarray(position + 24, position + 24 + included);
  position += 24 + included;
  record += 1;
  if (packet[0] !== 0x02 || packet.length < 5) continue;

  const handleAndFlags = packet.readUInt16LE(1);
  const handle = handleAndFlags & 0x0fff;
  const pb = (handleAndFlags >>> 12) & 0x3;
  const direction = flags & 1 ? "camera-to-tablet" : "tablet-to-camera";
  const key = `${direction}:${handle}`;
  let l2cap;
  const fragment = packet.subarray(5, 5 + packet.readUInt16LE(3));
  if (pb === 2) {
    if (fragment.length < 4) continue;
    const expected = fragment.readUInt16LE(0) + 4;
    partialL2cap.set(key, { expected, data: Buffer.from(fragment) });
  } else if (pb === 1) {
    const prior = partialL2cap.get(key);
    if (!prior) continue;
    prior.data = Buffer.concat([prior.data, fragment]);
  } else {
    continue;
  }
  const pending = partialL2cap.get(key);
  if (!pending || pending.data.length < pending.expected) continue;
  partialL2cap.delete(key);
  l2cap = pending.data.subarray(0, pending.expected);
  if (l2cap.readUInt16LE(2) !== 0x0004) continue;

  const att = l2cap.subarray(4);
  const opcode = att[0];
  if (opcode === 0x0a && att.length === 3) { // Read Request
    console.log(JSON.stringify({ event: ++event, hciRecord: record, direction,
      operation: "read-request", attribute: `0x${att.readUInt16LE(1).toString(16).padStart(4, "0")}` }));
    continue;
  }
  if (opcode === 0x0b) { // Read Response; ATT has no handle, retain it as such.
    console.log(JSON.stringify({ event: ++event, hciRecord: record, direction,
      operation: "read-response", value: att.subarray(1).toString("hex") }));
    continue;
  }
  if (opcode !== 0x1b && opcode !== 0x52) continue; // notification / write command
  if (att.length < 4) continue;
  const attribute = att.readUInt16LE(1);
  const value = att.subarray(3);
  const streamKey = `${direction}:${handle}:${attribute}`;
  const combined = Buffer.concat([streams.get(streamKey) ?? Buffer.alloc(0), value]);
  const packets = findDumlPackets(combined);
  let consumed = 0;
  for (const duml of packets) {
    consumed = Math.max(consumed, duml.offset + duml.raw.length);
    event += 1;
    const state = duml.commandSet === 0x00 && duml.command === 0x99 ? namedState(duml.payload) : undefined;
    console.log(JSON.stringify({
      event,
      hciRecord: record,
      direction,
      attribute: `0x${attribute.toString(16).padStart(4, "0")}`,
      sequence: `0x${duml.sequence.toString(16).padStart(4, "0")}`,
      commandSet: `0x${duml.commandSet.toString(16).padStart(2, "0")}`,
      command: `0x${duml.command.toString(16).padStart(2, "0")}`,
      payload: duml.payload.toString("hex"),
      ...(state ? { state } : {}),
    }));
  }
  // Keep a short suffix: a DUML start marker can be split across ATT packets.
  streams.set(streamKey, combined.subarray(Math.max(consumed, combined.length - 1024)));
}
