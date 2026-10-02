# v0.1.0 Testing Contract

**Status:** the v0.2.0 gate extends v0.1.x Rust, built-in Node bridge, and browser-native regressions for classification and the full Item lifecycle. Continue using these dependency-free contracts. Accessibility requirements are in [ACCESSIBILITY](ACCESSIBILITY.md); event/protocol behavior is in [EVENTS](EVENTS.md) and [ABI](ABI.md).

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

The v0.2.0 regression suite retains Rust as the authoritative validator/reducer, IndexedDB schema 1 as the canonical event source, and content-free BroadcastChannel invalidations. It covers Today/Needs classification, legacy/current event replay, classification-aware retry ownership, and complete/reopen/archive transitions in addition to v0.1.x regressions.

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
- A quota-exceeded write preserves the event count, announces a storage-full message, exposes retry, and a later retry persists exactly one event.
- With two same-origin tabs open, a successful write in one invalidates the other; the peer reloads canonical events and reruns Rust replay. Verify the notification carries no event or household content.
- CSP smoke: load the page under its shipped same-origin policy and inspect the console for CSP violation messages.
- Accessibility stress: test forced-colors, text-spacing overrides, 320px reflow, 200% browser zoom, and visible focus around actions.
- No household-content, backend, analytics, or third-party network requests occur; serving local static assets from the application origin is expected.
- Browser console has no uncaught errors.
- Keyboard interaction, focus visibility, status announcements, and a narrow mobile viewport work.

## Cross-browser and assistive-technology checklist

These environments are not certified by the Windows/Edge checks recorded so far. Mark each item verified only after running it against a release build:

- [ ] Firefox desktop: startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [ ] Safari desktop: startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [ ] Standalone Chrome desktop: startup, add/complete/reload, storage failure, CSP console, 320px reflow.
- [ ] NVDA with Firefox or Chrome: labels, status/error announcements, completion, and focus restoration.
- [ ] VoiceOver with Safari: labels, status/error announcements, completion, and focus restoration.

Do not introduce an external test framework just for convenience. Record tested browser/runtime versions and manual steps in the release notes when implementation begins.
