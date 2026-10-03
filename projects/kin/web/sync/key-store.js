import {
  deviceKeyFingerprint,
  exportDevicePublicKeys,
  generateProtectedDeviceKeys,
  importProtectedDeviceKeys,
  createDeviceKeyTransition,
  resealHouseholdEpoch,
  verifyLegacyHouseholdEpoch,
  restoreHouseholdEpochKey,
} from "./crypto.js";
import { getActiveVault } from "../security/local-vault.js";
import { encryptedDatabase, snapshotStores, protectRows, replaceStores } from "../storage/encrypted-idb.js";

const DATABASE_NAME = "kin-crypto-keys";
const DATABASE_VERSION = 4;
const SECURITY_STORE = "security_state";
const KEY_DEFINITIONS = {
  devices: { keyPath: "deviceId" },
  epochs: { keyPath: "key", indexes: { household_id: "householdId" } },
  trusted_devices: { keyPath: "key" },
};
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

  static async open({ vault = getActiveVault() } = {}) {
    vault?.assertUnlocked();
    if (!vault) throw new SyncKeyStoreError("Unlock local household storage before accessing sync keys.");
    const database = await openRawDatabase();
    const marker = await securityRecord(database);
    if (marker?.phase !== "encrypted" || marker.vaultId !== vault.vaultId) {
      database.close();
      throw new SyncKeyStoreError("Complete local security migration before accessing sync keys.");
    }
    const store = new SyncKeyStore(encryptedDatabase(database, vault, KEY_DEFINITIONS));
    store.vault = vault;
    store.onLock = vault.onLock(() => store.close());
    return store;
  }

  async getOrCreatePendingDevice() {
    const existing = await this.getDevice(PENDING_DEVICE_ID);
    if (existing) return existing;
    const { keys, serializedKeys } = await generateProtectedDeviceKeys();
    const publicKeys = await exportDevicePublicKeys(keys);
    const candidate = {
      deviceId: PENDING_DEVICE_ID,
      serializedKeys,
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
    }).then(record => hydrateDevice(record, this.vault));
  }

  getDevice(deviceId) {
    const transaction = this.database.transaction(DEVICE_STORE, "readonly");
    const request = transaction.objectStore(DEVICE_STORE).get(deviceId);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    }).then(record => hydrateDevice(record, this.vault));
  }

  async pinTrustedDevice({
    householdId,
    deviceId,
    memberId,
    publicKeys,
    fingerprint,
  }) {
    this.vault?.assertUnlocked();
    const pin = {
      key: `${householdId}:${deviceId}`,
      householdId,
      deviceId,
      memberId,
      fingerprint,
      publicKeys: structuredClone(publicKeys),
    };
    // Verify a stable snapshot before opening IDB: its request callbacks cannot
    // retain a transaction while an unrelated Web Crypto operation is pending.
    if ((await deviceKeyFingerprint(pin.publicKeys)) !== fingerprint)
      throw new SyncKeyStoreError(
        "Kin could not match this trusted device's key fingerprint.",
      );
    this.vault?.assertUnlocked();
    const transaction = this.database.transaction(
      TRUSTED_DEVICE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(TRUSTED_DEVICE_STORE);
    const request = store.get(pin.key);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => {
        try {
          const existing = request.result;
          if (existing && existing.fingerprint !== fingerprint)
            throw new SyncKeyStoreError(
              "Kin detected that a trusted device key changed.",
            );
          if (!existing) store.add(pin);
          finish(existing ?? pin);
        } catch (error) {
          abortWith(transaction, error);
        }
      };
      request.onerror = () => abortWith(transaction, request.error);
    });
  }

  advanceTrustedDevice(pin, expectedFingerprint) {
    const tx = this.database.transaction(TRUSTED_DEVICE_STORE, "readwrite");
    const store = tx.objectStore(TRUSTED_DEVICE_STORE);
    const request = store.get(pin.key);
    return transactionResult(tx, finish => {
      request.onsuccess = () => {
        if (request.result?.fingerprint === pin.fingerprint) return finish(request.result);
        if (request.result?.fingerprint !== expectedFingerprint) return abortWith(tx, new Error("A trusted key pin changed during verification."));
        store.put(pin);
        finish(pin);
      };
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
    }).then(record => hydrateDevice(record, this.vault));
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
          sealed,
          fingerprint,
        });
        finish({
          key,
          householdId,
          keyEpoch,
          sealed,
          fingerprint,
        });
      };
      request.onerror = () => abortWith(transaction, request.error);
    }).then(record => ({ ...record, householdKey }));
  }

  getEpoch(householdId, keyEpoch) {
    const transaction = this.database.transaction(EPOCH_STORE, "readonly");
    const request = transaction
      .objectStore(EPOCH_STORE)
      .get(`${householdId}:${keyEpoch}`);
    return transactionResult(transaction, (finish) => {
      request.onsuccess = () => finish(request.result ?? null);
      request.onerror = () => abortWith(transaction, request.error);
    }).then(record => this.hydrateEpoch(record));
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
    }).then(records => Promise.all(records.map(record => this.hydrateEpoch(record))));
  }

  async hydrateEpoch(record) {
    if (!record) return null;
    const tx = this.database.transaction(DEVICE_STORE, "readonly");
    const request = tx.objectStore(DEVICE_STORE).getAll();
    const devices = await transactionResult(tx, finish => { request.onsuccess = () => finish(request.result); });
    for (const stored of devices) {
      if (stored.householdId && stored.householdId !== record.householdId) continue;
      const device = await hydrateDevice(stored, this.vault);
      try {
        const householdKey = await restoreHouseholdEpochKey({ sealed: record.sealed, deviceKeys: device.keys });
        this.vault.assertUnlocked();
        return { ...record, householdKey };
      } catch (error) { if (error.code !== "stored_key_invalid") throw error; }
    }
    throw new SyncKeyStoreError("This device cannot restore its saved household epoch key.");
  }

  async completePendingTransition(deviceId, { signal } = {}) {
    const device = await this.getDevice(deviceId);
    if (!device?.pendingTransition) return device;
    this.vault.assertUnlocked();
    await this.vault.checkSecurityEpoch?.();
    const response = await fetch("/api/sync/device-keys/successor", {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition: device.pendingTransition }),
    });
    const accepted = await response.json().catch(() => ({}));
    this.vault.assertUnlocked();
    await this.vault.checkSecurityEpoch?.();
    if (!response.ok || accepted.fingerprint !== device.fingerprint || accepted.generation !== device.pendingTransition.generation)
      throw new SyncKeyStoreError(accepted.message ?? "This device's protected key transition must be accepted before pairing or sync can continue.");
    await this.acceptTransition(deviceId, device.pendingTransition.transitionId);
    return this.getDevice(deviceId);
  }

  async acceptTransition(deviceId, transitionId) {
    const tx = this.database.transaction(DEVICE_STORE, "readwrite");
    const store = tx.objectStore(DEVICE_STORE);
    const request = store.get(deviceId);
    return transactionResult(tx, finish => {
      request.onsuccess = () => {
        const record = request.result;
        if (record?.pendingTransition?.transitionId !== transitionId) return abortWith(tx, new Error("The pending key transition changed."));
        delete record.pendingTransition;
        store.put(record);
        finish(true);
      };
    });
  }

  close() {
    this.onLock?.();
    this.onLock = null;
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

async function hydrateDevice(record, vault) {
  if (!record) return null;
  vault?.assertUnlocked();
  const { serializedKeys, ...publicRecord } = record;
  const keys = await importProtectedDeviceKeys(serializedKeys);
  vault?.assertUnlocked();
  return { ...publicRecord, keys };
}

async function openRawDatabase() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
    throw new SyncKeyStoreError("This browser cannot securely store device sync keys.");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE, { keyPath: "deviceId" });
      if (!db.objectStoreNames.contains(EPOCH_STORE)) {
        const epochs = db.createObjectStore(EPOCH_STORE, { keyPath: "key" });
        epochs.createIndex("household_id", "householdId", { unique: false });
      }
      if (!db.objectStoreNames.contains(TRUSTED_DEVICE_STORE)) db.createObjectStore(TRUSTED_DEVICE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SECURITY_STORE)) db.createObjectStore(SECURITY_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = () => { settled = true; reject(storageError(request.error)); };
    request.onblocked = () => { settled = true; reject(new SyncKeyStoreError("Close other Kin tabs before migrating device keys.")); };
  });
  database.onversionchange = () => database.close();
  return database;
}

