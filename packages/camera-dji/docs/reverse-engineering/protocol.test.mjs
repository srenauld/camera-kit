import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  acknowledgeWifiDatagram,
  createVideoAssembler,
  encodeDuml,
  encodeFirstWifiCommand,
  encodeWifiHandshake,
  makeMediaFragment,
  parseDuml,
  parseMediaEntries,
  parseVideoDatagram,
  parseWifiDatagram,
  reassembleMediaList,
  wifiHeaderChecksum,
} from "./protocol.mjs";

const hex = (value) => Buffer.from(value.replaceAll(/\s/g, ""), "hex");

test("DUML parses and re-encodes a captured start-record command", () => {
  const captured = hex("550e04660201aed4400202014f2f");
  const parsed = parseDuml(captured);
  assert.deepEqual(
    { ...parsed, payload: parsed.payload.toString("hex") },
    { sender: 2, receiver: 1, sequence: 0xd4ae, flags: 0x40, commandSet: 2, command: 2, payload: "01" },
  );
  assert.deepEqual(encodeDuml({ ...parsed, payload: parsed.payload }), captured);
});

test("DUML rejects damaged header and packet CRCs", () => {
  const captured = hex("550e04660201aed4400202014f2f");
  const badHeader = Buffer.from(captured);
  badHeader[3] ^= 1;
  assert.throws(() => parseDuml(badHeader), /CRC-8/);
  const badPacket = Buffer.from(captured);
  badPacket[11] ^= 1;
  assert.throws(() => parseDuml(badPacket), /CRC-16/);
});

test("fresh Wi-Fi handshake and first command match hardware-tested fixtures", () => {
  const handshake = encodeWifiHandshake(0xe98f);
  const expectedHandshake = hex(fs.readFileSync(new URL("fixtures/wifi-handshake-init.hex", import.meta.url), "utf8"));
  assert.deepEqual(handshake, expectedHandshake);
  assert.equal(handshake[7], wifiHeaderChecksum(handshake));

  const duml = encodeDuml({
    sender: 2,
    receiver: 1,
    sequence: 1,
    flags: 0x40,
    commandSet: 2,
    command: 0x8e,
    payload: [0, 1, 8, 0],
  });
  const command = encodeFirstWifiCommand({ session: 0xe98f, duml });
  const expectedCommand = hex(fs.readFileSync(new URL("fixtures/wifi-setting-query.hex", import.meta.url), "utf8"));
  assert.deepEqual(command, expectedCommand);
  const parsed = parseWifiDatagram(command);
  assert.equal(parsed.session, 0xe98f);
  assert.equal(parsed.channel, 5);
  assert.equal(parsed.duml.commandSet, 2);
  assert.equal(parsed.duml.command, 0x8e);
});

test("reliable camera data acknowledgement matches a paired capture", () => {
  const inbound = hex("2280e98f000001c5487f487f00000000487f487f00000000487f487f000000000000");
  const expected = hex("2280e98f000004c0487f487f00000000487f487f00000000487f507f000000000000");
  const acknowledgement = acknowledgeWifiDatagram(inbound, { transmitCursor: 0x7f50 });
  assert.deepEqual(acknowledgement, expected);
  assert.equal(acknowledgement[7], wifiHeaderChecksum(acknowledgement));
});

test("media-list reassembly accepts out-of-order fragments and rejects gaps", () => {
  const payloads = [
    makeMediaFragment({ transactionId: 7, index: 2, final: true, body: "three" }),
    makeMediaFragment({ transactionId: 7, index: 0, body: "one" }),
    makeMediaFragment({ transactionId: 7, index: 1, body: "two" }),
  ];
  assert.equal(reassembleMediaList(payloads).body.toString(), "onetwothree");
  assert.throws(() => reassembleMediaList([payloads[0], payloads[1]]), /Missing/);
  assert.throws(() => reassembleMediaList([payloads[1], payloads[1], payloads[0]]), /Duplicate/);
});

const typedPath = (type, value, padding = []) => {
  const text = Buffer.from(value, "ascii");
  const suffix = Buffer.from(padding);
  const result = Buffer.alloc(6 + text.length + suffix.length);
  result[0] = 0x1a;
  result.writeUInt32LE(text.length + suffix.length, 1);
  result[5] = type;
  text.copy(result, 6);
  suffix.copy(result, 6 + text.length);
  return result;
};

