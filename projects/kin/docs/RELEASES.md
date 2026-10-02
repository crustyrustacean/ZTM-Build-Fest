# Release Process

**Status:** release procedure for future milestones. Kin's current tags are annotated, namespaced `kin-vX.Y.Z`; this document does not publish or move any tag.

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

## Semantic version intent

Semantic versioning describes Kin's product release; persistent event, ABI, storage, and export versions remain independent contracts, as described in [VERSIONING](VERSIONING.md).

- **Patch (`0.1.x`):** bug fixes, security hardening, documentation corrections, or compatible implementation improvements.
- **Minor (`0.x.0`):** a planned new product capability that preserves the supported contracts where reasonably possible.
- **Major (`x.0.0`):** a substantial product or compatibility break once Kin has a mature enough public compatibility promise to warrant it.

Before maturity, do not overpromise strict public API stability. Still document compatibility effects and provide migration/recovery expectations before changing persistent contracts.

## Release checks

For documentation milestones, validate required documents, internal links, scope, and absence of application code. For coded releases, use the release gate defined in [V0.1.0](V0.1.0.md) and any later release-specific criteria. Report the release commit, exact tag, and whether each was actually pushed. When publication is not authorized, provide the exact `git push origin kin-vX.Y.Z` command and do not claim the release is published.
