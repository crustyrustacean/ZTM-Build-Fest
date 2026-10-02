import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { encodeAddedRecord, loadKinEngine } from "./kin-engine.js";

const zeroId = new Uint8Array(16);

function encodeText(text) {
  return encodeAddedRecord({
    eventId: zeroId,
    householdId: zeroId,
    actorId: zeroId,
    deviceId: zeroId,
    timestamp: 1,
    logicalTime: 1,
    itemId: zeroId,
    text,
  });
}

test("leading BOM and Unicode are preserved in event text", () => {
  const text = "\uFEFFmilk 🥛";
  const record = encodeText(text);
  const textBytes = new TextEncoder().encode(text);

  assert.deepEqual(record.subarray(112), textBytes);
  assert.equal(
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(record.subarray(112)),
    text,
  );
  assert.equal(new DataView(record.buffer).getUint16(0, true), 2);
  assert.equal(record[104], 1);
});

test("unpaired surrogate input is rejected instead of silently replaced", () => {
  assert.throws(() => encodeText("\uD800"), /valid Unicode/);
});

test("item text is bounded by UTF-8 bytes rather than character count", () => {
  const maximum = "🥛".repeat(1024);
  const record = encodeText(maximum);

  assert.equal(record.length, 88 + 24 + 4096);
  assert.throws(() => encodeText(`${maximum}x`), /4096 UTF-8 bytes/);
});

test("invalid classification is rejected", () => {
  assert.throws(
    () =>
      encodeAddedRecord({
        eventId: zeroId,
        householdId: zeroId,
        actorId: zeroId,
        deviceId: zeroId,
        timestamp: 1,
        logicalTime: 1,
        itemId: zeroId,
        text: "Milk",
        classification: "later",
      }),
    /valid list/,
  );
});

// Independent v0.1 wire fixtures: do not use the current event writer to
// define the historical record layout that these compatibility tests protect.
function legacyRecord(kind, sequence) {
  const record = new Uint8Array(kind === 1 ? 112 : 104);
  const view = new DataView(record.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, kind, true);
  record.fill(sequence, 4, 20);
  record.fill(0xaa, 20, 36);
  record.fill(0xbb, 36, 52);
  record.fill(0xcc, 52, 68);
  view.setBigInt64(68, BigInt(sequence), true);
  view.setBigUint64(76, BigInt(sequence), true);
  view.setUint32(84, record.length - 88, true);
  record.fill(0x11, 88, 104);
  if (kind === 1) {
    view.setUint32(104, 4, true);
    record.set([77, 105, 108, 107], 108); // Milk
  }
  return record;
}

function expectedState(version, status = null, classification = 0) {
  const bytes = new Uint8Array(status === null ? 12 : 64);
  bytes.set([75, 73, 78, 83, version, 0, 0, 0, status === null ? 0 : 1, 0, 0, 0]);
  if (status !== null) {
    bytes.fill(0x11, 12, 28);
    bytes.fill(0xbb, 28, 44);
    bytes[44] = 1; // created_at:i64 little endian
    bytes[52] = version === 1 ? status : classification;
    bytes[53] = version === 1 ? 0 : status;
    bytes[56] = 4; // text_length:u32 little endian
    bytes.set([77, 105, 108, 107], 60);
  }
  return bytes;
}

async function rawEngine() {
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL("./kin_engine.wasm", import.meta.url)),
    {},
  );
  const abi = instance.exports;
  return (version, records, expectedStatus = 0) => {
    const request = new Uint8Array(12 + records.reduce((size, row) => size + row.length, 0));
    request.set([75, 73, 78, 69, version, 0, 0, 0]);
    new DataView(request.buffer).setUint32(8, records.length, true);
    let offset = 12;
    for (const record of records) {
      request.set(record, offset);
      offset += record.length;
    }
    const pointer = abi.kin_alloc(request.length);
    assert.notEqual(pointer, 0);
    try {
      new Uint8Array(abi.memory.buffer, pointer, request.length).set(request);
      assert.equal(abi.kin_apply_events(pointer, request.length), expectedStatus);
      const success = expectedStatus === 0;
      assert.equal(success ? abi.kin_error_ptr() : abi.kin_result_ptr(), 0);
      assert.equal(success ? abi.kin_error_len() : abi.kin_result_len(), 0);
      const result = new Uint8Array(
        abi.memory.buffer,
        success ? abi.kin_result_ptr() : abi.kin_error_ptr(),
        success ? abi.kin_result_len() : abi.kin_error_len(),
      ).slice();
      if (!success) {
        assert.deepEqual(result.subarray(0, 8), new Uint8Array([75, 69, 82, 82, 1, 0, expectedStatus, 0]));
        assert.equal(result.length, 12 + new DataView(result.buffer).getUint32(8, true));
      }
      return result;
    } finally {
      assert.equal(abi.kin_free(pointer, request.length), 0);
    }
  };
}

