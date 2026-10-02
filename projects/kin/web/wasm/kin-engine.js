const PROTOCOL_VERSION = 3;
const REQUEST_HEADER_BYTES = 12;
const EVENT_HEADER_BYTES = 88;
const RESULT_HEADER_BYTES = 12;
const ITEM_HEADER_BYTES = 48;
const MAX_EVENT_COUNT = 10_000;
const MAX_PROTOCOL_BYTES = 64 * 1024 * 1024;
const MAX_ITEM_TEXT_BYTES = 4096;
const textEncoder = new TextEncoder();
const strictTextDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export class KinEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KinEngineError";
    this.code = code;
  }
}

const USER_MESSAGES = new Map([
  [1, "Kin could not safely access its household engine. Try again."],
  [
    2,
    "Kin could not read that household event. Your saved information was not deleted.",
  ],
  [
    3,
    "Kin needs a compatible household engine. Your saved information was not deleted.",
  ],
  [4, "That household change is not valid. Review its current state and try again."],
  [
    5,
    "Kin has reached a supported storage limit. Your saved information was not deleted.",
  ],
  [
    6,
    "Kin could not complete that action. Your saved information was not deleted.",
  ],
]);

export async function loadKinEngine(
  wasmUrl = new URL("./kin_engine.wasm", import.meta.url),
) {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new KinEngineError(
      6,
      "Kin could not load its household engine. Check the local WASM build and try again.",
    );
  }
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;
  const requiredExports = [
    "memory",
    "kin_alloc",
    "kin_free",
    "kin_apply_events",
    "kin_result_ptr",
    "kin_result_len",
    "kin_error_ptr",
    "kin_error_len",
  ];
  if (
    requiredExports.some((name) => !(name in exports)) ||
    !(exports.memory instanceof WebAssembly.Memory)
  ) {
    throw new KinEngineError(6, "Kin loaded an incompatible household engine.");
  }

  return {
    applyEvents: (records) => applyEvents(exports, records),
  };
}

export function randomId() {
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  return id;
}

export function idFromHex(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{32}$/.test(value)) {
    throw new KinEngineError(4, "Kin received an invalid household reference.");
  }
  const id = new Uint8Array(16);
  for (let index = 0; index < id.length; index += 1) {
    id[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return id;
}

export function idToHex(value) {
  return [...asBytes(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function encodeAddedRecord({
  eventId,
  householdId,
  actorId,
  deviceId,
  timestamp,
  logicalTime,
  itemId,
  text,
  classification = "need",
}) {
  const textBytes = textEncoder.encode(text);
  const classificationCode =
    classification === "today" ? 0 : classification === "need" ? 1 : -1;
  if (classificationCode < 0) {
    throw new KinEngineError(2, "Choose a valid list.");
  }
  if (
    strictTextDecoder.decode(textBytes) !== text ||
    textBytes.length < 1 ||
    textBytes.length > MAX_ITEM_TEXT_BYTES
  ) {
    throw new KinEngineError(
      2,
      "Item text must be valid Unicode and no more than 4096 UTF-8 bytes.",
    );
  }
  const payload = new Uint8Array(24 + textBytes.length);
  payload.set(assertId(itemId), 0);
  payload[16] = classificationCode;
  new DataView(payload.buffer).setUint32(20, textBytes.length, true);
  payload.set(textBytes, 24);
  return encodeEventRecord({
    eventId,
    householdId,
    actorId,
    deviceId,
    timestamp,
    logicalTime,
    eventVersion: 2,
    kind: 1,
    payload,
  });
}

export function encodeCompletedRecord({
  eventId,
  householdId,
  actorId,
  deviceId,
  timestamp,
  logicalTime,
  itemId,
}) {
  return encodeEventRecord({
    eventId,
    householdId,
    actorId,
    deviceId,
    timestamp,
    logicalTime,
    eventVersion: 1,
    kind: 2,
    payload: assertId(itemId),
  });
}

export function encodeReopenedRecord({
  eventId,
  householdId,
  actorId,
  deviceId,
  timestamp,
  logicalTime,
  itemId,
}) {
  return encodeEventRecord({
    eventId,
    householdId,
    actorId,
    deviceId,
    timestamp,
    logicalTime,
    eventVersion: 1,
    kind: 3,
    payload: assertId(itemId),
  });
}

export function encodeArchivedRecord({
  eventId,
  householdId,
  actorId,
  deviceId,
  timestamp,
  logicalTime,
  itemId,
}) {
  return encodeEventRecord({
    eventId,
    householdId,
    actorId,
    deviceId,
    timestamp,
    logicalTime,
    eventVersion: 1,
    kind: 4,
    payload: assertId(itemId),
  });
}

export function encodeHandoffAddedRecord({ handoffId, text, ...identity }) {
  const textBytes = textEncoder.encode(text);
  if (strictTextDecoder.decode(textBytes) !== text || textBytes.length < 1 ||
      textBytes.length > MAX_ITEM_TEXT_BYTES) {
    throw new KinEngineError(2, "Handoff text must be valid Unicode and no more than 4096 UTF-8 bytes.");
  }
  const payload = new Uint8Array(20 + textBytes.length);
  payload.set(assertId(handoffId));
  new DataView(payload.buffer).setUint32(16, textBytes.length, true);
  payload.set(textBytes, 20);
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 5, payload });
}

export function encodeHandoffAcknowledgedRecord({ handoffId, ...identity }) {
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 6, payload: assertId(handoffId) });
}

