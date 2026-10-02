# Changelog

This file records completed Kin releases. The `v0.0.x` releases are planning and documentation milestones; they do not represent implemented application features. The first implementation milestone remains `v0.1.0`.

## [0.5.2] — Pulse Resilience & Accessibility

Restored capacity-selector focus when expiry hides an active Pulse control. Added late timer, simulated sleep/wake, focus/visibility, clock forward/backward, missed invalidation, original SET/CLEAR quota/abort retry, repeated refresh failures, supersession, rapid intent, reconnect/busy, native keyboard and accessibility-mode coverage. No new capability; evidence is in docs/V0.5.0.md.

## [0.5.1] — Pulse Correctness

Added exhaustive Pulse payload lengths, schemas, reserved/value codes, timestamp bounds, mixed entity invariance, exact v5 layouts, malformed results and combined count limits. Legacy byte fixtures remain unchanged. No new capability or production defect found; validation evidence is in docs/V0.5.0.md.

## [0.5.0] — Pulse

Added fixed actor-scoped capacity, set/replace/clear and explicit expiry. Rust owns rebuild_at(events, as_of); protocol v5 preserves v1–v4 layouts. Native controls and canonical timer/visibility/focus refresh reuse IndexedDB schema 1 and original-command retry. No migration, acknowledgement, analytics, identity inference, automation or dependency.

Validation evidence: [V0.5.0](docs/V0.5.0.md).

## [0.4.3] — Talk Hardening & Polish

Added every truncated v4 result-header/Talk-record boundary, malformed request headers and extreme lengths, 10,000-event mixed replay, and 10,000-Talk real-WASM growth with independent copied results across repeated success/error/empty calls. Retained explicit v3 Handoff truncation/trailing-byte coverage. Visual inspection found and fixed horizontal overflow caused by a 320px page minimum width when a desktop scrollbar consumes space; reflow assertions now compare scrollWidth with clientWidth. The corrected 320px screen preserves full input focus outlines and wrapping actions.

Passed 58 Rust tests and 19 Node bridge/real-WASM tests, formatting, Clippy with warnings denied, version consistency, release WASM, PowerShell and WSL POSIX build scripts and build/run launchers (page and WASM HTTP 200), and complete browser regressions. Environment: Windows x64, Rust 1.93.0, Node 22.12.0, Chrome 154.0.8037.59; POSIX via WSL. Keyboard, all Talk lifecycle focus restoration, native focus order, semantics, busy/status/error, 48px targets, scrollbar-aware 320px reflow, forced colors, increased spacing, reduced motion and 200% page-scale emulation passed. Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

Architecture/product/privacy audit confirms Rust-only reduction; separate Item/Handoff/Talk semantics; immutable canonical IndexedDB schema-1 events; no migration; unchanged v1/v2/v3 contracts and explicit v4; content-free invalidation; textContent rendering; same-origin static requests; no framework/runtime dependency, analytics, AI, remote service, sentiment, scores, blame, identity inference, resolver attribution or response metrics. Resolved is workflow state only and claims neither agreement nor an objective solution. No remaining release-blocking defect was found in exercised environments. Cross-browser, assistive-technology and native-zoom checks remain validation gaps, not certifications. No additional UI feature was added. Duplication remains manageable, so no orchestration refactor was introduced.

## [0.4.2] — Talk Resilience & Accessibility

Expanded Talk browser checks for keyboard resolve/reopen/archive, native input-to-Add focus order, semantic headings/lists, labels, polite status/assertive errors, visible focus and 48px targets under forced colors. Added independent draft assertions and direct stale retries with missed invalidation, alongside repeated-refresh recovery. Retained delayed saves, reconnect, queued peer refresh, sessionStorage denial, quota/abort rollback, rapid retry once and supersession. No production defect was found. Passed 56 Rust and 17 Node/real-WASM tests, formatting, Clippy, version consistency, release WASM, both build scripts/launchers (page/WASM HTTP 200), and complete browser suite in Windows x64/Chrome 154.0.8037.59/Node 22.12.0, POSIX via WSL. 320px, increased spacing, forced colors, reduced motion and 200% page-scale emulation pass; native zoom, Firefox, Safari, NVDA and VoiceOver remain unverified. No new product capability.

