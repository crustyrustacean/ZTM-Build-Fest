# Release Process

**Status:** Talk is implemented alongside Today, Needs and Handoff. See [V0.4.0](V0.4.0.md) for the current scope, compatibility contract and release evidence.

## Release sequence

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
