# Architecture

**Status:** design for future implementation. No runtime, source code, build pipeline, or dependencies exist yet. This document records intended ownership boundaries, not a completed architecture.

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

The exact module layout and ABI remain open until implementation. The boundary is the important part: browser concerns stay in the browser layer; authoritative, deterministic household-state rules live in Rust.

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

The initial implementation is intended to target `wasm32-unknown-unknown` and explore a small, explicit JavaScript-to-WASM ABI before adopting convenience bindings. Initial constraints are no `wasm-bindgen`, `web-sys`, `js-sys`, `serde`, or framework runtime.

A possible conceptual ABI is:

```text
alloc(size)
dealloc(ptr, size)
apply_events(ptr, len)
result_ptr()
result_len()
```

These names and signatures are illustrative, not commitments. The eventual boundary must specify memory ownership, encoding, buffer lifetimes, error reporting, bounds checking, and ABI versioning. JavaScript would allocate/copy input and decode output; Rust would only read valid input ranges and return a well-defined result. The browser layer retains ownership of DOM, storage, cryptographic APIs, networking, and lifecycle integration.

A manual ABI is being explored to keep the interface visible, understand the cost of crossing the boundary, and avoid introducing bindings before their value is clear. It is not a goal to make the boundary manual forever if a later requirement justifies another choice.

## Local-first progression

The first coded versions should work locally:

```text
Browser UI
    |
    v
IndexedDB event log
    |
    v
Rust reconstructs household state
```

Only later should the design consider a remote sync service:

```text
Device A <---- encrypted event sync ----> Service <---- encrypted event sync ----> Device B
```

The service-side protocol, conflict policy, and cryptographic design are future decisions. Sync is explicitly deferred; it is not part of the planning releases or v0.1.0.

## Dependency policy

The goal is not “dependencies are bad.” The goal is to understand and use Rust and the modern web platform before adding dependencies. The long-term default stack is Rust, WebAssembly, HTML, CSS, JavaScript, Web Components, and browser APIs. No external framework is planned unless a concrete requirement provides compelling justification. Any dependency must have a clear owner, purpose, security/update story, and cost worth accepting.

## Decisions still open

Exact event encoding, ABI signatures, module boundaries, browser support floor, IndexedDB schema/migrations, and any future synchronization protocol must be decided and documented alongside implementation. None should be inferred from the illustrative examples here.
