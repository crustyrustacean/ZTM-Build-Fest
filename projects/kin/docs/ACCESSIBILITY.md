# Accessibility Contract

**Status:** v0.2.2 hardens Today/Needs and lifecycle interaction recovery while retaining native controls and the v0.1.x accessibility baseline. Release-specific checks and unverified environments are listed in the changelog.

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