## [0.4.1] — Talk Correctness

Talk correctness audit passes the full lifecycle matrix, every truncated payload, overlong references, unsupported schemas, empty/oversized/invalid UTF-8 and blank text, exact v4 records, malformed status/reserved/count/length fields and combined entity limits. Exact pre-Talk writer/result fixtures remain unchanged. Browser tests verify event/counter rollback, retry once, metadata preservation and invalid-transition non-append. No production defect was found. Passed 56 Rust and 17 Node/real-WASM tests, formatting, Clippy, version consistency, release WASM, both build scripts and both launchers (page/WASM HTTP 200), and the complete Chrome 154.0.8037.59 browser suite on Windows x64/Node 22.12.0; POSIX via WSL. Previously listed platform/assistive-technology gaps remain. No new product capability.

## [0.4.0] — Talk

- Added one-field topic capture, Open/Resolved lists, resolve, reopen and terminal archive. Resolution is workflow state only; no agreement, blame or verified-person claim is made.
- Added distinct Rust Talk types and schema-1 event codes 8–11, with explicit protocol v4. Protocols 1–3 and prior event bytes remain unchanged; older protocols reject Talk. IndexedDB stays schema 1 with no migration.
- Reused atomic storage, independent drafts, original-command retry, suspended-refresh recovery, content-free peer invalidation and safe rendering. No runtime dependency or remote service.

Validation evidence is recorded in [V0.4.0](docs/V0.4.0.md).

## [0.3.5] — Build & Run Convenience

### Improved

- Added project-local PowerShell and POSIX shell workflows that reuse the established WASM build scripts, then serve `projects/kin/web` on loopback port 8000.
- Updated the README and development instructions to use the one-command workflow.
- Preserved the existing build boundary, dependency policy, and stale-artifact failure behavior.

### Validation

- Passed `cargo fmt --check`, Clippy with warnings denied, 51 Rust tests, release WASM build, both existing build scripts, both new launchers, 13 Node bridge/real-WASM tests, version consistency, and the complete browser regression runner.
- Windows x64 used PowerShell 5.1, Rust 1.93.0, Python 3.13.14, Node 22.12.0, and headless Edge 154.0.4258.48. POSIX validation used WSL Ubuntu 22.04.5, Rust 1.93.0, and Python 3.10.12. Each launcher served the page and WASM asset successfully with HTTP 200.
- No product capability, event format, protocol, IndexedDB schema, or runtime dependency changed.

## [0.3.4] — Handoff Retry Recovery

### Fixed

- A failed canonical refresh could replace and lose an earlier failed save/action retry. Preserve the original command, intent and feedback through repeated refresh failures; restore it only after successful canonical replay. Recovery does not automatically append anything.
- Stale actions still clear against Rust-derived state. A newly submitted command supersedes the suspended retry. The shared fix also preserves Item retries and keeps newer capture drafts intact.
- Added a browser regression that failed before the fix, plus repeated-failure, add/action recovery, stale cross-tab acknowledgement/archive, Item retry and superseding-command coverage.

### Validation

- Passed 51 Rust tests, 13 Node bridge/real-WASM tests, formatting, Clippy with warnings denied, release WASM build, both build scripts, version consistency and the full browser runner.
- Tested with Windows x64, Node 22.12.0, headless Chrome 154.0.8037.59; POSIX build ran in WSL Ubuntu 22.04. Existing 320px/accessibility-mode, storage, protocol, CSP and same-origin regressions remain passing. Firefox, Safari, native desktop zoom, NVDA and VoiceOver remain unverified.
- No new product capability, persisted event change, IndexedDB migration, protocol change, or dependency. Earlier release tags remain unchanged.

## [0.3.3] — Handoff Hardening & Polish

