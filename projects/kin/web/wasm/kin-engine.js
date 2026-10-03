const PROTOCOL_VERSION = 7;
const REQUEST_HEADER_BYTES = 44;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const PULSE_VALUES = ["good", "okay", "drained", "rough-day", "need-quiet"];
const EVENT_HEADER_BYTES = 88;
const RESULT_HEADER_BYTES = 12;
const ITEM_HEADER_BYTES = 48;
const MAX_EVENT_COUNT = 10_000;
const MAX_PROTOCOL_BYTES = 64 * 1024 * 1024;
const MAX_ITEM_TEXT_BYTES = 4096;
const MAX_SUMMARY_ENTRIES = 8;
const SUMMARY_KINDS = [
  "",
  "item-added",
  "item-completed",
  "item-reopened",
  "item-archived",
  "handoff-added",
  "handoff-acknowledged",
  "handoff-archived",
  "talk-added",
  "talk-resolved",
  "talk-reopened",
  "talk-archived",
  "routine-created",
  "routine-occurrence-completed",
  "routine-occurrence-reopened",
  "routine-archived",
];
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
  [
    4,
    "That household change is not valid. Review its current state and try again.",
  ],
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
    applyEvents: (records, asOf, cursorEventId = null, civilDate) =>
      applyEvents(exports, records, asOf, cursorEventId, civilDate),
  };
}

export function randomId() {
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  return id;
}

// Wire validation only. Rust owns recurrence and current-period selection.
function assertCivilDate(value) {
  const year = Math.floor(value / 10000);
  const month = Math.floor(value / 100) % 100;
  const day = value % 100;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (!Number.isInteger(value) || year < 1 || year > 9999 ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new KinEngineError(2, "Kin requires a valid civil date.");
  }
}

export function encodeRoutineCreatedRecord({ routineId, text, cadence, createdOn, ...identity }) {
  assertCivilDate(createdOn);
  assertTimestamp(identity.timestamp);
  const code = ["daily", "weekly"].indexOf(cadence);
  const bytes = textEncoder.encode(text);
  if (code < 0 || bytes.length < 1 || bytes.length > 4096 || strictTextDecoder.decode(bytes) !== text) {
    throw new KinEngineError(2, "Choose a cadence and valid text up to 4096 UTF-8 bytes.");
  }
  const payload = new Uint8Array(28 + bytes.length);
  payload.set(assertId(routineId));
  payload[16] = code;
  const view = new DataView(payload.buffer);
  view.setUint32(20, createdOn, true);
  view.setUint32(24, bytes.length, true);
  payload.set(bytes, 28);
  return encodeEventRecord({ ...identity, kind: 14, eventVersion: 1, payload });
}

export function encodeRoutineActionRecord({ routineId, occurrenceKey, action, ...identity }) {
  assertTimestamp(identity.timestamp);
  const kind = { complete: 15, reopen: 16, archive: 17 }[action];
  if (!kind) throw new KinEngineError(2, "Kin received an invalid routine action.");
  const payload = new Uint8Array(kind === 17 ? 16 : 20);
  payload.set(assertId(routineId));
  if (kind !== 17) {
    assertCivilDate(occurrenceKey);
    new DataView(payload.buffer).setUint32(16, occurrenceKey, true);
  }
  return encodeEventRecord({ ...identity, kind, eventVersion: 1, payload });
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
  if (
    strictTextDecoder.decode(textBytes) !== text ||
    textBytes.length < 1 ||
    textBytes.length > MAX_ITEM_TEXT_BYTES
  ) {
    throw new KinEngineError(
      2,
      "Handoff text must be valid Unicode and no more than 4096 UTF-8 bytes.",
    );
  }
  const payload = new Uint8Array(20 + textBytes.length);
  payload.set(assertId(handoffId));
  new DataView(payload.buffer).setUint32(16, textBytes.length, true);
  payload.set(textBytes, 20);
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 5, payload });
}

export function encodeHandoffAcknowledgedRecord({ handoffId, ...identity }) {
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 6,
    payload: assertId(handoffId),
  });
}

export function encodeHandoffArchivedRecord({ handoffId, ...identity }) {
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 7,
    payload: assertId(handoffId),
  });
}

export function encodeTalkAddedRecord({ talkId, text, ...identity }) {
  const textBytes = textEncoder.encode(text);
  if (
    strictTextDecoder.decode(textBytes) !== text ||
    textBytes.length < 1 ||
    textBytes.length > MAX_ITEM_TEXT_BYTES
  ) {
    throw new KinEngineError(
      2,
      "Talk text must be valid Unicode and no more than 4096 UTF-8 bytes.",
    );
  }
  const payload = new Uint8Array(20 + textBytes.length);
  payload.set(assertId(talkId));
  new DataView(payload.buffer).setUint32(16, textBytes.length, true);
  payload.set(textBytes, 20);
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 8, payload });
}