async function securityRecord(database) {
  const rows = await snapshotStores(database, [SECURITY_STORE]);
  return rows[SECURITY_STORE].find(row => row.key === "vault");
}

// The encrypted staging journal retains one exact successor across interruptions.
// Legacy key capabilities stay intact until the event migration has committed.
export async function migrateSyncKeys(vault, { prepareOnly = true } = {}) {
  vault.assertUnlocked();
  const database = await openRawDatabase();
  try {
    const marker = await securityRecord(database);
    if (marker && marker.vaultId !== vault.vaultId) throw new SyncKeyStoreError("The key store belongs to a different local vault.");
    if (marker && !["preparing", "encrypted"].includes(marker.phase)) throw new SyncKeyStoreError("The device-key migration format is unsupported.");
    if (marker?.phase === "encrypted") return { rewrapEventRows: async rows => rows };
    const legacy = await snapshotStores(database, Object.keys(KEY_DEFINITIONS));
    let staged;
    if (marker?.phase === "preparing") {
      staged = await vault.open(marker.staging, { store: "sync-key-migration", id: "staged" });
    } else {
      staged = { devices: [], epochs: [], trusted_devices: legacy.trusted_devices };
      for (const old of legacy.devices) {
        if (!old.keys || old.serializedKeys) throw new SyncKeyStoreError("Unexpected legacy device-key format.");
        const { keys, serializedKeys } = await generateProtectedDeviceKeys();
        const publicKeys = await exportDevicePublicKeys(keys);
        const { keys: discardedKeys, ...metadata } = old;
        const fingerprint = await deviceKeyFingerprint(publicKeys);
        const next = { ...metadata, serializedKeys, publicKeys, fingerprint };
        if (old.deviceId !== PENDING_DEVICE_ID) {
          if (!old.householdId || !old.memberId) throw new SyncKeyStoreError("A legacy device has no authorized identity.");
          next.pendingTransition = await createDeviceKeyTransition({
            householdId: old.householdId, memberId: old.memberId, deviceId: old.deviceId,
            generation: (old.generation ?? 0) + 1, oldFingerprint: old.fingerprint,
            publicKeys, signingKey: old.keys.signingPrivateKey,
          });
          next.generation = next.pendingTransition.generation;
        }
        staged.devices.push(next);
      }
      for (const old of legacy.epochs) {
        const sealed = await resealForMigration(old.sealed, legacy.devices, staged.devices, old);
        const { householdKey: discardedKey, ...metadata } = old;
        staged.epochs.push({ ...metadata, sealed });
      }
      const staging = await vault.seal(staged, { store: "sync-key-migration", id: "staged" });
      const verified = await vault.open(staging, { store: "sync-key-migration", id: "staged" });
      // Verify all serialized device secrets can reconstruct the exact public key.
      for (const record of verified.devices) {
        const keys = await importProtectedDeviceKeys(record.serializedKeys);
        if (await deviceKeyFingerprint(await exportDevicePublicKeys(keys)) !== record.fingerprint)
          throw new SyncKeyStoreError("Device migration verification failed.");
      }
      await replaceStores(database, {}, { metadata: { store: SECURITY_STORE, value: {
        key: "vault", phase: "preparing", vaultId: vault.vaultId, staging,
      } }, guard: () => vault.assertUnlocked() });
    }
    const migration = {
      async rewrapEventRows(rows) {
        vault.assertUnlocked();
        for (const state of rows.sync_state ?? []) {
          if (state.pendingRotation?.sealed)
            state.pendingRotation.sealed = await resealForMigration(state.pendingRotation.sealed, legacy.devices, staged.devices);
        }
        vault.assertUnlocked();
        return rows;
      },
    };
    if (!prepareOnly) throw new SyncKeyStoreError("Device keys must be finalized only after verified event migration.");
    return migration;
  } finally { database.close(); }
}

