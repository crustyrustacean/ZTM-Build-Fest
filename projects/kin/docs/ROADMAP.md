# Roadmap

Current implementation: `v0.10.0 — Portable Core + Local Data Security` (publication pending).

```text
v0.9.3 — Encrypted Event Sync Stabilization
	↓
v0.10.x — Portable Core + Local Data Security
	↓
v0.11.x — UX/UI Consolidation
	↓
v1.0.0 — Stable Kin Platform
```

Kin supports encrypted local storage, recovery/optional PRF unlock, verified migration, Rust commands/codecs, encrypted archives and a static offline shell alongside opt-in encrypted sync. The identity service and relay remain in-memory. Archives recover local history, not server identity. Independent security review and broader browser/authenticator coverage remain outstanding.

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

Implemented: short Talk capture, Open/Resolved lists, resolve, reopen and terminal archive. Resolution is workflow state only. See [V0.4.0](V0.4.0.md).

### `v0.4.1` — Talk Correctness

Completed: lifecycle/payload/result/compatibility audit, exact legacy bytes, combined limits and atomic storage regressions.

### `v0.4.2` — Talk Resilience & Accessibility

Completed: keyboard lifecycle/focus, semantic controls, native focus order, independent drafts and stale retries with/without invalidation or refresh recovery.

### `v0.4.3` — Talk Hardening & Polish

Completed: parser truncation/length boundaries, maximum mixed replay, real WASM growth/copied results, architecture/privacy review and documentation reconciliation. Pulse preserves all Talk regressions.

### `v0.5.0` — Pulse

Implemented: fixed actor-scoped capacity, set/replace/clear, deterministic explicit-time expiry and protocol v5. No acknowledgement, scoring or interpretation. See [V0.5.0](V0.5.0.md).

### `v0.6.0` — Since You Last Looked

Completed: derive a bounded, Rust-owned summary of Item, Handoff and Talk changes since this installation's explicit local cursor. Pulse is excluded. Protocol v6 preserves the exact snapshot boundary; IndexedDB remains schema 1 and no household event records a view. See [V0.6.0](V0.6.0.md).

### `v0.6.1` — Summary Correctness

Completed: audited empty and cursor-position cases, duplicate/conflicting event IDs, exact cap boundaries, and malformed/partial local metadata. No new capability or production behavior change.

### `v0.6.2` — Summary Resilience & Accessibility

Completed: audited cursor write failures/abort, refresh recovery, pending-write reconnect, missed invalidation, cross-tab orderings, Pulse timer refresh, keyboard/focus and accessibility modes. No new capability.

### `v0.6.3` — Summary Hardening & Polish

Completed: audited v6 parser/result boundaries, 10,000-event replay, WASM memory/copy behavior, privacy and restrained UI polish without adding capability. Stop for user evaluation.

### `v0.7.0` — Routines

Implemented: Daily and Monday-start Weekly Routines with deterministic civil-date occurrence keys, current-period complete/reopen, terminal archive, catch-up summary integration and browser lifecycle reprojection. See [V0.7.0](V0.7.0.md).

### `v0.7.1` — Routine Correctness

Audit recurrence boundaries, replay, malformed protocol, duplicates/conflicts and historical compatibility. No new capability.

### `v0.7.2` — Routine Resilience & Accessibility

Audit suspended/stale tabs, midnight/focus/visibility, failed writes/retries, keyboard/focus and accessibility modes. No new capability.

### `v0.7.3` — Routine Hardening & Polish

Audit ABI/allocation/maximum replay, privacy and documentation consistency; restrained UX polish only. Stop for evaluation.

### `v0.7.4` — Routine Stale-Action Correctness

Reject stale same-period completion/reopen commands before persistence, add multi-client regression coverage, harden manual Wasm ABI allocation ownership, and refresh pairing-document status for the v0.8.0 planning checkpoint. No product capability, protocol-layout or persistent-storage change.

### `v0.8.0` — Household Pairing