- Added deterministic Handoff header/extreme-length checks, 10,000-event mixed replay, every truncated result boundary, trailing result rejection, and real WASM memory growth with repeated success/error/empty replay.
- Reconciled current product, protocol, storage, component, accessibility, roadmap and release documentation. Confirmed Rust remains the sole reducer, IndexedDB schema 1 is canonical, history is immutable, peer messages carry no content, and no runtime dependencies, remote services, identity claims or timing analytics were introduced.
- Passed 51 Rust tests, 13 Node bridge/real-WASM tests, formatting, Clippy, release WASM compilation, both build scripts, version consistency and the full browser suite (Windows x64, Node 22.12.0, headless Chrome 154.0.8037.59; POSIX build in WSL Ubuntu 22.04).
- Native desktop 200% zoom, Firefox, Safari, NVDA and VoiceOver remain untested. The planned Handoff line stops here for user evaluation; v0.3.4 and v0.4.0 have not begun.

## [0.3.2] — Handoff Resilience & Accessibility

- Extended browser regression coverage for Handoff delayed saves, reconnect and queued peer refresh, newer draft ownership, sessionStorage denial, acknowledgement/archive write failures, abort rollback, and rapid retry exactly once.
- Verified stale acknowledgement/archive recovery even with missed invalidation, peer-action focus restoration, labeled input, semantic headings/lists, polite status, assertive errors, all busy controls, 48px targets, 320px reflow, forced colors, text spacing, reduced motion and 200% page-scale emulation. No product capability or domain rule changed.
- Passed 49 Rust tests, 11 Node bridge/real-WASM tests, formatting, Clippy, release WASM compilation, both build scripts, version consistency and full browser regressions (Windows x64, Node 22.12.0, headless Chrome 154.0.8037.59; POSIX build in WSL Ubuntu 22.04). Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain untested.

## [0.3.1] — Handoff Correctness

- Added exhaustive Handoff payload truncation, exact reference lengths, schema rejection, extreme lengths, invalid Unicode, actor provenance, separate ID namespace, and exact result-layout regressions.
- Added malformed result-field recovery and Handoff-specific event/counter rollback, exactly-once retry, metadata mismatch and canonical-byte preservation tests. No new capability or contract change.
- Passed 49 Rust tests, 11 Node bridge/real-WASM tests, formatting, Clippy, release WASM build, both build scripts, version check, and the full browser regression runner (Windows x64, Node 22.12.0, headless Chrome 154.0.8037.59; POSIX build in WSL Ubuntu 22.04). Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

## [0.3.0] — Handoff

### Added

- Dedicated short Handoff capture and needs-attention/recent lists, neutral acknowledgement, and terminal archival. Actor placeholders are not verified people; no named receipt or creator/acknowledger inequality is inferred.
- Rust-owned Handoff types, lifecycle, mixed replay and explicit protocol v3. Protocols v1/v2 remain unchanged and reject Handoff history/state. Existing event bytes and IndexedDB schema 1 remain unchanged.
- Independent tab draft ownership, atomic persistence/retry, content-free peer invalidation, inert text rendering, keyboard/focus/busy behavior. No framework, runtime dependency, or remote service.

### Validation

- Passed 46 Rust tests and 9 Node bridge/real-WASM tests, formatting, Clippy with warnings denied, release WASM compilation, both build scripts and version consistency.
- Full browser regression suite passed on Windows x64, Node 22.12.0, headless Chrome 154.0.8037.59, including prior Today/Needs checks and Handoff lifecycle, mixed replay/reload, invalid-reference non-append, retries/drafts, cross-tab stale acknowledgement, keyboard/focus, 320px, forced colors, text spacing, reduced motion, page-scale emulation, CSP and same-origin requests. POSIX build ran in WSL Ubuntu 22.04.
- Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain untested. Page-scale emulation is not native desktop 200% zoom.

## [0.2.4] — Today + Needs Compatibility Fixes

### Fixed

