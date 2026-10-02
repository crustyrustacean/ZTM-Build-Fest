# Data Migrations

**Status:** Current through v0.5.0 Pulse; earlier version sections are historical contracts. See Pulse below.

## Migration categories

- **Storage migration:** change IndexedDB schema, such as database schema 1 to 2 (stores, indexes, local record layout). This is distinct from an event payload change.
- **Event/protocol migration:** decode a supported event or wire representation version into the current in-memory model. Persisted source event bytes remain immutable unless a separately reviewed, explicit export/restore conversion is required.
- **Projection migration:** change derived state, a disposable cache, or snapshot format. Rebuild from canonical events whenever possible; do not make a projection a second source of truth.
- **Export migration:** validate an older portable export format and import its logical events into the current event representation without silently dropping unsupported content.

Application, event, protocol, IndexedDB, and export versions are independent. Update only the version axis whose contract changed.

## Safety requirements

Once implementation begins, migrations must be deterministic for the same source bytes and target version, tested, and explicit about the data they read/write. They must not silently discard household events or meaningful fields. A destructive transformation requires exceptional justification, a reviewed recovery plan, and explicit user consent. Preserve original information when reasonably possible; rebuild derived state from events.

Storage changes should use an atomic IndexedDB upgrade transaction. Prepare a validated target representation before replacing source values; a failed transaction must leave the old database readable. Do not perform asynchronous network requests, cryptographic key changes, or unrelated work inside an upgrade transaction.

For an event format change, use a versioned decoder/normalizer that leaves original event bytes unchanged. v0.2.0 reads `ITEM_ADDED` schema v1 as Today and schema v2 with its explicit classification; it does not convert stored source bytes. If conversion of source bytes ever becomes unavoidable, first create and verify a portable backup, then stage the conversion separately and retain a recoverable original until successful validation.

## Failure behavior

```text
detect required migration
        |
        v
validate source and target support
        |
        v
attempt bounded, atomic migration
        |
    success? ---- no ----> abort transaction
        |                    preserve original data
       yes                   show recoverable error
        |                    offer export/restore path
        v
verify target records and replay
        |
        v
commit upgraded schema
```

A migration failure must never default to clearing IndexedDB, partially accepting the new schema, or presenting incomplete state as complete. Stop writes that could worsen the incompatibility. Preserve the database and surface a non-destructive recovery choice. If recovery cannot be guaranteed, explain that limitation rather than retrying destructive steps automatically.

## Backup before destructive changes

Before a migration that rewrites or removes user information, require a verified recovery representation that the user can store outside the current browser installation. The future portable format and its plaintext/encryption choices are described in [PORTABILITY](PORTABILITY.md). A backup is useful only if it can be read and its event stream validated; creating a file without a verification path is not a sufficient rollback plan.

## Test obligations

Migration implementations must have tests for supported old versions, malformed input, unknown newer versions, interrupted/aborted transaction behavior, preservation of original event bytes, deterministic output, successful replay after migration, and recovery from failure. No migration implementation is part of v0.1.0 beyond creating schema version 1 from an empty database.

## v0.5.0 Pulse

No migration is required. New Pulse events coexist with unchanged historical bytes in IndexedDB schema 1. See [V0.5.0](V0.5.0.md).
