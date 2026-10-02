# Changelog

This file records completed Kin releases. The `v0.0.x` releases are planning and documentation milestones; they do not represent implemented application features. The first implementation milestone remains `v0.1.0`.

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

- Established this project-scoped changelog and documented how release entries are maintained.

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
