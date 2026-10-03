# Architecture

**Status:** Current through v0.9.3 encrypted sync. JavaScript owns Web Crypto, local key persistence, pairing/device transport, and IndexedDB v2 outbox/cursor integration. Rust owns protocol v8 identity resolution, deterministic distributed replay, and domain state. The same-origin service authorizes and relays opaque encrypted records but remains in-memory.

## System shape

```text
Web Components
      |
      v
Vanilla JavaScript and browser APIs
      |
      v
Household event stream
      |
      v
Rust compiled for WebAssembly
      |
      v
Derived household state
      |
      +------> Web Components render the result
```

The v0.1.0 module layout and ABI are implemented as documented in [IMPLEMENTATION](IMPLEMENTATION.md) and [ABI](ABI.md). The boundary is the important part: browser concerns stay in the browser layer; authoritative, deterministic household-state rules live in Rust.

## Browser and JavaScript responsibilities

JavaScript owns browser integration and presentation:

- DOM, Web Components, rendering, and browser events
- IndexedDB and persistence lifecycle
- WebAuthn authentication and Web Crypto encryption/key wrapping
- Networking and synchronization transport
- Browser lifecycle and accessibility interactions
- Loading the WebAssembly module and passing data across the boundary

JavaScript should not duplicate Kin's authoritative household-state logic. It may validate UI input for usability, but Rust remains responsible for validating events and deriving state.

## Rust and WebAssembly responsibilities

Rust owns deterministic domain behavior:

- Household event model and event validation
- State transitions and reconstruction by replay
- Recurrence rules when routines are introduced
- Diffing and useful search/indexing where justified
- Distributed v8 event ordering and deterministic domain replay

Rust must not manipulate the DOM. It should be possible to test domain behavior independently from browser rendering and storage.

## Manual WebAssembly boundary

The v0.1.0 implementation targets `wasm32-unknown-unknown` and uses the explicit JavaScript-to-WASM ABI in [ABI](ABI.md). It has no `wasm-bindgen`, `web-sys`, `js-sys`, `serde`, or framework runtime dependency.

A manual ABI is implemented for v0.1.0 in [ABI](ABI.md), including exported function signatures, versioned request/result encoding, ownership and lifetimes, errors, bounds, and repeated-call behavior. JavaScript allocates/copies input and decodes output; Rust reads validated input ranges and returns a well-defined result. The browser layer retains ownership of DOM, storage, cryptographic APIs, networking, and lifecycle integration.

The manual boundary keeps the interface visible and avoids convenience bindings before a demonstrated need. A later requirement may justify revisiting that choice through an explicit architecture decision; the v0.1.0 implementation must follow the current contract.

## Local-first progression

The current implementation works locally:

```text
Browser UI
    |
    v
IndexedDB event log
    |
    v
Rust reconstructs household state
```

Opt-in encrypted sync now extends the local-first event store. The browser encrypts the exact canonical event bytes, the authenticated service stores/forwards opaque envelopes, and Rust validates/replays decrypted canonical records on each authorized device:

```text
Device A <---- encrypted event sync ----> Service <---- encrypted event sync ----> Device B
```

The service is not a household source of truth or plaintext domain processor. It still sees routing/membership metadata, event timing/count/size, cursors, and traffic patterns; it controls availability. Identity and relay records are process-memory only, so acknowledgement is not durable. The implementation and limitations are documented in [SYNC](SYNC.md), [IDENTITY](IDENTITY.md), [CRYPTOGRAPHY](CRYPTOGRAPHY.md), and [THREAT-MODEL](THREAT-MODEL.md).

## Future capability leverage

The v0.1.x core is intended to be extended, not treated as proof that later features already exist:

| Future capability     | Foundation already present                           | Extendable without replacing the core? | Still required                                                        |
| --------------------- | ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Today / Needs         | Versioned event pipeline and Rust-derived projection | Implemented in v0.2.0                  | Stabilization and accessibility audit in v0.2.1–v0.2.3                |
| Handoff               | Actor-aware immutable event envelope                 | Implemented in v0.3.0                  | Stabilization through v0.3.3                                          |
| Talk                  | Identified events and deterministic replay           | Implemented in v0.4.0                  | Stabilization audited through v0.4.3; see V0.4.0                      |
| Pulse                 | Actor IDs and timestamps                             | Implemented in v0.5.0                  | Explicit as_of, fixed enum, set/replace/clear; audited through v0.5.3 |
| Since You Last Looked | Ordered immutable event history                      | Implemented in v0.6.0                  | Stabilization through v0.6.3                                          |
| Routines              | Event infrastructure and explicit civil context      | Implemented in v0.7.0                  | Correctness/resilience/hardening audits in v0.7.1–v0.7.4              |
| Pairing               | Household/member/device identity fields              | Yes                                    | Authentication, authorization, pairing, recovery, and device trust    |
| Offline sync          | Random event IDs and immutable canonical event bytes | Implemented in v0.9.2                  | Bounded to current relay/storage limits; restart is not durable       |
| Encrypted sync        | Versioned canonical events and browser Web Crypto    | Implemented through v0.9.3             | Independent audit, durable relay, all-device recovery, broader UX     |
| Export/import         | Versioned event representation and preserved history | Yes                                    | Portable container, validation, and recovery UX                       |

“Yes” means the existing infrastructure can be extended; it does not mean the capability is implemented, secure, or ready to ship without its listed domain and validation work.

## Dependency policy

The goal is not “dependencies are bad.” The goal is to understand and use Rust and the modern web platform before adding dependencies. The long-term default stack is Rust, WebAssembly, HTML, CSS, JavaScript, Web Components, and browser APIs. No external framework is planned unless a concrete requirement provides compelling justification. Any dependency must have a clear owner, purpose, security/update story, and cost worth accepting.

## Decisions still open

The domain event envelope, event naming, ordering requirements, and replay behavior are specified in [Events](EVENTS.md) and [State](STATE.md). The v0.0.6 [implementation](IMPLEMENTATION.md), [ABI](ABI.md), and [storage](STORAGE.md) contracts define module responsibilities, browser support, buffer protocol, and initial IndexedDB shape. Persistent contract versioning and non-destructive evolution are specified in [VERSIONING](VERSIONING.md) and [MIGRATIONS](MIGRATIONS.md). The examples in this document are not a wire format.

## v0.5.0 Pulse

Pulse adds Rust rebuild_at(events, as_of). Timers request canonical reprojection; Rust never reads ambient time. Same events plus same explicit time yield identical state. See [V0.5.0](V0.5.0.md).

## v0.6.0 Since You Last Looked

Rust protocol v6 derives structured summary entries and the exact through-event boundary from the ordered canonical stream plus an optional stable event-ID cursor. IndexedDB local_sequence remains browser-only. Browser local_context holds the installation cursor; no summary view or acknowledgement is a household event. See [V0.6.0](V0.6.0.md).

## v0.7.0 Routines

Rust derives Daily/Weekly periods from validated explicit civil dates, alongside as_of for Pulse. JS obtains local year/month/day from one browser clock sample; timers only request replay. Inside occurrence append transactions, JS compares the frozen intent key with Rust’s fresh canonical current key before candidate replay. This is identity checking, not a browser recurrence reducer. See [V0.7.0](V0.7.0.md).