test("real WASM ABI preserves exact v1 empty, active and completed results", async () => {
  const apply = await rawEngine();
  assert.deepEqual(apply(1, []), expectedState(1));
  assert.deepEqual(apply(1, [legacyRecord(1, 1)]), expectedState(1, 0));
  assert.deepEqual(apply(1, [legacyRecord(1, 1), legacyRecord(2, 2)]), expectedState(1, 1));
});

test("real WASM ABI emits exact v2 classification and lifecycle layouts", async () => {
  const apply = await rawEngine();
  const legacy = legacyRecord(1, 1);
  const need = new Uint8Array(116);
  need.set(legacy.subarray(0, 104));
  const view = new DataView(need.buffer);
  view.setUint16(0, 2, true);
  view.setUint32(84, 28, true);
  need[104] = 1;
  view.setUint32(108, 4, true);
  need.set([77, 105, 108, 107], 112);
  assert.deepEqual(apply(2, []), expectedState(2));
  for (const [added, classification] of [[legacy, 0], [need, 1]]) {
    assert.deepEqual(apply(2, [added]), expectedState(2, 0, classification));
    assert.deepEqual(apply(2, [added, legacyRecord(2, 2)]), expectedState(2, 1, classification));
    assert.deepEqual(apply(2, [added, legacyRecord(4, 2)]), expectedState(2, 2, classification));
  }
  apply(1, [need], 3);
  apply(1, [legacy, legacyRecord(4, 2)], 3);
});

test("real WASM ABI clears stale result and error buffers across versions", async () => {
  const apply = await rawEngine();
  for (let iteration = 0; iteration < 8; iteration++) {
    assert.deepEqual(apply(1, [legacyRecord(1, 1), legacyRecord(2, 2)]), expectedState(1, 1));
    apply(3, [], 3);
    assert.deepEqual(apply(2, []), expectedState(2));
    apply(1, [legacyRecord(4, 2)], 3);
    assert.deepEqual(apply(1, []), expectedState(1));
    assert.deepEqual(apply(2, [legacyRecord(1, 1)]), expectedState(2, 0));
  }
});

test("bridge decodes real v1 and v2 completed results as Today, not Need", async (context) => {
  const instantiate = WebAssembly.instantiate;
  let requestedVersion = 1;
  // The browser writes v2 only. A test transport shim requests v1 from the
  // real encoder so the bridge's historical decoder is exercised as well.
  context.mock.method(WebAssembly, "instantiate", async (...args) => {
    const { instance } = await instantiate(...args);
    const abi = instance.exports;
    return {
      instance: {
        exports: {
          ...abi,
          kin_apply_events(pointer, length) {
            new DataView(abi.memory.buffer).setUint16(pointer + 4, requestedVersion, true);
            return abi.kin_apply_events(pointer, length);
          },
        },
      },
    };
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  for (requestedVersion of [1, 2]) {
    assert.deepEqual(engine.applyEvents([]), { items: [] });
    for (const completed of [false, true]) {
      const records = [legacyRecord(1, 1)];
      if (completed) records.push(legacyRecord(2, 2));
      assert.deepEqual(engine.applyEvents(records).items, [{
        itemId: "11".repeat(16),
        createdBy: "bb".repeat(16),
        createdAt: 1,
        classification: "today",
        status: completed ? "completed" : "active",
        text: "Milk",
      }]);
    }
  }
});