const mediaRecord = (index, filename, base) => {
  const marker = Buffer.alloc(10);
  marker[0] = 0x8a;
  marker[1] = 1;
  marker.writeUInt32LE(index, 2);
  marker.writeUInt32LE(index | 0x4000, 6);
  return Buffer.concat([
    marker,
    Buffer.from(filename, "ascii"),
    typedPath(1, `DCIM/DJI_001/${base}`, [0, 0x1b, 0x0a, 0, 0, 0]),
    typedPath(2, `MISC/THM/DJI_001/${base}`, [0, 0x1b, 0x0a, 0, 0, 0]),
  ]);
};

test("media entry decoder returns original, proxy, and thumbnail paths", () => {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(2);
  const body = Buffer.concat([
    count,
    mediaRecord(35, "DJI_20260718102718_0036_D.MP4", "DJI_20260718102718_0036_D"),
    mediaRecord(36, "DJI_20260718102719_0037_D.JPG", "DJI_20260718102719_0037_D"),
  ]);
  const entries = parseMediaEntries(body);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].originalPath, "DCIM/DJI_001/DJI_20260718102718_0036_D.MP4");
  assert.equal(entries[0].lowResolutionPath, "DCIM/DJI_001/DJI_20260718102718_0036_D.lrf");
  assert.equal(entries[1].mediaType, "photo");
  assert.equal(entries[1].lowResolutionPath, undefined);
});

const videoPacket = ({ session = 0x1234, sequence, start = false, bytes }) => {
  const metadata = start ? hex("000001ff000000000000000000000000") : Buffer.alloc(0);
  const packet = Buffer.alloc(20 + metadata.length + bytes.length);
  packet[0] = packet.length & 0xff;
  packet[1] = 0x80 | ((packet.length >>> 8) & 0x0f);
  packet.writeUInt16BE(session, 2);
  packet.writeUInt16LE(sequence, 4);
  packet[6] = 2;
  packet[7] = wifiHeaderChecksum(packet);
  metadata.copy(packet, 20);
  bytes.copy(packet, 20 + metadata.length);
  return packet;
};

test("video parser strips first-fragment metadata and assembler detects loss", () => {
  const first = videoPacket({ sequence: 0x1000, start: true, bytes: hex("0000000167aa") });
  const continuation = videoPacket({ sequence: 0x1008, bytes: hex("bbcc") });
  const next = videoPacket({ sequence: 0x1010, start: true, bytes: hex("0000000141dd") });
  assert.equal(parseVideoDatagram(first).startsAccessUnit, true);
  const assembler = createVideoAssembler();
  assert.equal(assembler.push(first).completed, undefined);
  assert.equal(assembler.push(continuation).lost, false);
  assert.equal(assembler.push(next).completed.toString("hex"), "0000000167aabbcc");

  const lossy = createVideoAssembler();
  lossy.push(first);
  assert.equal(lossy.push(videoPacket({ sequence: 0x1010, bytes: hex("ff") })).lost, true);
  assert.equal(lossy.flush(), undefined);
});

test("capability fixture maps all advertised modes without a default", () => {
  const capabilities = JSON.parse(
    fs.readFileSync(new URL("fixtures/camera-capabilities.json", import.meta.url), "utf8"),
  );
  assert.equal(capabilities.normalVideo.reduce((sum, mode) => sum + mode.fps.length, 0), 35);
  assert.equal(capabilities.slowMotion.length, 4);
  for (const mode of capabilities.normalVideo) {
    const key = `${mode.resolution}-${mode.aspectRatio}`;
    assert.equal(mode.resolutionEnum, capabilities.resolutionEnums[key]);
    for (const fps of mode.fps) assert.equal(Number.isInteger(capabilities.fpsEnums[fps]), true);
  }
  for (const mode of capabilities.slowMotion) {
    const payload = Buffer.from(mode.payloadHex, "hex");
    assert.equal(payload.length, 5);
    assert.equal(payload[0], capabilities.resolutionEnums[`${mode.resolution}-${mode.aspectRatio}`]);
    assert.equal(payload[1], capabilities.fpsEnums[mode.captureFps]);
    assert.equal(payload[2], 0);
    assert.equal(payload[3], mode.slowFactor);
    assert.equal(payload[4], 0);
  }
  assert.equal(capabilities.normalVideo.find((mode) => mode.resolution === "4K" && mode.aspectRatio === "4:3").fps.includes(60), false);
  assert.equal(capabilities.normalVideo.find((mode) => mode.resolution === "4K" && mode.aspectRatio === "16:9").fps.includes(60), true);
  assert.deepEqual(capabilities.slowMotion.map((mode) => mode.captureFps).sort((a, b) => a - b), [120, 120, 120, 240]);
  assert.equal("default" in capabilities, false);
});
