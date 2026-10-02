# Kin

> A private, lightweight household coordination app for the little things families need to know, remember, hand off, or discuss.

**Current status: `v0.0.9` — Implementation Preflight. No usable application has been implemented.** Planning/specification is complete enough to begin `v0.1.0` when authorized. Rust/WASM, Web Components, and IndexedDB are specified but not implemented; `v0.1.0` will be the first executable prototype.

## The problem

Household information gets scattered across memory, messages, calendars, sticky notes, verbal conversations, and assumptions. That makes small handoffs easy to miss and everyday coordination harder than it needs to be. The gaps can lead to "I thought you knew," "Why didn't you tell me?", "I thought you were doing that," or conversations happening at the wrong time.

Kin aims to make useful household context easier to share and find. It is not a promise to prevent conflict or fix relationships, and it will not decide who is right or measure anyone's contribution.

## Intended direction

Kin is planned as a private, lightweight shared household operating layer, initially for one household and two adults. Its long-term concepts include Today, Needs, Handoff, Talk, Pulse, and Since You Last Looked. These are not implemented features.

The intended technical direction is Rust compiled to WebAssembly, native Web Components, vanilla JavaScript, and browser APIs, with a local-first start and no external framework unless a demonstrated requirement justifies one.

## Planned releases

- `v0.0.1` — Product definition and principles (`kin-v0.0.1`)
- `v0.0.2` — Architecture, event model, and privacy design (`kin-v0.0.2`)
- `v0.0.3` — UX flows and implementation planning (`kin-v0.0.3`)
- `v0.0.4` — Household Domain Specification (`kin-v0.0.4`)
- `v0.0.5` — Trust, Identity, and Synchronization Design (`kin-v0.0.5`)
- `v0.0.6` — Implementation Contract (`kin-v0.0.6`)
- `v0.0.7` — Data Durability & Evolution (`kin-v0.0.7`)
- `v0.0.8` — Developer & Contributor Experience (`kin-v0.0.8`)
- `v0.0.9` — Implementation Preflight (`kin-v0.0.9`)
- `v0.1.0` — First functional prototype

## Install and run

There is currently no application to install or run. The `v0.0.x` releases are documentation-only; application source, build tooling, and runtime dependencies have deliberately not been added. The first implementation is planned for `v0.1.0`.

## AI usage

AI-assisted development tools are being used for brainstorming, product planning, architecture exploration, documentation, and implementation support. Kin is not currently designed around an AI runtime. The intended privacy posture is that household content is not sent to an AI service by default.

## Project documents

- [Contributing to Kin](CONTRIBUTING.md)
- [Product vision](docs/PRODUCT.md)
- [Principles and non-goals](docs/PRINCIPLES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Conceptual data model](docs/DATA-MODEL.md)
- [Privacy](docs/PRIVACY.md)
- [Household domain](docs/DOMAIN.md)
- [Event contract](docs/EVENTS.md)
- [Derived state and replay](docs/STATE.md)
- [Entity lifecycles](docs/LIFECYCLES.md)
- [Identity and trusted devices](docs/IDENTITY.md)
- [Pairing](docs/PAIRING.md)
- [Synchronization design](docs/SYNC.md)
- [Cryptographic posture](docs/CRYPTOGRAPHY.md)
- [Threat model](docs/THREAT-MODEL.md)
- [Implementation layout and responsibilities](docs/IMPLEMENTATION.md)
- [JavaScript/WASM ABI](docs/ABI.md)
- [IndexedDB storage contract](docs/STORAGE.md)
- [Web Component contract](docs/COMPONENTS.md)
- [Testing contract](docs/TESTING.md)
- [Accessibility contract](docs/ACCESSIBILITY.md)
- [Persistent contract versioning](docs/VERSIONING.md)
- [Migration safety](docs/MIGRATIONS.md)
- [Portable household data](docs/PORTABILITY.md)
- [Retention and deletion](docs/RETENTION.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Code style](docs/CODE-STYLE.md)
- [Release process](docs/RELEASES.md)
- [Debugging and diagnostics](docs/DEBUGGING.md)
- [Implementation preflight](docs/PREFLIGHT.md)
- [Requirement traceability](docs/TRACEABILITY.md)
- [Canonical test vectors](docs/TEST-VECTORS.md)
- [Accepted architecture decision: event-sourced household state](docs/decisions/0001-event-sourced-household-state.md)
- [UX flows](docs/UX.md)
- [Roadmap](docs/ROADMAP.md)
- [v0.1.0 implementation specification](docs/V0.1.0.md)