export function encodeHandoffArchivedRecord({ handoffId, ...identity }) {
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 7, payload: assertId(handoffId) });
}

function encodeEventRecord({
  eventId,
  householdId,
  actorId,
  deviceId,
  timestamp,
  logicalTime,
  eventVersion,
  kind,
  payload,
}) {
  const record = new Uint8Array(EVENT_HEADER_BYTES + payload.length);
  const view = new DataView(record.buffer);
  view.setUint16(0, eventVersion, true);
  view.setUint16(2, kind, true);
  record.set(assertId(eventId), 4);
  record.set(assertId(householdId), 20);
  record.set(assertId(actorId), 36);
  record.set(assertId(deviceId), 52);
  view.setBigInt64(68, BigInt(timestamp), true);
  view.setBigUint64(76, BigInt(logicalTime), true);
  view.setUint32(84, payload.length, true);
  record.set(payload, EVENT_HEADER_BYTES);
  return record;
}

function applyEvents(exports, records) {
  if (records.length > MAX_EVENT_COUNT) {
    throw new KinEngineError(5, USER_MESSAGES.get(5));
  }
  const request = encodeRequest(records);
  const inputPointer = exports.kin_alloc(request.length);
  if (inputPointer === 0) {
    throw new KinEngineError(5, USER_MESSAGES.get(5));
  }

  let result;
  let operationError;
  try {
    new Uint8Array(exports.memory.buffer, inputPointer, request.length).set(
      request,
    );
    const status = exports.kin_apply_events(inputPointer, request.length);
    const output =
      status === 0
        ? copyWasmBytes(
            exports.memory,
            exports.kin_result_ptr(),
            exports.kin_result_len(),
          )
        : copyWasmBytes(
            exports.memory,
            exports.kin_error_ptr(),
            exports.kin_error_len(),
          );
    if (status !== 0) {
      throw decodeError(output, status);
    }
    result = decodeState(output);
  } catch (error) {
    operationError =
      error instanceof KinEngineError
        ? error
        : new KinEngineError(
            6,
            "Kin could not complete a household-engine operation.",
          );
  }

  const freeStatus = exports.kin_free(inputPointer, request.length);
  if (operationError) {
    throw operationError;
  }
  if (freeStatus !== 0) {
    throw new KinEngineError(1, USER_MESSAGES.get(1));
  }
  return result;
}

function encodeRequest(records) {
  let length = REQUEST_HEADER_BYTES;
  for (const record of records) {
    length += asBytes(record).length;
    if (!Number.isSafeInteger(length) || length > MAX_PROTOCOL_BYTES) {
      throw new KinEngineError(5, USER_MESSAGES.get(5));
    }
  }

  const bytes = new Uint8Array(length);
  bytes.set([0x4b, 0x49, 0x4e, 0x45]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, records.length, true);
  let offset = REQUEST_HEADER_BYTES;
  for (const record of records) {
    const eventBytes = asBytes(record);
    bytes.set(eventBytes, offset);
    offset += eventBytes.length;
  }
  return bytes;
}

function copyWasmBytes(memory, pointer, length) {
  const start = Number(pointer);
  const size = Number(length);
  const end = start + size;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(size) ||
    start <= 0 ||
    size <= 0 ||
    end > memory.buffer.byteLength
  ) {
    throw new KinEngineError(
      6,
      "Kin received an invalid buffer from its household engine.",
    );
  }
  return new Uint8Array(memory.buffer, start, size).slice();
}

