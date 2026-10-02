import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { encodePulseSetRecord, encodePulseClearedRecord, encodeTalkAddedRecord, encodeTalkResolvedRecord, encodeTalkReopenedRecord, encodeTalkArchivedRecord, encodeAddedRecord, encodeHandoffAddedRecord, encodeHandoffAcknowledgedRecord, encodeHandoffArchivedRecord, loadKinEngine } from "./kin-engine.js";

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
  return (version, records, expectedStatus = 0, asOf = 0) => {
    const headerSize = version === 5 ? 20 : 12;
    const request = new Uint8Array(headerSize + records.reduce((size, row) => size + row.length, 0));
    request.set([75, 73, 78, 69, version, 0, 0, 0]);
    new DataView(request.buffer).setUint32(8, records.length, true);
    if (version === 5) new DataView(request.buffer).setBigInt64(12, BigInt(asOf), true);
    let offset = headerSize;
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
    apply(99, [], 3);
    assert.deepEqual(apply(2, []), expectedState(2));
    apply(1, [legacyRecord(4, 2)], 3);
    assert.deepEqual(apply(1, []), expectedState(1));
    assert.deepEqual(apply(2, [legacyRecord(1, 1)]), expectedState(2, 0));
  }
});

test("bridge decodes real v1 and v2 completed results as Today, not Need", async (context) => {
  const instantiate = WebAssembly.instantiate;
  let requestedVersion = 1;
  // The browser writes v5 only. A test transport shim requests v1 from the
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
            return applyLegacy(abi, pointer, length);
          },
        },
      },
    };
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  for (requestedVersion of [1, 2]) {
    assert.deepEqual(engine.applyEvents([], 0), { items: [], handoffs: [], talks: [], pulses: [] });
    for (const completed of [false, true]) {
      const records = [legacyRecord(1, 1)];
      if (completed) records.push(legacyRecord(2, 2));
      assert.deepEqual(engine.applyEvents(records, 0).items, [{
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

function handoff(sequence, kind = 5, text = "Dishwasher running") {
  const identity = { eventId: new Uint8Array(16).fill(sequence), householdId: new Uint8Array(16).fill(0xaa),
    actorId: new Uint8Array(16).fill(0xbb), deviceId: new Uint8Array(16).fill(0xcc),
    timestamp: sequence, logicalTime: sequence, handoffId: new Uint8Array(16).fill(0x22), text };
  return (kind === 5 ? encodeHandoffAddedRecord : kind === 6 ? encodeHandoffAcknowledgedRecord : encodeHandoffArchivedRecord)(identity);
}

test("protocol v3 mixed replay preserves legacy bytes and Handoff lifecycle", async () => {
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  const legacy = legacyRecord(1, 1);
  const snapshot = legacy.slice();
  const records = [legacy, handoff(2)];
  const state = engine.applyEvents(records, 0);
  assert.equal(state.items[0].classification, "today");
  assert.equal(state.handoffs[0].status, "unacknowledged");
  assert.equal(state.handoffs[0].createdBy, "bb".repeat(16));
  assert.equal(state.handoffs[0].createdAt, 2);
  records.push(handoff(3, 6));
  assert.equal(engine.applyEvents(records, 0).handoffs[0].status, "acknowledged");
  records.push(handoff(4, 7));
  assert.equal(engine.applyEvents(records, 0).handoffs[0].status, "archived");
  assert.throws(() => engine.applyEvents([...records,handoff(5,6)], 0), error => error.code === 4);
  assert.deepEqual(legacy,snapshot);
  const apply = await rawEngine();
  for (const version of [1,2]) apply(version,[handoff(1)],3);
  assert.deepEqual(apply(3,[]),new Uint8Array([75,73,78,83,3,0,0,0,0,0,0,0,0,0,0,0]));
});

test("Handoff text encoder preserves Unicode and enforces byte bounds", () => {
  const text = "\uFEFF" + "🥛".repeat(1023) + "x";
  const record = handoff(1, 5, text);
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(record.subarray(108)), text);
  assert.equal(record.length, 108 + 4096);
  assert.throws(() => handoff(1, 5, text + "x"), /4096/);
  assert.throws(() => handoff(1, 5, "\uD800"), /valid Unicode/);
});

test("bridge rejects malformed Handoff result fields and recovers", async context => {
  const instantiate = WebAssembly.instantiate;
  let mutate = () => {};
  context.mock.method(WebAssembly, "instantiate", async (...args) => {
    const { instance } = await instantiate(...args);
    const abi = instance.exports;
    return { instance: { exports: { ...abi, kin_apply_events(pointer, length) {
      new DataView(abi.memory.buffer).setUint16(pointer + 4, 3, true);
      const status = applyLegacy(abi, pointer, length);
      if (status === 0) mutate(new Uint8Array(abi.memory.buffer, abi.kin_result_ptr(), abi.kin_result_len()));
      return status;
    } } } };
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  for (const mutation of [
    bytes => bytes[56] = 3,
    ...[57,58,59].map(offset => bytes => bytes[offset] = 1),
    bytes => new DataView(bytes.buffer,bytes.byteOffset).setUint32(60,0,true),
    bytes => new DataView(bytes.buffer,bytes.byteOffset).setUint32(60,0xffffffff,true),
    bytes => new DataView(bytes.buffer,bytes.byteOffset).setUint32(12,10001,true),
    bytes => bytes[64] = 255,
    bytes => new DataView(bytes.buffer,bytes.byteOffset).setBigInt64(48,1n<<62n,true),
  ]) {
    mutate = mutation;
    assert.throws(() => engine.applyEvents([handoff(1)], 0), error => error.code === 6);
    mutate = () => {};
    assert.equal(engine.applyEvents([handoff(1)], 0).handoffs[0].text, "Dishwasher running");
  }
});

test("bridge fails closed at every truncated Handoff result boundary", async context => {
  const instantiate = WebAssembly.instantiate;
  let resultLength;
  context.mock.method(WebAssembly, "instantiate", async (...args) => {
    const { instance } = await instantiate(...args);
    const abi = instance.exports;
    return { instance: { exports: { ...abi,
      kin_apply_events(pointer,length) {
        new DataView(abi.memory.buffer).setUint16(pointer+4,3,true);
        return applyLegacy(abi, pointer,length);
      }, kin_result_len: () => resultLength ?? abi.kin_result_len() } } };
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  for (resultLength = 0; resultLength < 16+48+18; resultLength++) {
    assert.throws(() => engine.applyEvents([handoff(1)], 0), error => error.code === 6);
  }
  resultLength = 16+48+18+1;
  assert.throws(() => engine.applyEvents([handoff(1)], 0), error => error.code === 6);
  resultLength = undefined;
  assert.equal(engine.applyEvents([handoff(1)], 0).handoffs.length,1);
});

test("large Handoff replay grows WASM memory and preserves independent repeated results", async context => {
  const instantiate = WebAssembly.instantiate;
  let memory;
  context.mock.method(WebAssembly,"instantiate",async(...args)=>{
    const result=await instantiate(...args); memory=result.instance.exports.memory; return result;
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  const initial = memory.buffer.byteLength;
  const id = number => { const bytes=new Uint8Array(16); new DataView(bytes.buffer).setUint32(0,number,true); return bytes; };
  const records=Array.from({length:10000},(_,index)=>encodeHandoffAddedRecord({
    eventId:id(index+1), handoffId:id(index+1), householdId:zeroId, actorId:zeroId, deviceId:zeroId,
    timestamp:index,logicalTime:index+1,text:index<1000 ? "x".repeat(4096) : "x",
  }));
  const state=engine.applyEvents(records, 0);
  assert.ok(memory.buffer.byteLength>initial,"real memory growth occurred");
  assert.equal(state.handoffs.length,10000);
  assert.equal(state.handoffs[999].text.length,4096);
  for(let iteration=0;iteration<4;iteration++) {
    const bad=handoff(1);new DataView(bad.buffer).setUint16(2,99,true);
    assert.throws(()=>engine.applyEvents([bad], 0),error=>error.code===3);
    assert.deepEqual(engine.applyEvents([], 0),{items:[],handoffs:[],talks:[],pulses:[]});
    assert.deepEqual(engine.applyEvents(records, 0),state);
  }
  assert.equal(state.handoffs[0].text.length,4096,"host-owned result survives later calls");
  assert.throws(()=>engine.applyEvents([...records,records[0]], 0),error=>error.code===5);
});

function talk(sequence, kind = 8, text = "Weekend plans") {
  const values = {eventId:new Uint8Array(16).fill(sequence),householdId:new Uint8Array(16).fill(0xaa),
    actorId:new Uint8Array(16).fill(0xbb),deviceId:new Uint8Array(16).fill(0xcc),
    timestamp:sequence,logicalTime:sequence,talkId:new Uint8Array(16).fill(0x33),text};
  return ({8:encodeTalkAddedRecord,9:encodeTalkResolvedRecord,10:encodeTalkReopenedRecord,11:encodeTalkArchivedRecord})[kind](values);
}

test("Talk real WASM mixed replay, lifecycle and legacy compatibility", async () => {
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  const records = [legacyRecord(1,1),handoff(2),talk(3)];
  const originals = records.map(row=>row.slice());
  assert.equal(engine.applyEvents(records, 0).talks[0].status,"open");
  for (const [kind,status] of [[9,"resolved"],[10,"open"],[11,"archived"]]) {
    records.push(talk(records.length+1,kind));
    const state=engine.applyEvents(records, 0);
    assert.equal(state.talks[0].status,status);
    assert.equal(state.items.length,1);assert.equal(state.handoffs.length,1);
  }
  assert.deepEqual(records.slice(0,3),originals);
  assert.throws(()=>engine.applyEvents([...records,talk(7,10)], 0),error=>error.code===4);
  const apply=await rawEngine();
  for (const version of [1,2,3]) for (const kind of [8,9,10,11]) apply(version,[talk(1,kind)],3);
  assert.deepEqual(apply(4,[]),new Uint8Array([75,73,78,83,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]));
});

test("Talk payload codes, schemas, Unicode and byte limits", () => {
  const text="\uFEFF"+"\u{1f95b}".repeat(1023)+"x";
  for (const kind of [8,9,10,11]) {
    const row=talk(1,kind,text),view=new DataView(row.buffer);
    assert.equal(view.getUint16(0,true),1);assert.equal(view.getUint16(2,true),kind);
    assert.equal(row.length,kind===8?108+4096:104);
  }
  assert.throws(()=>talk(1,8,text+"x"),/4096/);
  assert.throws(()=>talk(1,8,"\uD800"),/valid Unicode/);
});

test("v4 rejects malformed Talk records, headers and combined counts", async context => {
  const instantiate=WebAssembly.instantiate;let mutate=()=>{};
  context.mock.method(WebAssembly,"instantiate",async (...args)=>{
    const {instance}=await instantiate(...args);const abi=instance.exports;
    return {instance:{exports:{...abi,kin_apply_events(pointer,length){
      new DataView(abi.memory.buffer).setUint16(pointer+4,4,true);
      const status=applyLegacy(abi, pointer,length);
      if(status===0)mutate(new Uint8Array(abi.memory.buffer,abi.kin_result_ptr(),abi.kin_result_len()));
      return status;
    }}}};
  });
  const wasm=await readFile(new URL("./kin_engine.wasm",import.meta.url));
  const engine=await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  const mutations=[bytes=>bytes[0]=0,bytes=>bytes[4]=99,bytes=>bytes[6]=1,bytes=>bytes[7]=1,
    bytes=>bytes[60]=3,...[61,62,63].map(offset=>bytes=>bytes[offset]=1),bytes=>bytes[68]=255,
    bytes=>new DataView(bytes.buffer,bytes.byteOffset).setBigInt64(52,2n**60n,true),
    ...[0,4097,0xffffffff].map(length=>bytes=>new DataView(bytes.buffer,bytes.byteOffset).setUint32(64,length,true)),
    ...[8,12,16].map(offset=>bytes=>new DataView(bytes.buffer,bytes.byteOffset).setUint32(offset,0xffffffff,true)),
    bytes=>{const v=new DataView(bytes.buffer,bytes.byteOffset);v.setUint32(8,3333,true);v.setUint32(12,3333,true);v.setUint32(16,3335,true);}];
  for(mutate of mutations) assert.throws(()=>engine.applyEvents([talk(1)], 0),error=>error.code===6);
  mutate=()=>{};assert.equal(engine.applyEvents([talk(1)], 0).talks[0].text,"Weekend plans");
});

test("exact pre-Talk event writer bytes and v3 result remain unchanged",async()=>{
  const old=legacyRecord(1,1);
  const identity={eventId:new Uint8Array(16).fill(1),householdId:new Uint8Array(16).fill(0xaa),
    actorId:new Uint8Array(16).fill(0xbb),deviceId:new Uint8Array(16).fill(0xcc),timestamp:1,logicalTime:1};
  const expected=new Uint8Array(116);expected.set(old.subarray(0,88));expected[0]=2;expected[84]=28;
  expected.fill(0x11,88,104);expected[104]=1;expected[108]=4;expected.set([77,105,108,107],112);
  assert.deepEqual(encodeAddedRecord({...identity,itemId:new Uint8Array(16).fill(0x11),text:"Milk"}),expected);
  for(const kind of [5,6,7]) {
    const fixture=legacyRecord(kind===5?1:2,1);fixture[2]=kind;fixture.fill(0x22,88,104);
    assert.deepEqual(handoff(1,kind,"Milk"),fixture);
  }
  const apply=await rawEngine();
  const expectedV3=new Uint8Array(68);expectedV3.set([75,73,78,83,3,0,0,0,0,0,0,0,1,0,0,0]);
  expectedV3.fill(0x22,16,32);expectedV3.fill(0xbb,32,48);expectedV3[48]=1;expectedV3[60]=4;expectedV3.set([77,105,108,107],64);
  assert.deepEqual(apply(3,[handoff(1,5,"Milk")]),expectedV3);
});

test("bridge fails closed at every truncated Talk result boundary", async context => {
  const instantiate = WebAssembly.instantiate;
  let resultLength;
  context.mock.method(WebAssembly, "instantiate", async (...args) => {
    const { instance } = await instantiate(...args);
    const abi = instance.exports;
    return { instance: { exports: { ...abi,
      kin_apply_events(pointer,length) {
        new DataView(abi.memory.buffer).setUint16(pointer+4,4,true);
        return applyLegacy(abi, pointer,length);
      }, kin_result_len: () => resultLength ?? abi.kin_result_len() } } };
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  for (resultLength = 0; resultLength < 20+48+13; resultLength++) {
    assert.throws(() => engine.applyEvents([talk(1)], 0), error => error.code === 6);
  }
  resultLength = 20+48+13+1;
  assert.throws(() => engine.applyEvents([talk(1)], 0), error => error.code === 6);
  resultLength = undefined;
  assert.equal(engine.applyEvents([talk(1)], 0).talks.length,1);
});

test("large Talk replay grows WASM memory and preserves independent repeated results", async context => {
  const instantiate = WebAssembly.instantiate;
  let memory;
  context.mock.method(WebAssembly,"instantiate",async(...args)=>{
    const result=await instantiate(...args); memory=result.instance.exports.memory; return result;
  });
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  const engine = await loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
  const initial = memory.buffer.byteLength;
  const id = number => { const bytes=new Uint8Array(16); new DataView(bytes.buffer).setUint32(0,number,true); return bytes; };
  const records=Array.from({length:10000},(_,index)=>encodeTalkAddedRecord({
    eventId:id(index+1), talkId:id(index+1), householdId:zeroId, actorId:zeroId, deviceId:zeroId,
    timestamp:index,logicalTime:index+1,text:index<1000 ? "x".repeat(4096) : "x",
  }));
  const state=engine.applyEvents(records, 0);
  assert.ok(memory.buffer.byteLength>initial,"real memory growth occurred");
  assert.equal(state.talks.length,10000);
  assert.equal(state.talks[999].text.length,4096);
  for(let iteration=0;iteration<4;iteration++) {
    const bad=talk(1);new DataView(bad.buffer).setUint16(2,99,true);
    assert.throws(()=>engine.applyEvents([bad], 0),error=>error.code===3);
    assert.deepEqual(engine.applyEvents([], 0),{items:[],handoffs:[],talks:[],pulses:[]});
    assert.deepEqual(engine.applyEvents(records, 0),state);
  }
  assert.equal(state.talks[0].text.length,4096,"host-owned result survives later calls");
  assert.throws(()=>engine.applyEvents([...records,records[0]], 0),error=>error.code===5);
});

// Strip only the new explicit-time field when exercising unchanged legacy decoders.
function applyLegacy(abi, pointer, length) {
  const bytes = new Uint8Array(abi.memory.buffer, pointer, length);
  bytes.copyWithin(12, 20);
  return abi.kin_apply_events(pointer, length - 8);
}

function pulseRecord(sequence, value = "drained", expiresAt = 2000, actor = 0xbb) {
  const identity = { eventId: new Uint8Array(16).fill(sequence), householdId: new Uint8Array(16).fill(0xaa),
    actorId: new Uint8Array(16).fill(actor), deviceId: new Uint8Array(16).fill(0xcc), timestamp: 1000, logicalTime: sequence };
  return value === null ? encodePulseClearedRecord(identity) : encodePulseSetRecord({ ...identity, value, expiresAt });
}

async function pulseEngine() {
  const wasm = await readFile(new URL("./kin_engine.wasm", import.meta.url));
  return loadKinEngine(`data:application/wasm;base64,${wasm.toString("base64")}`);
}

test("Pulse real WASM explicit-time boundary, replacement, actors and clear", async () => {
  const engine = await pulseEngine();
  const records = [pulseRecord(1)];
  for (const time of [1999,2000,2001,1000]) {
    assert.equal(engine.applyEvents(records,time).pulses[0].status,time<2000?"active":"expired");
  }
  records.push(pulseRecord(2,"good",3000,0xaa),pulseRecord(3,"need-quiet",4000));
  assert.deepEqual(engine.applyEvents(records,2000).pulses.map(p=>p.value),["good","need-quiet"]);
  records.push(pulseRecord(4,null),pulseRecord(5,null));
  assert.equal(engine.applyEvents(records,2000).pulses.length,1);
  records.push(pulseRecord(6,"okay",5000));
  assert.equal(engine.applyEvents(records,2000).pulses[1].value,"okay");
  assert.throws(()=>engine.applyEvents(records),error=>error.code===2);
  for(const time of [NaN,Infinity,0.5,8640000000000001]) assert.throws(()=>engine.applyEvents(records,time),error=>error.code===2);
});

test("Pulse encoding is fixed and legacy protocols reject both kinds",async()=>{
  const set=pulseRecord(1,"need-quiet");
  assert.equal(set.length,104);assert.deepEqual([...set.subarray(88,96)],[4,0,0,0,0,0,0,0]);
  assert.equal(new DataView(set.buffer).getBigInt64(96,true),2000n);
  const clear=pulseRecord(2,null);assert.equal(clear.length,88);assert.equal(clear[2],13);
  const apply=await rawEngine();
  for(const version of [1,2,3,4]) for(const row of [set,clear]) apply(version,[row],3);
  assert.throws(()=>pulseRecord(1,"custom"),error=>error.code===2);
});


test("v5 exact request/result time fields and immutable v4 Talk bytes",async()=>{
  const apply=await rawEngine();
  const expected=new Uint8Array(64);expected.set([75,73,78,83,5,0,0,0]);expected[20]=1;
  expected.fill(0xbb,24,40);const view=new DataView(expected.buffer);
  view.setBigInt64(40,1000n,true);view.setBigInt64(48,2000n,true);expected[56]=2;
  assert.deepEqual(apply(5,[pulseRecord(1)],0,1999),expected);
  expected[57]=1;assert.deepEqual(apply(5,[pulseRecord(1)],0,2000),expected);
  const v4=apply(4,[talk(1)]),v5=apply(5,[talk(1)],0,2000);
  assert.deepEqual(v5.subarray(24),v4.subarray(20));
  for(const time of [-(2n**63n),8640000000000001n,2n**63n-1n])apply(5,[],2,time);
});

test("v5 bridge rejects malformed Pulse fields and combined counts then recovers",async context=>{
  const instantiate=WebAssembly.instantiate;let mutate=()=>{};
  context.mock.method(WebAssembly,"instantiate",async(...args)=>{
    const {instance}=await instantiate(...args),abi=instance.exports;
    return {instance:{exports:{...abi,kin_apply_events(pointer,length){
      const status=abi.kin_apply_events(pointer,length);
      if(status===0)mutate(new Uint8Array(abi.memory.buffer,abi.kin_result_ptr(),abi.kin_result_len()));
      return status;
    }}}};
  });
  const engine=await pulseEngine();
  const mutations=[bytes=>bytes[0]=0,bytes=>bytes[4]=6,bytes=>bytes[6]=1,bytes=>bytes[7]=1,
    bytes=>bytes[56]=5,bytes=>bytes[57]=2,...[58,59,60,61,62,63].map(i=>bytes=>bytes[i]=1),
    ...[40,48].map(i=>bytes=>new DataView(bytes.buffer,bytes.byteOffset).setBigInt64(i,8640000000000001n,true)),
    bytes=>new DataView(bytes.buffer,bytes.byteOffset).setBigInt64(48,1000n,true),
    ...[8,12,16,20].map(i=>bytes=>new DataView(bytes.buffer,bytes.byteOffset).setUint32(i,0xffffffff,true)),
    bytes=>{const v=new DataView(bytes.buffer,bytes.byteOffset);for(const i of [8,12,16,20])v.setUint32(i,2501,true);}
  ];
  for(mutate of mutations)assert.throws(()=>engine.applyEvents([pulseRecord(1)],0),e=>e.code===6);
  mutate=()=>{};assert.equal(engine.applyEvents([pulseRecord(1)],0).pulses[0].value,"drained");
});

test("Pulse real WASM rejects malformed schema, payload, reserved and duration",async()=>{
  const apply=await rawEngine();
  for(const original of [pulseRecord(1),pulseRecord(1,null)]) {
    for(let length=0;length<=20;length++){
      if(length===original.length-88)continue;
      const bad=new Uint8Array(88+length);bad.set(original.subarray(0,bad.length));
      new DataView(bad.buffer).setUint32(84,length,true);apply(5,[bad],2);
    }
    for(const version of [0,2,65535]){const bad=original.slice();new DataView(bad.buffer).setUint16(0,version,true);apply(5,[bad],3);}
  }
  for(let offset=89;offset<96;offset++){const bad=pulseRecord(1);bad[offset]=1;apply(5,[bad],2);}
  for(const expiry of [999,1000])apply(5,[pulseRecord(1,"good",expiry)],4);
});
