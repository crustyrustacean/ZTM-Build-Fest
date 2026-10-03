# Portable Household Data

**Status:** Current through v0.7.4 Routine Stale-Action Correctness; export/import design only. No export file, import path, integrity checker, or encryption exists. Format versioning is discussed in [VERSIONING](VERSIONING.md), migration failure behavior in [MIGRATIONS](MIGRATIONS.md), and retention/deletion in [RETENTION](RETENTION.md).

## Ownership principle

> Household members should be able to obtain a usable copy of their Kin data.

Portability is a product and privacy responsibility, not only a storage convenience. An export should remain understandable and importable without access to the original browser installation or a live Kin server.

## Conceptual export

A future portable archive (possible extension: `.kin`) contains a versioned manifest and the canonical logical event stream:

```text
Kin Export
├── format_version
├── created_at
├── household_id
├── event_count
├── events (canonical envelopes and original payload bytes)
├── optional non-authoritative projection/checkpoint
└── integrity metadata
```

This describes logical sections, not a committed file/container encoding. The export format version is separate from application, event, ABI, and IndexedDB versions. Any included projection/checkpoint is disposable and must not replace events as source of truth.

## Plaintext and encrypted exports

An export may contain sensitive household history. A plaintext export is straightforward to inspect and recover but is readable by anyone who obtains the file; the UI must warn clearly and avoid creating one silently. The user should choose where to save it and be able to cancel.

An encrypted export may be considered later. It would require a reviewed standard encryption/KDF design, secure random generation, authenticated integrity, a clear user-selected passphrase/recovery policy, and interoperable import support. Kin must not invent cryptography or imply an export is encrypted unless it actually is. The possible passphrase flow, parameters, and key management are undecided; there is no encryption implementation in this release.

For device-to-device transfer, use the same validated portable representation or a separately reviewed secure enrollment protocol. Do not treat physical proximity, a QR code, or an export file as authentication by itself.

## Import validation and atomicity

Before changing current household data, stage and validate the entire import:

- Supported `format_version` and declared counts/lengths
- Well-formed structure, bounded sizes, and valid encoding
- Event IDs, household IDs, actor/device IDs, event versions, and payloads
- Duplicate IDs: exact identical duplicates may be deduplicated; same ID with different canonical bytes is an integrity error
- Deterministic event ordering and successful full replay
- Integrity metadata, when present, with a clear distinction between accidental-corruption detection and authenticity
- Household identity compatibility and explicit choice to restore/replace versus create a separate local household

An import must not merge a different household implicitly. Validate into a temporary destination, show the user the household/date/count summary, and commit atomically only after confirmation. Invalid input leaves the existing household state and source file untouched. Unknown newer event versions are preserved and reported as unsupported; never drop them to force an import.

## Integrity limits

A checksum can detect some accidental corruption but does not prove who created the export or protect plaintext. Authentication requires a separately designed signature/key trust model; encryption/authentication claims must follow [CRYPTOGRAPHY](CRYPTOGRAPHY.md). No cryptographic export guarantees are established here.
