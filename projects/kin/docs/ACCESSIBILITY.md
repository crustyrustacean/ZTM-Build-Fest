# Accessibility Contract

**Status:** Current through v0.5.0 Pulse; earlier version sections are historical contracts. See Pulse below.

## Baseline requirements

- Use semantic HTML first and native form controls wherever possible.
- Give every input and button a programmatic name and visible label where appropriate.
- Preserve complete keyboard operation and a logical focus order.
- Restore focus to the compose input after add, complete, reopen, and archive transactions that disable or replace the originating control.
- When canonical peer refresh replaces a focused item action, restore focus to the compose input; a stale item retry must not remain available after the item is archived or missing.
- Provide a clear, visible focus indicator that is not obscured.
- Use meaningful heading hierarchy and landmarks.
- Announce asynchronous loading, save/completion success, and errors through an appropriately scoped status region without moving focus unexpectedly.
- Never convey item state by color alone; use text, icon plus accessible name, or another non-color cue.
- Maintain readable contrast for text, controls, boundaries, and focus states.
- Support browser zoom and reflow at narrow viewport widths without loss of functionality.
- Use touch targets large enough for one-handed mobile use; do not make a tiny icon the only way to complete an item.
- Respect `prefers-reduced-motion`; avoid unnecessary motion.
- Use ARIA only when native HTML cannot express the needed semantics.
- Test custom elements and shadow-boundary event behavior with keyboard and assistive technology where practical.

## Mobile interaction contract

Kin should remain usable one-handed on a phone and during interruptions:

- Keep item capture to a short text entry and one clear submit action.
- Default classification to Needs and expose Today through one labeled native control.
- Keep classification label, visible focus, and touch target clear under forced colors and increased text spacing.
- Minimize typing and avoid mandatory metadata.
- Keep primary controls stable and easy to reach.
- Provide accessible names for icon-only controls; prefer a visible text label for unfamiliar actions.
- Preserve draft text and communicate failures if an interaction is interrupted where practical.
- Restore a typed draft after same-tab reload when session storage is available; clear it only after a successful append.
- Avoid dense administration, tiny hit targets, and layouts that require precise gestures.
- Test 320px reflow and browser/page-scale zoom where supported; report emulated page scaling separately from native desktop zoom.

## v0.1.0 acceptance

Today/Needs capture and complete/reopen/archive controls work with keyboard alone, restore focus after asynchronous updates, announce result/error state, expose a busy state, and remain understandable without color. Release-specific browser evidence and unverified platforms are recorded in the changelog. Mobile usability and accessibility checks are release requirements, not optional polish.

## Handoff

Handoff add/acknowledge/archive restore its input focus. Peer refresh restores focus there when replacing a focused Handoff action. Busy state disables every Item/Handoff control plus retry. Semantic headings and textual acknowledgement communicate status without color or named identity.

## v0.3.2 resilience and accessibility

The browser runner covers delayed Handoff persistence across reconnect/peer refresh, newer draft ownership, sessionStorage denial, acknowledgement/archive failure and abort retry, rapid repeated retry, and stale actions without invalidation delivery. Handoff semantics, focus, announcements, disabled controls and touch targets are checked under the existing accessibility modes. No screen-reader or native desktop zoom certification is claimed.

## v0.4.0 Talk

Talk uses semantic heading/lists, native labels/buttons, textual status and input focus restoration after add/resolve/reopen/archive and peer action replacement. Busy state disables all controls. Require 48px targets, 320px reflow and accessibility modes; do not claim untested assistive-technology certification. See [V0.4.0](V0.4.0.md).

## v0.4.2 resilience and accessibility evidence

Expanded Talk browser checks for keyboard resolve/reopen/archive, native input-to-Add focus order, semantic headings/lists, labels, polite status/assertive errors, visible focus and 48px targets under forced colors. Added independent draft assertions and direct stale retries with missed invalidation, alongside repeated-refresh recovery. Retained delayed saves, reconnect, queued peer refresh, sessionStorage denial, quota/abort rollback, rapid retry once and supersession. No production defect was found. Passed 56 Rust and 17 Node/real-WASM tests, formatting, Clippy, version consistency, release WASM, both build scripts/launchers (page/WASM HTTP 200), and complete browser suite in Windows x64/Chrome 154.0.8037.59/Node 22.12.0, POSIX via WSL. 320px, increased spacing, forced colors, reduced motion and 200% page-scale emulation pass; native zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

## v0.4.3 reflow correction

Added every truncated v4 result-header/Talk-record boundary, malformed request headers and extreme lengths, 10,000-event mixed replay, and 10,000-Talk real-WASM growth with independent copied results across repeated success/error/empty calls. Retained explicit v3 Handoff truncation/trailing-byte coverage. Visual inspection found and fixed horizontal overflow caused by a 320px page minimum width when a desktop scrollbar consumes space; reflow assertions now compare scrollWidth with clientWidth. The corrected 320px screen preserves full input focus outlines and wrapping actions.

Passed 58 Rust tests and 19 Node bridge/real-WASM tests, formatting, Clippy with warnings denied, version consistency, release WASM, PowerShell and WSL POSIX build scripts and build/run launchers (page and WASM HTTP 200), and complete browser regressions. Environment: Windows x64, Rust 1.93.0, Node 22.12.0, Chrome 154.0.8037.59; POSIX via WSL. Keyboard, all Talk lifecycle focus restoration, native focus order, semantics, busy/status/error, 48px targets, scrollbar-aware 320px reflow, forced colors, increased spacing, reduced motion and 200% page-scale emulation passed. Native desktop zoom, Firefox, Safari, NVDA and VoiceOver remain unverified.

## v0.5.0 Pulse

Pulse uses semantic heading, labeled native selects/buttons, textual state, visible focus and 48px targets. Busy disables controls, success is polite, errors assertive. Refresh preserves selections/focus. Report actual zoom/assistive-technology coverage per milestone. See [V0.5.0](V0.5.0.md).
