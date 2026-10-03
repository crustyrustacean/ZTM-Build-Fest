import test from "node:test";
import assert from "node:assert/strict";
import { LocalVault, randomRecoverySecret, serializeProtectedValue, deserializeProtectedValue } from "./local-vault.js";

test("recovery wrapper unlocks encrypted canonical bytes without storing root or recovery secret", async () => {
  const { vault, manifest, recoverySecret } = await LocalVault.create();
  const value = { encoded_event: new Uint8Array([0, 1, 255]), logical_time: 42n, nested: [undefined, null] };
  const context = { store: "events", id: "example" };
  const encrypted = await vault.seal(value, context);
  assert.ok(!JSON.stringify(manifest).includes(recoverySecret));
  assert.deepEqual(await vault.open(encrypted, context), value);
  vault.lock();
  const restored = await LocalVault.unlock(manifest, recoverySecret);
  assert.deepEqual(await restored.open(encrypted, context), value);
  restored.lock();
});

test("wrong recovery key and wrong credential wrapper fail closed", async () => {
  const { vault, manifest } = await LocalVault.create();
  await assert.rejects(LocalVault.unlock(manifest, randomRecoverySecret()), { code: "unlock_failed" });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const updated = await vault.addCredentialWrapper(secret, { credentialId: "credential-A", prfSalt: "salt-A" });
  const wrapper = updated.wrappers.find((entry) => entry.type === "prf");
  await assert.rejects(LocalVault.unlock(updated, crypto.getRandomValues(new Uint8Array(32)), wrapper.id), { code: "unlock_failed" });
  const unlocked = await LocalVault.unlock(updated, secret, wrapper.id);
  unlocked.lock(); vault.lock();
});

test("tampered ciphertext, nonce, salt, version and context are rejected", async () => {
  const { vault } = await LocalVault.create();
  const context = { store: "events", id: "one" };
  const envelope = await vault.seal("private household", context);
  for (const field of ["ciphertext", "nonce", "salt"])
    await assert.rejects(vault.open({ ...envelope, [field]: (envelope[field][0] === "A" ? "B" : "A") + envelope[field].slice(1) }, context));
  await assert.rejects(vault.open({ ...envelope, version: 2 }, context));
  await assert.rejects(vault.open(envelope, { store: "sync_outbox", id: "one" }));
  await assert.rejects(vault.open(envelope, { store: "events", id: "two" }));
  await assert.rejects(vault.open({ ...envelope, vaultId: "0".repeat(32) }, context));
  const { vault: other } = await LocalVault.create();
  await assert.rejects(other.open(envelope, context));
  vault.lock(); other.lock();
});

test("fresh encryptions use independent HKDF salts and nonces", async () => {
  const { vault } = await LocalVault.create();
  const records = await Promise.all(Array.from({ length: 100 }, () => vault.seal("same", { store: "events", id: "same" })));
  assert.equal(new Set(records.map((record) => record.salt)).size, 100);
  assert.equal(new Set(records.map((record) => record.nonce)).size, 100);
  assert.equal(new Set(records.map((record) => record.ciphertext)).size, 100);
  vault.lock();
});

test("credential enrollment leaves corpus unchanged and two credentials wrap same root", async () => {
  const { vault, recoverySecret } = await LocalVault.create();
  const context = { store: "events", id: "item" };
  const envelope = await vault.seal("shared history", context);
  const before = JSON.stringify(envelope);
  const alice = crypto.getRandomValues(new Uint8Array(32));
  const bob = crypto.getRandomValues(new Uint8Array(32));
  await vault.addCredentialWrapper(alice, { credentialId: "alice", prfSalt: "alice-salt" });
  const manifest = await vault.addCredentialWrapper(bob, { credentialId: "bob", prfSalt: "bob-salt" });
  for (const [credentialId, secret] of [["alice", alice], ["bob", bob]]) {
    const wrapper = manifest.wrappers.find((entry) => entry.credentialId === credentialId);
    const unlocked = await LocalVault.unlock(manifest, secret, wrapper.id);
    assert.equal(await unlocked.open(envelope, context), "shared history");
    unlocked.lock();
  }
  assert.equal(JSON.stringify(envelope), before);
  const removed = vault.removeWrapper(manifest.wrappers.find((entry) => entry.credentialId === "alice").id);
  assert.equal(removed.wrappers.length, 2);
  await assert.rejects(LocalVault.unlock(removed, alice, manifest.wrappers.find((entry) => entry.credentialId === "alice").id), { code: "wrapper_unavailable" });
  const recovered = await LocalVault.unlock(removed, recoverySecret);
  assert.equal(await recovered.open(envelope, context), "shared history");
  recovered.lock(); vault.lock();
});

test("last recovery wrapper cannot be removed", async () => {
  const { vault, manifest } = await LocalVault.create();
  assert.throws(() => vault.removeWrapper(manifest.wrappers[0].id), { code: "last_wrapper" });
  vault.lock();
});

test("lock revokes ongoing work and notifies all listeners", async () => {
  const { vault } = await LocalVault.create();
  let calls = 0;
  vault.onLock(() => { calls++; throw new Error("listener failure"); });
  vault.onLock(() => calls++);
  const pending = vault.seal("sensitive", { store: "events", id: 1 });
  vault.lock();
  await assert.rejects(pending, { code: "locked" });
  assert.equal(calls, 2);
  assert.equal(vault.root, null);
  await assert.rejects(vault.seal("no", { store: "events", id: 2 }), { code: "locked" });
  vault.lock(); assert.equal(calls, 2);
});

test("archive encryption is domain separated from local records", async () => {
  const { vault } = await LocalVault.create();
  const archive = await vault.sealArchive({ events: [new Uint8Array([1, 2])] });
  assert.deepEqual(await vault.openArchive(archive), { events: [new Uint8Array([1, 2])] });
  await assert.rejects(vault.open(archive, { store: "archive", id: "1" }));
  const local = await vault.seal("text", { store: "archive", id: "1" });
  await assert.rejects(vault.openArchive(local));
  vault.lock();
});

test("typed-value encoding preserves prototype-shaped keys as inert data", () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"text"}');
  const output = deserializeProtectedValue(serializeProtectedValue(input));
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(output.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(output, input);
});
