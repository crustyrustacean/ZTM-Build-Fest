# Synchronization Design

**Status:** Current through v0.7.4 Routine Stale-Action Correctness; future architecture design. No server, network protocol, event encryption, or multi-device reconciliation is implemented. Event identity and ordering requirements are specified in [EVENTS](EVENTS.md); the threat model and cryptographic boundary are in [THREAT-MODEL](THREAT-MODEL.md) and [CRYPTOGRAPHY](CRYPTOGRAPHY.md).

## Intended direction

```text
Device A
   |
   v
local event
   |
   v
Rust validates domain event
   |
   v
IndexedDB append
   |
   v
client encrypts event payload
   |
   v
authenticated encrypted-event relay
   |
   v
Device B receives ciphertext
   |
   v
decrypt after device authorization
   |
   v
Rust validates, orders, and replays
   |
   v
derived household state
```

Each device remains useful offline. Events are committed locally first, queued for later upload, and retried safely. The receiver deduplicates by stable event ID, validates the event version, and reconstructs state using the deterministic ordering contract. No sync is included in v0.1.0.

## Server responsibility

The server is an authenticated encrypted-event relay, not the household source of truth, relationship analyst, plaintext event processor, or domain rules engine. Clients encrypt/decrypt household payloads and Rust validates/replays domain events. The server may authenticate accounts/devices, authorize access to a household's relay channel, store/forward ciphertext, enforce quotas/rate limits, and return opaque cursors.

Minimum routing metadata may include opaque household/channel ID, authorized device/account reference, event ID or opaque relay cursor, ciphertext size, upload/receipt time, and delivery status. Network services may also observe IP address, connection timing, and transport metadata. Minimize retention and access; encrypted content does not mean anonymous traffic.

The service must not receive plaintext household event payloads or household content keys. Authentication metadata and transport security remain necessary in addition to payload encryption. See [Cryptography](CRYPTOGRAPHY.md).

## Offline and delivery semantics

- Local event persistence succeeds before an event is considered locally accepted.
- Upload is at-least-once; clients must tolerate repeated delivery.
- Exact event duplicates are idempotent under the v0.0.4 event contract.
- Acknowledgement means the relay durably accepted ciphertext, not that another member read or agreed with it.
- A device may remain offline indefinitely; later synchronization must not rely on wall-clock timestamps as ordering authority.
- Authorization is checked on every sync operation. Revoked-device queued events are rejected unless an explicit, reviewed recovery procedure says otherwise.
- A client unable to decrypt or interpret an event must preserve it and surface a recoverable compatibility error; it must not silently drop it.

## Ordering and reconciliation

Use the deterministic ordering requirements in [EVENTS](EVENTS.md): logical time, then bytewise device ID, then event ID. The tuple defines reproducible replay order only. It is not a semantic “last write wins” policy and must not be presented as deciding who is right.

Conflict classes require explicit product decisions before sync ships:

| Concurrent operations                            | Required consideration                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both devices complete the same item              | Completion is naturally idempotent; preserve both distinct facts or deduplicate only exact event delivery.                                                                              |
| One archives an item while another completes it  | Archive tombstones prevent resurrection, but whether completion is retained as history and what UI communicates needs a defined policy. Do not silently discard either member's intent. |
| Both edit item text                              | Concurrent replacements cannot be resolved by total order alone. Preserve competing edits or ask for an explicit resolution; never silently overwrite based only on wall-clock time.    |
| One completes while another reopens              | State depends on event order but reflects conflicting intent; define whether a review state or explicit resolution is needed before supporting reopen+sync.                             |
| Member/device removed while offline events exist | Recheck authorization at upload; reject events from revoked devices and define user-visible recovery without bypassing revocation.                                                      |

`v0.0.5` identifies these classes and principles; it does not choose every eventual UX resolution or implement reconciliation.

## Privacy boundary

Ciphertext payloads conceal content only to the extent that key management and client integrity hold. The relay can still observe routing IDs, ciphertext lengths, timing, delivery patterns, and possibly IP/log metadata. Document retention and access controls for these fields. Do not claim perfect anonymity, complete metadata privacy, or protection from a compromised authorized client.
