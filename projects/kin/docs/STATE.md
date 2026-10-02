# Derived Household State

**Status:** Current through v0.5.3 Pulse; earlier version sections are historical contracts. See Pulse below.

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

The same valid ordered event stream and explicit as_of must always derive the same household state. Current state is a projection of events; the event history remains the underlying record. Do not persist an independently editable state snapshot as a second source of truth. A future cache may accelerate replay only if it can be discarded and rebuilt from events.

If replay later becomes expensive, a snapshot/checkpoint may accelerate reconstruction only as a verified derived projection. It is not authoritative and cannot justify deleting source events by itself. Optimization must not change observable household state; see [Retention](RETENTION.md) for the deferred event-compaction policy.

## Current HouseholdState

Keep the first projection small:

```text
HouseholdState
├── household_id: Option<HouseholdId>
├── items: Vec<ItemState> in original add-event order
├── handoffs: Vec<HandoffState> in original add-event order
├── talks: Vec<TalkState> in original add-event order
└── pulses: Vec<PulseState> ordered by actor_id

ItemState
├── item_id
├── text
├── created_by
├── created_at
├── classification: today | need
└── status: active | completed | archived
```

Items are identified by stable item ID, never display text. Actor, household, and device IDs remain local placeholders. Schema-v1 `ITEM_ADDED` events normalize to `today`; schema-v2 events carry explicit classification. HandoffState contains handoff_id, text, created_by, created_at, and status (unacknowledged, acknowledged, archived). Acknowledgement actor/time remain in its source envelope. TalkState contains talk_id, text, created_by, created_at and open/resolved/archived status. Routine, Agreement, authentication, and remote device state remain future work.

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

The same stream is supported in v0.2.x and produces `status = active`. A v0.1.x engine does not support `ITEM_REOPENED` and fails closed.

Replaying the same supported event stream repeatedly produces structurally identical state. No reducer rule may depend on ambient current time, random values, network responses, DOM state, or iteration order of an unordered container.

## Time-dependent projections

Event timestamps are data, not an implicit clock. Features such as Pulse expiry must be projected using an explicit `as_of` instant supplied to the projection; the same events and same `as_of` value must yield the same result. Pulse is not part of v0.1.0.

## Archival and deletion

Do not physically erase a domain entity's earlier events to represent routine removal. An explicit `ITEM_ARCHIVED` transition acts as a tombstone in derived state and prevents an old event replay or disconnected device from making the item appear active again. Archived items are excluded from the active view but remain represented in history.

This does not override a person's right to request data deletion. Physical log compaction, household erasure, backup deletion, and cross-device deletion require a later privacy and synchronization design. No retention or erasure implementation exists yet.

## Future sync boundary

A deterministic total event ordering makes projections reproducible; it does not decide which conflicting human intent wins. Semantic conflict rules, including archive versus complete, are separate future sync design work. v0.1.0 has one local append-ordered stream and no merge behavior.

## v0.4.0 Talk

HouseholdState adds talks: Vec<TalkState> beside items and handoffs. Each is ordered by its original creation event. TalkState has talk_id, text, created_by, created_at and status; no duplicated resolution metadata. Archived tombstones stay in projection/history but are hidden in normal lists. See [V0.4.0](V0.4.0.md).

## v0.5.0 Pulse

HouseholdState adds pulses sorted by actor ID. Explicit rebuild_at(events, as_of) projects active iff as_of < expires_at, otherwise expired. SET replaces per actor; CLEAR removes, including absent no-op. Clock rollback may reactivate latest expired context; source events stay unchanged. See [V0.5.0](V0.5.0.md).
