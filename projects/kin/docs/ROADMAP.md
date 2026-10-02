# Roadmap

This roadmap is a planning baseline, not a promise of dates. The current release is `v0.3.5 — Build & Run Convenience`. The planned v0.3.0–v0.3.3 line, v0.3.4 recovery patch, and v0.3.5 developer workflow patch are complete. Stop for user evaluation before v0.3.6 or v0.4.0 Talk. Historical planning releases remain preserved.

## Planning releases

### `v0.0.1` — Product foundation

Define what Kin is, who it initially serves, the everyday problem it addresses, its first useful daily loop, and its non-goals. Record the product principles.

### `v0.0.2` — Technical foundation

Document intended browser/Rust responsibilities, a conceptual event model, the local-first direction, the future sync boundary, the privacy posture, and dependency policy.

### `v0.0.3` — UX and implementation planning

Describe conceptual daily flows, sequence the implementation roadmap, and specify the initial direction for the first coded release. Later planning releases refine the domain, trust model, and implementation contract; no app ships in this release.

### `v0.0.4` — Household Domain Specification

Define household entities and lifecycles, the immutable event envelope and naming convention, event availability by release, deterministic validation/replay, and state/tombstone semantics. See [DOMAIN](DOMAIN.md), [EVENTS](EVENTS.md), [STATE](STATE.md), and [LIFECYCLES](LIFECYCLES.md).

### `v0.0.5` — Trust, Identity, and Synchronization Design

Specify household/member/device/credential identity, pairing and device revocation, cryptographic posture, threats, encrypted relay responsibilities, metadata exposure, and offline conflict classes. Design only; no identity, crypto, or sync implementation. See [IDENTITY](IDENTITY.md), [PAIRING](PAIRING.md), [SYNC](SYNC.md), [CRYPTOGRAPHY](CRYPTOGRAPHY.md), and [THREAT-MODEL](THREAT-MODEL.md).

### `v0.0.6` — Implementation Contract

Freeze the initial v0.1.0 scope and specify its ABI, protocol, local storage, components, testing, accessibility, and release gate. The `.0.7`–`.0.9` planning releases add durability, contributor guidance, and final preflight; v0.0.6 does not ship an app. See [IMPLEMENTATION](IMPLEMENTATION.md), [ABI](ABI.md), [STORAGE](STORAGE.md), [COMPONENTS](COMPONENTS.md), [TESTING](TESTING.md), [ACCESSIBILITY](ACCESSIBILITY.md), and [V0.1.0](V0.1.0.md).

### `v0.0.7` — Data Durability & Evolution

Define independent persistent-contract versions, compatibility and migration failure behavior, portable export/import requirements, data retention/deletion boundaries, and event-log growth/checkpoint principles. Specifications only; no migration or export functionality. See [VERSIONING](VERSIONING.md), [MIGRATIONS](MIGRATIONS.md), [PORTABILITY](PORTABILITY.md), and [RETENTION](RETENTION.md).

### `v0.0.8` — Developer & Contributor Experience

Document human contribution expectations, intended cross-platform development setup, code style, release procedure, and privacy-safe debugging. The commands/workflow are guidance only; no executable tooling or application code. See [CONTRIBUTING](../CONTRIBUTING.md), [DEVELOPMENT](DEVELOPMENT.md), [CODE-STYLE](CODE-STYLE.md), [RELEASES](RELEASES.md), and [DEBUGGING](DEBUGGING.md).

### `v0.0.9` — Implementation Preflight

Complete the specification audit, accepted decision records, canonical test vectors, and requirement traceability for the frozen v0.1.0 scope. This Specification Release Candidate 1 completes technical planning; it does not begin implementation. See [PREFLIGHT](PREFLIGHT.md), [TEST-VECTORS](TEST-VECTORS.md), [TRACEABILITY](TRACEABILITY.md), and [accepted decisions](decisions/0001-event-sourced-household-state.md).

### `v0.0.10` — GitHub Community & Project Documentation

Align README with the Build Fest project requirements and add project-scoped conduct, security, support, issue, and pull-request guidance. The MIT license already exists. Because Kin is nested in a monorepo, GitHub does not automatically discover the nested community files/templates; document this limitation rather than changing parent-repository files. This release remains documentation-only.

### `v0.0.11` — Implementation Cycle Handoff

Record the general release cadence for future implementation lines, reaffirm v0.1.0 as the first implementation milestone, and correct stale current-version wording. Preserve the v0.1.0 specification and v0.0.10 community-health work; this release adds no application code or build tooling.

### `v0.0.12` — Changelog & Release History

Establish a Kin-scoped changelog from actual tagged release history and document its maintenance. This is a documentation-only release; it does not begin v0.1.0 implementation.

## First coded release

Each minor release represents a new product capability. Its initial stabilization patches address correctness (`.1`), resilience/accessibility (`.2`), and hardening (`.3`) when needed. After `.3`, stop and ask the user before starting another feature; additional fixes remain patches `.4` and onward.

### `v0.1.0` — Household Heartbeat

Implemented: Rust compiled to WebAssembly, a native `<kin-app>` with focused child custom elements, the manual versioned JS/WASM ABI, `ITEM_ADDED` and `ITEM_COMPLETED`, deterministic Rust replay, IndexedDB event-only persistence, and add/complete/reload behavior using local placeholder identities. No partner login, sync, or other product areas are included. See [V0.1.0.md](V0.1.0.md) for the frozen contract and release checks.

The detailed boundary and acceptance scope are in [V0.1.0.md](V0.1.0.md); release history is in [CHANGELOG](../CHANGELOG.md).

### `v0.1.1` — Core Correctness

