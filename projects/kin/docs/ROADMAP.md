# Roadmap

This roadmap is a planning baseline, not a promise of delivery dates. Releases may change as the product is tested. Kin is currently in the documentation-only `v0.0.x` phase; no application code exists.

## Planning releases

### `v0.0.1` — Product foundation

Define what Kin is, who it initially serves, the everyday problem it addresses, its first useful daily loop, and its non-goals. Record the product principles.

### `v0.0.2` — Technical foundation

Document intended browser/Rust responsibilities, a conceptual event model, the local-first direction, the future sync boundary, the privacy posture, and dependency policy.

### `v0.0.3` — UX and implementation planning

Describe conceptual daily flows, sequence the implementation roadmap, and specify the first coded release. This completes planning; it does not ship an app.

## First coded release

### `v0.1.0` — Household Heartbeat

Build the smallest end-to-end technical foundation: Rust compiled to WebAssembly, a native `<kin-app>` custom element, an explicit JS/WASM boundary, an event model with `ADD_ITEM` and `COMPLETE_ITEM`, Rust state reconstruction, local browser persistence, adding and completing a simple household item, and refresh/replay. Use a temporary local identity only. No partner login, sync, or other product areas.

The detailed boundary and acceptance scope are in [V0.1.0.md](V0.1.0.md).

## Product increments

### `v0.2.0` — Today + Needs

Add the Today and Needs views, fast capture, lightweight classification, and active/completed household items.

### `v0.3.0` — Handoff

Add short parent-to-parent handoffs, acknowledgement, recent handoff state, and household context transfer.

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

Each roadmap item is future work. Authentication, passkeys, encryption, remote services, pairing, and synchronization are not part of the planning releases, and no v0.1.0 code should be started as part of this documentation phase.