export function encodeTalkResolvedRecord({ talkId, ...identity }) {
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 9,
    payload: assertId(talkId),
  });
}

export function encodeTalkArchivedRecord({ talkId, ...identity }) {
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 11,
    payload: assertId(talkId),
  });
}

export function encodeTalkReopenedRecord({ talkId, ...identity }) {
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 10,
    payload: assertId(talkId),
  });
}

export function encodePulseSetRecord({ value, expiresAt, ...identity }) {
  const code = PULSE_VALUES.indexOf(value);
  if (code < 0) throw new KinEngineError(2, "Choose a valid capacity.");
  assertTimestamp(identity.timestamp);
  assertTimestamp(expiresAt);
  const payload = new Uint8Array(16);
  payload[0] = code;
  new DataView(payload.buffer).setBigInt64(8, BigInt(expiresAt), true);
  return encodeEventRecord({ ...identity, eventVersion: 1, kind: 12, payload });
}

export function encodePulseClearedRecord(identity) {
  assertTimestamp(identity.timestamp);
  return encodeEventRecord({
    ...identity,
    eventVersion: 1,
    kind: 13,
    payload: new Uint8Array(0),
  });
}

function assertTimestamp(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_TIMESTAMP) {
    throw new KinEngineError(2, "Kin needs a valid evaluation time.");
  }
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

