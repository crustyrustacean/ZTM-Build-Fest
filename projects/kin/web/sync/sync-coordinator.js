import {
  createHouseholdEpochKey,
  createProvisionedHouseholdEpoch,
  decryptEvent,
  decryptIdentityBinding,
  deviceKeyFingerprint,
  encryptEvent,
  encryptIdentityBinding,
  importDevicePublicKeys,
  provisionSealedEpochKey,
  restoreHouseholdEpochKey,
  unwrapEpochKey,
  verifyDeviceAuthorizationCertificate,
} from "./crypto.js";
import { SyncKeyStore } from "./key-store.js";
import { idToHex } from "../wasm/kin-engine.js";

const MAX_PUSH_BATCH = 20;
const MAX_PULL_PASSES = 5;
const KEY_GRANT_TTL_MS = 10 * 60_000;

export class SyncCoordinator {
  constructor({ store, engine, identity, onState = () => {} }) {
    this.store = store;
    this.engine = engine;
    this.identity = identity;
    this.onState = onState;
    this.keyStore = null;
    this.deviceKeys = null;
    this.timer = null;
    this.running = null;
    this.stopped = false;
  }

  async start() {
    if (!this.identity) return;
    this.stopped = false;
    this.keyStore ??= await SyncKeyStore.open();
    this.deviceKeys = await this.keyStore.getDevice(this.identity.deviceId);
    if (!this.deviceKeys) {
      const pending = await this.keyStore.getOrCreatePendingDevice();
      await api("/api/sync/device-keys", {
        method: "POST",
        body: JSON.stringify({ publicKeys: pending.publicKeys }),
      });
      this.deviceKeys = await this.keyStore.bindPendingDevice({
        deviceId: this.identity.deviceId,
        householdId: this.identity.householdId,
        memberId: this.identity.memberId,
      });
    }
    await this.syncNow();
    this.timer = setInterval(() => void this.syncNow(), 5_000);
  }

