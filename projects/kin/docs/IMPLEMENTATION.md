# v0.1.0 Implementation Contract

**Status:** specification only. The layout and responsibilities below are plans; no source directories, application source, Cargo files, build tooling, or dependencies have been created. The release is frozen by [V0.1.0](V0.1.0.md).

## Proposed project layout

```text
projects/kin/
├── AGENTS.md
├── README.md
├── LICENSE
├── Cargo.toml
├── docs/
├── rust/
│   └── src/
│       ├── lib.rs
│       ├── abi.rs
│       ├── event.rs
│       ├── state.rs
│       ├── protocol.rs
│       └── error.rs
└── web/
    ├── index.html
    ├── components/
    │   ├── kin-app.js
    │   ├── kin-today.js
    │   ├── kin-compose.js
    │   └── kin-item.js
    ├── wasm/
    │   └── kin-engine.js
    ├── storage/
    │   └── event-store.js
    └── styles/
```

This is a proposed implementation layout, not a set of directories to create during planning. Avoid a demo app, general framework, or extra component/module unless v0.1.0 requires it.

## Module responsibilities

- **`rust/src/event.rs`:** event kinds, envelope representation, payload validation, and v0.1.0 event decoding.
- **`rust/src/state.rs`:** deterministic reducer and projection of the ordered local event stream into item state.
- **`rust/src/protocol.rs`:** versioned binary request/result encoding and bounded parsing.
- **`rust/src/abi.rs`:** exported C-ABI functions, pointer/length checks, buffer ownership, and status codes.
- **`rust/src/error.rs`:** stable error categories and non-sensitive messages.
- **`rust/src/lib.rs`:** module exports only; no DOM or browser API access.
- **`web/wasm/kin-engine.js`:** load WASM, validate memory ranges, allocate/copy input, call exports, copy result/error bytes before another mutating call, and decode the protocol.
- **`web/storage/event-store.js`:** open/migrate IndexedDB, read the ordered event log, and append an event atomically.
- **`web/components/kin-app.js`:** orchestrate initialization, event-store and WASM calls, loading/error states, and rendering.
- **`web/components/kin-today.js`:** display active and completed items from the Rust projection.
- **`web/components/kin-compose.js`:** capture short item text and dispatch a browser-native custom event.
- **`web/components/kin-item.js`:** render one item and expose its completion control; it contains no authoritative state transition.
- **`web/index.html` and styles:** semantic shell and minimal responsive presentation.

See [ABI](ABI.md), [Storage](STORAGE.md), and [Components](COMPONENTS.md) for implementable contracts. Rust owns authoritative domain rules; JavaScript owns browser integration and persistence.

## Build boundary

The intended target is `wasm32-unknown-unknown`. Build output should be a local artifact loaded by the page; no server or remote code loader is required. No `wasm-bindgen`, `web-sys`, `js-sys`, `serde`, `serde_json`, UI framework, or runtime library is planned. A future build command/script may be documented or added during implementation, but no build pipeline is part of these documentation releases.

## Browser support floor

Target the latest two stable major releases of desktop and mobile Chrome, Firefox, and Safari available when v0.1.0 implementation begins. The browser must provide core WebAssembly, ES modules, Custom Elements, IndexedDB, `CustomEvent`, `TextEncoder`/`TextDecoder`, `crypto.getRandomValues`, and a secure context (including localhost for development). Do not target Internet Explorer or obsolete browsers. Record the exact tested browser/OS versions during the v0.1.0 release gate; this policy is a target, not a claim of tested compatibility today.
