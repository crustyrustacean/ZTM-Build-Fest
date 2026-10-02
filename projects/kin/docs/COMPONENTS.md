# Web Component Contract

**Status:** v0.1.0 native custom elements and command communication are implemented. Later components and product areas remain out of scope.

## Component responsibilities

### `<kin-app>`

Own application initialization, WASM loading, IndexedDB opening/loading, orchestration of the storage and Rust bridge, global loading/error states, and passing Rust-derived state to presentation components. It is the only owner of the command-to-event-to-persist flow. It must not duplicate Rust's validation or reducer.

### `<kin-today>`

Display the current local household items using the projection supplied by `<kin-app>`. Keep active items and completed items visually distinguishable without ranking people or adding future Today features.

### `<kin-compose>`

Provide a labeled, short item-entry form. On valid submission, dispatch `kin:add-item` with the submitted text. It does not create event IDs, write storage, or mutate authoritative state.

### `<kin-item>`

Render one item and expose a semantic completion control only while active. Dispatch `kin:complete-item` with the item ID. It does not decide or persist completion.

Only create the components needed for these responsibilities; do not componentize for its own sake. A simpler `<kin-app>`-owned view is acceptable if it avoids needless indirection while preserving these boundaries.

## Browser-native command events

| Event               | Dispatching component | `detail`             | `bubbles` | `composed` | `cancelable` |
| ------------------- | --------------------- | -------------------- | --------- | ---------- | ------------ |
| `kin:add-item`      | `<kin-compose>`       | `{ text: string }`   | `true`    | `true`     | `false`      |
| `kin:complete-item` | `<kin-item>`          | `{ itemId: string }` | `true`    | `true`     | `false`      |

`composed: true` allows a command to cross a shadow boundary to `<kin-app>`; `bubbles: true` allows normal ancestor handling. Events represent user intent, not successful domain mutations. `<kin-app>` validates through Rust, persists the accepted event, then rerenders from returned state. Errors are presented through an explicit app state, not by components pretending the action succeeded.

The detail value contains only the minimum command data. Do not include member analytics, device telemetry, or derived business state. Use native `CustomEvent`; no event bus dependency is needed.

## State and accessibility boundary

Parent/application orchestration supplies state as properties or a documented attribute/property contract; components do not read IndexedDB or call WASM directly. Controls use semantic HTML, labels, keyboard interaction, visible focus, and accessible status feedback as described in [ACCESSIBILITY](ACCESSIBILITY.md). User text is rendered as text, never interpolated as executable HTML.
