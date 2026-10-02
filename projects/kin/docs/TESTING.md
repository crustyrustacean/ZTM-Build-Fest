# v0.1.0 Testing Contract

**Status:** Current through v0.5.0 Pulse; earlier version sections are historical contracts. See Pulse below.

## Rust domain tests

Before v0.1.0 is considered complete, cover at least:

1. `ITEM_ADDED` creates an active item with the specified ID, text, actor, and creation time.
2. Two distinct additions produce both items in deterministic creation order.
3. `ITEM_ADDED` followed by `ITEM_COMPLETED` derives a completed item.
4. Completing an unknown item returns the specified deterministic validation error and no partial state.
5. Reconstructing the same ordered stream repeatedly yields structurally identical output.
6. Exact duplicate event delivery is idempotent; reuse of an event ID with different bytes fails as an integrity error.
7. A second distinct completion event for an already-completed item is a valid no-op in state.
8. Malformed event envelope or payload fails safely.
9. Unsupported protocol and event-schema versions fail with stable error categories.
10. Cross-household input and bounds/length violations fail without partial state.
11. Reopen/archive payloads are exactly one item ID; every shorter or longer payload fails as malformed protocol data.
12. Protocol v1 cannot encode state that has Needs classification or archived status; it fails closed instead of dropping fields.

The Rust reducer must be testable without a browser or WebAssembly runtime. Use the standard Rust test harness; no third-party test framework is required.

The browser bridge's focused encoding/Unicode regression tests use Node's built-in test runner (no npm dependencies):

```text
node --test projects/kin/web/wasm/kin-engine.test.mjs
```

## ABI/protocol tests

Verify null/zero pointers, undersized and oversized buffers, overflow-safe range checks, zero-item results, stale-output reset between calls, correct result lifetime, memory growth handling, deterministic error status, malformed encoding, and the rule that input pointers are not retained after return.

## Browser-level validation

The browser regression runner uses Node 22+ built-ins and a local Chromium-family executable. Build WASM first, then run from the repository root (PowerShell example):

```powershell
node projects/kin/scripts/browser-regression.mjs 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
```

It starts a loopback static server and an isolated headless browser profile, runs against the shipped CSP and real Rust/WASM/IndexedDB, and removes its temporary profile afterward. It does not access the user's existing Kin database. No npm install is needed. The runner fails on assertion errors, uncaught browser errors, CSP errors, or third-party page requests; the automatic favicon 404 is ignored.

Regression cases include unchanged/edited drafts after failed add, exact original-command retry, rapid and stale retry clicks, delayed add completion, reconnect during a pending save, and peer refresh retaining a failed-command retry. Both synchronous and asynchronous quota categories are injected without exhausting disk space. A separate real transaction abort after request success verifies rollback and retry. The remaining checks cover the existing add/complete/replay, storage, cross-tab, Unicode, rendering, focus, and narrow-layout flows below. Automated focus checks assert focus ownership and a 3px outline; they do not certify screen-reader announcements or visual contrast.

The v0.2.3 regression suite retains Rust as the authoritative validator/reducer, IndexedDB schema 1 as the canonical event source, immutable source event bytes, and content-free BroadcastChannel invalidations. It covers complete/reopen/archive recovery, stale canonical state, focus continuity, accessibility modes, repeated WASM calls after failure/empty input, and 10,000-event replay/result bounds in native Rust and the browser.

Manually exercise or use a lightweight browser-native harness to verify:

- WASM loads and exports match the ABI contract.
- IndexedDB opens and event history reads in append order.
- Existing events load and Rust reconstructs state.
- An item can be added and then completed through UI commands.
- New capture defaults to Needs; selecting Today changes classification with one native control action.
- Schema-v1 legacy items normalize to Today; schema-v2 classification survives reload without modifying original stored bytes.
- Complete and reopen work from their appropriate states; archive creates a tombstone that remains in IndexedDB and stays hidden after reload.
- Refresh reconstructs exactly the same visible state.
- Repeated actions and replay do not duplicate/corrupt state.
- User-entered text renders safely as text.
- Storage/ABI failures reach an understandable error state without claiming success.
- A compose draft survives a same-tab reload and clears only after successful persistence; the draft is not written to the event store.
- Focus returns to a usable control after add, complete, reopen, and archive; `aria-busy` clears after success or failure.
- Complete/reopen/archive storage failures and transaction aborts preserve the prior state; retry applies exactly one event.
- If canonical state makes a retry invalid, reload the full event log through Rust, clear the stale retry, present the current state, and append nothing.
- Rebuild and serialize 10,000 synthetic classified events deterministically below the 64 MiB request/result limits; verify repeated WASM calls do not return stale state/error buffers.
- A quota-exceeded write preserves the event count, announces a storage-full message, exposes retry, and a later retry persists exactly one event.
- With two same-origin tabs open, a successful write in one invalidates the other; the peer reloads canonical events and reruns Rust replay. Verify the notification carries no event or household content.
- CSP smoke: load the page under its shipped same-origin policy and inspect the console for CSP violation messages.
- Accessibility stress: test forced-colors, text-spacing overrides, 320px reflow, 200% browser zoom, and visible focus around actions.
- No household-content, backend, analytics, or third-party network requests occur; serving local static assets from the application origin is expected.
- Browser console has no uncaught errors.
- Keyboard interaction, focus visibility, status announcements, and a narrow mobile viewport work.

## Cross-browser and assistive-technology checklist

The following platforms/assistive technologies are not certified by the Windows/Chrome regression run. Mark an item verified only after running it against a release build:

- [ ] Firefox desktop: startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [ ] Safari desktop: startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [x] Standalone Chrome desktop (headless): startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [ ] NVDA with Firefox or Chrome: labels, status/error announcements, completion, and focus restoration.
- [ ] VoiceOver with Safari: labels, status/error announcements, completion, and focus restoration.

Do not introduce an external test framework just for convenience. Record tested browser/runtime versions and manual steps in the release notes when implementation begins.

## Handoff

Coverage in protocol.rs, kin-engine.test.mjs, and scripts/handoff-regression.mjs (called by the browser runner) exercises mixed replay, lifecycle, legacy rejection, immutable storage, inert text, drafts/retries, and cross-tab canonical state.

## v0.3.1 correctness evidence

Handoff tests reject every shortened payload, overlong references, unsupported schemas, extreme lengths, invalid UTF-8 and whitespace-only domain text. Exact v3 result records and separate entity namespaces are checked. Actor provenance comes from envelopes; same and different acknowledging actors both succeed. Browser fault injection verifies event/counter rollback, retry once, and metadata mismatch preservation; Node tests reject malformed Handoff result fields and recover on the next call.

## v0.3.2 resilience and accessibility

The browser runner covers delayed Handoff persistence across reconnect/peer refresh, newer draft ownership, sessionStorage denial, acknowledgement/archive failure and abort retry, rapid repeated retry, and stale actions without invalidation delivery. Handoff semantics, focus, announcements, disabled controls and touch targets are checked under the existing accessibility modes. No screen-reader or native desktop zoom certification is claimed.

## v0.3.3 hardening evidence

Rust checks truncated Handoff request/event headers, reserved fields, extreme text lengths and a deterministic 10,000-event mixed projection. Real WASM tests reject every truncated Handoff result boundary and trailing bytes, observe memory growth during 10,000-Handoff replay, and verify independent host-owned results across success/error/empty/repeated calls. The complete earlier regression suite remains required.

## v0.3.4 retry recovery

User-authorized follow-up patch: a failed canonical refresh retains the original failed command and feedback in transient application memory. Repeated refresh failure offers refresh retry first; successful Rust replay restores the command retry unless canonical state invalidates it. No automatic append occurs on refresh recovery. New commands supersede suspended retries. Browser regressions cover Handoff add/acknowledge/archive, Item add, repeated failure, newer drafts, stale peer actions and supersession. This is not persisted household state or a new capability.

## v0.3.5 build and run workflow

