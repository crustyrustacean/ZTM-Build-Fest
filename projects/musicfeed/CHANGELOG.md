# Changelog

All notable changes to MusicFeed are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-10-03

The first real feature: the to-do starter demo is gone, replaced by a music rotation log. Entries
can be added through a form and appear live in the list.

### Added

- `RotationEntry` domain type (`src/domain.rs`), replacing the starter's `Item`. Field names mirror
  the blog widget's existing `rotation.json` contract (`artist`, `album`, `cover`, `year`, `note`)
  so the destination site needs no data-handling changes. `id` and `listened_date` are stamped by the
  app and the type derives `Serialize` only, so neither can be forged by a client.
- `POST /rotation` handler (`src/routes/rotation.rs`) accepting form input and streaming SSE patches.
- `RawRotationEntry`, the request type, alongside the handler. `year` is typed `i32` and validated by
  serde, so bad input is rejected before the handler runs — no custom parsing required.
- In-memory storage: `AppState { rotation_entries, next_id }`, replacing `items` and `next_id`.
- Entry form and rotation list (`templates/index.html`), with `templates/rotation.html` as a shared
  partial included by both the server-rendered page and the SSE patch.
- Empty state ("Nothing spinning yet"), shown only while the list is empty.
- `compact_html()` in `src/utils.rs`. Datastar prefixes every line of `data: elements`, so a
  pretty-printed fragment arrives as many separate patches. Compacting at render time keeps the
  templates readable.
- `bacon.toml` with the `test` job wired to `cargo nextest`.
- README run instructions: clone, `cargo run`, configuration table, test instructions.
- 19 tests covering the SSE contract, HTML escaping, the empty state, cover handling, and the
  form-reset round trip.

### Changed

- Crate renamed from `axum-tera-datastar` to `musicfeed`.
- Entry list is rendered as cards with an optional cover image, artist, album, year, note, and the
  date listened.
- Blank `cover` and `note` are treated as absent and omitted rather than rendered empty.

### Removed

- The starter's to-do demo: `Item`, `src/routes/items.rs`, `tests/api/items.rs`, and the
  `POST /items` / `DELETE /items/{id}` routes.

### Fixed

- Only the first entry appeared in the live list. A multi-line template produced one `data: elements`
  field per line, so Datastar applied fragments instead of the whole entry.
- "Nothing spinning yet" survived the first submission. The empty state sat outside the patched
  element and no patch removed it; it now lives inside `#rotation-list` and the stream carries an
  explicit removal.
- Entries after the second silently failed with a `400`. The form reset sent `"year":""`, which
  serde rejects for an `i32`; `year` is no longer cleared.

### Known issues

- The `year` field does not visually clear after submission in Firefox. It is `required` and is
  excluded from the signal reset, so the value persists by design — but the browser is not
  clearing the input itself.

## [0.1.0] - 2026-10-02

Initial scaffold, renamed from the `axum-tera-datastar` starter.

### Added

- axum 0.8 + Tera 2 + Datastar 0.4 application skeleton with layered configuration, Bunyan-formatted
  tracing, and graceful shutdown.
- `GET /health_check` and a starter to-do demo.

[Unreleased]: https://github.com/crustyrustacean/ZTM-Build-Fest/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/crustyrustacean/ZTM-Build-Fest/releases/tag/musicfeed-v0.2.0