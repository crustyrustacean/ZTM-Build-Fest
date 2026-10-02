# Architecture

**Status:** Today, Needs, Handoff and Talk are implemented locally. Rust owns deterministic domain replay; browser components capture intents and render projection. No runtime dependency or remote service exists.

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
- WebAuthn and Web Crypto if future releases need them
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
- Synchronization reconciliation when sync is introduced

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

Remote sync remains future work. Its trust and protocol design is documented before implementation in [SYNC](SYNC.md), with identity, pairing, cryptographic properties, and threats specified in [IDENTITY](IDENTITY.md), [PAIRING](PAIRING.md), [CRYPTOGRAPHY](CRYPTOGRAPHY.md), and [THREAT-MODEL](THREAT-MODEL.md):

```text
Device A <---- encrypted event sync ----> Service <---- encrypted event sync ----> Device B
```

The service is intended as an authenticated encrypted-event relay, not a household source of truth or plaintext domain processor. Its protocol, conflict classes, and cryptographic design remain future implementation work. Design is documented in v0.0.5; sync is not part of v0.1.0.

## Future capability leverage

The v0.1.x core is intended to be extended, not treated as proof that later features already exist:

| Future capability     | Foundation already present                           | Extendable without replacing the core? | Still required                                                     |
| --------------------- | ---------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Today / Needs         | Versioned event pipeline and Rust-derived projection | Implemented in v0.2.0                  | Stabilization and accessibility audit in v0.2.1–v0.2.3             |
| Handoff | Actor-aware immutable event envelope | Implemented in v0.3.0 | Stabilization through v0.3.3 |
| Talk | Identified events and deterministic replay | Implemented in v0.4.0 | Stabilization audited through v0.4.3; see V0.4.0 |
| Pulse                 | Actor IDs and timestamps                             | Yes                                    | Time-bounded domain, explicit evaluation time, and expiry rules    |
| Since You Last Looked | Ordered immutable event history                      | Yes                                    | Last-seen marker and derived summary                               |
| Routines              | Event infrastructure and replay                      | Yes                                    | Recurrence model and occurrence semantics                          |
| Pairing               | Household/member/device identity fields              | Yes                                    | Authentication, authorization, pairing, recovery, and device trust |
| Offline sync          | Random event IDs and immutable canonical event bytes | Yes                                    | Multi-device transport and conflict/reconciliation policy          |
| Encrypted sync        | Deterministic, versioned event representation        | Yes                                    | Reviewed cryptographic protocol and key lifecycle                  |
| Export/import         | Versioned event representation and preserved history | Yes                                    | Portable container, validation, and recovery UX                    |

“Yes” means the existing infrastructure can be extended; it does not mean the capability is implemented, secure, or ready to ship without its listed domain and validation work.

## Dependency policy

The goal is not “dependencies are bad.” The goal is to understand and use Rust and the modern web platform before adding dependencies. The long-term default stack is Rust, WebAssembly, HTML, CSS, JavaScript, Web Components, and browser APIs. No external framework is planned unless a concrete requirement provides compelling justification. Any dependency must have a clear owner, purpose, security/update story, and cost worth accepting.

## Decisions still open

The domain event envelope, event naming, ordering requirements, and replay behavior are specified in [Events](EVENTS.md) and [State](STATE.md). The v0.0.6 [implementation](IMPLEMENTATION.md), [ABI](ABI.md), and [storage](STORAGE.md) contracts define module responsibilities, browser support, buffer protocol, and initial IndexedDB shape. Persistent contract versioning and non-destructive evolution are specified in [VERSIONING](VERSIONING.md) and [MIGRATIONS](MIGRATIONS.md). The examples in this document are not a wire format.