async function resealForMigration(sealed, oldDevices, newDevices, legacyEpoch = null) {
  for (const old of oldDevices) {
    if (old.householdId && old.householdId !== sealed.householdId) continue;
    const replacement = newDevices.find(record => record.deviceId === old.deviceId);
    if (!replacement) continue;
    const newDeviceKeys = await importProtectedDeviceKeys(replacement.serializedKeys);
    try {
      if (legacyEpoch) await verifyLegacyHouseholdEpoch({ record: legacyEpoch, deviceKeys: old.keys });
      return await resealHouseholdEpoch({ sealed, oldDeviceKeys: old.keys, newDeviceKeys });
    }
    catch (error) { if (error.code !== "stored_key_invalid") throw error; }
  }
  throw new SyncKeyStoreError("A saved sync key cannot be migrated. Original data was preserved.");
}

export async function finalizeSyncKeyMigration(vault) {
  vault.assertUnlocked();
  const database = await openRawDatabase();
  try {
    const marker = await securityRecord(database);
    if (marker?.vaultId !== vault.vaultId) throw new SyncKeyStoreError("The key migration belongs to another local vault.");
    if (marker.phase === "encrypted") return;
    if (marker.phase !== "preparing") throw new SyncKeyStoreError("Prepare device-key migration before committing it.");
    const staged = await vault.open(marker.staging, { store: "sync-key-migration", id: "staged" });
    const protectedRows = await protectRows(vault, KEY_DEFINITIONS, staged);
    await replaceStores(database, protectedRows, {
      metadata: { store: SECURITY_STORE, value: { key: "vault", phase: "encrypted", vaultId: vault.vaultId } },
      guard: () => vault.assertUnlocked(),
    });
  } finally { database.close(); }
}
