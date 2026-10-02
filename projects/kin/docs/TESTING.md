# v0.1.0 Testing Contract

**Status:** required future validation; no test code or runtime exists. Accessibility requirements are in [ACCESSIBILITY](ACCESSIBILITY.md); the event/protocol behavior is in [EVENTS](EVENTS.md) and [ABI](ABI.md).

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

## ABI/protocol tests

Verify null/zero pointers, undersized and oversized buffers, overflow-safe range checks, zero-item results, stale-output reset between calls, correct result lifetime, memory growth handling, deterministic error status, malformed encoding, and the rule that input pointers are not retained after return.

## Browser-level validation

Manually exercise or use a lightweight browser-native harness to verify:

- WASM loads and exports match the ABI contract.
- IndexedDB opens and event history reads in append order.
- Existing events load and Rust reconstructs state.
- An item can be added and then completed through UI commands.
- Refresh reconstructs exactly the same visible state.
- Repeated actions and replay do not duplicate/corrupt state.
- User-entered text renders safely as text.
- Storage/ABI failures reach an understandable error state without claiming success.
- No household-content, backend, analytics, or third-party network requests occur; serving local static assets from the application origin is expected.
- Browser console has no uncaught errors.
- Keyboard interaction, focus visibility, status announcements, and a narrow mobile viewport work.

Do not introduce an external test framework just for convenience. Record tested browser/runtime versions and manual steps in the release notes when implementation begins.