function applyEvents(exports, records, asOf, cursorEventId, civilDate) {
  if (records.length > MAX_EVENT_COUNT) {
    throw new KinEngineError(5, USER_MESSAGES.get(5));
  }
  const request = encodeRequest(records, asOf, cursorEventId, civilDate);
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

function encodeRequest(records, asOf, cursorEventId, civilDate) {
  assertTimestamp(asOf);
  assertCivilDate(civilDate);
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
  view.setBigInt64(12, BigInt(asOf), true);
  if (cursorEventId !== null) {
    const cursor =
      typeof cursorEventId === "string"
        ? idFromHex(cursorEventId)
        : assertId(cursorEventId);
    bytes[20] = 1;
    bytes.set(cursor, 24);
  }
  view.setUint32(40, civilDate, true);
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
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "KERR") {
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
    ![1, 2, 3, 4, PROTOCOL_VERSION].includes(version) ||
    code !== status ||
    bytes.length !== 12 + messageLength
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
    ![1, 2, 3, 4, 5, 6, PROTOCOL_VERSION].includes(protocolVersion) ||
    view.getUint16(6, true) !== 0
  ) {
    throw new KinEngineError(6, "Kin received an unsupported state format.");
  }
  const resultHeaderBytes =
    protocolVersion === 7 ? 56 : protocolVersion >= 6
      ? 52
      : protocolVersion === 5
        ? 24
        : protocolVersion === 4
          ? 20
          : protocolVersion === 3
            ? 16
            : 12;
  if (bytes.length < resultHeaderBytes) {
    throw new KinEngineError(6, "Kin received a truncated state header.");
  }
  const handoffCount = protocolVersion >= 3 ? view.getUint32(12, true) : 0;
  const talkCount = protocolVersion >= 4 ? view.getUint32(16, true) : 0;
  const pulseCount = protocolVersion >= 5 ? view.getUint32(20, true) : 0;
  const itemCount = view.getUint32(8, true);
  const routineCount = protocolVersion === 7 ? view.getUint32(52, true) : 0;
  const summaryCount = protocolVersion >= 6 ? view.getUint32(24, true) : 0;
  const summaryTotalCount =
    protocolVersion >= 6 ? view.getUint32(28, true) : 0;
  const summaryThroughPresent = protocolVersion >= 6 ? view.getUint8(32) : 0;
  const summaryThroughBytes =
    protocolVersion >= 6 ? bytes.subarray(36, 52) : null;
  const summaryThroughEventId =
    protocolVersion >= 6 && summaryThroughPresent === 1
      ? idToHex(summaryThroughBytes)
      : null;
  if (
    protocolVersion >= 6 &&
    (summaryCount > MAX_SUMMARY_ENTRIES ||
      summaryCount > summaryTotalCount ||
      summaryTotalCount > MAX_EVENT_COUNT ||
      summaryThroughPresent > 1 ||
      (summaryTotalCount > 0 && summaryThroughPresent !== 1) ||
      (summaryCount > 0 && summaryThroughPresent !== 1) ||
      bytes.subarray(33, 36).some((byte) => byte !== 0) ||
      (summaryThroughPresent === 0 &&
        summaryThroughBytes.some((byte) => byte !== 0)))
  ) {
    throw new KinEngineError(6, "Kin received invalid summary metadata.");
  }
  if (itemCount + handoffCount + talkCount + pulseCount + routineCount > MAX_EVENT_COUNT) {
    throw new KinEngineError(
      6,
      "Kin received too many items from its household engine.",
    );
  }
  const items = [];
  let offset = resultHeaderBytes;
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
    if (
      recordEnd > bytes.length ||
      textLength < 1 ||
      textLength > MAX_ITEM_TEXT_BYTES ||
      !validStatus
    ) {
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
    if (headerEnd > bytes.length)
      throw new KinEngineError(6, "Kin received a truncated handoff record.");
    const textLength = view.getUint32(offset + 44, true);
    const end = headerEnd + textLength;
    const status = bytes[offset + 40];
    const createdAt = Number(view.getBigInt64(offset + 32, true));
    if (
      end > bytes.length ||
      textLength < 1 ||
      textLength > MAX_ITEM_TEXT_BYTES ||
      status > 2 ||
      bytes.slice(offset + 41, offset + 44).some((value) => value !== 0) ||
      !Number.isSafeInteger(createdAt)
    ) {
      throw new KinEngineError(6, "Kin received an invalid handoff record.");
    }
    let text;
    try {
      text = strictTextDecoder.decode(bytes.subarray(headerEnd, end));
    } catch {
      throw new KinEngineError(6, "Kin received invalid handoff text.");
    }
    handoffs.push({
      handoffId: idToHex(bytes.subarray(offset, offset + 16)),
      createdBy: idToHex(bytes.subarray(offset + 16, offset + 32)),
      createdAt,
      text,
      status: ["unacknowledged", "acknowledged", "archived"][status],
    });
    offset = end;
  }
  const talks = [];
  for (let index = 0; index < talkCount; index += 1) {
    const headerEnd = offset + 48;
    if (headerEnd > bytes.length)
      throw new KinEngineError(6, "Kin received a truncated talk record.");
    const textLength = view.getUint32(offset + 44, true);
    const end = headerEnd + textLength;
    const status = bytes[offset + 40];
    const createdAt = Number(view.getBigInt64(offset + 32, true));
    if (
      end > bytes.length ||
      textLength < 1 ||
      textLength > MAX_ITEM_TEXT_BYTES ||
      status > 2 ||
      bytes.slice(offset + 41, offset + 44).some((value) => value !== 0) ||
      !Number.isSafeInteger(createdAt)
    ) {
      throw new KinEngineError(6, "Kin received an invalid talk record.");
    }
    let text;
    try {
      text = strictTextDecoder.decode(bytes.subarray(headerEnd, end));
    } catch {
      throw new KinEngineError(6, "Kin received invalid talk text.");
    }
    talks.push({
      talkId: idToHex(bytes.subarray(offset, offset + 16)),
      createdBy: idToHex(bytes.subarray(offset + 16, offset + 32)),
      createdAt,
      text,
      status: ["open", "resolved", "archived"][status],
    });
    offset = end;
  }
  const pulses = [];
  let previousActor = null;
  for (let index = 0; index < pulseCount; index += 1) {
    if (offset + 40 > bytes.length)
      throw new KinEngineError(6, "Kin received a truncated pulse record.");
    const actorId = idToHex(bytes.subarray(offset, offset + 16));
    const setAt = Number(view.getBigInt64(offset + 16, true));
    const expiresAt = Number(view.getBigInt64(offset + 24, true));
    const value = bytes[offset + 32];
    const status = bytes[offset + 33];
    if (
      !Number.isSafeInteger(setAt) ||
      !Number.isSafeInteger(expiresAt) ||
      Math.abs(setAt) > MAX_TIMESTAMP ||
      Math.abs(expiresAt) > MAX_TIMESTAMP ||
      expiresAt <= setAt ||
      value > 4 ||
      status > 1 ||
      bytes.subarray(offset + 34, offset + 40).some((byte) => byte !== 0) ||
      (previousActor !== null && actorId <= previousActor)
    ) {
      throw new KinEngineError(6, "Kin received an invalid pulse record.");
    }
    pulses.push({
      actorId,
      setAt,
      expiresAt,
      value: PULSE_VALUES[value],
      status: ["active", "expired"][status],
    });
    previousActor = actorId;
    offset += 40;
  }
  const routines = [];
  const routineIds = new Set();
  for (let index = 0; index < routineCount; index += 1) {
    const headerEnd = offset + 56;
    if (headerEnd > bytes.length) throw new KinEngineError(6, "Kin received a truncated routine.");
    const length = view.getUint32(offset + 52, true);
    const end = headerEnd + length;
    const routineId = idToHex(bytes.subarray(offset, offset + 16));
    const createdAt = Number(view.getBigInt64(offset + 32, true));
    const createdOn = view.getUint32(offset + 40, true);
    const key = view.getUint32(offset + 44, true);
    const cadence = bytes[offset + 48], status = bytes[offset + 49], occurrence = bytes[offset + 50];
    if (length < 1 || length > 4096 || end > bytes.length || cadence > 1 || status > 1 || occurrence > 2 ||
        bytes[offset + 51] !== 0 || (key === 0) !== (occurrence === 0) || (status === 1 && occurrence !== 0) || routineIds.has(routineId)) {
      throw new KinEngineError(6, "Kin received an invalid routine.");
    }
    let text;
    try {
      assertTimestamp(createdAt);
      assertCivilDate(createdOn);
      if (key) assertCivilDate(key);
      // Validate wire combinations without calculating the household's current period.
      if (key && cadence === 0 && key < createdOn) throw new Error();
      if (key && cadence === 1) {
        const d = new Date(0);
        d.setUTCFullYear(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
        if (d.getUTCDay() !== 1) throw new Error();
        d.setUTCDate(d.getUTCDate() + 6);
        const endKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        if (endKey < createdOn) throw new Error();
      }
      text = strictTextDecoder.decode(bytes.subarray(headerEnd, end));
    } catch { throw new KinEngineError(6, "Kin received invalid routine fields."); }
    routineIds.add(routineId);
    routines.push({ routineId, createdBy: idToHex(bytes.subarray(offset + 16, offset + 32)), createdAt, createdOn,
      cadence: ["daily", "weekly"][cadence], status: ["active", "archived"][status],
      occurrenceKey: key || null, occurrenceStatus: ["unavailable", "open", "completed"][occurrence], text });
    offset = end;
  }
  const summaryEntries = [];
  const entityNames = ["", "item", "handoff", "talk", "routine"];
  for (let index = 0; index < summaryCount; index += 1) {
    const headerEnd = offset + 24;
    if (headerEnd > bytes.length) {
      throw new KinEngineError(6, "Kin received a truncated summary entry.");
    }
    const kindCode = bytes[offset + 16];
    const entityCode = bytes[offset + 17];
    const classificationCode = bytes[offset + 18];
    const textLength = view.getUint32(offset + 20, true);
    const end = headerEnd + textLength;
    const expectedEntity =
      kindCode >= 1 && kindCode <= 4
        ? 1
        : kindCode >= 5 && kindCode <= 7
          ? 2
          : kindCode >= 8 && kindCode <= 11
            ? 3
            : protocolVersion === 7 && kindCode >= 12 && kindCode <= 15 ? 4 : 0;
    const validClassification =
      kindCode === 1 ? classificationCode <= 1 : classificationCode === 255;
    if (
      end > bytes.length ||
      kindCode === 0 ||
      expectedEntity === 0 ||
      entityCode !== expectedEntity ||
      !validClassification ||
      bytes[offset + 19] !== 0 ||
      textLength < 1 ||
      textLength > MAX_ITEM_TEXT_BYTES
    ) {
      throw new KinEngineError(6, "Kin received an invalid summary entry.");
    }
    let text;
    try {
      text = strictTextDecoder.decode(bytes.subarray(headerEnd, end));
    } catch {
      throw new KinEngineError(6, "Kin received invalid summary text.");
    }
    summaryEntries.push({
      eventId: idToHex(bytes.subarray(offset, offset + 16)),
      kind: SUMMARY_KINDS[kindCode],
      entityKind: entityNames[entityCode],
      text,
      classification:
        classificationCode === 255
          ? null
          : classificationCode === 0
            ? "today"
            : "need",
    });
    offset = end;
  }
  if (offset !== bytes.length) {
    throw new KinEngineError(
      6,
      "Kin received trailing bytes from its household engine.",
    );
  }
  if (protocolVersion >= 6) {
    return {
      items,
      handoffs,
      talks,
      pulses,
      ...(protocolVersion === 7 ? { routines } : {}),
      summary: {
        entries: summaryEntries,
        totalCount: summaryTotalCount,
        throughEventId: summaryThroughEventId,
      },
    };
  }
  return { items, handoffs, talks, pulses };
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