Validate both launchers through the existing platform build scripts, confirm the server serves `web/` on loopback port 8000, and run the complete browser regression suite against the generated WASM. The launch workflow changes no application behavior.

## v0.4.1 correctness evidence

Talk correctness audit passes the full lifecycle matrix, every truncated payload, overlong references, unsupported schemas, empty/oversized/invalid UTF-8 and blank text, exact v4 records, malformed status/reserved/count/length fields and combined entity limits. Exact pre-Talk writer/result fixtures remain unchanged. Browser tests verify event/counter rollback, retry once, metadata preservation and invalid-transition non-append. No production defect was found. Passed 56 Rust and 17 Node/real-WASM tests, formatting, Clippy, version consistency, release WASM, both build scripts and both launchers (page/WASM HTTP 200), and the complete Chrome 154.0.8037.59 browser suite on Windows x64/Node 22.12.0; POSIX via WSL. Previously listed platform/assistive-technology gaps remain.

## v0.4.2 resilience and accessibility evidence

Expanded Talk browser checks for keyboard resolve/reopen/archive, native input-to-Add focus order, semantic headings/lists, labels, polite status/assertive errors, visible focus and 48px targets under forced colors. Added independent draft assertions and direct stale retries with missed invalidation, alongside repeated-refresh recovery. Retained delayed saves, reconnect, queued peer refresh, sessionStorage denial, quota/abort rollback, rapid retry once and supersession. No production defect was found. Passed 56 Rust and 17 Node/real-WASM tests, formatting, Clippy, version consistency, release WASM, both build scripts/launchers (page/WASM HTTP 200), and complete browser suite in Windows x64/Chrome 154.0.8037.59/Node 22.12.0, POSIX via WSL. 320px, increased spacing, forced colors, reduced motion and 200% page-scale emulation pass; native zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

## v0.4.3 hardening and final audit

Added every truncated v4 result-header/Talk-record boundary, malformed request headers and extreme lengths, 10,000-event mixed replay, and 10,000-Talk real-WASM growth with independent copied results across repeated success/error/empty calls. Retained explicit v3 Handoff truncation/trailing-byte coverage. Visual inspection found and fixed horizontal overflow caused by a 320px page minimum width when a desktop scrollbar consumes space; reflow assertions now compare scrollWidth with clientWidth. The corrected 320px screen preserves full input focus outlines and wrapping actions.

Passed 58 Rust tests and 19 Node bridge/real-WASM tests, formatting, Clippy with warnings denied, version consistency, release WASM, PowerShell and WSL POSIX build scripts and build/run launchers (page and WASM HTTP 200), and complete browser regressions. Environment: Windows x64, Rust 1.93.0, Node 22.12.0, Chrome 154.0.8037.59; POSIX via WSL. Keyboard, all Talk lifecycle focus restoration, native focus order, semantics, busy/status/error, 48px targets, scrollbar-aware 320px reflow, forced colors, increased spacing, reduced motion and 200% page-scale emulation passed. Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

Architecture/product/privacy audit confirms Rust-only reduction; separate Item/Handoff/Talk semantics; immutable canonical IndexedDB schema-1 events; no migration; unchanged v1/v2/v3 contracts and explicit v4; content-free invalidation; textContent rendering; same-origin static requests; no framework/runtime dependency, analytics, AI, remote service, sentiment, scores, blame, identity inference, resolver attribution or response metrics. Resolved is workflow state only and claims neither agreement nor an objective solution. No remaining release-blocking defect was found in exercised environments. Cross-browser, assistive-technology and native-zoom checks remain validation gaps, not certifications. No additional UI feature was added. Duplication remains manageable, so no orchestration refactor was introduced.

## v0.5.0 Pulse

Pulse coverage is in rust/src/pulse_tests.rs, web/wasm/kin-engine.test.mjs and scripts/pulse-regression.mjs, called by the complete browser runner. All prior regressions remain; actual milestone evidence and gaps are in V0.5.0. See [V0.5.0](V0.5.0.md).
