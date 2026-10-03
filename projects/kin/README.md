# Kin

> A private, lightweight household coordination app for the little things families need to know, remember, hand off, or discuss.

**Current status: `v0.9.3` — Encrypted Event Sync stabilization.** Kin supports opt-in encrypted synchronization of canonical household events between the two passkey-paired adults' trusted devices. Browser Web Crypto encrypts events before the authenticated service relay; the relay coordinates opaque delivery and still sees routing metadata, timing, counts, ciphertext sizes, and device membership. Device revocation invalidates sessions and advances the content-key epoch. Existing local event bytes are preserved during migration, and offline retries reuse the same encrypted envelope.

The next development line is `v0.10.x` — Portable Core + Local Data Security; its [architecture, migration and release contract](docs/V0.10.0.md) is under development. `v0.11.x` then consolidates UX/UI and accessibility. v1.0.0 requires both readiness gates. The current release remains v0.9.3, whose local events and drafts are plaintext and whose persisted sync keys remain usable after logout; encrypted relay sync is not local-at-rest protection.

## The problem

Household information gets scattered across memory, messages, calendars, sticky notes, verbal conversations, and assumptions. That makes small handoffs easy to miss and everyday coordination harder than it needs to be. The gaps can lead to "I thought you knew," "Why didn't you tell me?", "I thought you were doing that," or conversations happening at the wrong time.

Kin aims to make useful household context easier to share and find. It is not a promise to prevent conflict or fix relationships, and it will not decide who is right or measure anyone's contribution.

## Intended direction

Kin is intended as a private, lightweight shared household operating layer. Today and Needs views, lightweight classification, capture, completion, reopening, and archival are implemented locally. Handoff capture, acknowledgement, and recent context are implemented locally. Talk captures short topics for later, with Open/Resolved lists, resolve, reopen, and archive. Resolved is workflow state only, not agreement or an objective solution. Pulse adds fixed current capacity, set/replace/clear and explicit expiry, introduced in Rust protocol v5. Since You Last Looked shows at most eight recent meaningful household changes with an omitted-change count; Pulse is excluded. The user explicitly marks the displayed snapshot caught up. Values are context only, never scores or diagnoses. Routines support Daily/Weekly coordination without reminders, streaks, assignments or calendar UI.

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
- `v0.5.3` — Pulse Hardening & Polish (`kin-v0.5.3`)
- `v0.6.0` — Since You Last Looked (`kin-v0.6.0`)
- `v0.6.1` — Summary Correctness (`kin-v0.6.1`)
- `v0.6.2` — Summary Resilience & Accessibility (`kin-v0.6.2`)
- `v0.6.3` — Summary Hardening & Polish (`kin-v0.6.3`)
- `v0.7.0` — Routines (`kin-v0.7.0`)
- `v0.7.1` — Routine Correctness (`kin-v0.7.1`)
- `v0.7.2` — Routine Resilience & Accessibility (`kin-v0.7.2`)
- `v0.7.3` — Routine Hardening & Polish (`kin-v0.7.3`)
- `v0.7.4` — Routine Stale-Action Correctness (`kin-v0.7.4`)
- `v0.8.0` — Household Pairing Foundation (`kin-v0.8.0`)
- `v0.8.1` — Pairing Hardening and Failure Recovery (`kin-v0.8.1`)
- `v0.8.2` — Trusted Devices, Authorization, and Security UX (`kin-v0.8.2`)
- `v0.8.3` — Household Pairing Pre-Feedback Stabilization (`kin-v0.8.3`)
- `v0.8.4` — Pairing Creation Response Correctness (`kin-v0.8.4`)
- `v0.8.5` — Auth Panel Text Contrast (`kin-v0.8.5`)
- `v0.8.6` — Pairing Feedback-Gate Corrections (`kin-v0.8.6`)
- `v0.8.7` — Pairing Security and State Hygiene (`kin-v0.8.7`)
- `v0.8.8` — Active-Member Slot Correctness (`kin-v0.8.8`)
- `v0.9.0` — Encrypted Event Sync (`kin-v0.9.0`)
- `v0.9.1` — Device Provisioning, Epochs, and Revocation (`kin-v0.9.1`)
- `v0.9.2` — Offline Reconciliation and Conflict Semantics (`kin-v0.9.2`)
- `v0.9.3` — Recovery, Privacy, and Feedback Readiness (`kin-v0.9.3`)
- Next development line: `v0.10.x` — Portable Core + Local Data Security
- Then `v0.11.x` — UX/UI Consolidation, before `v1.0.0` — Stable Kin Platform
- See the [changelog](CHANGELOG.md) for the completed release history.

## Install, build, and run

Requirements: Rust/Cargo with the `wasm32-unknown-unknown` target, Node.js 22 or later, and a modern browser with WebAssembly, WebAuthn/passkeys, ES modules, Custom Elements, and IndexedDB.

From the repository root in PowerShell:

```powershell
rustup target add wasm32-unknown-unknown
./projects/kin/run.ps1
```

The script builds the WASM module and serves the web app at `http://localhost:8000`. On macOS/Linux, run `sh projects/kin/run.sh` from the repository root.

Kin stores canonical household events and encrypted outbox envelopes in the current browser profile's IndexedDB. Sync is off until an authenticated adult enables it. The local Node service holds identity, relay ciphertext, cursors, and provisioning state in memory; restarting it ends sessions and loses relay records. Local canonical history and exact cached envelopes remain on devices, but this prototype does not provide durable relay storage, backup, all-device recovery, or last-device recovery. A newly joined/replacement adult receives current and later epochs only; pre-join history is unavailable in v0.9.x. Existing adults can pair another device to the same member identity after comparing its device fingerprint. Browser storage and encryption do not protect against a compromised unlocked browser/runtime or extensions. Use synthetic household text while evaluating this prototype.

## AI usage

AI-assisted development tools are used for brainstorming, product planning, architecture exploration, documentation, implementation support, debugging, and testing. Kin has no AI runtime, analytics, or third-party runtime dependency. When sync is explicitly enabled, the service receives encrypted event envelopes and limited routing metadata, never plaintext household semantics or content keys.

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

- [Routines release contract and test matrix](docs/V0.7.0.md)

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
- [v0.8.0 Household Pairing contract](docs/V0.8.0.md)
- [v0.9.0 Encrypted Event Sync contract](docs/V0.9.0.md)
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
- [Since You Last Looked release contract](docs/V0.6.0.md)
- [Accepted architecture decision: event-sourced household state](docs/decisions/0001-event-sourced-household-state.md)
- [UX flows](docs/UX.md)
- [Roadmap](docs/ROADMAP.md)
- [v0.1.0 implementation specification](docs/V0.1.0.md)
- [Handoff release contract and final validation](docs/V0.3.0.md)

- [Talk release contract and validation](docs/V0.4.0.md)