- Protocol-v1 `KINS` responses now carry the requested v1 header, matching the unchanged active/completed record layout and zero reserved bytes. Protocol-v2 responses retain their v2 classification/status layout.
- Item busy state now disables every action control, including Archive beside Complete or Reopen. Compose and retry controls remain disabled until the pending operation finishes, with focus restoration preserved.
- Added exact-byte real-WASM ABI regressions for both versions, unsupported v1 state, repeated result/error buffer clearing, bridge decoding, and browser coverage for all busy controls and recovery. The focused adjacent audit found no further defect requiring a production change.

### Validation

- Passed 44 Rust tests, 8 Node bridge/real-WASM tests, `cargo fmt --check`, Clippy with warnings denied, version consistency, release `wasm32-unknown-unknown` compilation, and both PowerShell and POSIX WASM build scripts. POSIX validation ran in WSL Ubuntu 22.04 with Rust 1.93.0.
- The Windows x64 browser runner passed in headless Chrome 154.0.8037.59 with Node 22.12.0: legacy replay, Today/Needs, complete/reopen/archive, pending busy controls, retries, draft ownership, cross-tab canonical refresh, malformed-storage preservation, 320px reflow, CSP/console, and same-origin requests. Existing forced-colors, reduced-motion, text-spacing, and 200% page-scale checks also passed.
- Native desktop 200% zoom, Firefox, Safari, NVDA, and VoiceOver were not tested. No product capability, persisted event change, IndexedDB schema change, or runtime dependency was introduced. Published `kin-v0.2.0`–`kin-v0.2.3` tags remain unchanged.

## [0.2.3] — Today + Needs Hardening & Polish

### Hardened

- Rechecked Rust-owned replay, protocol/event version boundaries, IndexedDB schema 1, immutable history, safe text rendering, same-origin-only runtime requests, content-free BroadcastChannel messages, and the absence of runtime dependencies or remote services.
- Added deterministic 10,000-event classified replay checks through native Rust and real WASM, plus valid/error/empty/repeated-call coverage for stale ABI output handling.
- Completed focused Today/Needs clarity and accessibility regressions without adding a product concept. `v0.3.0 — Handoff` remains future work.

### Validation

- Passed 44 Rust tests, 4 built-in Node bridge tests, `cargo fmt --check`, Clippy with warnings denied, version consistency, and both PowerShell and POSIX WASM release builds. The shell build ran in WSL Ubuntu 22.04 with Rust 1.93.0.
- The Windows x64 browser runner passed in headless Chrome 154.0.8037.59 with Node 22.12.0. It covered v0.1 byte preservation, protocol errors/repeated calls, maximum 10,000-event replay, draft/action recovery, stale cross-tab actions, two-tab canonical replay, 320px, forced colors, reduced motion, increased text spacing, 200% page-scale emulation, CSP, and same-origin-only requests.
- Native desktop 200% browser zoom, Firefox, Safari, NVDA, and VoiceOver were not tested. The 200% check was Chromium page-scale emulation, not native desktop zoom; no screen-reader certification is claimed.
- No product capability, IndexedDB schema change, runtime dependency, framework, backend, or remote service was added.

## [0.2.2] — Today + Needs Resilience & Accessibility

### Improved

- Hardened complete/reopen/archive failures and retries; a domain-invalid retry now reloads canonical events and clears stale item intent instead of repeatedly presenting an unavailable action.
- Restored compose focus when a peer refresh replaces a focused item control and disabled retry controls while the app is busy.
- Extended browser coverage for text-only draft compatibility, action write failures/abort recovery, two-tab stale-action races with and without invalidation delivery, and keyboard lifecycle actions.
- Added forced-colors, reduced-motion, increased-text-spacing, 320px reflow, target-size/focus checks, and 200% Chromium page-scale emulation.

### Validation

