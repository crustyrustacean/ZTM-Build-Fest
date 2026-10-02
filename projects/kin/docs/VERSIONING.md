# Persistent Contract Versioning

**Status:** Talk is implemented alongside Today, Needs and Handoff. See [V0.4.0](V0.4.0.md) for the current scope, compatibility contract and release evidence.

## Independent version axes

Kin version numbers describe product releases; they do not version every persistent or transport contract.

| Version axis             | Example                     | Governs                                                                  |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------ |
| Application version      | `v0.1.0`, `v0.2.0`          | A Kin product release, source snapshot, and namespaced Git tag.          |
| Event schema version     | `event_version = 1`         | The payload/envelope interpretation for one persisted event kind.        |
| ABI/protocol version     | `protocol_version = 1, 2, or 3` | The byte-level JavaScript ↔ WASM request/result contract.                |
| IndexedDB schema version | database `version = 1`      | Object stores, indexes, and local record structure managed by IndexedDB. |
| Export format version    | `format_version = 1`        | The portable archive manifest and event-container representation.        |

These numbers evolve independently. An application release may keep the same event, protocol, storage, or export version; a contract may change between application versions. Never infer compatibility from equal version numbers or silently bump one axis as a proxy for another.

The v0.2.0 implementation reads event schema 1 for all supported kinds and schema 2 for `ITEM_ADDED`; new instances write add schema 2 and other Item event schema 1. v0.3.0 additionally reads Handoff schema 1, supports protocols 1/2/3, and writes protocol 3. IndexedDB schema remains 1. Export format version 1 is a future design baseline only.

## Compatibility policy

Newer Kin versions should read older supported household data whenever reasonably possible. Each release must declare which event, protocol, storage, and export versions it can read and write. A version is supported only when a tested decoder/migration exists; compatibility must not be assumed from a version number alone.

- **Known supported version:** decode, validate, and process according to its documented semantics.
- **Known older version with an explicit upgrader:** preserve the original record, normalize it to the current in-memory representation, and make migration atomic/recoverable.
- **Unknown or unsupported older version:** stop before modifying source data; offer a recoverable compatibility error and export/restore path where possible.
- **Unknown newer version:** do not reinterpret, skip, rewrite, or delete it. Preserve its raw bytes if possible, stop operations that would risk loss, and explain that a newer compatible Kin version is needed.

“Unsupported” means Kin cannot establish the meaning and integrity of the data safely. It does not mean invalid, disposable, or safe to delete. In a mixed-version future sync, an older client must not write a replacement snapshot that omits unknown newer events.

## Event evolution

Persisted events are immutable. A change to today's domain model does not by itself justify rewriting historical event bytes. Prefer a version-specific decoder/upgrader:

```text
immutable Event v1 bytes
          |
          v
v1 decoder and validation
          |
          v
current internal event representation
          |
          v
current reducer/projection
```

This separates durable history from evolving in-memory types and enables old history to be replayed. It has costs: old decoders remain maintenance obligations, normalization rules need tests, and an unsafe upgrader can still lose meaning. Only add an upgrader when a supported release requires it; retain original bytes and record its version/behavior.

## Backward and forward guarantees

Kin has published v0.1.x event history. v0.2.0 explicitly reads schema-v1 legacy item events, normalizes them in memory, and preserves their exact bytes; it writes schema-v2 `ITEM_ADDED` and schema-v1 lifecycle events. Protocols v1/v2/v3 are supported, with v4 written by current clients. Protocols v1/v2 reject Handoff history rather than return lossy state. IndexedDB remains schema 1. A client with no decoder for a future event must preserve it and fail closed, not pretend it has derived complete household state.

## v0.4.0 Talk

Current compatibility: protocols 1/2/3/4; writer v4; Item add schemas 1/2, lifecycle and Handoff/Talk schema 1. IndexedDB schema 1. Legacy events retain exact source bytes. Protocols 1–3 reject Talk rather than omit it. See [V0.4.0](V0.4.0.md).
