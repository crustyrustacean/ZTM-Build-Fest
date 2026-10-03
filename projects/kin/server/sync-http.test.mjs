import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { PairingService } from "./pairing-service.mjs";
import { createKinServer } from "./server.mjs";
import { EncryptedSyncService } from "./sync-service.mjs";

globalThis.crypto ??= webcrypto;

const credential = (id) => ({ id, publicKey: `key-${id}`, algorithm: -7 });

async function start(service = new PairingService()) {
  const app = createKinServer({ service });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    url: `http://127.0.0.1:${app.server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        app.server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function publicKeys() {
  const [agreement, signing] = await Promise.all([
    crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]),
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]),
  ]);
  return {
    agreement: await crypto.subtle.exportKey("jwk", agreement.publicKey),
    signing: await crypto.subtle.exportKey("jwk", signing.publicKey),
  };
}

function eventEnvelope(identity, overrides = {}) {
  return {
    protocolVersion: 1,
    envelopeVersion: 1,
    eventId: "a".repeat(32),
    householdId: identity.householdId,
    deviceId: identity.deviceId,
    deviceSequence: 1,
    logicalTime: "1",
    keyEpoch: 1,
    nonce: Buffer.alloc(12, 1).toString("base64url"),
    ciphertext: Buffer.alloc(32, 2).toString("base64url"),
    signature: Buffer.alloc(64, 3).toString("base64url"),
    ...overrides,
  };
}

test("HTTP sync operations require an active session and revoked devices cannot use stale cursors", async () => {
  const service = new PairingService();
  const adult = service.bootstrap({
    credential: credential("a"),
    deviceLabel: "A",
  });
  const invite = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invite.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  service.approvePairing(adult.sessionToken, invite.pairingId, claim.version);
  const other = service.activateClaim(claim.claimToken);
  const app = await start(service);
  const call = (
    path,
    { method = "GET", body, token = adult.sessionToken } = {},
  ) =>
    fetch(`${app.url}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `kin_session=${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call("/api/sync/status", { token: null })).status, 401);
    const keys = await publicKeys();
    assert.equal(
      (
        await call("/api/sync/device-keys", {
          method: "POST",
          body: { publicKeys: keys },
        })
      ).status,
      200,
    );
    assert.equal((await call("/api/sync/status")).status, 200);
    const envelope = eventEnvelope(adult);
    assert.equal(
      (
        await call("/api/sync/events", {
          method: "POST",
          body: { events: [envelope] },
        })
      ).status,
      200,
    );
    const pulled = await call("/api/sync/events?cursor=&limit=1");
    assert.equal(
      (await pulled.json()).events[0].envelope.eventId,
      envelope.eventId,
    );

    const revoked = await call(`/api/devices/${other.deviceId}`, {
      method: "DELETE",
      body: {},
    });
    assert.equal(revoked.status, 200);
    const status = await (await call("/api/sync/status")).json();
    assert.equal(status.rotationPending, true);
    assert.equal(status.pendingEpoch, 2);
    assert.equal(
      (
        await call("/api/sync/events?cursor=AAAAAAAAAAE", {
          token: other.sessionToken,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/api/sync/events", {
          method: "POST",
          body: {
            events: [
              eventEnvelope(adult, {
                eventId: "b".repeat(32),
                deviceSequence: 2,
              }),
            ],
          },
        })
      ).status,
      409,
    );
  } finally {
    await app.close();
  }
});

test("relay restart loses only process-local ciphertext and HTTPS is required outside loopback", async () => {
  const service = new PairingService();
  const adult = service.bootstrap({
    credential: credential("a"),
    deviceLabel: "A",
  });
  const first = new EncryptedSyncService(service);
  first.push(adult.sessionToken, [eventEnvelope(adult)]);
  const restarted = new EncryptedSyncService(service);
  assert.equal(restarted.status(adult.sessionToken).eventCount, 0);
  assert.throws(
    () => createKinServer({ host: "0.0.0.0", origin: "http://localhost:8000" }),
    /must bind to loopback/,
  );
  assert.throws(
    () => createKinServer({ host: "0.0.0.0", origin: "https://kin.example" }),
    /must bind to loopback/,
  );
  assert.doesNotThrow(() =>
    createKinServer({ host: "127.0.0.1", origin: "https://kin.example" }),
  );
});

test("full service restart loses identity/session and relay state explicitly", async () => {
  const originalService = new PairingService();
  const adult = originalService.bootstrap({
    credential: credential("restart-adult"),
    deviceLabel: "Restart device",
  });
  const first = await start(originalService);
  const firstStatus = await fetch(`${first.url}/api/sync/status`, {
    headers: { Cookie: `kin_session=${adult.sessionToken}` },
  });
  assert.equal(firstStatus.status, 200);
  await first.close();

  const restarted = await start(new PairingService());
  try {
    const identity = await fetch(`${restarted.url}/api/status`, {
      headers: { Cookie: `kin_session=${adult.sessionToken}` },
    });
    assert.equal((await identity.json()).identity, null);
    const sync = await fetch(`${restarted.url}/api/sync/status`, {
      headers: { Cookie: `kin_session=${adult.sessionToken}` },
    });
    assert.equal(sync.status, 401);
    assert.equal(restarted.syncService.households.size, 0);
  } finally {
    await restarted.close();
  }
});