- Passed 43 Rust tests, 4 built-in Node bridge tests, `cargo fmt --check`, Clippy with warnings denied, version consistency, and both PowerShell and POSIX WASM release builds. The shell build ran in WSL Ubuntu 22.04 with Rust 1.93.0.
- The Windows x64 browser runner passed in Chrome 154.0.8037.59 with Node 22.12.0. It covered draft restoration/ownership, action failures and retries, stale cross-tab intent with and without invalidation delivery, keyboard/focus recovery, 320px reflow, forced colors, reduced motion, increased text spacing, 200% page-scale emulation, CSP, same-origin requests, and the event/storage compatibility regressions.
- Native desktop 200% browser zoom, Firefox, Safari, NVDA, and VoiceOver were not tested. The 200% check used Chromium page-scale emulation, not native desktop zoom; no screen-reader certification is claimed.
- No product capability, IndexedDB schema change, framework, or runtime dependency was added.

## [0.2.1] — Today + Needs Correctness

### Hardened

- Added exact malformed-length coverage for `ITEM_REOPENED` and `ITEM_ARCHIVED` payloads and a regression ensuring protocol v1 rejects state it cannot represent rather than dropping classification/status.
- Extended browser regressions to verify event and logical-time counter rollback on failed/aborted writes and exactly-once counter advancement on retry.
- Reconciled test vectors, traceability, and the current compatibility contract; no product capability or persistent schema changed.

### Validation

- Passed 43 Rust tests, 4 built-in Node bridge tests, formatting, Clippy with warnings denied, version consistency, and both PowerShell and POSIX WASM release builds.
- The Windows x64 browser runner passed in Chrome 154.0.8037.59 with Node 22.12.0, including exact v0.1 byte preservation, malformed lifecycle payloads, event/counter rollback and retry, metadata mismatch preservation, the 10,000-event cap, cross-tab replay, CSP, same-origin requests, keyboard submission, focus, and 320px reflow. The shell build ran in WSL Ubuntu 22.04 with Rust 1.93.0.
- No product capability, IndexedDB schema change, framework, or runtime dependency was added.

## [0.2.0] — Today + Needs

### Added

- Added separate Today and Needs views, with new items defaulting to Needs and a native classification selector for Today.
- Added completion, reopening, and terminal archival intents. Archived items remain in event history and are hidden from ordinary views.
- Added explicit protocol v2 and schema-v2 `ITEM_ADDED` classification while preserving protocol v1, schema-v1 event bytes, and IndexedDB schema version 1. Legacy unclassified items normalize to Today.
- Extended text draft ownership to the submitted text-and-classification snapshot and added browser regressions for retry, reload, two-tab replay, and lifecycle actions.

### Validation

- Passed 41 Rust tests, 4 built-in Node bridge tests, `cargo fmt --check`, Clippy with warnings denied, version consistency, and both PowerShell and POSIX WASM release builds. Browser regressions passed on Windows x64 with Node 22.12.0 and Chrome 154.0.8037.59; the shell build ran in WSL Ubuntu 22.04 with Rust 1.93.0.
- Browser checks covered Needs-default and Today capture, synthetic v0.1 event replay with exact byte preservation, failed-write retries, text/classification draft ownership, completion in both views, reopen/archive, invalid-transition non-append, hidden tombstones after reload, cross-tab content-free invalidation, malformed-row preservation, keyboard submission, focus, busy state, 320px reflow, CSP, and same-origin requests.
- Forced-colors, 200% zoom, Firefox, Safari, NVDA, and VoiceOver were not tested for this milestone.
- No new IndexedDB schema, framework, runtime dependency, backend, or remote service was added.

## [0.1.5] — Final 0.1.x Stabilization

### Fixed

- Prevented a successful retry of an earlier failed add from clearing a newer compose draft. Draft clearing now belongs to the captured, successfully persisted submission, including delayed normal adds; retry still uses the original command.
- Retained failed-command retry feedback after a successful peer refresh and kept reconnects from restarting the engine or unlocking an in-flight save.
- Aborted synchronous IndexedDB write-request failures with their original storage-error guidance.
- Stopped the PowerShell build script before copying a stale WASM artifact when Cargo fails.

### Tests

