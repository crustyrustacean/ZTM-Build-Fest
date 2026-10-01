# Derived Household State

**Status:** state/replay contract for future implementation. No reducer or state engine exists yet. Event rules are in [Events](EVENTS.md); entity meaning is in [Domain](DOMAIN.md).

## Projection pipeline

```text
ordered event stream
       |
       v
validate envelope and payload
       |
       v
apply deterministic reducer
       |
       v
HouseholdState
```

The same valid ordered event stream must always derive the same household state. Current state is a projection of events; the event history remains the underlying record. Do not persist an independently editable state snapshot as a second source of truth. A future cache may accelerate replay only if it can be discarded and rebuilt from events.

## v0.1.0 HouseholdState

Keep the first projection small:

```text
HouseholdState
├── household_id
├── items: map<ItemId, ItemState>
└── replay metadata (supported version, applied event identities)

ItemState
├── item_id
├── text
├── created_by
├── created_at
└── status: active | completed
```

The item map is keyed by stable item ID, never display text. Actor, household, and device IDs in v0.1.0 are local placeholders. Handoff, Talk, Pulse, Routine, Agreement, authentication, and remote device state are outside the v0.1.0 projection.

## Validation and errors

Validate the complete event envelope and event-specific payload before applying a transition. Event kind and schema version must be supported, household identity must match the stream, IDs and text must meet the documented constraints, and referenced entities must exist.

An invalid event makes reconstruction fail deterministically and produces no partial state for presentation. Preserve the event bytes for diagnosis/recovery; do not silently discard an unknown event or continue with a misleading projection. Duplicate delivery follows [Events](EVENTS.md): an exact duplicate event is ignored, while a duplicate ID with different content is an integrity error.

## Replay example

Given this ordered, valid stream:

```text
ITEM_ADDED      item-17 "Buy milk"
ITEM_COMPLETED  item-17
ITEM_REOPENED   item-17
```

The resulting state is:

```text
Item item-17
text = "Buy milk"
status = active
```

`ITEM_REOPENED` is a later-release event and is shown only to define intended future semantics. The v0.1.0 subset ends after `ITEM_COMPLETED`, producing `status = completed`.

Replaying the same supported event stream repeatedly produces structurally identical state. No reducer rule may depend on ambient current time, random values, network responses, DOM state, or iteration order of an unordered container.

## Time-dependent projections

Event timestamps are data, not an implicit clock. Features such as Pulse expiry must be projected using an explicit `as_of` instant supplied to the projection; the same events and same `as_of` value must yield the same result. Pulse is not part of v0.1.0.

## Archival and deletion

Do not physically erase a domain entity's earlier events to represent routine removal. An explicit `ITEM_ARCHIVED` transition acts as a tombstone in derived state and prevents an old event replay or disconnected device from making the item appear active again. Archived items are excluded from the active view but remain represented in history.

This does not override a person's right to request data deletion. Physical log compaction, household erasure, backup deletion, and cross-device deletion require a later privacy and synchronization design. No retention or erasure implementation exists yet.

## Future sync boundary

A deterministic total event ordering makes projections reproducible; it does not decide which conflicting human intent wins. Semantic conflict rules, including archive versus complete, are separate future sync design work. v0.1.0 has one local append-ordered stream and no merge behavior.
