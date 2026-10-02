# Kin

> A private, lightweight household coordination app for the little things families need to know, remember, hand off, or discuss.

**Current status: `v0.5.2` — Pulse Resilience & Accessibility.** Kin separates household items into Today and Needs, defaults fast capture to Needs, and supports completion, reopening, and archival. Rust remains the only domain reducer; IndexedDB schema 1 remains canonical, v0.1.x event bytes remain unchanged, and no runtime framework or remote service is present. Handoff adds short context capture, acknowledgement, and archival with protocol v3. Talk adds short topics, Open/Resolved lists, resolve/reopen/archive and protocol v4. Resolution is workflow state only. Actor IDs remain local placeholders, not verified people.

## The problem

Household information gets scattered across memory, messages, calendars, sticky notes, verbal conversations, and assumptions. That makes small handoffs easy to miss and everyday coordination harder than it needs to be. The gaps can lead to "I thought you knew," "Why didn't you tell me?", "I thought you were doing that," or conversations happening at the wrong time.

Kin aims to make useful household context easier to share and find. It is not a promise to prevent conflict or fix relationships, and it will not decide who is right or measure anyone's contribution.

## Intended direction

Kin is intended as a private, lightweight shared household operating layer. Today and Needs views, lightweight classification, capture, completion, reopening, and archival are implemented locally. Handoff capture, acknowledgement, and recent context are implemented locally. Talk captures short topics for later, with Open/Resolved lists, resolve, reopen, and archive. Resolved is workflow state only, not agreement or an objective solution. Pulse adds fixed current capacity, set/replace/clear and explicit expiry through Rust protocol v5. Values are context only, never scores or diagnoses. Routines and Since You Last Looked remain future concepts.

The intended technical direction is Rust compiled to WebAssembly, native Web Components, vanilla JavaScript, and browser APIs, with a local-first start and no external framework unless a demonstrated requirement justifies one.

## Release history

- `v0.0.1` — Product definition and principles (`kin-v0.0.1`)
- `v0.0.2` — Architecture, event model, and privacy design (`kin-v0.0.2`)
- `v0.0.3` — UX flows and implementation planning (`kin-v0.0.3`)
- `v0.0.4` — Household Domain Specification (`kin-v0.0.4`)
- `v0.0.5` — Trust, Identity, and Synchronization Design (`kin-v0.0.5`)
- `v0.0.6` — Implementation Contract (`kin-v0.0.6`)
- `v0.0.7` — Data Durability & Evolution (`kin-v0.0.7`)
- `v0.0.8` — Developer & Contributor Experience (`kin-v0.0.8`)
- `v0.0.9` — Implementation Preflight (`kin-v0.0.9`)
- `v0.0.10` — GitHub Community & Project Documentation (`kin-v0.0.10`)
- `v0.0.11` — Implementation Cycle Handoff (`kin-v0.0.11`)
- `v0.0.12` — Changelog & Release History (`kin-v0.0.12`)
- `v0.1.0` — Household Heartbeat (`kin-v0.1.0`)
- `v0.1.1` — Core Correctness (`kin-v0.1.1`)
- `v0.1.2` — Resilience & Accessibility (`kin-v0.1.2`)
- `v0.1.3` — Household Heartbeat Hardening (`kin-v0.1.3`)
- `v0.1.4` — Household Heartbeat Maintenance (`kin-v0.1.4`)
- `v0.1.5` — Final 0.1.x Stabilization (`kin-v0.1.5`)
- `v0.2.0` — Today + Needs (`kin-v0.2.0`)
- `v0.2.1` — Today + Needs Correctness (`kin-v0.2.1`)
- `v0.2.2` — Today + Needs Resilience & Accessibility (`kin-v0.2.2`)
- `v0.2.3` — Today + Needs Hardening & Polish (`kin-v0.2.3`)
- `v0.2.4` — Today + Needs Compatibility Fixes (`kin-v0.2.4`)
- `v0.3.0` — Handoff (`kin-v0.3.0`)
- `v0.3.1` — Handoff Correctness (`kin-v0.3.1`)
- `v0.3.2` — Handoff Resilience & Accessibility (`kin-v0.3.2`)
- `v0.3.3` — Handoff Hardening & Polish (`kin-v0.3.3`)
- `v0.3.4` — Handoff Retry Recovery (`kin-v0.3.4`)
- `v0.3.5` — Build & Run Convenience (`kin-v0.3.5`)
- `v0.4.0` — Talk (`kin-v0.4.0`)
- `v0.4.1` — Talk Correctness (`kin-v0.4.1`)
- `v0.4.2` — Talk Resilience & Accessibility (`kin-v0.4.2`)
- `v0.4.3` — Talk Hardening & Polish (`kin-v0.4.3`)
- `v0.5.0` — Pulse (`kin-v0.5.0`)
- `v0.5.1` — Pulse Correctness (`kin-v0.5.1`)
- `v0.5.2` — Pulse Resilience & Accessibility (`kin-v0.5.2`)
- See the [changelog](CHANGELOG.md) for the completed release history.

## Install, build, and run

Requirements: Rust/Cargo with the `wasm32-unknown-unknown` target, Python 3, and a modern browser with WebAssembly, ES modules, Custom Elements, and IndexedDB.

From the repository root in PowerShell:

```powershell
rustup target add wasm32-unknown-unknown
./projects/kin/run.ps1
```

The script builds the WASM module and serves the web app at `http://localhost:8000`. On macOS/Linux, run `sh projects/kin/run.sh` from the repository root.

Kin stores household events in the current browser profile's IndexedDB and may keep independent in-progress Item, Handoff and Talk drafts in tab-scoped `sessionStorage`. It does not provide accounts, backup, encryption, pairing, or cross-device sync; browser storage is not a security boundary against device compromise or extensions. Use synthetic household text while evaluating this prototype.

## AI usage

AI-assisted development tools are used for brainstorming, product planning, architecture exploration, documentation, implementation support, debugging, and testing. Kin has no AI runtime, analytics, backend, or third-party runtime dependency; household events are processed locally and are not transmitted by the application.

## License

Kin is available under the [MIT License](LICENSE).

## Community

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [GitHub community files and monorepo limitations](docs/GITHUB-COMMUNITY.md)

Kin is nested in the ZTM Build Fest repository. Its community files and templates are kept inside `projects/kin/`; GitHub does not automatically apply nested `.github` templates or count them in the parent repository's Community Standards profile.

## Project documents

- [Changelog](CHANGELOG.md)
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
- [Handoff release contract and final validation](docs/V0.3.0.md)

- [Talk release contract and validation](docs/V0.4.0.md)