  async syncNow() {
    if (this.stopped || !this.identity) return;
    if (this.running) return this.running;
    this.running = this.runOnce()
      .catch((error) => {
        this.onState({
          state: "paused",
          message: error.message || "Device sync is paused.",
        });
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async runOnce() {
    let status = await api("/api/sync/status");
    if (!status.enabled) {
      this.onState({ state: "disabled", message: "Device sync is off." });
      return;
    }
    await this.store.requeueAfterRelayReset(status.latestCursor);
    await this.store.updateSyncServerState(status);
    this.onState({ state: "syncing", message: "Syncing this device…" });
    let devices = await this.loadDeviceDirectory();
    await this.receiveProvisioning(devices);
    status = await api("/api/sync/status");
    await this.store.updateSyncServerState(status);

    const storedSyncState = await this.store.getSyncState();
    const localRotation = storedSyncState?.pendingRotation;
    if (
      localRotation &&
      status.currentEpoch === localRotation.epoch &&
      !status.rotationPending
    ) {
      if (status.lastRotationProposalId === localRotation.proposalId) {
        const householdKey = await restoreHouseholdEpochKey({
          sealed: localRotation.sealed,
          deviceKeys: this.deviceKeys.keys,
        });
        await this.keyStore.saveEpoch({
          householdId: this.identity.householdId,
          keyEpoch: localRotation.epoch,
          householdKey,
          sealed: localRotation.sealed,
          fingerprint: localRotation.fingerprint,
        });
        await this.store.commitPendingRotation({
          expectedEpoch: localRotation.expectedEpoch,
          currentEpoch: localRotation.epoch,
        });
      } else {
        const acceptedKey = await this.keyStore.getEpoch(
          this.identity.householdId,
          status.currentEpoch,
        );
        if (!acceptedKey)
          throw new Error(
            "Another trusted device completed key rotation. This device needs its approved key transfer.",
          );
        await this.store.clearPendingRotation();
      }
    }

    let currentKey = await this.keyStore.getEpoch(
      this.identity.householdId,
      status.currentEpoch,
    );
    const ownDevice = devices.find(
      (device) => device.deviceId === this.identity.deviceId,
    );
    if (
      !currentKey &&
      status.currentEpoch === 1 &&
      status.eventCount === 0 &&
      (ownDevice?.historyFromEpoch ?? 1) <= status.currentEpoch
    ) {
      const initial = await createHouseholdEpochKey({
        householdId: this.identity.householdId,
        keyEpoch: 1,
        deviceKeys: this.deviceKeys.keys,
      });
      currentKey = await this.keyStore.saveEpoch({
        householdId: this.identity.householdId,
        keyEpoch: 1,
        ...initial,
      });
    }
    if (
      !currentKey &&
      ownDevice?.historyFromEpoch > status.currentEpoch &&
      status.rotationPending
    ) {
      throw new Error(
        "An existing trusted device needs to finish setting up household sync first.",
      );
    }
    if (status.rotationPending && currentKey) {
      await this.commitRotation(status, devices);
      status = await api("/api/sync/status");
      await this.store.updateSyncServerState(status);
      devices = await this.loadDeviceDirectory();
      currentKey = await this.keyStore.getEpoch(
        this.identity.householdId,
        status.currentEpoch,
      );
    }
    if (!currentKey) {
      throw new Error(
        "This device needs an authorized household key before sync can continue.",
      );
    }

    const bootstrap = await this.store.getSyncBootstrap();
    const remoteBindings = await this.fetchBindings(devices);
    const needsLegacyBinding = bootstrap.events.some(
      (row) =>
        idToHex(row.household_id) !== this.identity.householdId ||
        idToHex(row.actor_id) !== this.identity.memberId ||
        idToHex(row.device_id) !== this.identity.deviceId,
    );
    let legacyBindingEnvelope = null;
    if (
      needsLegacyBinding &&
      !remoteBindings.some((record) =>
        sameLegacyTuple(record.binding, bootstrap.legacyIdentity),
      )
    ) {
      const binding = {
        legacyHouseholdId: bootstrap.legacyIdentity.householdId,
        legacyActorId: bootstrap.legacyIdentity.actorId,
        legacyDeviceId: bootstrap.legacyIdentity.deviceId,
        householdId: this.identity.householdId,
        actorId: this.identity.memberId,
        deviceId: this.identity.deviceId,
      };
      legacyBindingEnvelope = await encryptIdentityBinding({
        binding,
        householdId: this.identity.householdId,
        deviceId: this.identity.deviceId,
        deviceSequence: 1,
        logicalTime: (bootstrap.maxLogicalTime + 1n).toString(),
        keyEpoch: status.currentEpoch,
        householdKey: currentKey.householdKey,
        signingKey: this.deviceKeys.keys.signingPrivateKey,
      });
      remoteBindings.push({ binding, envelope: legacyBindingEnvelope });
    }

    let syncState = await this.store.getSyncState();
    if (!syncState) {
      await this.store.initializeSync({
        identity: this.identity,
        serverStatus: status,
        identityBindings: remoteBindings,
        legacyBindingEnvelope,
      });
    } else if (remoteBindings.length) {
      await this.store.installIdentityBindings(remoteBindings, this.identity);
    }

    await this.pushIdentityBindings();
    await this.pushPendingEvents();
    let passes = 0;
    let hasMore = true;
    while (hasMore && passes < MAX_PULL_PASSES) {
      const syncStateBefore = await this.store.getSyncState();
      const page = await api(
        `/api/sync/events?cursor=${encodeURIComponent(syncStateBefore.syncCursor)}&limit=${MAX_PUSH_BATCH}`,
      );
      const verified = [];
      for (const item of page.events) {
        const envelope = item.envelope;
        const signer = devices.find(
          (device) => device.deviceId === envelope.deviceId,
        );
        if (!signer?.publicKeys)
          throw new Error(
            "A synchronized event came from an unknown trusted device.",
          );
        if (signer.revokedAt && envelope.keyEpoch >= status.currentEpoch)
          throw new Error(
            "A revoked device cannot author events in the current key epoch.",
          );
        if (envelope.keyEpoch < signer.historyFromEpoch)
          throw new Error(
            "This device is not authorized to receive that event history.",
          );
        const epoch = await this.keyStore.getEpoch(
          this.identity.householdId,
          envelope.keyEpoch,
        );
        if (!epoch)
          throw new Error(
            `This device is missing key epoch ${envelope.keyEpoch}; sync is paused.`,
          );
        const signerKeys = await importDevicePublicKeys(signer.publicKeys);
        const encodedEvent = await decryptEvent({
          envelope,
          householdKey: epoch.householdKey,
          signingKey: signerKeys.signing,
        });
        validateCanonicalIdentity({
          encodedEvent,
          envelope,
          signer,
          householdId: this.identity.householdId,
          bindings: remoteBindings.map((record) => record.binding),
        });
        verified.push({ encodedEvent });
      }
      const committed = await this.store.commitRemoteBatch({
        received: verified,
        nextCursor: page.nextCursor,
        engine: this.engine,
      });
      this.onState({
        state: "syncing",
        message: committed.added
          ? "Household changes received."
          : "Device sync is up to date.",
        projection: committed.state,
        snapshotBoundary: committed.snapshotBoundary,
      });
      hasMore = page.hasMore;
      passes += 1;
    }

    const pendingOutbox = await this.store.getPendingOutbox(1);
    const pendingBindings = await this.store.getPendingBindings();
    if (!hasMore && pendingOutbox.length === 0 && pendingBindings.length === 0)
      await this.store.markSyncInitialized();
    this.onState({
      state: hasMore ? "syncing" : "ready",
      message: hasMore
        ? "Sync will continue in the background."
        : "Device sync is up to date.",
    });
  }

  async loadDeviceDirectory() {
    const { devices } = await api("/api/sync/devices");
    const byId = new Map(devices.map((device) => [device.deviceId, device]));
    const verified = new Set();
    const checking = new Set();
    const verify = async (deviceId) => {
      if (verified.has(deviceId)) return;
      if (checking.has(deviceId))
        throw new Error(
          "Kin found a cycle in the trusted-device approval chain.",
        );
      const device = byId.get(deviceId);
      if (!device?.publicKeys || !device.fingerprint)
        throw new Error(
          "A trusted device must register its sync key before synchronization.",
        );
      if (device.householdId !== this.identity.householdId)
        throw new Error(
          "A trusted-device directory entry belongs to another household.",
        );
      if (
        (await deviceKeyFingerprint(device.publicKeys)) !== device.fingerprint
      )
        throw new Error(
          "A trusted device key does not match its approved fingerprint.",
        );
      if (deviceId === this.identity.deviceId) {
        if (
          device.memberId !== this.identity.memberId ||
          device.fingerprint !== this.deviceKeys.fingerprint
        )
          throw new Error(
            "This browser's local sync key does not match its trusted-device record.",
          );
        verified.add(deviceId);
        return;
      }
      const pin = await this.keyStore.getPinnedDevice(
        this.identity.householdId,
        deviceId,
      );
      if (pin) {
        if (
          pin.memberId !== device.memberId ||
          pin.fingerprint !== device.fingerprint
        )
          throw new Error(
            "A trusted device key changed after it was approved.",
          );
        verified.add(deviceId);
        return;
      }
      const certificate = device.certificate;
      const issuer = byId.get(certificate?.issuerDeviceId);
      if (!certificate || !issuer)
        throw new Error(
          "A trusted device has no verifiable approval certificate.",
        );
      checking.add(deviceId);
      await verify(issuer.deviceId);
      await verifyDeviceAuthorizationCertificate({
        certificate,
        issuerPublicKeys: issuer.publicKeys,
        issuerDeviceId: issuer.deviceId,
        device,
      });
      checking.delete(deviceId);
      verified.add(deviceId);
    };
    for (const device of devices)
      if (device.publicKeys || device.deviceId === this.identity.deviceId)
        await verify(device.deviceId);
    return devices;
  }

  async receiveProvisioning(devices) {
    while (true) {
      const { grants } = await api("/api/sync/provisioning");
      if (grants.length === 0) return;
      for (const grant of grants) {
        const sender = devices.find(
          (device) => device.deviceId === grant.senderDeviceId,
        );
        if (!sender?.publicKeys)
          throw new Error(
            "A key transfer came from an unknown trusted device.",
          );
        const signer = await importDevicePublicKeys(sender.publicKeys);
        const received = await unwrapEpochKey({
          package: grant.package,
          deviceKeys: this.deviceKeys.keys,
          householdId: this.identity.householdId,
          deviceId: this.identity.deviceId,
          deviceFingerprint: this.deviceKeys.fingerprint,
          senderSigningKey: signer.signing,
        });
        await this.keyStore.saveEpoch({
          householdId: this.identity.householdId,
          keyEpoch: grant.keyEpoch,
          ...received,
        });
        await api(`/api/sync/provisioning/${grant.grantId}/ack`, {
          method: "POST",
          body: "{}",
        });
      }
    }
  }

  async commitRotation(status, devices) {
    const expectedEpoch = status.currentEpoch;
    const epoch = expectedEpoch + 1;
    let pending = (await this.store.getSyncState())?.pendingRotation;
    if (!pending) {
      const currentKey = await this.keyStore.getEpoch(
        this.identity.householdId,
        expectedEpoch,
      );
      if (!currentKey)
        throw new Error(
          "The current household key is unavailable for rotation.",
        );
      const recipients = devices
        .filter(
          (device) =>
            device.deviceId !== this.identity.deviceId &&
            !device.revokedAt &&
            device.publicKeys,
        )
        .map((device) => ({
          deviceId: device.deviceId,
          publicKeys: device.publicKeys,
          fingerprint: device.fingerprint,
        }));
      const rotation = await createProvisionedHouseholdEpoch({
        householdId: this.identity.householdId,
        keyEpoch: epoch,
        deviceKeys: this.deviceKeys.keys,
        senderDeviceId: this.identity.deviceId,
        recipients,
        expiresAt: Date.now() + KEY_GRANT_TTL_MS,
      });
      pending = await this.store.savePendingRotation({
        expectedEpoch,
        epoch,
        proposalId: randomIdHex(),
        sealed: rotation.sealed,
        fingerprint: rotation.fingerprint,
        packages: rotation.packages,
      });
    }
    const result = await api("/api/sync/epochs", {
      method: "POST",
      body: JSON.stringify({
        expectedEpoch: pending.expectedEpoch,
        packages: pending.packages,
        proposalId: pending.proposalId,
      }),
    });
    const householdKey = await restoreHouseholdEpochKey({
      sealed: pending.sealed,
      deviceKeys: this.deviceKeys.keys,
    });
    await this.keyStore.saveEpoch({
      householdId: this.identity.householdId,
      keyEpoch: result.currentEpoch,
      householdKey,
      sealed: pending.sealed,
      fingerprint: pending.fingerprint,
    });
    await this.store.commitPendingRotation({
      expectedEpoch: pending.expectedEpoch,
      currentEpoch: result.currentEpoch,
    });
    await this.provisionMemberHistory(
      result.currentEpoch,
      await this.loadDeviceDirectory(),
    );
  }

  async provisionMemberHistory(currentEpoch, devices) {
    for (const recipient of devices) {
      if (
        recipient.deviceId === this.identity.deviceId ||
        recipient.revokedAt ||
        recipient.memberId !== this.identity.memberId ||
        (recipient.historyFromEpoch ?? 1) >= currentEpoch ||
        !recipient.publicKeys
      )
        continue;
      for (
        let keyEpoch = recipient.historyFromEpoch ?? 1;
        keyEpoch < currentEpoch;
        keyEpoch += 1
      ) {
        if (recipient.provisionedEpochs?.includes(keyEpoch)) continue;
        const request = await this.store.getProvisioningRequest(
          recipient.deviceId,
          keyEpoch,
        );
        if (request.accepted) continue;
        const key = await this.keyStore.getEpoch(
          this.identity.householdId,
          keyEpoch,
        );
        if (!key)
          throw new Error(
            `Historical key epoch ${keyEpoch} is missing on this device.`,
          );
        const grant = await api("/api/sync/provisioning/grants", {
          method: "POST",
          body: JSON.stringify({
            recipientDeviceId: recipient.deviceId,
            keyEpoch,
            requestId: request.requestId,
          }),
        });
        let keyPackage = request.package;
        if (
          !keyPackage ||
          keyPackage.grantId !== grant.grantId ||
          keyPackage.expiresAt <= Date.now()
        ) {
          keyPackage = await provisionSealedEpochKey({
            sealed: key.sealed,
            deviceKeys: this.deviceKeys.keys,
            grant: {
              ...grant,
              recipientPublicKeys: grant.recipientPublicKeys,
              signingKey: this.deviceKeys.keys.signingPrivateKey,
            },
          });
          await this.store.updateProvisioningRequest(request.requestId, {
            package: keyPackage,
          });
        }
        await api(`/api/sync/provisioning/grants/${grant.grantId}`, {
          method: "POST",
          body: JSON.stringify({ package: keyPackage }),
        });
        await this.store.updateProvisioningRequest(request.requestId, {
          accepted: true,
        });
      }
    }
  }

  async fetchBindings(devices) {
    const result = [];
    let cursor = "";
    while (true) {
      const page = await api(
        `/api/sync/bindings?cursor=${encodeURIComponent(cursor)}`,
      );
      for (const envelope of page.bindings) {
        const sender = devices.find(
          (device) => device.deviceId === envelope.deviceId,
        );
        if (!sender?.publicKeys)
          throw new Error(
            "A household identity record came from an unknown device.",
          );
        const epoch = await this.keyStore.getEpoch(
          this.identity.householdId,
          envelope.keyEpoch,
        );
        if (!epoch)
          throw new Error(
            `A historical identity key for epoch ${envelope.keyEpoch} is missing.`,
          );
        const signer = await importDevicePublicKeys(sender.publicKeys);
        const binding = await decryptIdentityBinding({
          envelope,
          householdKey: epoch.householdKey,
          signingKey: signer.signing,
          expectedHouseholdId: this.identity.householdId,
        });
        if (
          binding.actorId !== sender.memberId ||
          binding.deviceId !== sender.deviceId
        )
          throw new Error(
            "A household identity record does not match its trusted signer.",
          );
        result.push({ binding, envelope });
      }
      if (!page.hasMore) break;
      if (page.nextCursor === cursor)
        throw new Error("Kin could not advance the household identity cursor.");
      cursor = page.nextCursor;
    }
    return result;
  }

  async pushIdentityBindings() {
    const pending = await this.store.getPendingBindings();
    for (const record of pending) {
      await api("/api/sync/bindings", {
        method: "POST",
        body: JSON.stringify({ bindings: [record.controlEnvelope] }),
      });
      await this.store.markBindingUploaded(record.legacy_key);
    }
  }

  async pushPendingEvents() {
    while (true) {
      const pending = await this.store.getPendingOutbox(MAX_PUSH_BATCH);
      if (!pending.length) return;
      const envelopes = [];
      for (const row of pending) {
        if (row.envelope) {
          envelopes.push(row.envelope);
          continue;
        }
        if (row.keyEpoch == null)
          throw new Error(
            "Device sync is paused until household key rotation completes.",
          );
        const keyEpoch = row.keyEpoch;
        const epoch = await this.keyStore.getEpoch(
          this.identity.householdId,
          keyEpoch,
        );
        if (!epoch)
          throw new Error(
            `The current household key epoch ${keyEpoch} is missing.`,
          );
        const view = new DataView(
          row.canonical_event.buffer,
          row.canonical_event.byteOffset,
          row.canonical_event.byteLength,
        );
        const envelope = await encryptEvent({
          eventId: row.event_id,
          householdId: row.householdId,
          deviceId: row.deviceId,
          deviceSequence: row.deviceSequence,
          logicalTime: view.getBigUint64(76, true).toString(),
          keyEpoch,
          plaintext: row.canonical_event,
          householdKey: epoch.householdKey,
          signingKey: this.deviceKeys.keys.signingPrivateKey,
        });
        await this.store.storeOutboxEnvelope(row.event_id, envelope, keyEpoch);
        envelopes.push(envelope);
      }
      const acknowledgement = await api("/api/sync/events", {
        method: "POST",
        body: JSON.stringify({ events: envelopes }),
      });
      for (const envelope of envelopes)
        await this.store.markOutboxAccepted(
          envelope.eventId,
          acknowledgement.latestCursor,
        );
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    this.keyStore?.close();
    this.keyStore = null;
  }
}

function validateCanonicalIdentity({
  encodedEvent,
  envelope,
  signer,
  householdId,
  bindings,
}) {
  if (!(encodedEvent instanceof Uint8Array) || encodedEvent.length < 88)
    throw new Error("Kin received an incomplete canonical event.");
  const view = new DataView(
    encodedEvent.buffer,
    encodedEvent.byteOffset,
    encodedEvent.byteLength,
  );
  const eventId = toHex(encodedEvent.subarray(4, 20));
  const embeddedHousehold = toHex(encodedEvent.subarray(20, 36));
  const embeddedActor = toHex(encodedEvent.subarray(36, 52));
  const embeddedDevice = toHex(encodedEvent.subarray(52, 68));
  if (
    eventId !== envelope.eventId ||
    envelope.householdId !== householdId ||
    view.getBigUint64(76, true).toString() !== envelope.logicalTime
  )
    throw new Error(
      "The encrypted envelope does not match its canonical event bytes.",
    );
  const directIdentity =
    embeddedHousehold === householdId &&
    embeddedActor === signer.memberId &&
    embeddedDevice === envelope.deviceId;
  if (directIdentity) return;
  const binding = bindings.find(
    (candidate) =>
      candidate.legacyHouseholdId === embeddedHousehold &&
      candidate.legacyActorId === embeddedActor &&
      candidate.legacyDeviceId === embeddedDevice,
  );
  if (
    !binding ||
    binding.householdId !== householdId ||
    binding.actorId !== signer.memberId ||
    binding.deviceId !== envelope.deviceId
  )
    throw new Error(
      "A synchronized event's embedded identity could not be verified.",
    );
}

function sameLegacyTuple(binding, identity) {
  return (
    binding.legacyHouseholdId === identity.householdId &&
    binding.legacyActorId === identity.actorId &&
    binding.legacyDeviceId === identity.deviceId
  );
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      value.message || "Kin could not synchronize this device.",
    );
    error.code = value.error;
    throw error;
  }
  return value;
}

function randomIdHex() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
