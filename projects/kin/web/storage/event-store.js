import {
  encodeAddedRecord,
  encodePulseSetRecord,
  encodePulseClearedRecord,
  idToHex,
  encodeTalkAddedRecord,
  encodeTalkResolvedRecord,
  encodeTalkReopenedRecord,
  encodeTalkArchivedRecord,
  encodeHandoffAddedRecord,
  encodeHandoffAcknowledgedRecord,
  encodeHandoffArchivedRecord,
  encodeArchivedRecord,
  encodeCompletedRecord,
  idFromHex,
  randomId,
  encodeReopenedRecord,
} from "../wasm/kin-engine.js";

const DATABASE_NAME = "kin";
const DATABASE_VERSION = 1;
const EVENT_STORE = "events";
const CONTEXT_STORE = "local_context";
const CONTEXT_KEY = "installation";
const MAX_EVENT_COUNT = 10_000;
const MAX_LOGICAL_TIME = (1n << 64n) - 1n;

export class EventStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "EventStoreError";
    this.userMessage = message;
    this.code = cause?.code;
  }
}

export class EventStore {
  constructor(database) {
    this.database = database;
  }

  static async open() {
    if (!globalThis.indexedDB) {
      throw new EventStoreError(
        "Kin could not access local household storage. Your information was not intentionally deleted.",
      );
    }

    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EVENT_STORE)) {
          const events = db.createObjectStore(EVENT_STORE, {
            keyPath: "local_sequence",
            autoIncrement: true,
          });
          events.createIndex("event_id", "event_id", { unique: true });
        }
        if (!db.objectStoreNames.contains(CONTEXT_STORE)) {
          db.createObjectStore(CONTEXT_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(storageError(request.error));
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          reject(
            new EventStoreError(
              "Kin could not finish opening local household storage. Close other Kin tabs and try again.",
            ),
          );
        }
      };
    });

    const store = new EventStore(database);
    database.onversionchange = () => database.close();
    try {
      const context = await store.ensureContext();
      store.actorId = idToHex(context.actor_id);
    } catch (error) {
      database.close();
      throw error;
    }
    return store;
  }

  async loadEvents() {
    const transaction = this.database.transaction(EVENT_STORE, "readonly");
    const request = transaction.objectStore(EVENT_STORE).getAll();
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        try {
          finish(validateEventRows(request.result));
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  append(command, engine) {
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE],
      "readwrite",
    );
    const events = transaction.objectStore(EVENT_STORE);
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const eventRequest = events.getAll();
    const contextRequest = contextStore.get(CONTEXT_KEY);

    return transactionResult(transaction, (finish) => {
      let loadedEvents;
      let context;
      let eventsReady = false;
      let contextReady = false;
      let candidateState;

      const prepareCandidate = () => {
        if (!eventsReady || !contextReady) {
          return;
        }
        try {
          loadedEvents = validateEventRows(loadedEvents);
          validateContext(context);
          validateCursorBoundary(context, loadedEvents);
          if (loadedEvents.length >= MAX_EVENT_COUNT) {
            throw new EventStoreError(
              "Kin has reached its local event limit. Your saved information was not deleted.",
            );
          }

          const logicalTime = BigInt(context.next_logical_time);
          if (logicalTime <= 0n || logicalTime >= MAX_LOGICAL_TIME) {
            throw new EventStoreError(
              "Kin has reached a supported event-order limit. Your saved information was not deleted.",
            );
          }
          const eventId = randomId();
          const asOf = Date.now();
          const timestamp =
            command.type === "set-pulse" ? command.timestamp : asOf;
          const identity = {
            eventId,
            householdId: context.household_id,
            actorId: context.actor_id,
            deviceId: context.device_id,
            timestamp,
            logicalTime,
          };
          let kind;
          let encodedEvent;
          if (command.type === "set-pulse") {
            kind = "PULSE_SET";
            encodedEvent = encodePulseSetRecord({
              ...identity,
              value: command.value,
              expiresAt: command.expiresAt,
            });
          } else if (command.type === "clear-pulse") {
            kind = "PULSE_CLEARED";
            encodedEvent = encodePulseClearedRecord(identity);
          } else if (command.type === "add-talk") {
            kind = "TALK_ADDED";
            encodedEvent = encodeTalkAddedRecord({
              ...identity,
              talkId: randomId(),
              text: command.text,
            });
          } else if (command.type === "resolve-talk") {
            kind = "TALK_RESOLVED";
            encodedEvent = encodeTalkResolvedRecord({
              ...identity,
              talkId: idFromHex(command.talkId),
            });
          } else if (command.type === "reopen-talk") {
            kind = "TALK_REOPENED";
            encodedEvent = encodeTalkReopenedRecord({
              ...identity,
              talkId: idFromHex(command.talkId),
            });
          } else if (command.type === "archive-talk") {
            kind = "TALK_ARCHIVED";
            encodedEvent = encodeTalkArchivedRecord({
              ...identity,
              talkId: idFromHex(command.talkId),
            });
          } else if (command.type === "add-handoff") {
            kind = "HANDOFF_ADDED";
            encodedEvent = encodeHandoffAddedRecord({
              ...identity,
              handoffId: randomId(),
              text: command.text,
            });
          } else if (command.type === "acknowledge-handoff") {
            kind = "HANDOFF_ACKNOWLEDGED";
            encodedEvent = encodeHandoffAcknowledgedRecord({
              ...identity,
              handoffId: idFromHex(command.handoffId),
            });
          } else if (command.type === "archive-handoff") {
            kind = "HANDOFF_ARCHIVED";
            encodedEvent = encodeHandoffArchivedRecord({
              ...identity,
              handoffId: idFromHex(command.handoffId),
            });
          } else if (command.type === "add") {
            kind = "ITEM_ADDED";
            encodedEvent = encodeAddedRecord({
              ...identity,
              itemId: randomId(),
              text: command.text,
              classification: command.classification,
            });
          } else if (command.type === "complete") {
            kind = "ITEM_COMPLETED";
            encodedEvent = encodeCompletedRecord({
              ...identity,
              itemId: idFromHex(command.itemId),
            });
          } else if (command.type === "reopen") {
            kind = "ITEM_REOPENED";
            encodedEvent = encodeReopenedRecord({
              ...identity,
              itemId: idFromHex(command.itemId),
            });
          } else if (command.type === "archive") {
            kind = "ITEM_ARCHIVED";
            encodedEvent = encodeArchivedRecord({
              ...identity,
              itemId: idFromHex(command.itemId),
            });
          } else {
            throw new EventStoreError(
              "Kin could not identify that household action.",
            );
          }

          candidateState = engine.applyEvents(
            [...loadedEvents.map((event) => event.encoded_event), encodedEvent],
            asOf,
            context.last_looked_event_id === null
              ? null
              : idToHex(context.last_looked_event_id),
          );

          const existingRequest = events.index("event_id").get(eventId);
          existingRequest.onsuccess = () => {
            const existing = existingRequest.result;
            if (existing) {
              if (!bytesEqual(existing.encoded_event, encodedEvent)) {
                abortWith(
                  transaction,
                  new EventStoreError(
                    "Kin found a conflicting local event identifier. Your saved information was not deleted.",
                  ),
                );
                return;
              }
              const currentState = engine.applyEvents(
                loadedEvents.map((storedEvent) => storedEvent.encoded_event),
                asOf,
                context.last_looked_event_id === null
                  ? null
                  : idToHex(context.last_looked_event_id),
              );
              const tail = loadedEvents.at(-1);
              finish({
                state: currentState,
                snapshotBoundary: tail
                  ? {
                      eventId: idToHex(tail.event_id),
                      localSequence: tail.local_sequence,
                      snapshotThroughEventId: idToHex(tail.event_id),
                      snapshotThroughLocalSequence: tail.local_sequence,
                    }
                  : null,
              });
              return;
            }

            const row = {
              event_id: eventId,
              household_id: context.household_id,
              actor_id: context.actor_id,
              device_id: context.device_id,
              timestamp,
              logical_time: logicalTime,
              kind,
              event_version: command.type === "add" ? 2 : 1,
              encoded_event: encodedEvent,
            };
            try {
              const appendResult = {
                state: candidateState,
                snapshotBoundary: null,
              };
              const addRequest = events.add(row);
              addRequest.onsuccess = () => {
                appendResult.snapshotBoundary = {
                  eventId: idToHex(eventId),
                  localSequence: addRequest.result,
                  snapshotThroughEventId: idToHex(eventId),
                  snapshotThroughLocalSequence: addRequest.result,
                };
              };
              const contextWrite = contextStore.put({
                ...context,
                next_logical_time: logicalTime + 1n,
              });
              addRequest.onerror = () =>
                abortWith(transaction, storageError(addRequest.error));
              contextWrite.onerror = () =>
                abortWith(transaction, storageError(contextWrite.error));
              finish(appendResult);
            } catch (error) {
              // Request creation can throw before an onerror handler exists.
              abortWith(transaction, storageError(error));
            }
          };
          existingRequest.onerror = () =>
            abortWith(transaction, storageError(existingRequest.error));
        } catch (error) {
          abortWith(
            transaction,
            error instanceof EventStoreError
              ? error
              : new EventStoreError(
                  error.userMessage ??
                    "Kin could not validate that household change.",
                  error,
                ),
          );
        }
      };

      eventRequest.onsuccess = () => {
        loadedEvents = eventRequest.result;
        eventsReady = true;
        prepareCandidate();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        contextReady = true;
        prepareCandidate();
      };
      eventRequest.onerror = () =>
        abortWith(transaction, storageError(eventRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
    });
  }

  getCatchUpState() {
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE],
      "readonly",
    );
    const eventsRequest = transaction.objectStore(EVENT_STORE).getAll();
    const contextRequest = transaction
      .objectStore(CONTEXT_STORE)
      .get(CONTEXT_KEY);

    return transactionResult(transaction, (finish) => {
      let loadedEvents;
      let context;
      let eventsReady = false;
      let contextReady = false;
      const complete = () => {
        if (!eventsReady || !contextReady) return;
        try {
          loadedEvents = validateEventRows(loadedEvents);
          validateContext(context);
          validateCursorBoundary(context, loadedEvents);
          const tail = loadedEvents.at(-1);
          finish({
            events: loadedEvents,
            cursor: {
              eventId: context.last_looked_event_id
                ? idToHex(context.last_looked_event_id)
                : null,
              localSequence: context.last_looked_local_sequence,
              lastLookedAt: context.last_looked_at,
            },
            through: tail
              ? {
                  eventId: idToHex(tail.event_id),
                  localSequence: tail.local_sequence,
                }
              : null,
          });
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      eventsRequest.onsuccess = () => {
        loadedEvents = eventsRequest.result;
        eventsReady = true;
        complete();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        contextReady = true;
        complete();
      };
      eventsRequest.onerror = () =>
        abortWith(transaction, storageError(eventsRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
    });
  }

  markCaughtUpThrough(snapshotBoundary) {
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE],
      "readwrite",
    );
    const eventsStore = transaction.objectStore(EVENT_STORE);
    const eventsRequest = eventsStore.getAll();
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const contextRequest = contextStore.get(CONTEXT_KEY);

    return transactionResult(transaction, (finish) => {
      let loadedEvents;
      let context;
      let eventsReady = false;
      let contextReady = false;
      const complete = () => {
        if (!eventsReady || !contextReady) return;
        try {
          loadedEvents = validateEventRows(loadedEvents);
          validateContext(context);
          validateCursorBoundary(context, loadedEvents);
          const boundary = validateSnapshotBoundary(snapshotBoundary);
          const snapshotTail =
            boundary.snapshotThroughLocalSequence === 0
              ? null
              : loadedEvents.find(
                  (row) =>
                    row.local_sequence ===
                    boundary.snapshotThroughLocalSequence,
                );
          if (
            !snapshotTail ||
            idToHex(snapshotTail.event_id) !==
              boundary.snapshotThroughEventId ||
            boundary.localSequence > boundary.snapshotThroughLocalSequence
          ) {
            throw invalidCatchUpState();
          }
          const requested = loadedEvents.find(
            (row) => row.local_sequence === boundary.localSequence,
          );
          if (!requested || idToHex(requested.event_id) !== boundary.eventId) {
            throw invalidCatchUpState();
          }
          if (boundary.localSequence <= context.last_looked_local_sequence) {
            finish({
              advanced: false,
              cursor: catchUpCursor(context),
            });
            return;
          }

          const updatedContext = {
            ...context,
            last_looked_event_id: requested.event_id,
            last_looked_local_sequence: requested.local_sequence,
            last_looked_at: Date.now(),
          };
          const write = contextStore.put(updatedContext);
          write.onerror = () =>
            abortWith(transaction, storageError(write.error));
          finish({
            advanced: true,
            cursor: catchUpCursor(updatedContext),
          });
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      eventsRequest.onsuccess = () => {
        loadedEvents = eventsRequest.result;
        eventsReady = true;
        complete();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        contextReady = true;
        complete();
      };
      eventsRequest.onerror = () =>
        abortWith(transaction, storageError(eventsRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
    });
  }

  ensureContext() {
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE],
      "readwrite",
    );
    const eventRequest = transaction.objectStore(EVENT_STORE).getAll();
    const contexts = transaction.objectStore(CONTEXT_STORE);
    const request = contexts.get(CONTEXT_KEY);
    let loadedEvents;
    let context;
    let eventsReady = false;
    let contextReady = false;

    return transactionResult(transaction, (finish) => {
      const initialize = () => {
        if (!eventsReady || !contextReady) return;
        try {
          loadedEvents = validateEventRows(loadedEvents);
          if (!context) {
            if (loadedEvents.length) throw invalidCatchUpState();
            context = {
              key: CONTEXT_KEY,
              household_id: randomId(),
              actor_id: randomId(),
              device_id: randomId(),
              next_logical_time: 1n,
              last_looked_event_id: null,
              last_looked_local_sequence: 0,
              last_looked_at: Date.now(),
            };
            const write = contexts.add(context);
            write.onerror = () =>
              abortWith(transaction, storageError(write.error));
            finish(context);
            return;
          }

          validateContext(context, { allowUninitialized: true });
          validateEventHousehold(context, loadedEvents);
          if (!hasCatchUpMetadata(context)) {
            const tail = loadedEvents.at(-1);
            context = {
              ...context,
              last_looked_event_id: tail
                ? Uint8Array.from(asBytes(tail.event_id))
                : null,
              last_looked_local_sequence: tail?.local_sequence ?? 0,
              last_looked_at: Date.now(),
            };
            const write = contexts.put(context);
            write.onerror = () =>
              abortWith(transaction, storageError(write.error));
          } else {
            validateCursorBoundary(context, loadedEvents);
          }
          finish(context);
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      request.onsuccess = () => {
        context = request.result;
        contextReady = true;
        initialize();
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
      eventRequest.onsuccess = () => {
        loadedEvents = eventRequest.result;
        eventsReady = true;
        initialize();
      };
      eventRequest.onerror = () =>
        abortWith(transaction, storageError(eventRequest.error));
    });
  }

  close() {
    this.database.close();
  }
}

function transactionResult(transaction, schedule) {
  return new Promise((resolve, reject) => {
    let failure;
    let result;
    let hasResult = false;
    const finish = (value) => {
      result = value;
      hasResult = true;
    };
    transaction.oncomplete = () => {
      if (hasResult) {
        resolve(result);
      } else {
        reject(storageError(transaction.error));
      }
    };
    transaction.onerror = () => {
      failure ??= transaction.__kinFailure ?? storageError(transaction.error);
    };
    transaction.onabort = () =>
      reject(
        failure ?? transaction.__kinFailure ?? storageError(transaction.error),
      );
    try {
      schedule(finish);
    } catch (error) {
      abortWith(transaction, error);
    }
  });
}

function abortWith(transaction, error) {
  try {
    transaction.__kinFailure ??= error;
    transaction.abort();
  } catch {
    transaction.__kinFailure ??= error;
  }
}

function storageError(cause) {
  const message =
    cause?.name === "QuotaExceededError"
      ? "Kin couldn't save because local browser storage is full. Free some space, then try again. Your saved information was not deleted."
      : "Kin could not safely access local household storage. Your saved information was not intentionally deleted.";
  const error = new EventStoreError(message, cause);
  return error;
}

function validateEventRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_EVENT_COUNT) {
    throw new EventStoreError(
      "Kin found an invalid local event history. The stored data was preserved.",
    );
  }
  let previousSequence = 0;
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !Number.isSafeInteger(row.local_sequence) ||
      row.local_sequence <= previousSequence
    ) {
      throw new EventStoreError(
        "Kin found an invalid local event order. The stored data was preserved.",
      );
    }
    validateEventRow(row);
    previousSequence = row.local_sequence;
  }
  return rows;
}

function validateEventRow(row) {
  const encoded = asBytes(row.encoded_event);
  if (encoded.length < 88 || ![1, 2].includes(row.event_version)) {
    throw new EventStoreError(
      "Kin found an incomplete local event. The stored data was preserved.",
    );
  }
  const view = new DataView(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  );
  const kind = view.getUint16(2, true);
  const expectedKind = {
    ITEM_ADDED: 1,
    ITEM_COMPLETED: 2,
    ITEM_REOPENED: 3,
    ITEM_ARCHIVED: 4,
    HANDOFF_ADDED: 5,
    HANDOFF_ACKNOWLEDGED: 6,
    HANDOFF_ARCHIVED: 7,
    TALK_ADDED: 8,
    TALK_RESOLVED: 9,
    TALK_REOPENED: 10,
    TALK_ARCHIVED: 11,
    PULSE_SET: 12,
    PULSE_CLEARED: 13,
  }[row.kind];
  const supportedVersion =
    (row.kind === "ITEM_ADDED" && [1, 2].includes(row.event_version)) ||
    (row.kind !== "ITEM_ADDED" && row.event_version === 1);
  if (
    !Number.isSafeInteger(row.timestamp) ||
    typeof row.logical_time !== "bigint" ||
    row.logical_time < 0n
  ) {
    throw new EventStoreError(
      "Kin found inconsistent local event data. The stored data was preserved.",
    );
  }
  const timestamp = view.getBigInt64(68, true);
  const logicalTime = view.getBigUint64(76, true);
  if (
    view.getUint16(0, true) !== row.event_version ||
    kind !== expectedKind ||
    !supportedVersion ||
    !bytesEqual(encoded.subarray(4, 20), row.event_id) ||
    !bytesEqual(encoded.subarray(20, 36), row.household_id) ||
    !bytesEqual(encoded.subarray(36, 52), row.actor_id) ||
    !bytesEqual(encoded.subarray(52, 68), row.device_id) ||
    timestamp !== BigInt(row.timestamp) ||
    logicalTime !== BigInt(row.logical_time)
  ) {
    throw new EventStoreError(
      "Kin found inconsistent local event data. The stored data was preserved.",
    );
  }
}

function validateContext(context, { allowUninitialized = false } = {}) {
  if (
    context?.key !== CONTEXT_KEY ||
    !isId(context.household_id) ||
    !isId(context.actor_id) ||
    !isId(context.device_id) ||
    typeof context.next_logical_time !== "bigint" ||
    context.next_logical_time < 1n ||
    context.next_logical_time > MAX_LOGICAL_TIME
  ) {
    throw new EventStoreError(
      "Kin found invalid local household identity data. The stored data was preserved.",
    );
  }
  const catchUpFields = [
    "last_looked_event_id",
    "last_looked_local_sequence",
    "last_looked_at",
  ];
  const presentFields = catchUpFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(context, field),
  );
  if (presentFields.length === 0 && allowUninitialized) return;
  if (
    presentFields.length !== catchUpFields.length ||
    !Number.isSafeInteger(context.last_looked_local_sequence) ||
    context.last_looked_local_sequence < 0 ||
    !Number.isSafeInteger(context.last_looked_at) ||
    Math.abs(context.last_looked_at) > 8_640_000_000_000_000 ||
    (context.last_looked_local_sequence === 0
      ? context.last_looked_event_id !== null
      : !isId(context.last_looked_event_id))
  ) {
    throw invalidCatchUpState();
  }
}

function hasCatchUpMetadata(context) {
  return [
    "last_looked_event_id",
    "last_looked_local_sequence",
    "last_looked_at",
  ].some((field) => Object.prototype.hasOwnProperty.call(context, field));
}

function validateEventHousehold(context, events) {
  if (
    events.some(
      (event) => !bytesEqual(event.household_id, context.household_id),
    )
  ) {
    throw invalidCatchUpState();
  }
}

function validateCursorBoundary(context, events) {
  validateEventHousehold(context, events);
  if (context.last_looked_local_sequence === 0) return;
  const cursor = events.find(
    (event) => event.local_sequence === context.last_looked_local_sequence,
  );
  if (!cursor || !bytesEqual(cursor.event_id, context.last_looked_event_id)) {
    throw invalidCatchUpState();
  }
}

function catchUpCursor(context) {
  return {
    eventId: context.last_looked_event_id
      ? idToHex(context.last_looked_event_id)
      : null,
    localSequence: context.last_looked_local_sequence,
    lastLookedAt: context.last_looked_at,
  };
}

function validateSnapshotBoundary(boundary) {
  if (
    !boundary ||
    !/^[0-9a-f]{32}$/.test(boundary.eventId) ||
    !/^[0-9a-f]{32}$/.test(boundary.snapshotThroughEventId) ||
    !Number.isSafeInteger(boundary.localSequence) ||
    boundary.localSequence < 1 ||
    !Number.isSafeInteger(boundary.snapshotThroughLocalSequence) ||
    boundary.snapshotThroughLocalSequence < boundary.localSequence
  ) {
    throw invalidCatchUpState();
  }
  return boundary;
}

function invalidCatchUpState() {
  return new EventStoreError(
    "Kin found invalid local catch-up data. Your household events were preserved.",
  );
}

function isId(value) {
  try {
    return asBytes(value).length === 16;
  } catch {
    return false;
  }
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
  throw new EventStoreError(
    "Kin could not read a local event record. The stored data was preserved.",
  );
}

function bytesEqual(left, right) {
  try {
    const leftBytes = asBytes(left);
    const rightBytes = asBytes(right);
    if (leftBytes.length !== rightBytes.length) {
      return false;
    }
    return leftBytes.every((byte, index) => byte === rightBytes[index]);
  } catch {
    return false;
  }
}
