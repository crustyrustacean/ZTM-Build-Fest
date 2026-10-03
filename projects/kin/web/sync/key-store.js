import {
  deviceKeyFingerprint,
  exportDevicePublicKeys,
  generateDeviceKeys,
} from "./crypto.js";

const DATABASE_NAME = "kin-crypto-keys";
const DATABASE_VERSION = 3;
const DEVICE_STORE = "devices";
const EPOCH_STORE = "epochs";
const TRUSTED_DEVICE_STORE = "trusted_devices";
const PENDING_DEVICE_ID = "pending";
const MAX_KEY_EPOCHS = 128;

export class SyncKeyStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "SyncKeyStoreError";
  }
}

export class SyncKeyStore {
  constructor(database) {
    this.database = database;
  }

  static async open() {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
      throw new SyncKeyStoreError(
        "This browser cannot securely store the keys needed for device sync.",
      );
    }
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DEVICE_STORE))
          db.createObjectStore(DEVICE_STORE, { keyPath: "deviceId" });
        if (!db.objectStoreNames.contains(EPOCH_STORE)) {
          const epochs = db.createObjectStore(EPOCH_STORE, { keyPath: "key" });
          epochs.createIndex("household_id", "householdId", { unique: false });
        }
        if (!db.objectStoreNames.contains(TRUSTED_DEVICE_STORE))
          db.createObjectStore(TRUSTED_DEVICE_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () =>
        reject(
          new SyncKeyStoreError(
            "Kin could not open secure key storage. Close other Kin tabs and try again.",
          ),
        );
    });
    database.onversionchange = () => database.close();
    return new SyncKeyStore(database);
  }

  async getOrCreatePendingDevice() {
    const existing = await this.getDevice(PENDING_DEVICE_ID);
    if (existing) return existing;
    const keys = await generateDeviceKeys();
    const publicKeys = await exportDevicePublicKeys(keys);
    const candidate = {
      deviceId: PENDING_DEVICE_ID,
      keys,
      publicKeys,
      fingerprint: await deviceKeyFingerprint(publicKeys),
      createdAt: Date.now(),
    };
    const transaction = this.database.transaction(DEVICE_STORE, "readwrite");
    const store = transaction.objectStore(DEVICE_STORE);
    let result;
    return transactionResult(transaction, (finish) => {
      const request = store.get(PENDING_DEVICE_ID);
      request.onsuccess = () => {
        result = request.result ?? candidate;
        if (!request.result) store.add(candidate);
        finish(result);
      };
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  getDevice(deviceId) {
    const transaction = this.database.transaction(DEVICE_STORE, "readonly");
    const request = transaction.objectStore(DEVICE_STORE).get(deviceId);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  async pinTrustedDevice({
    householdId,
    deviceId,
    memberId,
    publicKeys,
    fingerprint,
  }) {
    if ((await deviceKeyFingerprint(publicKeys)) !== fingerprint)
      throw new SyncKeyStoreError(
        "Kin could not match this trusted device's key fingerprint.",
      );
    const key = `${householdId}:${deviceId}`;
    const transaction = this.database.transaction(
      TRUSTED_DEVICE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(TRUSTED_DEVICE_STORE);
    const request = store.get(key);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const existing = request.result;
        if (existing && existing.fingerprint !== fingerprint) {
          abortWith(
            transaction,
            new SyncKeyStoreError(
              "Kin detected that a trusted device key changed.",
            ),
          );
          return;
        }
        const pin = {
          key,
          householdId,
          deviceId,
          memberId,
          fingerprint,
          publicKeys: structuredClone(publicKeys),
        };
        if (!existing) store.add(pin);
        finish(existing ?? pin);
      };
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  getPinnedDevice(householdId, deviceId) {
    const transaction = this.database.transaction(
      TRUSTED_DEVICE_STORE,
      "readonly",
    );
    const request = transaction
      .objectStore(TRUSTED_DEVICE_STORE)
      .get(`${householdId}:${deviceId}`);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  pinTrustedDevice({
    householdId,
    deviceId,
    memberId,
    publicKeys,
    fingerprint,
  }) {
    const key = `${householdId}:${deviceId}`;
    const transaction = this.database.transaction(
      TRUSTED_DEVICE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(TRUSTED_DEVICE_STORE);
    const request = store.get(key);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = async () => {
        try {
          if ((await deviceKeyFingerprint(publicKeys)) !== fingerprint)
            throw new SyncKeyStoreError(
              "Kin could not match this trusted device's key fingerprint.",
            );
          const existing = request.result;
          if (existing && existing.fingerprint !== fingerprint)
            throw new SyncKeyStoreError(
              "Kin detected that a trusted device key changed.",
            );
          const pin = {
            key,
            householdId,
            deviceId,
            memberId,
            fingerprint,
            publicKeys: structuredClone(publicKeys),
          };
          if (!existing) store.add(pin);
          finish(existing ?? pin);
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  getPinnedDevice(householdId, deviceId) {
    const transaction = this.database.transaction(
      TRUSTED_DEVICE_STORE,
      "readonly",
    );
    const request = transaction
      .objectStore(TRUSTED_DEVICE_STORE)
      .get(`${householdId}:${deviceId}`);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  bindPendingDevice({ deviceId, householdId, memberId }) {
    const transaction = this.database.transaction(DEVICE_STORE, "readwrite");
    const store = transaction.objectStore(DEVICE_STORE);
    const pendingRequest = store.get(PENDING_DEVICE_ID);
    const existingRequest = store.get(deviceId);
    return transactionResult(transaction, (finish) => {
      let pending;
      let existing;
      let ready = 0;
      const complete = () => {
        ready += 1;
        if (ready !== 2) return;
        if (existing) {
          store.delete(PENDING_DEVICE_ID);
          finish(existing);
          return;
        }
        if (!pending) {
          abortWith(
            transaction,
            new SyncKeyStoreError(
              "Kin could not find this device's locally generated sync keys.",
            ),
          );
          return;
        }
        const bound = { ...pending, deviceId, householdId, memberId };
        store.add(bound);
        store.delete(PENDING_DEVICE_ID);
        finish(bound);
      };
      pendingRequest.onsuccess = () => {
        pending = pendingRequest.result;
        complete();
      };
      existingRequest.onsuccess = () => {
        existing = existingRequest.result;
        complete();
      };
      pendingRequest.onerror = () =>
        abortWith(transaction, pendingRequest.error);
      existingRequest.onerror = () =>
        abortWith(transaction, existingRequest.error);
    });
  }

  saveEpoch({ householdId, keyEpoch, householdKey, sealed, fingerprint }) {
    if (
      !Number.isSafeInteger(keyEpoch) ||
      keyEpoch < 1 ||
      keyEpoch > MAX_KEY_EPOCHS
    )
      throw new SyncKeyStoreError(
        "Kin reached its supported household-key history limit.",
      );
    const transaction = this.database.transaction(EPOCH_STORE, "readwrite");
    const store = transaction.objectStore(EPOCH_STORE);
    const key = `${householdId}:${keyEpoch}`;
    const request = store.get(key);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        const existing = request.result;
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            abortWith(
              transaction,
              new SyncKeyStoreError(
                "Kin found conflicting key material for this household epoch.",
              ),
            );
            return;
          }
          finish(existing);
          return;
        }
        store.add({
          key,
          householdId,
          keyEpoch,
          householdKey,
          sealed,
          fingerprint,
        });
        finish({
          key,
          householdId,
          keyEpoch,
          householdKey,
          sealed,
          fingerprint,
        });
      };
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  getEpoch(householdId, keyEpoch) {
    const transaction = this.database.transaction(EPOCH_STORE, "readonly");
    const request = transaction
      .objectStore(EPOCH_STORE)
      .get(`${householdId}:${keyEpoch}`);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  listEpochs(householdId) {
    const transaction = this.database.transaction(EPOCH_STORE, "readonly");
    const request = transaction
      .objectStore(EPOCH_STORE)
      .index("household_id")
      .getAll(householdId);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result);
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  close() {
    this.database.close();
  }
}

function transactionResult(transaction, schedule) {
  return new Promise((resolve, reject) => {
    let result;
    let hasResult = false;
    transaction.oncomplete = () =>
      hasResult ? resolve(result) : reject(storageError(transaction.error));
    transaction.onabort = () =>
      reject(transaction.__kinFailure ?? storageError(transaction.error));
    transaction.onerror = () => {};
    try {
      schedule((value) => {
        result = value;
        hasResult = true;
      });
    } catch (error) {
      abortWith(transaction, error);
    }
  });
}

function abortWith(transaction, error) {
  transaction.__kinFailure = storageError(error);
  try {
    transaction.abort();
  } catch {
    // The transaction has already stopped; its abort handler reports failure.
  }
}

function storageError(error) {
  return error instanceof SyncKeyStoreError
    ? error
    : new SyncKeyStoreError(
        "Kin could not securely save or read this device's sync keys.",
        error,
      );
}
