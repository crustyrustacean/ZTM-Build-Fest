# v0.1.0 Requirement Traceability

**Status:** the v0.1.0 table is a historical planning map; the v0.2.0 table records implemented Today + Needs requirements and their current regression coverage.

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

## v0.2.0 Today + Needs

| Requirement                                                         | Specification authority                                                       | v0.2.0 validation                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fixed Today/Need classification; Needs is capture default           | [V0.2.0](V0.2.0.md), [DOMAIN](DOMAIN.md), [COMPONENTS](COMPONENTS.md)         | Rust schema-v1/v2 replay tests and browser capture/classification/reload checks.                                  |
| Legacy v0.1.x item remains visible in Today without rewriting bytes | [V0.2.0](V0.2.0.md), [VERSIONING](VERSIONING.md), [MIGRATIONS](MIGRATIONS.md) | Protocol-v1 history fixture and mixed-schema replay; compare canonical source bytes.                              |
| Protocol v1 remains unchanged; v2 carries classification/status     | [ABI](ABI.md), [VERSIONING](VERSIONING.md)                                    | Rust protocol-v1/v2 vectors, malformed v2 boundaries, and browser WASM replay.                                    |
| Rust owns complete Item lifecycle and deterministic projection      | [EVENTS](EVENTS.md), [STATE](STATE.md), [LIFECYCLES](LIFECYCLES.md), ADR 0002 | Rust transition matrix and browser complete/reopen/archive/reload checks.                                         |
| Archive is terminal and preserves event history                     | [LIFECYCLES](LIFECYCLES.md), [STORAGE](STORAGE.md), [RETENTION](RETENTION.md) | Invalid post-archive transitions append nothing; archived record survives reload and is hidden from normal views. |
| Draft completion belongs to exact text/classification submission    | [V0.2.0](V0.2.0.md), [ACCESSIBILITY](ACCESSIBILITY.md)                        | Browser delayed-save, failed-add, edited-draft, retry, and reconnect regression.                                  |
| IndexedDB remains schema 1 and BroadcastChannel content-free        | [STORAGE](STORAGE.md), ADR 0004, ADR 0006                                     | Browser transaction/reload/two-tab checks and schema/version inspection.                                          |
| Capture/actions remain accessible and mobile-usable                 | [ACCESSIBILITY](ACCESSIBILITY.md), [TESTING](TESTING.md)                      | Keyboard, focus, announcements, target/reflow checks at 320px; platform gaps reported.                            |
| Reopen/archive payloads require exact shape                         | [ABI](ABI.md), [EVENTS](EVENTS.md), [V0.2.0](V0.2.0.md)                       | Reject every payload length other than 16 bytes for both lifecycle kinds.                                         |
| Protocol v1 never loses unrepresentable current state               | [ABI](ABI.md), [VERSIONING](VERSIONING.md)                                    | A v1 result request for Need or archived state returns unsupported-version error.                                 |
| Event append and logical counter commit atomically                  | [STORAGE](STORAGE.md), ADR 0004                                               | Browser failure/abort keeps both event count and counter unchanged; successful retry advances both once.          |
| Metadata mismatch and storage limit fail without data loss          | [STORAGE](STORAGE.md), [VERSIONING](VERSIONING.md)                            | Browser preserves mismatched row bytes and rejects the 10,001st event without changing history/counter.           |
| Stale action retry is reconciled with canonical state               | [EVENTS](EVENTS.md), [STATE](STATE.md), [ACCESSIBILITY](ACCESSIBILITY.md)     | Two-tab archive race and missed-invalidation retry reload through Rust, clear stale intent, and append nothing.   |
| Keyboard focus survives action and peer rerender                    | [ACCESSIBILITY](ACCESSIBILITY.md), [TESTING](TESTING.md)                      | Keyboard action restores compose focus; peer refresh replaces a focused control without losing focus.             |
| Accessibility modes preserve mobile usability                       | [ACCESSIBILITY](ACCESSIBILITY.md)                                             | 320px reflow, forced colors, reduced motion, increased text spacing, and 200% page-scale emulation.               |
| 10,000-event replay remains bounded and deterministic               | [ABI](ABI.md), [STATE](STATE.md), [TEST-VECTORS](TEST-VECTORS.md)             | Native Rust and real WASM replay 10,000 classified items within 64 MiB and produce deterministic results.         |
| Repeated WASM calls do not leak stale output/error buffers          | [ABI](ABI.md), [TESTING](TESTING.md)                                          | Browser performs success, unsupported event, empty, and repeated success calls in sequence.                       |
| Local privacy/security boundaries remain intact                     | [ARCHITECTURE](ARCHITECTURE.md), [PRINCIPLES](PRINCIPLES.md), [ABI](ABI.md)   | Safe text DOM, CSP, same-origin-only requests, content-free invalidation, and no framework/dependency audit.      |

## v0.3.0 Handoff

Authority: [V0.3.0](V0.3.0.md), ABI, EVENTS, LIFECYCLES. Rust protocol tests cover typed projection, lifecycle, identity, deduplication, and mixed replay. Node tests cover actual WASM and v1/v2/v3 compatibility. Browser Handoff regressions cover persistence, drafts, retry ownership, inert rendering, neutral labels, and cross-tab stale intent.

## v0.3.1 correctness evidence

Handoff tests reject every shortened payload, overlong references, unsupported schemas, extreme lengths, invalid UTF-8 and whitespace-only domain text. Exact v3 result records and separate entity namespaces are checked. Actor provenance comes from envelopes; same and different acknowledging actors both succeed. Browser fault injection verifies event/counter rollback, retry once, and metadata mismatch preservation; Node tests reject malformed Handoff result fields and recover on the next call.
