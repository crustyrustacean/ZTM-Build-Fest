# Accessibility Contract

**Status:** requirements for the future v0.1.0 UI. No application interface is implemented. Accessibility is part of release acceptance, not a final cleanup task.

## Baseline requirements

- Use semantic HTML first and native form controls wherever possible.
- Give every input and button a programmatic name and visible label where appropriate.
- Preserve complete keyboard operation and a logical focus order.
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
- Minimize typing and avoid mandatory metadata.
- Keep primary controls stable and easy to reach.
- Provide accessible names for icon-only controls; prefer a visible text label for unfamiliar actions.
- Preserve draft text and communicate failures if an interaction is interrupted where practical.
- Avoid dense administration, tiny hit targets, and layouts that require precise gestures.

## v0.1.0 acceptance

The add and complete flows must work with keyboard alone, expose visible focus, announce relevant result/error state, survive zoom/narrow layouts, and remain understandable without color. Mobile usability and accessibility checks are mandatory before release; they cannot be deferred as polish.
