import { LocalVault, serializeProtectedValue, deserializeProtectedValue, toBase64Url, fromBase64Url, VaultError } from "./local-vault.js";
import { EventStore } from "../storage/event-store.js";

export async function exportHouseholdArchive({ store, engine, vault }) {
  vault.assertUnlocked();
  const snapshot = await store.snapshotForArchive();
  const source = await EventStore.securityStatus();
  const manifest = {
    formatVersion: source.formatVersion, vaultId: source.vaultId, rootVersion: source.rootVersion,
    wrappers: source.wrappers.filter((wrapper) => wrapper.type === "recovery"), verifier: source.verifier,
  };
  if (!manifest.wrappers.length) throw new VaultError("Create a verified recovery path before exporting.");
  const metadata = serializeProtectedValue({ archiveVersion: 1, manifest });
  const envelope = await vault.sealArchive(snapshot, metadata);
  vault.assertUnlocked();
  const { ciphertext, ...protection } = envelope;
  // The binary container carries raw ciphertext: base64 would make valid large
  // household histories exceed the archive framing budget unnecessarily.
  const framedMetadata = serializeProtectedValue({ archiveVersion: 1, manifest, protection });
  return engine.encodeArchive(framedMetadata, fromBase64Url(ciphertext));
}

export async function importHouseholdArchive({ bytes, recoverySecret, engine, vault }) {
  vault.assertUnlocked();
  const { metadata, ciphertext } = engine.decodeArchive(bytes);
  const header = deserializeProtectedValue(metadata);
  if (header.archiveVersion !== 1 || Object.keys(header).sort().join(",") !== "archiveVersion,manifest,protection" ||
      Object.keys(header.protection ?? {}).sort().join(",") !== "nonce,salt,vaultId,version")
    throw new VaultError("This archive version is unsupported.");
  let sourceVault;
  const unsubscribe = vault.onLock(() => sourceVault?.lock());
  try {
    sourceVault = await LocalVault.unlock(header.manifest, recoverySecret);
    vault.assertUnlocked();
    const authenticatedMetadata = serializeProtectedValue({ archiveVersion: 1, manifest: header.manifest });
    const snapshot = await sourceVault.openArchive({ ...header.protection, ciphertext: toBase64Url(ciphertext) }, authenticatedMetadata);
    vault.assertUnlocked();
    // EventStore validates and replays the whole corpus and rejects a nonempty
    // target inside the same transaction that publishes the imported history.
    return await EventStore.restoreEmpty({ vault, engine, snapshot });
  } finally {
    unsubscribe();
    sourceVault?.lock();
  }
}