function decodeError(bytes, status) {
  if (
    bytes.length < REQUEST_HEADER_BYTES ||
    readAscii(bytes, 0, 4) !== "KERR"
  ) {
    return new KinEngineError(
      status,
      USER_MESSAGES.get(status) ?? USER_MESSAGES.get(6),
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  const code = view.getUint16(6, true);
  const messageLength = view.getUint32(8, true);
  if (
    ![1, 2, PROTOCOL_VERSION].includes(version) ||
    code !== status ||
    bytes.length !== REQUEST_HEADER_BYTES + messageLength
  ) {
    return new KinEngineError(
      status,
      USER_MESSAGES.get(status) ?? USER_MESSAGES.get(6),
    );
  }
  return new KinEngineError(
    status,
    USER_MESSAGES.get(code) ?? USER_MESSAGES.get(6),
  );
}

function decodeState(bytes) {
  if (
    bytes.length < RESULT_HEADER_BYTES ||
    bytes.length > MAX_PROTOCOL_BYTES ||
    readAscii(bytes, 0, 4) !== "KINS"
  ) {
    throw new KinEngineError(
      6,
      "Kin received an invalid state from its household engine.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const protocolVersion = view.getUint16(4, true);
  if (
    ![1, 2, PROTOCOL_VERSION].includes(protocolVersion) ||
    view.getUint16(6, true) !== 0
  ) {
    throw new KinEngineError(6, "Kin received an unsupported state format.");
  }
  if (protocolVersion === 3 && bytes.length < 16) {
    throw new KinEngineError(6, "Kin received a truncated state header.");
  }
  const handoffCount = protocolVersion === 3 ? view.getUint32(12, true) : 0;
  const itemCount = view.getUint32(8, true);
  if (itemCount + handoffCount > MAX_EVENT_COUNT) {
    throw new KinEngineError(
      6,
      "Kin received too many items from its household engine.",
    );
  }
  const items = [];
  let offset = protocolVersion === 3 ? 16 : RESULT_HEADER_BYTES;
  for (let index = 0; index < itemCount; index += 1) {
    const headerEnd = offset + ITEM_HEADER_BYTES;
    if (headerEnd > bytes.length) {
      throw new KinEngineError(
        6,
        "Kin received a truncated state from its household engine.",
      );
    }
    const textLength = view.getUint32(offset + 44, true);
    const recordEnd = headerEnd + textLength;
    const classificationCode = view.getUint8(offset + 40);
    const statusCode =
      protocolVersion === 1 ? classificationCode : view.getUint8(offset + 41);
    const validStatus =
      protocolVersion === 1
        ? classificationCode <= 1 &&
          view.getUint8(offset + 41) === 0 &&
          view.getUint8(offset + 42) === 0 &&
          view.getUint8(offset + 43) === 0
        : classificationCode <= 1 &&
          statusCode <= 2 &&
          view.getUint8(offset + 42) === 0 &&
          view.getUint8(offset + 43) === 0;
    if (recordEnd > bytes.length || textLength < 1 || textLength > MAX_ITEM_TEXT_BYTES || !validStatus) {
      throw new KinEngineError(
        6,
        "Kin received an invalid item record from its household engine.",
      );
    }
    const createdAt = view.getBigInt64(offset + 32, true);
    const createdAtNumber = Number(createdAt);
    if (!Number.isSafeInteger(createdAtNumber)) {
      throw new KinEngineError(
        6,
        "Kin received an invalid item timestamp from its household engine.",
      );
    }
    let text;
    try {
      text = strictTextDecoder.decode(bytes.subarray(headerEnd, recordEnd));
    } catch {
      throw new KinEngineError(
        6,
        "Kin received invalid item text from its household engine.",
      );
    }
    items.push({
      itemId: idToHex(bytes.subarray(offset, offset + 16)),
      createdBy: idToHex(bytes.subarray(offset + 16, offset + 32)),
      createdAt: createdAtNumber,
      classification:
        protocolVersion === 1 || classificationCode === 0 ? "today" : "need",
      status: ["active", "completed", "archived"][statusCode],
      text,
    });
    offset = recordEnd;
  }
  const handoffs = [];
  for (let index = 0; index < handoffCount; index += 1) {
    const headerEnd = offset + 48;
    if (headerEnd > bytes.length) throw new KinEngineError(6, "Kin received a truncated handoff record.");
    const textLength = view.getUint32(offset + 44, true);
    const end = headerEnd + textLength;
    const status = bytes[offset + 40];
    const createdAt = Number(view.getBigInt64(offset + 32, true));
    if (end > bytes.length || textLength < 1 || textLength > MAX_ITEM_TEXT_BYTES ||
        status > 2 || bytes.slice(offset + 41, offset + 44).some(value => value !== 0) ||
        !Number.isSafeInteger(createdAt)) {
      throw new KinEngineError(6, "Kin received an invalid handoff record.");
    }
    let text;
    try { text = strictTextDecoder.decode(bytes.subarray(headerEnd, end)); }
    catch { throw new KinEngineError(6, "Kin received invalid handoff text."); }
    handoffs.push({
      handoffId: idToHex(bytes.subarray(offset, offset + 16)),
      createdBy: idToHex(bytes.subarray(offset + 16, offset + 32)),
      createdAt, text, status: ["unacknowledged", "acknowledged", "archived"][status],
    });
    offset = end;
  }
  if (offset !== bytes.length) {
    throw new KinEngineError(
      6,
      "Kin received trailing bytes from its household engine.",
    );
  }
  return { items, handoffs };
}

function assertId(value) {
  const bytes = asBytes(value);
  if (bytes.length !== 16) {
    throw new KinEngineError(
      4,
      "Kin received an invalid household identifier.",
    );
  }
  return bytes;
}

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new KinEngineError(2, "Kin could not read a stored event record.");
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
