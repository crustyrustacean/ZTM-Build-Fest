// Run in an isolated browser profile before application setup, never user storage.
export async function keyMigrationRegression() {
  const { LocalVault } = await import('/security/local-vault.js');
  const { SyncKeyStore, migrateSyncKeys, finalizeSyncKeyMigration } = await import('/sync/key-store.js');
  const { generateDeviceKeys, exportDevicePublicKeys, deviceKeyFingerprint, createHouseholdEpochKey,
    restoreHouseholdEpochKey, encryptEvent, decryptEvent } = await import('/sync/crypto.js');
  const assertFails = async action => {
    let failed = false;
    try { await action(); } catch { failed = true; }
    if (!failed) throw new Error('Expected the protected key operation to fail closed.');
  };
  const check = (value, message) => { if (!value) throw new Error(message); };
  const name = 'kin-crypto-keys';
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close key store connections before isolated regression.'));
  });
  const raw = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('devices', { keyPath: 'deviceId' });
      request.result.createObjectStore('epochs', { keyPath: 'key' }).createIndex('household_id', 'householdId');
      request.result.createObjectStore('trusted_devices', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const identity = { householdId: 'a'.repeat(32), memberId: 'b'.repeat(32), deviceId: 'c'.repeat(32) };
  const keys = await generateDeviceKeys();
  const publicKeys = await exportDevicePublicKeys(keys);
  const fingerprint = await deviceKeyFingerprint(publicKeys);
  const epoch = await createHouseholdEpochKey({ householdId: identity.householdId, keyEpoch: 1, deviceKeys: keys });
  const rotation = await createHouseholdEpochKey({ householdId: identity.householdId, keyEpoch: 2, deviceKeys: keys });
  await new Promise((resolve, reject) => {
    const tx = raw.transaction(['devices', 'epochs'], 'readwrite');
    tx.objectStore('devices').add({ ...identity, keys, publicKeys, fingerprint });
    tx.objectStore('epochs').add({ key: `${identity.householdId}:1`, householdId: identity.householdId, keyEpoch: 1, ...epoch });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  raw.close();
  const { vault, manifest, recoverySecret } = await LocalVault.create();
  const conflicting = await createHouseholdEpochKey({ householdId: identity.householdId, keyEpoch: 1, deviceKeys: keys });
  await writeLegacyEpoch({ ...epoch, sealed: conflicting.sealed, fingerprint: conflicting.fingerprint });
  await assertFails(() => migrateSyncKeys(vault, { prepareOnly: true }));
  const rejectedRows = await rawRows();
  check(rejectedRows.epochs[0].householdKey instanceof CryptoKey && rejectedRows.devices[0].keys.signingPrivateKey instanceof CryptoKey,
    'AES/sealed mismatch must preserve every original key capability');
  check(rejectedRows.security_state.length === 0, 'AES/sealed mismatch must not commit a migration journal');
  await writeLegacyEpoch(epoch);
  await migrateSyncKeys(vault, { prepareOnly: true });
  await assertFails(() => SyncKeyStore.open({ vault }));
  const staged = await rawRows();
  check(staged.devices[0].keys.signingPrivateKey instanceof CryptoKey, 'legacy key preserved before verification');
  const firstStage = JSON.stringify(staged.security_state);
  const resumed = await migrateSyncKeys(vault, { prepareOnly: true });
  check(firstStage === JSON.stringify((await rawRows()).security_state), 'resume must reuse exact staged successor');
  const eventRows = await resumed.rewrapEventRows({ sync_state: [{ key: 'active', pendingRotation: { sealed: rotation.sealed } }] });
  await finalizeSyncKeyMigration(vault);
  const store = await SyncKeyStore.open({ vault });
  const device = await store.getDevice(identity.deviceId);
  check(device.keys.signingPrivateKey.extractable === false, 'runtime signing key must not be extractable');
  check(device.pendingTransition.oldFingerprint === fingerprint, 'transition must retain authenticated predecessor');
  const restored = await store.getEpoch(identity.householdId, 1);
  const pendingKey = await restoreHouseholdEpochKey({ sealed: eventRows.sync_state[0].pendingRotation.sealed, deviceKeys: device.keys });
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, rotation.householdKey, new Uint8Array([42]));
  check(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, pendingKey, encrypted))[0] === 42, 'pending rotation must survive key migration');
  const persisted = await rawRows();
  for (const name of ['devices', 'epochs', 'trusted_devices']) for (const row of persisted[name]) {
    check(row.protected_version === 1, 'all key rows must be protected');
    check(!row.keys && !row.householdKey && !row.serializedKeys && !row.pendingTransition, 'no persisted usable private material');
  }
  check(!persisted.security_state[0].staging, 'final commit must remove migration staging');
  const plaintext = new TextEncoder().encode('retained history');
  const envelope = await encryptEvent({ ...identity, eventId: 'd'.repeat(32), deviceSequence: 1, logicalTime: 1,
    keyEpoch: 1, plaintext, householdKey: epoch.householdKey, signingKey: keys.signingPrivateKey });
  check(new TextDecoder().decode(await decryptEvent({ envelope, householdKey: restored.householdKey, signingKey: keys.signingPublicKey })) === 'retained history', 'historical epoch unchanged');
  store.close();
  vault.lock();
  await assertFails(() => store.getDevice(identity.deviceId));
  const reopenedVault = await LocalVault.unlock(manifest, recoverySecret);
  const reopened = await SyncKeyStore.open({ vault: reopenedVault });
  check((await reopened.getEpoch(identity.householdId, 1)).householdKey instanceof CryptoKey, 'reload must restore protected epoch');
  reopened.close(); reopenedVault.lock();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
  });
  return 'PASS legacy AES/seal mismatch preservation, staged nonextractable-key migration, exact interrupted retry, rotation reseal, protected persistence, recovery reload and lock';

  async function writeLegacyEpoch(value) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('epochs', 'readwrite');
        tx.objectStore('epochs').put({ key: `${identity.householdId}:1`, householdId: identity.householdId, keyEpoch: 1, ...value });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  async function rawRows() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 4);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const names = ['devices', 'epochs', 'trusted_devices', 'security_state'];
        const tx = db.transaction(names, 'readonly'); const result = {};
        for (const name of names) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; }; }
        tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
}
