use std::collections::BTreeMap;

use crate::error::KinError;
use crate::event::{
    ActorId, EventEnvelope, EventId, EventKind, HandoffId, HouseholdId, ItemClassification, ItemId,
    TalkId,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ItemStatus {
    Active,
    Completed,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemState {
    pub item_id: ItemId,
    pub text: String,
    pub created_by: ActorId,
    pub created_at: i64,
    pub classification: ItemClassification,
    pub status: ItemStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandoffStatus {
    Unacknowledged,
    Acknowledged,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HandoffState {
    pub handoff_id: HandoffId,
    pub text: String,
    pub created_by: ActorId,
    pub created_at: i64,
    pub status: HandoffStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TalkStatus {
    Open,
    Resolved,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TalkState {
    pub talk_id: TalkId,
    pub text: String,
    pub created_by: ActorId,
    pub created_at: i64,
    pub status: TalkStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HouseholdState {
    pub household_id: Option<HouseholdId>,
    pub items: Vec<ItemState>,
    pub handoffs: Vec<HandoffState>,
    pub talks: Vec<TalkState>,
}

pub fn rebuild(events: &[EventEnvelope]) -> Result<HouseholdState, KinError> {
    let mut household_id = None;
    let mut items = Vec::new();
    let mut handoffs = Vec::new();
    let mut talks = Vec::new();
    let mut talk_positions = BTreeMap::new();
    let mut handoff_positions = BTreeMap::new();
    let mut item_positions = BTreeMap::new();
    let mut event_bytes = BTreeMap::<EventId, Vec<u8>>::new();
    let mut last_logical_time = 0;

    for event in events {
        if let Some(previous_bytes) = event_bytes.get(&event.event_id) {
            if previous_bytes == &event.canonical_bytes {
                continue;
            }
            return Err(KinError::InvalidEvent);
        }

        if let Some(stream_household) = household_id {
            if stream_household != event.household_id {
                return Err(KinError::InvalidEvent);
            }
        } else {
            household_id = Some(event.household_id);
        }

        if event.logical_time <= last_logical_time {
            return Err(KinError::InvalidEvent);
        }

        match &event.kind {
            EventKind::TalkAdded { talk_id, text } => {
                if text.trim().is_empty() || talk_positions.contains_key(talk_id) {
                    return Err(KinError::InvalidEvent);
                }
                talk_positions.insert(*talk_id, talks.len());
                talks.push(TalkState {
                    talk_id: *talk_id,
                    text: text.clone(),
                    created_by: event.actor_id,
                    created_at: event.timestamp,
                    status: TalkStatus::Open,
                });
            }
            EventKind::TalkResolved { talk_id }
            | EventKind::TalkReopened { talk_id }
            | EventKind::TalkArchived { talk_id } => {
                let position = talk_positions
                    .get(talk_id)
                    .copied()
                    .ok_or(KinError::InvalidEvent)?;
                let talk = &mut talks[position];
                if talk.status == TalkStatus::Archived {
                    return Err(KinError::InvalidEvent);
                }
                talk.status = match event.kind {
                    EventKind::TalkResolved { .. } => TalkStatus::Resolved,
                    EventKind::TalkReopened { .. } => TalkStatus::Open,
                    _ => TalkStatus::Archived,
                };
            }
            EventKind::HandoffAdded { handoff_id, text } => {
                if text.trim().is_empty() || handoff_positions.contains_key(handoff_id) {
                    return Err(KinError::InvalidEvent);
                }
                handoff_positions.insert(*handoff_id, handoffs.len());
                handoffs.push(HandoffState {
                    handoff_id: *handoff_id,
                    text: text.clone(),
                    created_by: event.actor_id,
                    created_at: event.timestamp,
                    status: HandoffStatus::Unacknowledged,
                });
            }
            EventKind::HandoffAcknowledged { handoff_id }
            | EventKind::HandoffArchived { handoff_id } => {
                let position = handoff_positions
                    .get(handoff_id)
                    .copied()
                    .ok_or(KinError::InvalidEvent)?;
                let handoff = &mut handoffs[position];
                if handoff.status == HandoffStatus::Archived {
                    return Err(KinError::InvalidEvent);
                }
                handoff.status = match event.kind {
                    EventKind::HandoffAcknowledged { .. } => HandoffStatus::Acknowledged,
                    _ => HandoffStatus::Archived,
                };
            }
            EventKind::ItemAdded {
                item_id,
                text,
                classification,
            } => {
                if text.trim().is_empty() || item_positions.contains_key(item_id) {
                    return Err(KinError::InvalidEvent);
                }
                item_positions.insert(*item_id, items.len());
                items.push(ItemState {
                    item_id: *item_id,
                    text: text.clone(),
                    created_by: event.actor_id,
                    created_at: event.timestamp,
                    classification: *classification,
                    status: ItemStatus::Active,
                });
            }
            EventKind::ItemCompleted { item_id } => {
                let position = item_positions
                    .get(item_id)
                    .copied()
                    .ok_or(KinError::InvalidEvent)?;
                match items[position].status {
                    ItemStatus::Active => items[position].status = ItemStatus::Completed,
                    ItemStatus::Completed => {}
                    ItemStatus::Archived => return Err(KinError::InvalidEvent),
                }
            }
            EventKind::ItemReopened { item_id } => {
                let position = item_positions
                    .get(item_id)
                    .copied()
                    .ok_or(KinError::InvalidEvent)?;
                match items[position].status {
                    ItemStatus::Active => {}
                    ItemStatus::Completed => items[position].status = ItemStatus::Active,
                    ItemStatus::Archived => return Err(KinError::InvalidEvent),
                }
            }
            EventKind::ItemArchived { item_id } => {
                let position = item_positions
                    .get(item_id)
                    .copied()
                    .ok_or(KinError::InvalidEvent)?;
                match items[position].status {
                    ItemStatus::Active | ItemStatus::Completed => {
                        items[position].status = ItemStatus::Archived;
                    }
                    ItemStatus::Archived => return Err(KinError::InvalidEvent),
                }
            }
        }

        last_logical_time = event.logical_time;
        event_bytes.insert(event.event_id, event.canonical_bytes.clone());
    }

    Ok(HouseholdState {
        household_id,
        items,
        handoffs,
        talks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{DeviceId, EventId};

    fn id(byte: u8) -> [u8; 16] {
        [byte; 16]
    }

    fn event(event_number: u8, logical_time: u64, kind: EventKind) -> EventEnvelope {
        let event_id = EventId(id(event_number));
        let mut canonical_bytes = vec![event_number, logical_time as u8];
        match &kind {
            EventKind::TalkAdded { talk_id, text } => {
                canonical_bytes.extend_from_slice(&talk_id.0);
                canonical_bytes.extend_from_slice(text.as_bytes());
            }
            EventKind::TalkResolved { talk_id }
            | EventKind::TalkReopened { talk_id }
            | EventKind::TalkArchived { talk_id } => {
                canonical_bytes.extend_from_slice(&talk_id.0);
            }
            EventKind::HandoffAdded { handoff_id, text } => {
                canonical_bytes.extend_from_slice(&handoff_id.0);
                canonical_bytes.extend_from_slice(text.as_bytes());
            }
            EventKind::HandoffAcknowledged { handoff_id }
            | EventKind::HandoffArchived { handoff_id } => {
                canonical_bytes.extend_from_slice(&handoff_id.0);
            }
            EventKind::ItemAdded { item_id, text, .. } => {
                canonical_bytes.extend_from_slice(&item_id.0);
                canonical_bytes.extend_from_slice(text.as_bytes());
            }
            EventKind::ItemCompleted { item_id }
            | EventKind::ItemReopened { item_id }
            | EventKind::ItemArchived { item_id } => {
                canonical_bytes.extend_from_slice(&item_id.0);
            }
        }
        EventEnvelope {
            event_id,
            household_id: HouseholdId(id(0xaa)),
            actor_id: ActorId(id(0xbb)),
            device_id: DeviceId(id(0xcc)),
            timestamp: 1_760_000_000_000 + i64::from(event_number),
            logical_time,
            event_version: 1,
            kind,
            canonical_bytes,
        }
    }

    fn added(event_number: u8, logical_time: u64, item_number: u8, text: &str) -> EventEnvelope {
        event(
            event_number,
            logical_time,
            EventKind::ItemAdded {
                item_id: ItemId(id(item_number)),
                text: text.to_owned(),
                classification: ItemClassification::Need,
            },
        )
    }

    #[test]
    fn add_item_creates_active_item() {
        let state = rebuild(&[added(1, 1, 0x11, "Buy milk")]).unwrap();
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.items[0].text, "Buy milk");
        assert_eq!(state.items[0].status, ItemStatus::Active);
    }

    #[test]
    fn multiple_items_keep_addition_order() {
        let events = [
            added(1, 1, 0x11, "Buy milk"),
            added(2, 2, 0x22, "Restock wipes"),
        ];
        let state = rebuild(&events).unwrap();
        assert_eq!(state.items.len(), 2);
        assert_eq!(state.items[0].text, "Buy milk");
        assert_eq!(state.items[1].text, "Restock wipes");
    }

    #[test]
    fn completion_changes_only_derived_status() {
        let events = [
            added(1, 1, 0x11, "Buy milk"),
            event(
                2,
                2,
                EventKind::ItemCompleted {
                    item_id: ItemId(id(0x11)),
                },
            ),
        ];
        let state = rebuild(&events).unwrap();
        assert_eq!(state.items[0].text, "Buy milk");
        assert_eq!(state.items[0].status, ItemStatus::Completed);
    }

    #[test]
    fn unknown_completion_is_invalid() {
        let completion = event(
            1,
            1,
            EventKind::ItemCompleted {
                item_id: ItemId(id(0xff)),
            },
        );
        assert_eq!(rebuild(&[completion]), Err(KinError::InvalidEvent));
    }

    #[test]
    fn identical_event_delivery_is_idempotent() {
        let added = added(1, 1, 0x11, "Buy milk");
        let state = rebuild(&[added.clone(), added]).unwrap();
        assert_eq!(state.items.len(), 1);
    }

    #[test]
    fn event_id_reuse_with_different_bytes_fails() {
        let first = added(1, 1, 0x11, "Buy milk");
        let mut conflicting = added(2, 2, 0x22, "Restock wipes");
        conflicting.event_id = first.event_id;
        assert_eq!(rebuild(&[first, conflicting]), Err(KinError::InvalidEvent));
    }

    #[test]
    fn duplicate_completion_is_a_valid_noop() {
        let events = [
            added(1, 1, 0x11, "Buy milk"),
            event(
                2,
                2,
                EventKind::ItemCompleted {
                    item_id: ItemId(id(0x11)),
                },
            ),
            event(
                3,
                3,
                EventKind::ItemCompleted {
                    item_id: ItemId(id(0x11)),
                },
            ),
        ];
        let state = rebuild(&events).unwrap();
        assert_eq!(state.items[0].status, ItemStatus::Completed);
    }

    #[test]
    fn rebuild_is_deterministic() {
        let events = [
            added(1, 1, 0x11, "Buy milk"),
            event(
                2,
                2,
                EventKind::ItemCompleted {
                    item_id: ItemId(id(0x11)),
                },
            ),
        ];
        let state_a = rebuild(&events).unwrap();
        let state_b = rebuild(&events).unwrap();
        let state_c = rebuild(&events).unwrap();
        assert_eq!(state_a, state_b);
        assert_eq!(state_b, state_c);
        assert_eq!(state_a, state_c);
    }

    #[test]
    fn mixed_households_fail_as_a_whole() {
        let first = added(1, 1, 0x11, "Buy milk");
        let mut second = added(2, 2, 0x22, "Restock wipes");
        second.household_id = HouseholdId(id(0xdd));
        assert_eq!(rebuild(&[first, second]), Err(KinError::InvalidEvent));
    }

    #[test]
    fn whitespace_only_items_are_invalid() {
        assert_eq!(
            rebuild(&[added(1, 1, 0x11, " \t\n")]),
            Err(KinError::InvalidEvent)
        );
    }

    #[test]
    fn reopening_completed_and_active_items_is_valid() {
        let item_id = ItemId(id(0x11));
        let completed_then_reopened = [
            added(1, 1, 0x11, "Buy milk"),
            event(2, 2, EventKind::ItemCompleted { item_id }),
            event(3, 3, EventKind::ItemReopened { item_id }),
        ];
        let reopened_state = rebuild(&completed_then_reopened).unwrap();
        assert_eq!(reopened_state.items[0].status, ItemStatus::Active);

        let already_active = [
            added(1, 1, 0x11, "Buy milk"),
            event(2, 2, EventKind::ItemReopened { item_id }),
        ];
        let active_state = rebuild(&already_active).unwrap();
        assert_eq!(active_state.items[0].status, ItemStatus::Active);
    }

    #[test]
    fn archiving_active_or_completed_items_is_terminal() {
        let item_id = ItemId(id(0x11));
        for prefix in [
            vec![added(1, 1, 0x11, "Buy milk")],
            vec![
                added(1, 1, 0x11, "Buy milk"),
                event(2, 2, EventKind::ItemCompleted { item_id }),
            ],
        ] {
            let mut archived_events = prefix.clone();
            archived_events.push(event(
                archived_events.len() as u8 + 1,
                archived_events.len() as u64 + 1,
                EventKind::ItemArchived { item_id },
            ));
            let archived_state = rebuild(&archived_events).unwrap();
            assert_eq!(archived_state.items[0].status, ItemStatus::Archived);

            for mutation in [
                EventKind::ItemCompleted { item_id },
                EventKind::ItemReopened { item_id },
                EventKind::ItemArchived { item_id },
            ] {
                let mut invalid_events = archived_events.clone();
                invalid_events.push(event(
                    invalid_events.len() as u8 + 1,
                    invalid_events.len() as u64 + 1,
                    mutation,
                ));
                assert_eq!(rebuild(&invalid_events), Err(KinError::InvalidEvent));
            }
        }
    }

    #[test]
    fn unknown_reopen_and_archive_references_are_invalid() {
        let item_id = ItemId(id(0xff));
        for kind in [
            EventKind::ItemReopened { item_id },
            EventKind::ItemArchived { item_id },
        ] {
            assert_eq!(rebuild(&[event(1, 1, kind)]), Err(KinError::InvalidEvent));
        }
    }

    #[test]
    fn duplicate_item_identity_is_invalid() {
        let events = [
            added(1, 1, 0x11, "Buy milk"),
            added(2, 2, 0x11, "Restock wipes"),
        ];
        assert_eq!(rebuild(&events), Err(KinError::InvalidEvent));
    }

    #[test]
    fn non_increasing_logical_order_is_invalid() {
        let events = [
            added(1, 2, 0x11, "Buy milk"),
            added(2, 2, 0x22, "Restock wipes"),
        ];
        assert_eq!(rebuild(&events), Err(KinError::InvalidEvent));
    }
}
