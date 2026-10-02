# Architecture

**Status:** the v0.1.0 local Household Heartbeat architecture is implemented. This document records current ownership boundaries and future design direction; it does not claim later product areas exist.

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

The v0.1.0 module layout and ABI are specified in [IMPLEMENTATION](IMPLEMENTATION.md) and [ABI](ABI.md); neither has been implemented. The boundary is the important part: browser concerns stay in the browser layer; authoritative, deterministic household-state rules live in Rust.

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

A manual ABI is specified for v0.1.0 in [ABI](ABI.md), including exported function signatures, versioned request/result encoding, ownership and lifetimes, errors, bounds, and repeated-call behavior. JavaScript allocates/copies input and decodes output; Rust reads validated input ranges and returns a well-defined result. The browser layer retains ownership of DOM, storage, cryptographic APIs, networking, and lifecycle integration.

The manual boundary keeps the interface visible and avoids convenience bindings before a demonstrated need. A later requirement may justify revisiting that choice through an explicit architecture decision; the v0.1.0 implementation must follow the current contract.

## Local-first progression

The first coded version should work locally:

```text
Browser UI
    |
    v
IndexedDB event log
    |
    v
Rust reconstructs household state
```

Only after the local-first release should implementation consider a remote sync service. Its trust and protocol design is documented before implementation in [SYNC](SYNC.md), with identity, pairing, cryptographic properties, and threats specified in [IDENTITY](IDENTITY.md), [PAIRING](PAIRING.md), [CRYPTOGRAPHY](CRYPTOGRAPHY.md), and [THREAT-MODEL](THREAT-MODEL.md):

```text
Device A <---- encrypted event sync ----> Service <---- encrypted event sync ----> Device B
```

The service is intended as an authenticated encrypted-event relay, not a household source of truth or plaintext domain processor. Its protocol, conflict classes, and cryptographic design remain future implementation work. Design is documented in v0.0.5; sync is not part of v0.1.0.

## Dependency policy

The goal is not “dependencies are bad.” The goal is to understand and use Rust and the modern web platform before adding dependencies. The long-term default stack is Rust, WebAssembly, HTML, CSS, JavaScript, Web Components, and browser APIs. No external framework is planned unless a concrete requirement provides compelling justification. Any dependency must have a clear owner, purpose, security/update story, and cost worth accepting.

## Decisions still open

The domain event envelope, event naming, ordering requirements, and replay behavior are specified in [Events](EVENTS.md) and [State](STATE.md). The v0.0.6 [implementation](IMPLEMENTATION.md), [ABI](ABI.md), and [storage](STORAGE.md) contracts define module responsibilities, browser support, buffer protocol, and initial IndexedDB shape. Persistent contract versioning and non-destructive evolution are specified in [VERSIONING](VERSIONING.md) and [MIGRATIONS](MIGRATIONS.md). The examples in this document are not a wire format.
