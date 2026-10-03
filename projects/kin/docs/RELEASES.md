# Release Process

**Status:** Current implementation/release: v0.9.3 Encrypted Event Sync Stabilization. The v0.9.x line ends at its encrypted-sync stabilization gate. The next planned development line is v0.10.x — Portable Core / Architectural Consolidation — before v1.0.0. Sync is opt-in and encrypted, but identity/relay state remains process-memory only; accepted relay data is not durable.

## Release sequence

The intended progression is `kin-v0.9.3` → `kin-v0.10.0` (Portable Core + Local
Data Security) → `kin-v0.11.0` (UX/UI Consolidation) → `kin-v1.0.0` (Stable Kin
Platform). v1.0 requires BOTH architecture/security and UX/UI readiness. Use the
concrete development slices and gates in [V0.10.0](V0.10.0.md); do not manufacture
patch releases or knowingly defer a necessary correctness fix. Create tags only
after completed validation and requested approval, never at development start.

```text
scope complete
      |
      v
validation and documentation updated
      |
      v
inspect git status and diff (Kin paths only)
      |
      v
release commit
      |
      v
verify clean working tree
      |
      v
annotated kin-vX.Y.Z tag on that commit
      |
      v
push commit/tag when explicitly authorized
```

A tag is created only for a completed, validated milestone. Use a descriptive annotated tag such as `kin-v0.0.8` or `kin-v0.1.0`. Never use generic tags such as `v0.1.0`; the repository contains multiple independent projects. Published tags are immutable: do not move, force-update, or reuse them. Correct a released mistake with a new patch version.

Before a new version starts, verify that the previous completed Kin version has its matching tag. Inspect the entire worktree and stage/commit only paths under `projects/kin/`. Do not include another contributor's changes.

## Changelog

Maintain the project-scoped [changelog](../CHANGELOG.md) for each completed release. Add an entry from the validated changes before committing and tagging; summarize what actually changed, not planned or deferred behavior. Keep prior release entries intact. Planning releases should be identified as documentation/planning work rather than implemented product features.

## Semantic version intent

Semantic versioning describes Kin's product release; persistent event, ABI, storage, and export versions remain independent contracts, as described in [VERSIONING](VERSIONING.md).

- **Patch (`0.1.x`):** bug fixes, security hardening, documentation corrections, or compatible implementation improvements.
- **Minor (`0.x.0`):** a planned new product capability that preserves the supported contracts where reasonably possible.
- **Major (`x.0.0`):** a substantial product or compatibility break once Kin has a mature enough public compatibility promise to warrant it.

For each approved minor capability, use these initial stabilization patches when meaningful work exists:

```text
v0.N.0 — new product capability
v0.N.1 — correctness
v0.N.2 — resilience and accessibility
v0.N.3 — hardening and polish
```

After `.3`, stop and ask the user whether the line is satisfactory before beginning another feature. Additional fixes remain normal patches (`.4`, `.5`, and onward); do not use four-part versions or manufacture unnecessary patch releases. A new minor version requires both a genuinely new product capability and explicit user approval. Each completed version gets its own annotated, namespaced tag on the validated release commit.

Before maturity, do not overpromise strict public API stability. Still document compatibility effects and provide migration/recovery expectations before changing persistent contracts.

## Release checks

For documentation milestones, validate required documents, internal links, scope, and absence of application code. For coded releases, use the release gate defined in [V0.1.0](V0.1.0.md) and any later release-specific criteria. Report the release commit, exact tag, and whether each was actually pushed. When publication is not authorized, provide the exact `git push origin kin-vX.Y.Z` command and do not claim the release is published.

## v0.4.0 Talk

Use kin-v0.4.0-development; create dedicated commits and annotated kin-v0.4.0 through kin-v0.4.3 tags only after each full validation gate. Stop after v0.4.3; no automatic push or kin-main merge. See [V0.4.0](V0.4.0.md).

## v0.5.x Pulse

Dedicated validated commits and annotated kin-v0.5.0 through kin-v0.5.3 tags. Stop after v0.5.3. See [V0.5.0](V0.5.0.md).

## v0.6.x Since You Last Looked

Create dedicated validated commits and annotated `kin-v0.6.0` through `kin-v0.6.3` tags. Preserve protocol v1–v5, schema-1 event bytes, and IndexedDB schema 1. Do not push or merge automatically. Stop after v0.6.3 and hand control back for release-line evaluation. See [V0.6.0](V0.6.0.md).

## v0.7.x Routines

Follow [V0.7.0](V0.7.0.md) for capability, correctness, resilience/accessibility and hardening gates. Release protocol v7 and new schema-1 kinds 14–17 without altering older contracts. Keep IndexedDB schema 1. Each completed milestone gets its own validated commit and annotated tag.

## v0.8.0 Household Pairing

The v0.7.x line is complete at `kin-v0.7.4`, which points to validated release commit `a8ded079be6fdbedba8738a64a5f0fb753e7fdd6` and is pushed to the fork, not upstream. The v0.8.x implementation and stabilization record is in [V0.8.0](V0.8.0.md). `kin-v0.8.8` corrected active-member slot accounting. The v0.9.x sync contract and release record is in [V0.9.0](V0.9.0.md). Stop after `kin-v0.9.3`; next plan v0.10.x, and do not begin v1.0 implementation until its readiness criteria are met.