Hardened Unicode roundtripping, local storage startup cleanup, and stored-event metadata validation. Regression checks cover malformed input, invalid-event non-append behavior, corrupted-row preservation, concurrent tabs, and rapid repeated submission. No new product capability was added.

### `v0.1.2` — Resilience & Accessibility

Preserves an in-progress compose draft across same-tab reloads using best-effort `sessionStorage`, restores keyboard focus after asynchronous add/complete operations, exposes `aria-busy`, and improves feedback when WASM or local storage is unavailable. Reflow and touch targets were checked at narrow widths. No new product capability was added.

### `v0.1.3` — Household Heartbeat Hardening

Audits the Rust/JavaScript ownership boundary, future-capability leverage, dependency surface, local-only privacy behavior, and v0.0.10 community documentation. Fixes only meaningful infrastructure or hardening gaps; introduces no new product capability.

### `v0.1.4` — Household Heartbeat Maintenance

Continues approved correctness, resilience, accessibility, test, and tooling improvements to the existing Household Heartbeat. No new product capability.

### `v0.1.5` — Final 0.1.x Stabilization

Associates draft clearing with the successfully persisted submission, preserves newer drafts during retry or delayed completion, and adds browser-native regressions. Fixes PowerShell build failure propagation. No new product capability; no further 0.1.x polishing is planned.

## Product increments

### `v0.2.0` — Today + Needs

Implemented: Today and Needs views, lightweight fixed classification, fast capture defaulting to Needs, complete/reopen/archive item transitions, and local deterministic replay. Legacy v0.1.x unclassified items appear in Today. Protocol v2 carries the new projection while protocol v1 and IndexedDB schema 1 remain unchanged.

### `v0.2.1` — Today + Needs Correctness

Completed: added exact reopen/archive payload-boundary tests, ensured protocol v1 fails closed for unrepresentable state, and checked event/logical-counter atomicity through failures, aborts, and retries. No product concept was added.

### `v0.2.2` — Today + Needs Resilience & Accessibility

Completed: drafts and item actions recover across failures/retries and peer state changes; stale retries clear against Rust-derived state. Keyboard focus, forced colors, reduced motion, increased text spacing, 320px reflow, and 200% page-scale emulation were checked. No new capability.

### `v0.2.3` — Today + Needs Hardening & Polish

Completed: verified the architecture/privacy boundary, parser/version handling, 10,000-event/64 MiB behavior, and current Today + Needs clarity. No new capability. Stop here for release-line evaluation.

### `v0.2.4` — Today + Needs Compatibility Fixes

Completed: corrected protocol-v1 result headers without changing the historical byte layout, disabled every item action while busy, and added exact WASM ABI and browser regression coverage. No new capability. Stop for user review before further work.

### `v0.3.0` — Handoff

Implemented locally: short Handoff capture, acknowledgement, recent context, and terminal archival. Protocol v3 preserves Item history and adds Handoff projection; actors remain local placeholders. Stabilization through v0.3.3 is complete; stop for user evaluation.

### `v0.3.1` — Handoff Correctness

Completed: lifecycle, protocol/payload/result boundaries, actor provenance, event/counter rollback and canonical-byte preservation.

### `v0.3.2` — Handoff Resilience & Accessibility

Completed: interrupted capture, drafts, failed-action retries, stale peers, focus, keyboard, busy state and accessibility modes.

### `v0.3.3` — Handoff Hardening & Polish

Completed: parser boundaries, 10,000-event replay, real WASM memory growth, architecture/privacy audit and documentation reconciliation. Stop for evaluation.

### `v0.3.4` — Handoff Retry Recovery

Completed: preserve failed command retries through repeated canonical-refresh failures. Reconcile stale actions after recovery and discard superseded retries. No new capability. Stop for evaluation.

### `v0.3.5` — Build & Run Convenience

Completed: add project-local PowerShell and POSIX shell launchers that build the WASM module through the established scripts and serve the web app on loopback port 8000. No product capability or runtime dependency added.

### `v0.4.0` — Talk

Add capture and revisit state for topics to discuss later, including resolved/unresolved state. Keep the experience nonjudgmental: no blame or scoring.

### `v0.5.0` — Pulse

Explore a lightweight current-capacity signal with expiration and acknowledgement only if useful. No scoring or historical ranking.

### `v0.6.0` — Since You Last Looked

Derive a compact summary from event additions, completions, changes, new handoffs, and Talk updates. This is intended to become a signature capability while respecting member expectations and privacy.

### `v0.7.0` — Routines

Add recurring household needs and lightweight routines, with recurrence logic in Rust. Avoid turning Kin into a traditional calendar.

### `v0.8.0` — Household Pairing

Begin multi-user household identity. Explore one household with two adult members, QR pairing, a short-lived pairing code, passkeys, and trusted devices. Define authorization and recovery before shipping pairing.

### `v0.9.0` — Encrypted Sync

Explore encrypted event synchronization across trusted devices, revocation, and offline reconciliation. Minimize what the service can know about household content. This release depends on a reviewed threat model and a clear key lifecycle.

### `v1.0.0` — Build Fest release

Focus on polish, reliability, accessibility, mobile UX, privacy documentation, onboarding, a clear demo, and real daily usability. Do not use the release as a reason to add major new architecture.

## Scope discipline

Each roadmap item is future work unless explicitly marked as completed. Authentication, passkeys, encryption, remote services, pairing, and synchronization remain unimplemented and out of scope for v0.3.x. Releases through `v0.0.12` were documentation-only; v0.1.0 is the first coded release. Handoff is implemented in v0.3.0; v0.4.0 Talk remains future work.
