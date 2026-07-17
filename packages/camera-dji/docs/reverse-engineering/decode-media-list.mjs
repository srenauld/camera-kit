#!/usr/bin/env node

import readline from "node:readline";

import { parseMediaEntries, reassembleMediaList } from "./protocol.mjs";

const transactions = new Map();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.direction !== "inbound" || message.commandSet !== 0 || message.command !== 0x27) {
    continue;
  }

  const payload = Buffer.from(message.payload, "hex");
  if (payload.length < 10 || payload[0] !== 0x4a || payload[1] !== 0x01) continue;
  const lengthAndFlags = payload.readUInt16LE(2);
  const transactionId = payload.readUInt16LE(4);
  const fragmentIndex = payload.readUInt32LE(6);
  const declaredLength = lengthAndFlags & 0x0fff;
  const isFinal = (lengthAndFlags & 0x1000) !== 0;
  const fragment = payload.subarray(10, declaredLength);
  if (payload.length !== declaredLength) {
    throw new Error(`Truncated transaction ${transactionId} fragment ${fragmentIndex}`);
  }

  const transaction = transactions.get(transactionId) ?? { fragments: new Map(), finalIndex: undefined };
  transaction.fragments.set(fragmentIndex, fragment);
  if (isFinal) transaction.finalIndex = fragmentIndex;
  transactions.set(transactionId, transaction);
}

for (const [transactionId, transaction] of transactions) {
  if (transaction.finalIndex === undefined) continue;
  const fragmentPayloads = [];
  for (let index = 0; index <= transaction.finalIndex; index += 1) {
    const fragment = transaction.fragments.get(index);
    if (!fragment) throw new Error(`Missing transaction ${transactionId} fragment ${index}`);
    const payload = Buffer.alloc(10 + fragment.length);
    payload[0] = 0x4a;
    payload[1] = 0x01;
    payload.writeUInt16LE(payload.length | (index === transaction.finalIndex ? 0x1000 : 0), 2);
    payload.writeUInt16LE(transactionId, 4);
    payload.writeUInt32LE(index, 6);
    fragment.copy(payload, 10);
    fragmentPayloads.push(payload);
  }
  const { body } = reassembleMediaList(fragmentPayloads);
  const recordOffsets = [];
  for (let offset = 0; offset + 16 < body.length; offset += 1) {
    const candidateIndex = body.readUInt32LE(offset + 2);
    if (
      body[offset] === 0x8a &&
      body[offset + 1] === 0x01 &&
      body.readUInt32LE(offset + 6) === (candidateIndex | 0x4000)
    ) {
      recordOffsets.push(offset);
    }
  }
  const records = recordOffsets.map((offset, index) => {
    const end = recordOffsets[index + 1] ?? body.length;
    return {
      offset,
      byteLength: end - offset,
      fileIndex: body.readUInt32LE(offset + 2),
      hex: body.subarray(offset, end).toString("hex"),
    };
  });
  const strings = [];
  for (let offset = 0; offset < body.length; ) {
    let end = offset;
    while (end < body.length && body[end] >= 0x20 && body[end] <= 0x7e) end += 1;
    if (end - offset >= 8) {
      strings.push({
        offset,
        value: body.subarray(offset, end).toString("ascii"),
        precedingHex: body.subarray(Math.max(0, offset - 16), offset).toString("hex"),
      });
    }
    offset = Math.max(end, offset + 1);
  }

  console.log(
    JSON.stringify(
      {
        transactionId,
        fragmentCount: transaction.finalIndex + 1,
        byteLength: body.length,
        firstBytes: body.subarray(0, 64).toString("hex"),
        listHeaderHex: body.subarray(0, recordOffsets[0]).toString("hex"),
        records: records.map(({ offset, byteLength, fileIndex }) => ({ offset, byteLength, fileIndex })),
        entries: parseMediaEntries(body),
        diagnostic: {
          firstRecordHex: records[0]?.hex,
          strings,
        },
      },
      null,
      2,
    ),
  );
}
