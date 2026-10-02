# v0.1.0 Canonical Test Vectors

**Status:** specification vectors, not executable tests. Field names and semantics follow [EVENTS](EVENTS.md), [ABI](ABI.md), and [STATE](STATE.md). These are decoded domain-level inputs; serialize them with ABI protocol version 1 for byte-level tests.

## Common envelope values

All IDs below are 16-byte values shown as 32 lowercase hexadecimal characters. Unless overridden, events use:

```text
household_id = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
actor_id     = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
device_id    = cccccccccccccccccccccccccccccccc
event_version = 1
protocol_version = 1
```

Timestamps are signed UTC Unix milliseconds. `local_sequence` is IndexedDB ordering metadata and is not encoded in the event payload. Text strings are exact UTF-8 values.

Unless a vector overrides a field, each event uses `event_version = 1`, the common household/actor/device IDs above, protocol version 1, and the timestamp, event ID, item ID, logical time, and local sequence shown in that vector. A vector that does not specify an ordering uses input order with `local_sequence` and `logical_time` starting at 1 and incrementing by one.

## Vector 001 — Add item

Input event at `local_sequence = 1`:

```text
kind          = ITEM_ADDED
event_id      = 00000000000000000000000000000001
item_id       = 11111111111111111111111111111111
timestamp     = 1760000000000
logical_time  = 1
text          = "Buy milk"
```

Expected state:

```text
household_id = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
items = [
  { item_id: 11111111111111111111111111111111,
    text: "Buy milk",
    created_by: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,
    created_at: 1760000000000,
    status: active }
]
```

## Vector 002 — Multiple items

Input these complete events in `local_sequence` order, using the common envelope values above:

```text
Event 1
local_sequence = 1
kind = ITEM_ADDED
event_id = 00000000000000000000000000000001
item_id = 11111111111111111111111111111111
timestamp = 1760000000000
logical_time = 1
text = "Buy milk"

Event 2
local_sequence = 2
kind = ITEM_ADDED
event_id = 00000000000000000000000000000002
item_id = 22222222222222222222222222222222
timestamp = 1760000030000
logical_time = 2
text = "Restock wipes"
```

Expected: two independent active items in addition order. Neither item overwrites the other; item text is not an identity key.

## Vector 003 — Complete item

Input Vector 001 followed at `local_sequence = 2` by:

```text
kind          = ITEM_COMPLETED
event_id      = 00000000000000000000000000000002
item_id       = 11111111111111111111111111111111
timestamp     = 1760000060000
logical_time  = 2
```

Expected: the item remains present with the same text and `status = completed`.

## Vector 004 — Invalid reference

Input one event at `local_sequence = 1`:

```text
kind          = ITEM_COMPLETED
event_id      = 00000000000000000000000000000004
item_id       = ffffffffffffffffffffffffffffffff
timestamp     = 1760000000000
logical_time  = 1
```

There is no prior `ITEM_ADDED` for this item ID.

Expected: deterministic invalid-domain-event error (ABI status code 4), no result projection, and no partial state.

## Vector 005 — Duplicate event ID

Input the exact canonical Vector 001 event twice in one test replay.

Expected: the identical duplicate is idempotently ignored; exactly one active item results. If the duplicate has the same event ID but different canonical bytes (for example, changed text), expected result is deterministic integrity/domain failure (status code 4), never overwrite.

## Vector 006 — Replay determinism

Let `A` be the ordered input from Vector 003. Run `rebuild(A)` repeatedly.

Expected: each successful state is structurally identical, including item ordering and fields. Replay must not depend on ambient time, random values, map iteration order, network, or DOM state.

## Vector 007 — Repeated completion

Input Vector 003 followed at `local_sequence = 3` by this second event:

```text
kind          = ITEM_COMPLETED
event_id      = 00000000000000000000000000000003
item_id       = 11111111111111111111111111111111
timestamp     = 1760000120000
logical_time  = 3
```

Expected: successful replay; item remains completed. The distinct completion fact remains in history and is a state no-op. Exact delivery duplication is covered by Vector 005.

## Vector 008 — Unsupported version

Use either protocol version `2` in the request header or event version `2` on a record.

Expected: deterministic unsupported-version status (ABI status code 3), no partial result, and original event bytes remain preserved by the caller/storage layer.

## Vector 009 — Malformed payload

Provide a protocol-v1 request with `event_count = 1` and one event at `local_sequence = 1`:

```text
event_version = 1
event_kind = 1 (ITEM_ADDED)
event_id = 00000000000000000000000000000009
household_id = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
actor_id = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
device_id = cccccccccccccccccccccccccccccccc
timestamp = 1760000000000
logical_time = 1
payload_length = 22 bytes
payload = item_id[16] | text_length:u32 = 5 | UTF-8 bytes for "hi" (2 bytes)
```

The record's payload length is internally present (22 bytes), but its text length exceeds the two text bytes supplied.

Expected: deterministic malformed-protocol status (ABI status code 2), no crash, no partial result, and no IndexedDB append.

## Vector 010 — Household mismatch

Provide two `ITEM_ADDED` events in one request. The first uses the common envelope values above; the second uses the same actor/device but a different household:

```text
Event 1
local_sequence = 1
timestamp = 1760000000000
household_id = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
event_id = 00000000000000000000000000000001
item_id = 11111111111111111111111111111111
logical_time = 1
text = "Buy milk"

Event 2
local_sequence = 2
timestamp = 1760000030000
household_id = dddddddddddddddddddddddddddddddd
event_id = 00000000000000000000000000000002
item_id = 22222222222222222222222222222222
logical_time = 2
text = "Restock wipes"
```

Expected: deterministic invalid-event/domain status (ABI status code 4); the stream is rejected as a whole.

## Vector 011 — User text remains inert

Use Vector 001 with text exactly:

```text
<script>alert("x")</script>
```

Expected domain state preserves the exact string as text. Browser acceptance verifies it is rendered inertly as text, never executed or interpreted as markup; see [TESTING](TESTING.md) and [ACCESSIBILITY](ACCESSIBILITY.md).