Completed through v0.8.8: one household with exactly two active adult-member slots, manual pairing codes/invitation URLs, passkeys, member-bound approval and activation, trusted-device controls and session invalidation, reauthentication, protected membership removal, replacement after removal or leave with historical membership retention, terminal-claim cleanup, and bounded authentication flows. QR is deferred. At the v0.8.8 boundary, household content sync remained unimplemented; v0.9.x adds it. The implementation record is [V0.8.0](V0.8.0.md).

### `v0.9.0` — Encrypted Sync

Completed as the first encrypted-sync iteration: reviewed threat/key lifecycle contract, versioned AES-GCM event envelopes with device signatures, opaque authorized push/pull relay, exact retry outbox, bounded cursoring, additive IndexedDB schema 2, and offline Rust/WASM/browser fixtures. Existing canonical bytes remain unchanged. See [V0.9.0](V0.9.0.md).

### `v0.9.1` — Device Provisioning, Epochs, and Revocation

Completed: locally generated non-extractable device keys, same-member trusted-device pairing with fingerprint comparison, recipient-bound key wrapping, atomic epoch compare-and-advance, revocation/member-removal rotation gates, historical-key entitlements, and retry/stale epoch coverage. Revocation cannot erase prior keys/plaintext.

### `v0.9.2` — Offline Reconciliation and Conflict Semantics

Completed: persistent exact-envelope outbox, crash-safe remote commit/cursor advancement, separate catch-up cursor, additive Rust v8 identity resolution, equal-Lamport deterministic replay, stale local-clock advancement, documented archive conflict behavior, and relay-cursor reset detection/retry.

### `v0.9.3` — Recovery, Privacy, and Feedback Readiness

Completed: recovery and metadata threat assessment, encrypted logging/privacy boundary, bounds and malformed-envelope handling, same-member device enrollment, relay restart semantics, browser storage migration verification, and product-facing sync states. The identity service/relay remain memory-only and no independent security audit is claimed. This is the final v0.9.x encrypted-sync stabilization gate.

### `v0.10.x` — Portable Core + Local Data Security

The final architecture/security development line. v0.10.0 implements cryptographically locked local household data, independent credential/recovery wrappers, recoverable plaintext migration, Rust-owned command semantics and canonical codecs, encrypted export/import, native domain tests, a static offline shell and signed transport-key migration. The evidence inventory, compatibility, measured limits and readiness work are in [V0.10.0](V0.10.0.md). Remaining architectural/security review belongs here before the v0.11 handoff.

Increase the Rust footprint by increasing the amount of Kin that is deterministic, portable, invariant-driven, and independently testable — not by moving browser-native capabilities into Wasm. Web Crypto and networking remain browser/server adapter responsibilities.

### `v0.11.x` — UX/UI Consolidation

Refine information architecture, navigation, responsive behavior, accessibility,
keyboard interaction, focus management and screen-reader semantics. Consolidate
authentication/unlock, pairing, backup/recovery, sync status and onboarding;
loading/empty/error states; component consistency, visual hierarchy, typography,
spacing, motion, modern CSS, PWA/install experience and cross-browser UX. v0.10
must deliver working accessible security states, while this line owns holistic
product polish. It must not need to redesign encryption, storage or commands.

### `v1.0.0` — Stable Kin Platform

Begin implementation only after BOTH v0.10 architecture/security and v0.11 UX/UI
readiness criteria are satisfied. Stabilize what those lines secured and refined;
do not introduce another major architecture at v1.0.

## Scope discipline

Each roadmap item is future work unless explicitly marked as implemented. v0.9.3 supplies authentication, pairing and encrypted sync; v0.10.0 adds local security, portable commands/codecs and encrypted recovery archives. v0.11 remains future work. Do not begin v1.0 before both readiness gates pass. Releases through `v0.0.12` were documentation-only; v0.1.0 was the first coded release. Earlier version sections preserve release history, including draft persistence later removed by v0.10.
