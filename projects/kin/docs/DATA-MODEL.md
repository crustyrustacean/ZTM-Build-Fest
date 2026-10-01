# Data Model

**Status:** conceptual. No event types, schemas, or persistence code have been implemented.

## Event-oriented state

Kin should be designed around household events rather than only storing a mutable snapshot such as:

```text
milk.completed = true
```

A conceptual history is clearer about what happened:

```text
09:13 ADD_ITEM "Buy milk"
11:42 COMPLETE_ITEM item-12
```

The current household state can be derived by applying valid events in order. A snapshot may later be useful as a performance optimization, but it must not silently replace the event model as the source of domain meaning.

## Conceptual event envelope

```text
Event
├── event_id
├── actor_id
├── timestamp
├── kind
└── payload
```

This is an initial sketch, not a serialization contract. A real schema will need to settle identity and ordering, timestamp semantics, payload validation, compatibility/versioning, and how invalid or duplicate events are handled. Actor identity is temporary and local in v0.1.0.

## Possible future event kinds

These names describe possible operations, not a commitment to implement them all:

```text
ADD_ITEM
COMPLETE_ITEM
ARCHIVE_ITEM

ADD_HANDOFF
ACKNOWLEDGE_HANDOFF

ADD_TALK_ITEM
RESOLVE_TALK_ITEM

SET_PULSE

CREATE_ROUTINE
COMPLETE_ROUTINE

UPDATE_AGREEMENT
```

The first coded release is intentionally much smaller: `ADD_ITEM` and `COMPLETE_ITEM` only. See [v0.1.0](V0.1.0.md).

## Initial conceptual entities

- **Household:** A shared coordination space; membership and identity are future design work.
- **Member:** A person associated with a household; authorization is not part of v0.1.0.
- **Device:** A client that may eventually be trusted, paired, and revoked.
- **Item:** A small household need that can be added and completed.
- **Handoff:** Context one household member transfers to another.
- **TalkItem:** A topic captured for a later conversation.
- **Routine:** A recurring household need.
- **Agreement:** A shared household understanding that may change over time.
- **Event:** A recorded domain action from which state can be reconstructed.

These entities are conceptual and will be narrowed to the actual requirements of each release.

## Why an event stream

A well-defined event stream can later support:

- Reconstructing current state after reload
- A useful “Since You Last Looked” summary
- Household history and event replay
- Offline changes and multiple devices
- Sync reconciliation and conflict handling
- Recurrence and derived views

These are reasons to explore the model, not features already delivered. Event history also has privacy and retention implications; see [Privacy](PRIVACY.md).
