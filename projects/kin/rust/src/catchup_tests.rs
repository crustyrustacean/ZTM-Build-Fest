use crate::error::KinError;
use crate::event::{
    ActorId, DeviceId, EventEnvelope, EventId, EventKind, HandoffId, HouseholdId,
    ItemClassification, ItemId, PulseValue, TalkId,
};
use crate::state::{summarize, SummaryEntityKind, SummaryKind, MAX_SUMMARY_ENTRIES};

fn id(value: u8) -> [u8; 16] {
    [value; 16]
}

fn event(number: u8, kind: EventKind) -> EventEnvelope {
    EventEnvelope {
        event_id: EventId(id(number)),
        household_id: HouseholdId(id(0xaa)),
        actor_id: ActorId(id(number.wrapping_add(1))),
        device_id: DeviceId(id(0xcc)),
        timestamp: 1_760_000_000_000 + i64::from(number),
        logical_time: u64::from(number),
        event_version: 1,
        kind,
        canonical_bytes: vec![number],
    }
}

fn item_added(number: u8, text: &str) -> EventEnvelope {
    event(
        number,
        EventKind::ItemAdded {
            item_id: ItemId(id(number.wrapping_add(32))),
            text: text.to_owned(),
            classification: ItemClassification::Need,
        },
    )
}

#[test]
fn pulse_is_excluded_but_remains_the_snapshot_boundary() {
    let events = vec![
        item_added(1, "Milk"),
        event(
            2,
            EventKind::PulseSet {
                value: PulseValue::Drained,
                expires_at: 1_760_000_010_000,
            },
        ),
        event(
            3,
            EventKind::ItemCompleted {
                item_id: ItemId(id(33)),
            },
        ),
        event(4, EventKind::PulseCleared),
    ];

    let summary = summarize(&events, Some(EventId(id(1)))).unwrap();

    assert_eq!(summary.total_count, 1);
    assert_eq!(summary.entries.len(), 1);
    assert_eq!(summary.entries[0].kind, SummaryKind::ItemCompleted);
    assert_eq!(summary.entries[0].text, "Milk");
    assert_eq!(summary.through_event_id, Some(EventId(id(4))));
}

#[test]
fn missing_cursor_fails_closed() {
    assert_eq!(
        summarize(&[item_added(1, "Milk")], Some(EventId(id(2)))),
        Err(KinError::InvalidEvent)
    );
}

#[test]
fn summary_keeps_the_latest_eight_in_event_order_and_counts_omissions() {
    let events: Vec<_> = (1..=10)
        .map(|number| item_added(number, &format!("Item {number}")))
        .collect();

    let summary = summarize(&events, None).unwrap();

    assert_eq!(summary.total_count, 10);
    assert_eq!(summary.entries.len(), MAX_SUMMARY_ENTRIES);
    assert_eq!(summary.entries[0].event_id, EventId(id(3)));
    assert_eq!(summary.entries[7].event_id, EventId(id(10)));
    assert_eq!(summary.entries[0].text, "Item 3");
    assert_eq!(summary.entries[7].text, "Item 10");
    assert_eq!(
        summary.entries[0].classification,
        Some(ItemClassification::Need)
    );
    assert_eq!(summary.through_event_id, Some(EventId(id(10))));
}

#[test]
fn lifecycle_summaries_use_the_referenced_entity_without_actor_data() {
    let events = vec![
        item_added(1, "Milk"),
        event(
            2,
            EventKind::HandoffAdded {
                handoff_id: HandoffId(id(50)),
                text: "Diaper bag".to_owned(),
            },
        ),
        event(
            3,
            EventKind::HandoffAcknowledged {
                handoff_id: HandoffId(id(50)),
            },
        ),
        event(
            4,
            EventKind::TalkAdded {
                talk_id: TalkId(id(60)),
                text: "Weekend plans".to_owned(),
            },
        ),
        event(
            5,
            EventKind::TalkResolved {
                talk_id: TalkId(id(60)),
            },
        ),
    ];

    let summary = summarize(&events, None).unwrap();

    assert_eq!(
        summary
            .entries
            .iter()
            .map(|entry| (entry.kind, entry.entity_kind, entry.text.as_str()))
            .collect::<Vec<_>>(),
        [
            (SummaryKind::ItemAdded, SummaryEntityKind::Item, "Milk"),
            (
                SummaryKind::HandoffAdded,
                SummaryEntityKind::Handoff,
                "Diaper bag"
            ),
            (
                SummaryKind::HandoffAcknowledged,
                SummaryEntityKind::Handoff,
                "Diaper bag"
            ),
            (
                SummaryKind::TalkAdded,
                SummaryEntityKind::Talk,
                "Weekend plans"
            ),
            (
                SummaryKind::TalkResolved,
                SummaryEntityKind::Talk,
                "Weekend plans"
            ),
        ]
    );
}

#[test]
fn exact_duplicate_delivery_does_not_duplicate_a_summary_entry() {
    let added = item_added(1, "Milk");
    let summary = summarize(&[added.clone(), added], None).unwrap();

    assert_eq!(summary.total_count, 1);
    assert_eq!(summary.entries.len(), 1);
}

#[test]
fn cursor_resolves_to_first_occurrence_of_an_exact_duplicate() {
    let cursor_event = item_added(1, "Milk");
    let intervening = item_added(2, "Wipes");
    let summary = summarize(
        &[cursor_event.clone(), intervening, cursor_event.clone()],
        Some(cursor_event.event_id),
    )
    .unwrap();

    assert_eq!(summary.total_count, 1);
    assert_eq!(summary.entries.len(), 1);
    assert_eq!(summary.entries[0].text, "Wipes");
}