- All 32 Rust tests, 3 built-in Node bridge tests, formatting, Clippy with warnings denied, the WASM release build, both build scripts, and version consistency passed. Injected Cargo failures stop both build paths before copying an artifact.
- Added a dependency-free browser regression runner covering normal add/clear, failed add with unchanged or edited draft, synchronous/asynchronous injected quota failures, repeated retry exactly once, commit/abort behavior, and delayed completion across reconnect.
- Browser checks also passed for startup, completion, reload/Rust replay, keyboard submission, draft restoration and sessionStorage denial, successful peer refresh retaining retry, two-tab content-free invalidation and canonical reload, malformed-row preservation, Unicode, inert script-like text, focus restoration/outline, 320px reflow, and busy-state cleanup.

### Validation

- Tested on Windows x64 with Rust 1.93.0, Node 22.12.0, and headless Edge 154.0.4258.48 through local CDP. Shell build validation used Git Bash on Windows. Page requests stayed same-origin; no uncaught errors or CSP violations occurred. The automatic favicon 404 is excluded from console assertions.
- Firefox, Safari, standalone Chrome, native browser zoom, NVDA, and VoiceOver were not tested for this patch. Quota failures were injected; the host disk was not filled.
- No new product capability or dependency was added. This closes planned 0.1.x stabilization; the next development target is v0.2.0.

## [0.1.4]

### Fixed

- Preserved the original IndexedDB write failure cause so quota errors receive actionable retry guidance without losing the draft or changing the event log.

### Improved

- Refreshed same-origin peer tabs from the canonical IndexedDB event stream through Rust replay using content-free BroadcastChannel invalidations.
- Added cross-platform build and version-consistency tooling, an explicit WASM-focused Rust toolchain pin, and a same-origin Content Security Policy.
- Expanded malformed protocol, deterministic replay, storage retry, cross-tab, and accessibility regression coverage.

### Tests

- 32 Rust tests and 3 built-in Node bridge tests passed.
- `cargo fmt --check`, Clippy with warnings denied, `wasm32-unknown-unknown` release build, both build scripts, and the version-consistency check passed.
- Browser checks passed for add/complete/reload, keyboard submission, Unicode and inert rendering, malformed-row preservation, quota abort/retry, two-tab refresh, 320px layout, and same-origin requests.

### Validation

- Tested on Windows 10 x64 with Rust 1.93.0, Node 22.12.0, and headless Edge 154.0.4258.48 through local CDP; CSP loaded with no CSP violations. An automatic `/favicon.ico` request returned 404.
- Forced-colors, increased text spacing, and 320px reflow were checked in the integrated VS Code browser (Code 1.139.1, Electron 43.6.0, Chromium 150). Native 200% browser zoom, Firefox, Safari, standalone Chrome, NVDA, and VoiceOver remain unverified.

## [0.1.3]

### Audited

- Confirmed JavaScript remains a browser adapter and renderer; Rust remains the only authoritative event validator and item-state reducer.
- Documented the event, identity, ordering, and protocol foundations that later capabilities can extend without implementing those capabilities.
- Confirmed no npm runtime packages, frontend frameworks, WASM helper crates, or third-party network dependencies are present.
- Rechecked local-only storage/requests, privacy-safe diagnostics, and the v0.0.10 community/security/support guidance.

### Validation

- Full Rust, bridge, WASM, reload, malformed-storage, Unicode, keyboard, and narrow-viewport regressions were run for the v0.1.x line.
- The release review records remaining platform and assistive-technology gaps and makes no certification claim for untested environments.

## [0.1.2]

### Improved

- Preserved in-progress compose drafts across same-tab reloads with best-effort `sessionStorage`; successful persistence clears the draft.
- Restored keyboard focus after asynchronous add and completion actions and exposed initialization/save progress with `aria-busy`.
- Kept retryable startup feedback for WASM and IndexedDB failures without discarding stored household events.

### Validation

