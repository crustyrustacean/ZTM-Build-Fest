# v0.1.0 Requirement Traceability

**Status:** lightweight planning map. Rows identify the authority and the future validation; they do not mean the behavior is implemented.

| Requirement                                        | Specification authority                                                                 | v0.1.0 validation                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Product stays small and nonjudgmental              | [PRODUCT](PRODUCT.md), [PRINCIPLES](PRINCIPLES.md), [UX](UX.md)                         | Scope review; fast-capture and language review.                                    |
| Rust owns household domain state                   | [ARCHITECTURE](ARCHITECTURE.md), [EVENTS](EVENTS.md), ADR 0002                          | Rust reducer/unit tests; verify JavaScript contains no duplicate reducer.          |
| Persisted events are immutable                     | [EVENTS](EVENTS.md), [VERSIONING](VERSIONING.md), ADR 0001                              | Replay and duplicate-event vectors.                                                |
| Event envelope/names and v0.1 subset               | [EVENTS](EVENTS.md), [V0.1.0](V0.1.0.md)                                                | Protocol decode tests and vectors 001–005.                                         |
| Invalid references fail deterministically          | [EVENTS](EVENTS.md), [STATE](STATE.md), [ABI](ABI.md)                                   | Vector 004; assert no partial output/state.                                        |
| Same ordered stream derives same state             | [STATE](STATE.md), ADR 0001                                                             | Vector 006 and repeated Rust reconstruction test.                                  |
| IndexedDB stores the event source of truth         | [STORAGE](STORAGE.md), ADR 0004                                                         | Append/read/reload browser test; verify no authoritative mutable projection store. |
| JS/WASM memory/protocol boundary is explicit       | [ABI](ABI.md), [IMPLEMENTATION](IMPLEMENTATION.md), ADR 0003                            | ABI ownership, bounds, malformed, and unsupported-version tests.                   |
| UI uses native Web Components/browser behavior     | [COMPONENTS](COMPONENTS.md), [ARCHITECTURE](ARCHITECTURE.md), ADR 0005                  | Browser command-flow and component boundary checks.                                |
| Local-first; no remote household content in v0.1.0 | [PRIVACY](PRIVACY.md), [V0.1.0](V0.1.0.md), ADR 0006                                    | Network inspection confirms no backend/analytics/third-party content request.      |
| User text remains data                             | [AGENTS.md](../AGENTS.md), [COMPONENTS](COMPONENTS.md), [THREAT-MODEL](THREAT-MODEL.md) | Vector 011; verify safe text rendering.                                            |
| Keyboard/mobile accessibility                      | [ACCESSIBILITY](ACCESSIBILITY.md), [TESTING](TESTING.md)                                | Keyboard, focus, status, zoom, and narrow viewport checks.                         |
| No runtime framework/dependency by default         | [AGENTS.md](../AGENTS.md), [IMPLEMENTATION](IMPLEMENTATION.md), ADR 0007                | Manifest/dependency review at release gate.                                        |
| Future migrations preserve data                    | [VERSIONING](VERSIONING.md), [MIGRATIONS](MIGRATIONS.md)                                | Migration tests when migration code is introduced; not a v0.1.0 feature.           |
| Export/deletion policy is explicit                 | [PORTABILITY](PORTABILITY.md), [RETENTION](RETENTION.md), [PRIVACY](PRIVACY.md)         | Documentation review now; no v0.1.0 export/delete behavior is claimed.             |
