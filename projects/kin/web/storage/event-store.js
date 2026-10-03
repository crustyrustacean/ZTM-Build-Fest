import {
  encodeRoutineCreatedRecord,
  encodeRoutineActionRecord,
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
import { projectionContext } from "../browser-time.js";

const DATABASE_NAME = "kin";
const DATABASE_VERSION = 2;
const EVENT_STORE = "events";
const CONTEXT_STORE = "local_context";
const SYNC_STATE_STORE = "sync_state";
const SYNC_OUTBOX_STORE = "sync_outbox";
const SYNC_BINDING_STORE = "sync_bindings";
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
        if (!db.objectStoreNames.contains(SYNC_STATE_STORE))
          db.createObjectStore(SYNC_STATE_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE))
          db.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: "event_id" });
        if (!db.objectStoreNames.contains(SYNC_BINDING_STORE))
          db.createObjectStore(SYNC_BINDING_STORE, { keyPath: "legacy_key" });
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
      store.actorId = idToHex(context.sync_member_id ?? context.actor_id);
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
      [EVENT_STORE, CONTEXT_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE],
      "readwrite",
    );
    const events = transaction.objectStore(EVENT_STORE);
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const syncStates = transaction.objectStore(SYNC_STATE_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const eventRequest = events.getAll();
    const contextRequest = contextStore.get(CONTEXT_KEY);
    const syncStateRequest = syncStates.get("active");

    return transactionResult(transaction, (finish) => {
      let loadedEvents;
      let context;
      let syncState;
      let eventsReady = false;
      let contextReady = false;
      let syncStateReady = false;
      let candidateState;

      const prepareCandidate = () => {
        if (!eventsReady || !contextReady || !syncStateReady) {
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
          if (syncState && syncState.pendingCount >= MAX_EVENT_COUNT)
            throw new EventStoreError(
              "Kin's sync queue is full. Sync this device before adding more household changes.",
            );

          const logicalTime = BigInt(context.next_logical_time);
          if (logicalTime <= 0n || logicalTime >= MAX_LOGICAL_TIME) {
            throw new EventStoreError(
              "Kin has reached a supported event-order limit. Your saved information was not deleted.",
            );
          }
          const eventId = randomId();
          const { asOf, civilDate } = projectionContext();
          const timestamp =
            command.type === "set-pulse" ? command.timestamp : asOf;
          const identity = {
            eventId,
            householdId: context.sync_household_id ?? context.household_id,
            actorId: context.sync_member_id ?? context.actor_id,
            deviceId: context.sync_device_id ?? context.device_id,
            timestamp,
            logicalTime,
          };
          const syncIdentity = syncIdentityFromContext(context);
          let kind;
          let encodedEvent;
          if (command.type === "create-routine") {
            kind = "ROUTINE_CREATED";
            encodedEvent = encodeRoutineCreatedRecord({
              ...identity,
              routineId: randomId(),
              text: command.text,
              cadence: command.cadence,
              createdOn: civilDate,
            });
          } else if (
            [
              "complete-routine-occurrence",
              "reopen-routine-occurrence",
              "archive-routine",
            ].includes(command.type)
          ) {
            const action = command.type.split("-")[0];
            if (action !== "archive") {
              const current = engine.applyEvents(
                loadedEvents.map((event) => event.encoded_event),
                asOf,
                context.last_looked_event_id === null
                  ? null
                  : idToHex(context.last_looked_event_id),
                civilDate,
                syncIdentity,
              );
              const routine = current.routines.find(
                (record) => record.routineId === command.routineId,
              );
              const occurrenceIsCurrent =
                action === "complete"
                  ? routine?.occurrenceStatus === "open"
                  : routine?.occurrenceStatus === "completed";
              if (
                !routine ||
                routine.status === "archived" ||
                routine.occurrenceKey === null ||
                routine.occurrenceKey !== command.occurrenceKey ||
                !occurrenceIsCurrent
              ) {
                const error = new EventStoreError(
                  "That period changed or the occurrence was already updated. Review the current routine.",
                );
                error.code = 4;
                throw error;
              }
            }
            kind =
              action === "archive"
                ? "ROUTINE_ARCHIVED"
                : action === "complete"
                  ? "ROUTINE_OCCURRENCE_COMPLETED"
                  : "ROUTINE_OCCURRENCE_REOPENED";
            encodedEvent = encodeRoutineActionRecord({
              ...identity,
              routineId: idFromHex(command.routineId),
              occurrenceKey: command.occurrenceKey,
              action,
            });
          } else if (command.type === "set-pulse") {
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
            civilDate,
            syncIdentity,
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
                civilDate,
                syncIdentity,
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
              household_id: identity.householdId,
              actor_id: identity.actorId,
              device_id: identity.deviceId,
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
              if (syncState) {
                const deviceSequence = syncState.nextDeviceSequence;
                const outboxWrite = outbox.add({
                  event_id: idToHex(eventId),
                  householdId: idToHex(identity.householdId),
                  deviceId: idToHex(identity.deviceId),
                  deviceSequence,
                  keyEpoch: syncState.rotationPending
                    ? null
                    : syncState.currentEpoch,
                  canonical_event: encodedEvent.slice(),
                  envelope: null,
                  accepted: false,
                });
                syncState.nextDeviceSequence += 1;
                syncState.pendingCount += 1;
                const syncStateWrite = syncStates.put(syncState);
                outboxWrite.onerror = () =>
                  abortWith(transaction, storageError(outboxWrite.error));
                syncStateWrite.onerror = () =>
                  abortWith(transaction, storageError(syncStateWrite.error));
              }
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
      syncStateRequest.onsuccess = () => {
        syncState = syncStateRequest.result ?? null;
        syncStateReady = true;
        prepareCandidate();
      };
      eventRequest.onerror = () =>
        abortWith(transaction, storageError(eventRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
      syncStateRequest.onerror = () =>
        abortWith(transaction, storageError(syncStateRequest.error));
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
            syncIdentity: syncIdentityFromContext(context),
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

  initializeSync({
    identity,
    serverStatus,
    identityBindings = [],
    legacyBindingEnvelope = null,
  }) {
    const transaction = this.database.transaction(
      [
        EVENT_STORE,
        CONTEXT_STORE,
        SYNC_STATE_STORE,
        SYNC_OUTBOX_STORE,
        SYNC_BINDING_STORE,
      ],
      "readwrite",
    );
    const eventsStore = transaction.objectStore(EVENT_STORE);
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const syncStates = transaction.objectStore(SYNC_STATE_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const bindings = transaction.objectStore(SYNC_BINDING_STORE);
    const eventsRequest = eventsStore.getAll();
    const contextRequest = contextStore.get(CONTEXT_KEY);
    const syncStateRequest = syncStates.get("active");

    return transactionResult(transaction, (finish) => {
      let loadedEvents;
      let context;
      let state;
      let ready = 0;
      const initialize = () => {
        ready += 1;
        if (ready !== 3) return;
        try {
          loadedEvents = validateEventRows(loadedEvents);
          validateContext(context);
          validateCursorBoundary(context, loadedEvents);
          for (const field of ["householdId", "memberId", "deviceId"])
            idFromHex(identity?.[field]);
          if (state) {
            if (
              state.householdId !== identity.householdId ||
              state.memberId !== identity.memberId ||
              state.deviceId !== identity.deviceId
            )
              throw new EventStoreError(
                "This browser's saved sync identity does not match the signed-in device.",
              );
            finish({ state, syncIdentity: syncIdentityFromContext(context) });
            return;
          }
          if (loadedEvents.length > MAX_EVENT_COUNT)
            throw new EventStoreError(
              "Kin reached its local sync queue limit.",
            );
          const identityTuple = {
            legacyHouseholdId: idToHex(context.household_id),
            legacyActorId: idToHex(context.actor_id),
            legacyDeviceId: idToHex(context.device_id),
            householdId: identity.householdId,
            actorId: identity.memberId,
            deviceId: identity.deviceId,
          };
          const requiresBinding = loadedEvents.some(
            (row) =>
              !bytesEqual(row.household_id, idFromHex(identity.householdId)) ||
              !bytesEqual(row.actor_id, idFromHex(identity.memberId)) ||
              !bytesEqual(row.device_id, idFromHex(identity.deviceId)),
          );
          const legacyTupleIsKnown =
            (context.sync_identity_bindings ?? []).some(
              (binding) =>
                binding.legacyHouseholdId === idToHex(context.household_id) &&
                binding.legacyActorId === idToHex(context.actor_id) &&
                binding.legacyDeviceId === idToHex(context.device_id),
            ) ||
            identityBindings.some((record) =>
              sameLegacyTupleForContext(record.binding, context),
            );
          if (requiresBinding && !legacyTupleIsKnown && !legacyBindingEnvelope)
            throw new EventStoreError(
              "Kin could not safely bind this local history to the trusted household.",
            );
          const bindingRecords = [...identityBindings];
          if (requiresBinding && !legacyTupleIsKnown)
            bindingRecords.push({
              binding: identityTuple,
              envelope: legacyBindingEnvelope,
            });
          const combinedBindings = new Map();
          for (const record of [
            ...(context.sync_identity_bindings ?? []).map((binding) => ({
              binding,
            })),
            ...bindingRecords,
          ]) {
            const binding = record.binding;
            const legacyKey = `${binding.legacyHouseholdId}:${binding.legacyActorId}:${binding.legacyDeviceId}`;
            const existing = combinedBindings.get(legacyKey);
            if (
              existing &&
              canonicalJson(existing.binding) !== canonicalJson(binding)
            )
              throw new EventStoreError(
                "Kin found conflicting household identity bindings.",
              );
            combinedBindings.set(legacyKey, record);
          }
          const verifiedBindings = [...combinedBindings.values()].map(
            (record) => record.binding,
          );
          const updatedContext = {
            ...context,
            sync_household_id: idFromHex(identity.householdId),
            sync_member_id: idFromHex(identity.memberId),
            sync_device_id: idFromHex(identity.deviceId),
            sync_identity_bindings: verifiedBindings,
          };
          const maxLogicalTime = loadedEvents.reduce(
            (maximum, row) =>
              row.logical_time > maximum ? row.logical_time : maximum,
            0n,
          );
          const newState = {
            key: "active",
            householdId: identity.householdId,
            memberId: identity.memberId,
            deviceId: identity.deviceId,
            currentEpoch: serverStatus.currentEpoch,
            pendingEpoch: serverStatus.pendingEpoch,
            rotationPending: serverStatus.rotationPending === true,
            syncCursor: "",
            cursorHighWater: "",
            relayHighWater: "",
            nextDeviceSequence: loadedEvents.length + 1,
            maxLogicalTime,
            pendingCount: loadedEvents.length,
            initialized: false,
          };
          const contextWrite = contextStore.put(updatedContext);
          const stateWrite = syncStates.add(newState);
          contextWrite.onerror = () =>
            abortWith(transaction, storageError(contextWrite.error));
          stateWrite.onerror = () =>
            abortWith(transaction, storageError(stateWrite.error));
          for (const record of bindingRecords) {
            const binding = record.binding;
            const legacyKey = `${binding.legacyHouseholdId}:${binding.legacyActorId}:${binding.legacyDeviceId}`;
            const bindingWrite = bindings.put({
              legacy_key: legacyKey,
              ...binding,
              controlEnvelope: structuredClone(record.envelope ?? null),
              uploaded:
                Boolean(record.uploaded) ||
                (record.envelope?.deviceId != null &&
                  record.envelope.deviceId !== identity.deviceId),
            });
            bindingWrite.onerror = () =>
              abortWith(transaction, storageError(bindingWrite.error));
          }
          loadedEvents.forEach((row, index) => {
            const eventId = idToHex(row.event_id);
            const write = outbox.add({
              event_id: eventId,
              householdId: identity.householdId,
              deviceId: identity.deviceId,
              deviceSequence: index + 1,
              keyEpoch: serverStatus.currentEpoch,
              canonical_event: asBytes(row.encoded_event).slice(),
              envelope: null,
              accepted: false,
            });
            write.onerror = () =>
              abortWith(transaction, storageError(write.error));
          });
          finish({
            state: newState,
            syncIdentity: syncIdentityFromContext(updatedContext),
          });
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      eventsRequest.onsuccess = () => {
        loadedEvents = eventsRequest.result;
        initialize();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        initialize();
      };
      syncStateRequest.onsuccess = () => {
        state = syncStateRequest.result;
        initialize();
      };
      eventsRequest.onerror = () =>
        abortWith(transaction, storageError(eventsRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
      syncStateRequest.onerror = () =>
        abortWith(transaction, storageError(syncStateRequest.error));
    });
  }

  getSyncState() {
    const transaction = this.database.transaction(SYNC_STATE_STORE, "readonly");
    const request = transaction.objectStore(SYNC_STATE_STORE).get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  updateSyncServerState(status) {
    const transaction = this.database.transaction(
      [SYNC_STATE_STORE, SYNC_OUTBOX_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const stateRequest = store.get("active");
    const outboxRequest = outbox.getAll();
    return transactionResult(transaction, (finish) => {
      let state;
      let rows;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 2) return;
        if (!state) {
          finish(null);
          return;
        }
        if (status.currentEpoch < state.currentEpoch) {
          abortWith(
            transaction,
            new EventStoreError("Kin rejected a household key epoch rollback."),
          );
          return;
        }
        state.currentEpoch = status.currentEpoch;
        state.pendingEpoch = status.pendingEpoch;
        state.rotationPending = status.rotationPending === true;
        if (
          status.latestCursor != null &&
          cursorValue(status.latestCursor) >=
            cursorValue(state.relayHighWater ?? "")
        )
          state.relayHighWater = status.latestCursor;
        if (!state.rotationPending) {
          for (const row of rows) {
            if (row.keyEpoch == null && !row.envelope) {
              row.keyEpoch = status.currentEpoch;
              const write = outbox.put(row);
              write.onerror = () =>
                abortWith(transaction, storageError(write.error));
            }
          }
        }
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(state);
      };
      stateRequest.onsuccess = () => {
        state = stateRequest.result;
        complete();
      };
      outboxRequest.onsuccess = () => {
        rows = outboxRequest.result;
        complete();
      };
      stateRequest.onerror = () =>
        abortWith(transaction, storageError(stateRequest.error));
      outboxRequest.onerror = () =>
        abortWith(transaction, storageError(outboxRequest.error));
    });
  }

  requeueAfterRelayReset(serverCursor) {
    const transaction = this.database.transaction(
      [SYNC_STATE_STORE, SYNC_OUTBOX_STORE],
      "readwrite",
    );
    const states = transaction.objectStore(SYNC_STATE_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const stateRequest = states.get("active");
    const outboxRequest = outbox.getAll();
    return transactionResult(transaction, (finish) => {
      let state;
      let rows;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 2) return;
        try {
          const localHighWater =
            cursorValue(state?.cursorHighWater ?? "") >=
            cursorValue(state?.relayHighWater ?? "")
              ? (state?.cursorHighWater ?? "")
              : (state?.relayHighWater ?? "");
          if (
            !state ||
            cursorValue(serverCursor) >= cursorValue(localHighWater)
          ) {
            finish(false);
            return;
          }
          for (const row of rows) {
            if (row.accepted && row.envelope) {
              row.accepted = false;
              const write = outbox.put(row);
              write.onerror = () =>
                abortWith(transaction, storageError(write.error));
            }
          }
          state.pendingCount = rows.filter((row) => !row.accepted).length;
          state.syncCursor = "";
          state.cursorHighWater = "";
          state.relayHighWater = "";
          const write = states.put(state);
          write.onerror = () =>
            abortWith(transaction, storageError(write.error));
          finish(true);
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      stateRequest.onsuccess = () => {
        state = stateRequest.result;
        complete();
      };
      outboxRequest.onsuccess = () => {
        rows = outboxRequest.result;
        complete();
      };
      stateRequest.onerror = () =>
        abortWith(transaction, storageError(stateRequest.error));
      outboxRequest.onerror = () =>
        abortWith(transaction, storageError(outboxRequest.error));
    });
  }

  savePendingRotation(rotation) {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        if (!state) {
          abortWith(
            transaction,
            new EventStoreError("Kin has not initialized encrypted sync."),
          );
          return;
        }
        if (
          state.pendingRotation &&
          canonicalJson(state.pendingRotation) !== canonicalJson(rotation)
        ) {
          abortWith(
            transaction,
            new EventStoreError("Kin found conflicting pending key rotations."),
          );
          return;
        }
        state.pendingRotation ??= structuredClone(rotation);
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(state.pendingRotation);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  commitPendingRotation({ expectedEpoch, currentEpoch }) {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        if (
          !state ||
          !state.pendingRotation ||
          state.pendingRotation.expectedEpoch !== expectedEpoch ||
          state.pendingRotation.epoch !== currentEpoch
        ) {
          abortWith(
            transaction,
            new EventStoreError(
              "Kin could not match the accepted key rotation.",
            ),
          );
          return;
        }
        state.currentEpoch = currentEpoch;
        state.pendingEpoch = null;
        state.rotationPending = false;
        state.pendingRotation = null;
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(state);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  clearPendingRotation() {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        if (!state) {
          finish(false);
          return;
        }
        state.pendingRotation = null;
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(true);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  getProvisioningRequest(recipientDeviceId, keyEpoch) {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        if (!state) {
          abortWith(
            transaction,
            new EventStoreError("Kin has not initialized encrypted sync."),
          );
          return;
        }
        state.provisioningRequests ??= {};
        const key = `${recipientDeviceId}:${keyEpoch}`;
        let entry = state.provisioningRequests[key];
        if (!entry) {
          if (Object.keys(state.provisioningRequests).length >= 2048) {
            abortWith(
              transaction,
              new EventStoreError(
                "Kin reached its device key-transfer history limit.",
              ),
            );
            return;
          }
          entry = {
            requestId: idToHex(randomId()),
            recipientDeviceId,
            keyEpoch,
            package: null,
            accepted: false,
          };
          state.provisioningRequests[key] = entry;
        }
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(structuredClone(entry));
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  updateProvisioningRequest(requestId, update) {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        const entry = Object.values(state?.provisioningRequests ?? {}).find(
          (value) => value.requestId === requestId,
        );
        if (!entry) {
          abortWith(
            transaction,
            new EventStoreError(
              "Kin could not find the pending device key transfer.",
            ),
          );
          return;
        }
        Object.assign(entry, structuredClone(update));
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(structuredClone(entry));
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  getSyncBootstrap() {
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE],
      "readonly",
    );
    const eventsRequest = transaction.objectStore(EVENT_STORE).getAll();
    const contextRequest = transaction
      .objectStore(CONTEXT_STORE)
      .get(CONTEXT_KEY);
    return transactionResult(transaction, (finish) => {
      let events;
      let context;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 2) return;
        try {
          events = validateEventRows(events);
          validateContext(context);
          finish({
            events,
            legacyIdentity: {
              householdId: idToHex(context.household_id),
              actorId: idToHex(context.actor_id),
              deviceId: idToHex(context.device_id),
            },
            maxLogicalTime: events.reduce(
              (maximum, row) =>
                row.logical_time > maximum ? row.logical_time : maximum,
              0n,
            ),
          });
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      eventsRequest.onsuccess = () => {
        events = eventsRequest.result;
        complete();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        complete();
      };
      eventsRequest.onerror = () =>
        abortWith(transaction, storageError(eventsRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
    });
  }

  getPendingBindings() {
    const transaction = this.database.transaction(
      SYNC_BINDING_STORE,
      "readonly",
    );
    const request = transaction.objectStore(SYNC_BINDING_STORE).getAll();
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () =>
        finish(
          request.result.filter(
            (record) => !record.uploaded && record.controlEnvelope,
          ),
        );
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  markBindingUploaded(legacyKey) {
    const transaction = this.database.transaction(
      SYNC_BINDING_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_BINDING_STORE);
    const request = store.get(legacyKey);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const record = request.result;
        if (!record) {
          finish(false);
          return;
        }
        record.uploaded = true;
        const write = store.put(record);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(true);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  installIdentityBindings(records, identity) {
    if (!Array.isArray(records) || records.length > 256)
      throw new EventStoreError("Kin received too many identity bindings.");
    const transaction = this.database.transaction(
      [CONTEXT_STORE, SYNC_BINDING_STORE],
      "readwrite",
    );
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const bindingStore = transaction.objectStore(SYNC_BINDING_STORE);
    const contextRequest = contextStore.get(CONTEXT_KEY);
    return transactionResult(transaction, (finish) => {
      contextRequest.onsuccess = () => {
        try {
          const context = contextRequest.result;
          validateContext(context);
          const bindingsByKey = new Map(
            (context.sync_identity_bindings ?? []).map((binding) => [
              `${binding.legacyHouseholdId}:${binding.legacyActorId}:${binding.legacyDeviceId}`,
              binding,
            ]),
          );
          for (const record of records) {
            const binding = record.binding;
            if (
              binding.householdId !== identity.householdId ||
              binding.deviceId !== record.envelope.deviceId
            )
              throw new EventStoreError(
                "Kin received an identity binding for another household or device.",
              );
            const key = `${binding.legacyHouseholdId}:${binding.legacyActorId}:${binding.legacyDeviceId}`;
            const existing = bindingsByKey.get(key);
            if (existing && canonicalJson(existing) !== canonicalJson(binding))
              throw new EventStoreError(
                "Kin found conflicting household identity bindings.",
              );
            bindingsByKey.set(key, binding);
            const write = bindingStore.put({
              legacy_key: key,
              ...binding,
              controlEnvelope: structuredClone(record.envelope),
              uploaded: true,
            });
            write.onerror = () =>
              abortWith(transaction, storageError(write.error));
          }
          context.sync_identity_bindings = [...bindingsByKey.values()];
          const contextWrite = contextStore.put(context);
          contextWrite.onerror = () =>
            abortWith(transaction, storageError(contextWrite.error));
          finish(context.sync_identity_bindings);
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
    });
  }

  getPendingOutbox(limit = 20) {
    const transaction = this.database.transaction(
      SYNC_OUTBOX_STORE,
      "readonly",
    );
    const request = transaction.objectStore(SYNC_OUTBOX_STORE).getAll();
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () =>
        finish(
          request.result
            .filter((row) => !row.accepted)
            .sort((left, right) => left.deviceSequence - right.deviceSequence)
            .slice(0, limit),
        );
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  storeOutboxEnvelope(eventId, envelope, keyEpoch) {
    const transaction = this.database.transaction(
      SYNC_OUTBOX_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_OUTBOX_STORE);
    const request = store.get(eventId);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const row = request.result;
        if (!row) {
          abortWith(
            transaction,
            new EventStoreError(
              "Kin could not find the local event to synchronize.",
            ),
          );
          return;
        }
        if (
          (row.envelope &&
            canonicalJson(row.envelope) !== canonicalJson(envelope)) ||
          (row.keyEpoch != null && row.keyEpoch !== keyEpoch)
        ) {
          abortWith(
            transaction,
            new EventStoreError(
              "Kin found conflicting encrypted retries for one event ID.",
            ),
          );
          return;
        }
        row.envelope ??= structuredClone(envelope);
        row.keyEpoch ??= keyEpoch;
        const write = store.put(row);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(row);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
    });
  }

  markOutboxAccepted(eventId, relayCursor = null) {
    const transaction = this.database.transaction(
      [SYNC_STATE_STORE, SYNC_OUTBOX_STORE],
      "readwrite",
    );
    const states = transaction.objectStore(SYNC_STATE_STORE);
    const outbox = transaction.objectStore(SYNC_OUTBOX_STORE);
    const stateRequest = states.get("active");
    const rowRequest = outbox.get(eventId);
    return transactionResult(transaction, (finish) => {
      let state;
      let row;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 2) return;
        if (!row) {
          finish(false);
          return;
        }
        if (!row.envelope) {
          abortWith(
            transaction,
            new EventStoreError(
              "Kin cannot acknowledge an event without its persisted encrypted envelope.",
            ),
          );
          return;
        }
        const wasAccepted = row.accepted;
        row.accepted = true;
        const outboxWrite = outbox.put(row);
        outboxWrite.onerror = () =>
          abortWith(transaction, storageError(outboxWrite.error));
        if (state && !wasAccepted) {
          state.pendingCount = Math.max(0, state.pendingCount - 1);
        }
        if (state && relayCursor != null) {
          if (
            cursorValue(relayCursor) < cursorValue(state.relayHighWater ?? "")
          ) {
            abortWith(
              transaction,
              new EventStoreError(
                "Kin rejected a relay acknowledgement rollback.",
              ),
            );
            return;
          }
          state.relayHighWater = relayCursor;
        }
        if (state) {
          const stateWrite = states.put(state);
          stateWrite.onerror = () =>
            abortWith(transaction, storageError(stateWrite.error));
        }
        finish(true);
      };
      stateRequest.onsuccess = () => {
        state = stateRequest.result;
        complete();
      };
      rowRequest.onsuccess = () => {
        row = rowRequest.result;
        complete();
      };
      stateRequest.onerror = () =>
        abortWith(transaction, storageError(stateRequest.error));
      rowRequest.onerror = () =>
        abortWith(transaction, storageError(rowRequest.error));
    });
  }

  commitRemoteBatch({ received, nextCursor, engine, asOf, civilDate }) {
    if (
      !Array.isArray(received) ||
      received.length > 20 ||
      typeof nextCursor !== "string" ||
      (nextCursor !== "" && !/^[A-Za-z0-9_-]{11}$/.test(nextCursor))
    )
      throw new EventStoreError(
        "Kin received a sync batch outside its supported bounds.",
      );
    const transaction = this.database.transaction(
      [EVENT_STORE, CONTEXT_STORE, SYNC_STATE_STORE],
      "readwrite",
    );
    const eventsStore = transaction.objectStore(EVENT_STORE);
    const contextStore = transaction.objectStore(CONTEXT_STORE);
    const syncStates = transaction.objectStore(SYNC_STATE_STORE);
    const eventsRequest = eventsStore.getAll();
    const contextRequest = contextStore.get(CONTEXT_KEY);
    const stateRequest = syncStates.get("active");
    return transactionResult(transaction, (finish) => {
      let rows;
      let context;
      let syncState;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 3) return;
        try {
          rows = validateEventRows(rows);
          validateContext(context);
          if (!syncState || !context.sync_household_id)
            throw new EventStoreError(
              "Kin has not initialized encrypted sync for this device.",
            );
          if (cursorValue(nextCursor) < cursorValue(syncState.cursorHighWater))
            throw new EventStoreError("Kin rejected a sync cursor rollback.");
          validateCursorBoundary(context, rows);
          const byId = new Map(rows.map((row) => [idToHex(row.event_id), row]));
          const additions = [];
          for (const item of received) {
            const canonical = asBytes(item.encodedEvent).slice();
            const candidate = eventRowFromCanonical(canonical);
            const eventId = idToHex(candidate.event_id);
            const existing = byId.get(eventId);
            if (existing) {
              if (!bytesEqual(existing.encoded_event, canonical))
                throw new EventStoreError(
                  "Kin found conflicting synchronized bytes for an existing event ID.",
                );
              continue;
            }
            candidate.local_sequence =
              (rows.at(-1)?.local_sequence ?? 0) + additions.length + 1;
            additions.push(candidate);
            byId.set(eventId, candidate);
          }
          const candidateRows = [...rows, ...additions];
          validateEventRows(candidateRows);
          const { asOf: projectionAsOf, civilDate: projectionDate } =
            projectionContext();
          const state = engine.applyEvents(
            candidateRows.map((row) => row.encoded_event),
            asOf ?? projectionAsOf,
            context.last_looked_event_id === null
              ? null
              : idToHex(context.last_looked_event_id),
            civilDate ?? projectionDate,
            syncIdentityFromContext(context),
          );
          for (const row of additions) {
            const { local_sequence, ...storedRow } = row;
            const write = eventsStore.add(storedRow);
            write.onsuccess = () => {
              if (write.result !== local_sequence)
                abortWith(
                  transaction,
                  new EventStoreError(
                    "Kin could not preserve local event order during sync.",
                  ),
                );
            };
            write.onerror = () =>
              abortWith(transaction, storageError(write.error));
          }
          const maximumLogicalTime = candidateRows.reduce(
            (maximum, row) =>
              row.logical_time > maximum ? row.logical_time : maximum,
            0n,
          );
          context.next_logical_time =
            context.next_logical_time > maximumLogicalTime
              ? context.next_logical_time
              : maximumLogicalTime + 1n;
          syncState.maxLogicalTime = maximumLogicalTime;
          syncState.syncCursor = nextCursor;
          syncState.cursorHighWater = nextCursor;
          const contextWrite = contextStore.put(context);
          const stateWrite = syncStates.put(syncState);
          contextWrite.onerror = () =>
            abortWith(transaction, storageError(contextWrite.error));
          stateWrite.onerror = () =>
            abortWith(transaction, storageError(stateWrite.error));
          const tail = candidateRows.at(-1);
          finish({
            state,
            added: additions.length,
            snapshotBoundary: tail
              ? {
                  eventId: idToHex(tail.event_id),
                  localSequence: tail.local_sequence,
                  snapshotThroughEventId: idToHex(tail.event_id),
                  snapshotThroughLocalSequence: tail.local_sequence,
                }
              : null,
          });
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      eventsRequest.onsuccess = () => {
        rows = eventsRequest.result;
        complete();
      };
      contextRequest.onsuccess = () => {
        context = contextRequest.result;
        complete();
      };
      stateRequest.onsuccess = () => {
        syncState = stateRequest.result;
        complete();
      };
      eventsRequest.onerror = () =>
        abortWith(transaction, storageError(eventsRequest.error));
      contextRequest.onerror = () =>
        abortWith(transaction, storageError(contextRequest.error));
      stateRequest.onerror = () =>
        abortWith(transaction, storageError(stateRequest.error));
    });
  }

  markSyncInitialized() {
    const transaction = this.database.transaction(
      SYNC_STATE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(SYNC_STATE_STORE);
    const request = store.get("active");
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const state = request.result;
        if (!state) {
          abortWith(
            transaction,
            new EventStoreError("Kin has not initialized encrypted sync."),
          );
          return;
        }
        state.initialized = true;
        const write = store.put(state);
        write.onerror = () => abortWith(transaction, storageError(write.error));
        finish(state);
      };
      request.onerror = () =>
        abortWith(transaction, storageError(request.error));
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
    ROUTINE_CREATED: 14,
    ROUTINE_OCCURRENCE_COMPLETED: 15,
    ROUTINE_OCCURRENCE_REOPENED: 16,
    ROUTINE_ARCHIVED: 17,
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
  const syncFields = [
    "sync_household_id",
    "sync_member_id",
    "sync_device_id",
    "sync_identity_bindings",
  ];
  const syncFieldsPresent = syncFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(context, field),
  );
  if (
    syncFieldsPresent.length !== 0 &&
    (syncFieldsPresent.length !== syncFields.length ||
      !isId(context.sync_household_id) ||
      !isId(context.sync_member_id) ||
      !isId(context.sync_device_id) ||
      !Array.isArray(context.sync_identity_bindings) ||
      context.sync_identity_bindings.length > 256)
  ) {
    throw new EventStoreError(
      "Kin found invalid sync identity data. The stored data was preserved.",
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
  if (context.sync_household_id) {
    const bindings = new Set(
      context.sync_identity_bindings.map(
        (binding) =>
          `${binding.legacyHouseholdId}:${binding.legacyActorId}:${binding.legacyDeviceId}`,
      ),
    );
    if (
      events.some((event) => {
        if (bytesEqual(event.household_id, context.sync_household_id))
          return false;
        const key = `${idToHex(event.household_id)}:${idToHex(event.actor_id)}:${idToHex(event.device_id)}`;
        return !bindings.has(key);
      })
    )
      throw invalidCatchUpState();
    return;
  }
  if (
    events.some(
      (event) => !bytesEqual(event.household_id, context.household_id),
    )
  ) {
    throw invalidCatchUpState();
  }
}

function syncIdentityFromContext(context) {
  return context.sync_household_id
    ? {
        householdId: idToHex(context.sync_household_id),
        bindings: context.sync_identity_bindings,
      }
    : null;
}

function sameLegacyTupleForContext(binding, context) {
  return (
    binding?.legacyHouseholdId === idToHex(context.household_id) &&
    binding?.legacyActorId === idToHex(context.actor_id) &&
    binding?.legacyDeviceId === idToHex(context.device_id)
  );
}

function eventRowFromCanonical(encodedEvent) {
  const bytes = asBytes(encodedEvent).slice();
  if (bytes.length < 88)
    throw new EventStoreError("Kin received an incomplete synchronized event.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = {
    1: "ITEM_ADDED",
    2: "ITEM_COMPLETED",
    3: "ITEM_REOPENED",
    4: "ITEM_ARCHIVED",
    5: "HANDOFF_ADDED",
    6: "HANDOFF_ACKNOWLEDGED",
    7: "HANDOFF_ARCHIVED",
    8: "TALK_ADDED",
    9: "TALK_RESOLVED",
    10: "TALK_REOPENED",
    11: "TALK_ARCHIVED",
    12: "PULSE_SET",
    13: "PULSE_CLEARED",
    14: "ROUTINE_CREATED",
    15: "ROUTINE_OCCURRENCE_COMPLETED",
    16: "ROUTINE_OCCURRENCE_REOPENED",
    17: "ROUTINE_ARCHIVED",
  }[view.getUint16(2, true)];
  if (!kind)
    throw new EventStoreError(
      "Kin received an unsupported synchronized event.",
    );
  return {
    event_id: bytes.slice(4, 20),
    household_id: bytes.slice(20, 36),
    actor_id: bytes.slice(36, 52),
    device_id: bytes.slice(52, 68),
    timestamp: Number(view.getBigInt64(68, true)),
    logical_time: view.getBigUint64(76, true),
    kind,
    event_version: view.getUint16(0, true),
    encoded_event: bytes,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function cursorValue(value) {
  if (value === "") return 0n;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value))
    throw new EventStoreError("Kin received an invalid sync cursor.");
  let bytes;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    throw new EventStoreError("Kin received an invalid sync cursor.", error);
  }
  if (bytes.length !== 8)
    throw new EventStoreError("Kin received an invalid sync cursor.");
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
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