- Verified draft restore/clear, WASM failure and retry with focus restoration, add/complete focus continuity, status updates, reduced-motion preference, and 320px/360px/640px reflow in the browser.
- Confirmed a blocked `sessionStorage` does not prevent startup or saving; draft retention degrades without affecting the event store.
- Confirmed primary controls are at least 48px high. Testing used Windows 10 x64 with the integrated VS Code browser (Code 1.139.1, Electron 43.6.0, Chromium 150.0.7871.250).
- Screen-reader and non-Chromium browser testing remain unverified.

## [0.1.1]

### Fixed

- Preserved leading U+FEFF and other Unicode text during UTF-8 validation while continuing to reject malformed lone surrogates.
- Closed IndexedDB connections when local-context initialization fails or a blocked open later completes.
- Rejected corrupted event metadata through deterministic integrity errors before lossy conversion or replay.

### Tests

- Added regression tests for BOM/emoji preservation, malformed surrogate input, and the exact UTF-8 byte limit.
- Verified invalid completion does not append, corrupted rows remain stored, concurrent tabs preserve contiguous event order, and rapid duplicate submission creates one event.
- Re-ran 24 Rust tests, 3 built-in Node bridge tests, formatting, Clippy, the WASM build, and browser reload checks.

## [0.1.0]

### Added

- Delivered the local Household Heartbeat flow using native Web Components, Rust/WASM event validation and replay, and IndexedDB event persistence.
- Added and completed household items, with deterministic state reconstruction after reload.
- Added the manual versioned binary ABI, local identity placeholders, bounded protocol parsing, and regression tests for replay and malformed input.
- Added project-local build and static-serving instructions.

### Validation

- Rust unit and protocol tests passed; the `wasm32-unknown-unknown` release build succeeded.
- Browser checks passed for add, complete, reload, inert rendering of script-like text, keyboard submission, narrow layout, and same-origin-only requests.
- Windows 10 x64 was exercised using the integrated VS Code browser (Code 1.139.1, Electron 43.6.0, Chromium 150.0.7871.250). Firefox, Safari, standalone Chrome, and assistive-technology testing were not performed.

## [0.0.12]

### Added

- Established a project-scoped changelog and documented how release entries are maintained.

### Changed

- Updated Kin's current release references through `v0.0.12`; `v0.0.9` remains the specification freeze and `v0.1.0` remains the first implementation milestone.

## [0.0.11]

### Added

- Defined the general minor-release cadence: capability in `.0`, then correctness, resilience/accessibility, and hardening patches when meaningful work exists.

### Changed

- Corrected stale current-version references and confirmed that `v0.1.0` is the first implementation milestone.

## [0.0.10]

### Added

- Added project-scoped Code of Conduct, security, support, contribution, issue-template, and pull-request guidance.
- Documented GitHub's discovery limitations for community files nested in the ZTM Build Fest monorepo.

## [0.0.9]

### Added

- Completed the implementation preflight, accepted architecture decisions, canonical test vectors, and requirement traceability for the frozen `v0.1.0` scope.

## [0.0.8]

### Added

- Documented contributor expectations, cross-platform development guidance, code style, release process, and privacy-safe debugging.

## [0.0.7]

### Added

- Specified persistent-contract versioning, migration safety, portability, retention, and event-log evolution.

## [0.0.6]

### Added

- Froze the initial implementation contract for the manual JS/WASM ABI, binary protocol, IndexedDB event store, components, tests, and accessibility.

## [0.0.5]

### Added

- Specified household/member/device identity, pairing, cryptographic posture, threat model, and synchronization design.

## [0.0.4]

### Added

- Defined the household domain, immutable event semantics, entity lifecycles, and deterministic state reconstruction.

## [0.0.3]

### Added

- Documented initial UX flows, the release roadmap, and the first implementation specification.

## [0.0.2]

### Added

- Established the technical foundation: architecture, event model, local-first direction, privacy posture, and dependency policy.

## [0.0.1]

### Added

- Defined Kin's product foundation, intended users, principles, scope, and non-goals.
