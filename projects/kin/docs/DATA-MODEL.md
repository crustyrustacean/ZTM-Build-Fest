# Data Model

**Status:** conceptual model specified for future implementation. No event types, schemas, persistence, or state engine have been implemented.

## Event-oriented source of truth

Kin records household changes as an append-oriented event stream rather than treating a mutable UI snapshot as the historical record:

```text
09:13 ITEM_ADDED item-12 "Buy milk"
11:42 ITEM_COMPLETED item-12
```

Current state is derived by validating and replaying events in a deterministic order. A future cache may accelerate reconstruction, but the event stream remains the domain source of truth. State and error behavior are specified in [STATE](STATE.md); immutable event shape, naming, identity, ordering, and validity are specified in [EVENTS](EVENTS.md).

## Conceptual event envelope

```text
Event
├── event_id
├── household_id
├── actor_id
├── device_id
├── timestamp
├── logical_time
├── kind
├── event_version
└── payload
```

The envelope is a domain contract, not the eventual JS/WASM byte encoding. The field meanings, local and future distributed ordering, idempotency, and invalid-event behavior are defined in [EVENTS](EVENTS.md). v0.1.0 uses local placeholder identities and only `ITEM_ADDED` and `ITEM_COMPLETED`.

## Conceptual entities

- **Household:** One private shared coordination space with stable identity.
- **Member:** A person with identity distinct from their devices and credentials.
- **Device:** A browser installation that may later be authorized, trusted, and revoked.
- **Credential:** An authenticator associated with a member; not itself a member or household key.
- **Item:** A lightweight household need/reminder.
- **Handoff:** Context one member wants another to know.
- **TalkItem:** A topic that matters but may be better discussed later.
- **Pulse:** Time-bounded context about current capacity.
- **Routine:** A recurring household need, not a general calendar entry.
- **Agreement:** A deliberately recorded household understanding, never inferred.
- **Event:** An immutable identified fact from which current state is reconstructed.

See [DOMAIN](DOMAIN.md) for definitions and release scope, and [LIFECYCLES](LIFECYCLES.md) for transition rules. These are specifications, not implemented features.

## Why events

An event history can support reconstruction after reload, household history, event-derived “Since You Last Looked,” offline changes, multiple devices, and later synchronization reconciliation. Those are future capabilities, not claims that history, sync, or conflict resolution exists today. Event retention and deletion also have privacy implications described in [PRIVACY](PRIVACY.md).
