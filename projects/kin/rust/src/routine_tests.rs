use crate::error::KinError;
use crate::protocol::{
    decode_request_with_summary, encode_state, encode_state_v6, encode_state_v7,
};
use crate::recurrence::CivilDate;
use crate::state::{rebuild_at, rebuild_on, summarize_validated, HouseholdState};

// Independent wire fixtures; do not construct expected bytes with production writers.
fn record(sequence: u32, kind: u16, cadence: u8, day: u32, text: &[u8]) -> Vec<u8> {
    let mut bytes = vec![0; 88];
    bytes[0] = 1;
    bytes[2..4].copy_from_slice(&kind.to_le_bytes());
    bytes[4..8].copy_from_slice(&sequence.to_le_bytes());
    bytes[20..36].fill(0xaa);
    bytes[36..52].fill(0xbb);
    bytes[52..68].fill(0xcc);
    bytes[68..76].copy_from_slice(&1234i64.to_le_bytes());
    bytes[76..84].copy_from_slice(&u64::from(sequence).to_le_bytes());
    bytes.extend_from_slice(&[0x11; 16]);
    match kind {
        14 => {
            bytes.extend_from_slice(&[cadence, 0, 0, 0]);
            bytes.extend_from_slice(&day.to_le_bytes());
            bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
            bytes.extend_from_slice(text);
        }
        15 | 16 => bytes.extend_from_slice(&day.to_le_bytes()),
        17 => {}
        _ => unreachable!(),
    }
    let payload_length = bytes.len() as u32 - 88;
    bytes[84..88].copy_from_slice(&payload_length.to_le_bytes());
    bytes
}

fn request(records: &[Vec<u8>], day: u32) -> Vec<u8> {
    let mut bytes = vec![0; 44];
    bytes[..4].copy_from_slice(b"KINE");
    bytes[4] = 7;
    bytes[8..12].copy_from_slice(&(records.len() as u32).to_le_bytes());
    bytes[12..20].copy_from_slice(&1234i64.to_le_bytes());
    bytes[40..44].copy_from_slice(&day.to_le_bytes());
    for record in records {
        bytes.extend_from_slice(record);
    }
    bytes
}

fn project(records: &[Vec<u8>], day: u32) -> Result<HouseholdState, KinError> {
    let req = decode_request_with_summary(&request(records, day))?;
    rebuild_on(&req.events, req.as_of.unwrap(), req.civil_date.unwrap())
}

#[test]
fn daily_completion_reopen_and_boundary_matrix() {
    let mut rows = vec![record(1, 14, 0, 20240228, b"Starter")];
    assert_eq!(
        project(&rows, 20240227).unwrap().routines[0].occurrence_key,
        None
    );
    assert!(!project(&rows, 20240228).unwrap().routines[0].completed);
    for (sequence, kind, done) in [
        (2, 15, true),
        (3, 15, true),
        (4, 16, false),
        (5, 16, false),
        (6, 15, true),
    ] {
        rows.push(record(sequence, kind, 0, 20240228, b""));
        let state = project(&rows, 20240228).unwrap();
        assert_eq!(state.routines[0].completed, done);
        assert_eq!(state, project(&rows, 20240228).unwrap());
        for later in [20240229, 20240301, 20260101] {
            let state = project(&rows, later).unwrap();
            assert!(!state.routines[0].completed);
            assert_eq!(state.routines[0].occurrence_key.unwrap().encoded(), later);
        }
    }
    rows.push(record(7, 15, 0, 20240229, b""));
    rows.push(record(8, 16, 0, 20240228, b""));
    assert!(project(&rows, 20240229).unwrap().routines[0].completed);
    assert!(!project(&rows, 20240228).unwrap().routines[0].completed);
}

#[test]
fn weekly_completion_partial_first_week_and_year_transition() {
    let mut rows = vec![record(1, 14, 1, 20201231, b"Trash")];
    assert_eq!(
        project(&rows, 20201230).unwrap().routines[0].occurrence_key,
        None
    );
    rows.push(record(2, 15, 0, 20201228, b""));
    for day in [20201231, 20210101, 20210103] {
        let routine = project(&rows, day).unwrap().routines.remove(0);
        assert!(routine.completed);
        assert_eq!(routine.occurrence_key.unwrap().encoded(), 20201228);
    }
    for day in [20210104, 20210601, 20220101] {
        assert!(!project(&rows, day).unwrap().routines[0].completed);
    }
    rows.push(record(3, 16, 0, 20201228, b""));
    assert!(!project(&rows, 20210103).unwrap().routines[0].completed);
}

#[test]
fn routine_invalid_references_periods_and_terminal_archive() {
    let created = record(1, 14, 1, 20261002, b"Trash");
    for kind in [15, 16, 17] {
        assert_eq!(
            project(&[record(1, kind, 0, 20260928, b"")], 20261002),
            Err(KinError::InvalidEvent)
        );
    }
    for key in [20260921, 20261002, 20261004] {
        assert_eq!(
            project(&[created.clone(), record(2, 15, 0, key, b"")], 20261002),
            Err(KinError::InvalidEvent)
        );
    }
    let archived = record(2, 17, 0, 0, b"");
    let state = project(&[created.clone(), archived.clone()], 20261002).unwrap();
    assert!(state.routines[0].archived);
    assert_eq!(state.routines[0].occurrence_key, None);
    for kind in [15, 16, 17] {
        assert_eq!(
            project(
                &[
                    created.clone(),
                    archived.clone(),
                    record(3, kind, 0, 20260928, b"")
                ],
                20261002
            ),
            Err(KinError::InvalidEvent)
        );
    }
    assert_eq!(
        project(&[created.clone(), archived.clone(), archived], 20261002).unwrap(),
        state
    );
    assert_eq!(
        project(
            &[created, record(2, 14, 1, 20261002, b"Duplicate")],
            20261002
        ),
        Err(KinError::InvalidEvent)
    );
}

#[test]
fn duplicate_conflicting_ids_order_and_household_are_preserved() {
    let created = record(1, 14, 0, 20261002, b"Starter");
    let complete = record(2, 15, 0, 20261002, b"");
    let expected = project(&[created.clone(), complete.clone()], 20261002).unwrap();
    assert_eq!(
        project(
            &[
                created.clone(),
                complete.clone(),
                created.clone(),
                complete.clone()
            ],
            20261002
        )
        .unwrap(),
        expected
    );
    let mut conflict = complete.clone();
    conflict[68] ^= 1;
    assert_eq!(
        project(&[created.clone(), complete.clone(), conflict], 20261002),
        Err(KinError::InvalidEvent)
    );
    let mut wrong_order = complete.clone();
    wrong_order[76] = 1;
    assert_eq!(
        project(&[created.clone(), wrong_order], 20261002),
        Err(KinError::InvalidEvent)
    );
    let mut wrong_household = complete;
    wrong_household[20] ^= 1;
    assert_eq!(
        project(&[created, wrong_household], 20261002),
        Err(KinError::InvalidEvent)
    );
}

#[test]
fn future_recorded_period_and_clock_rollback_do_not_invalidate_history() {
    let rows = [
        record(1, 14, 0, 20261002, b"Starter"),
        record(2, 15, 0, 20261003, b""),
    ];
    assert_eq!(
        project(&rows, 20261001).unwrap().routines[0].occurrence_key,
        None
    );
    assert!(!project(&rows, 20261002).unwrap().routines[0].completed);
    assert!(project(&rows, 20261003).unwrap().routines[0].completed);
    let invalid = [rows[0].clone(), record(2, 15, 0, 20261001, b"")];
    assert_eq!(project(&invalid, 20261003), Err(KinError::InvalidEvent));
}

#[test]
fn v7_exact_empty_and_routine_result_layout_with_summary() {
    let rows = [record(1, 14, 0, 20261002, b"x")];
    let decoded = decode_request_with_summary(&request(&rows, 20261002)).unwrap();
    let state = project(&rows, 20261002).unwrap();
    let summary = summarize_validated(&decoded.events, None, &state).unwrap();
    let result = encode_state_v7(&state, &summary).unwrap();
    let mut expected = vec![0; 56];
    expected[..4].copy_from_slice(b"KINS");
    expected[4] = 7;
    expected[24] = 1;
    expected[28] = 1;
    expected[32] = 1;
    expected[36] = 1;
    expected[52] = 1;
    expected.extend_from_slice(&[0x11; 16]);
    expected.extend_from_slice(&[0xbb; 16]);
    expected.extend_from_slice(&1234i64.to_le_bytes());
    expected.extend_from_slice(&20261002u32.to_le_bytes());
    expected.extend_from_slice(&20261002u32.to_le_bytes());
    expected.extend_from_slice(&[0, 0, 1, 0, 1, 0, 0, 0, b'x']);
    expected.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expected.extend_from_slice(&[12, 4, 255, 0, 1, 0, 0, 0, b'x']);
    assert_eq!(result, expected);
    let empty = project(&[], 20261002).unwrap();
    let empty_summary = summarize_validated(&[], None, &empty).unwrap();
    let mut expected_empty = vec![0; 56];
    expected_empty[..4].copy_from_slice(b"KINS");
    expected_empty[4] = 7;
    assert_eq!(
        encode_state_v7(&empty, &empty_summary).unwrap(),
        expected_empty
    );
    for version in 1..=5 {
        assert_eq!(
            encode_state(&state, version),
            Err(KinError::UnsupportedVersion)
        );
    }
    assert_eq!(
        encode_state_v6(&state, &summary),
        Err(KinError::UnsupportedVersion)
    );
    assert_eq!(
        rebuild_at(&decoded.events, 1234),
        Err(KinError::UnsupportedVersion)
    );
}

#[test]
fn routine_summary_counts_human_actions_not_period_transitions() {
    let mut rows = vec![record(1, 14, 0, 20261002, b"Starter")];
    for seq in 2..=10 {
        rows.push(record(seq, 15, 0, 20261002, b""));
    }
    rows.push(rows[1].clone());
    let decoded = decode_request_with_summary(&request(&rows, 20261002)).unwrap();
    let mut summaries = Vec::new();
    for date in [20261002, 20261003, 20270101] {
        let state = project(&rows, date).unwrap();
        let summary = summarize_validated(&decoded.events, None, &state).unwrap();
        assert_eq!(summary.entries.len(), 8);
        assert_eq!(summary.total_count, 10);
        summaries.push(summary);
    }
    assert_eq!(summaries[0], summaries[1]);
    assert_eq!(summaries[1], summaries[2]);
}

#[test]
fn all_routine_kinds_fail_closed_in_earlier_protocols() {
    for version in 1u16..=6 {
        for kind in 14..=17 {
            let row = record(1, kind, 0, 20261002, b"x");
            let header = if version == 6 {
                40
            } else if version == 5 {
                20
            } else {
                12
            };
            let mut req = request(&[], 20261002);
            req.truncate(header);
            req[4..6].copy_from_slice(&version.to_le_bytes());
            req[8] = 1;
            req.extend_from_slice(&row);
            assert_eq!(
                decode_request_with_summary(&req),
                Err(KinError::UnsupportedVersion)
            );
        }
    }
}

#[test]
fn v7_all_request_truncations_and_fixed_payload_lengths() {
    for kind in 14..=17 {
        let row = record(1, kind, 0, 20261002, b"x");
        let req = request(std::slice::from_ref(&row), 20261002);
        for length in 0..req.len() {
            assert_eq!(
                decode_request_with_summary(&req[..length]),
                Err(KinError::MalformedProtocol),
                "{kind} {length}"
            );
        }
        for length in 0..=row.len() - 88 + 1 {
            if length == row.len() - 88 {
                continue;
            }
            let mut malformed = row.clone();
            malformed.resize(88 + length, 0);
            malformed[84..88].copy_from_slice(&(length as u32).to_le_bytes());
            assert_eq!(
                decode_request_with_summary(&request(&[malformed], 20261002)),
                Err(KinError::MalformedProtocol)
            );
        }
    }
}

#[test]
fn v7_invalid_header_date_cadence_reserved_schema_text_and_extreme_lengths() {
    let row = record(1, 14, 0, 20261002, b"x");
    for offset in [6, 7, 21, 22, 23, 24, 39] {
        let mut req = request(std::slice::from_ref(&row), 20261002);
        req[offset] = 1;
        assert_eq!(
            decode_request_with_summary(&req),
            Err(KinError::MalformedProtocol)
        );
    }
    for value in [0, 20260229, u32::MAX] {
        assert_eq!(
            decode_request_with_summary(&request(std::slice::from_ref(&row), value)),
            Err(KinError::MalformedProtocol)
        );
        assert_eq!(
            project(&[record(1, 14, 0, value, b"x")], 20261002),
            Err(KinError::MalformedProtocol)
        );
    }
    for cadence in 2..=255 {
        assert_eq!(
            project(&[record(1, 14, cadence, 20261002, b"x")], 20261002),
            Err(KinError::MalformedProtocol)
        );
    }
    for offset in [105, 106, 107] {
        let mut bad = row.clone();
        bad[offset] = 1;
        assert_eq!(project(&[bad], 20261002), Err(KinError::MalformedProtocol));
    }
    for text in [vec![], vec![b'x'; 4097], vec![255]] {
        assert_eq!(
            project(&[record(1, 14, 0, 20261002, &text)], 20261002),
            Err(KinError::MalformedProtocol)
        );
    }
    assert_eq!(
        project(&[record(1, 14, 0, 20261002, b" \n\t")], 20261002),
        Err(KinError::InvalidEvent)
    );
    let text = "\u{feff}🥛";
    assert_eq!(
        project(&[record(1, 14, 0, 20261002, text.as_bytes())], 20261002)
            .unwrap()
            .routines[0]
            .text,
        text
    );
    assert!(project(&[record(1, 14, 0, 20261002, &vec![b'x'; 4096])], 20261002).is_ok());
    for offset in [84, 112] {
        let mut bad = row.clone();
        bad[offset..offset + 4].fill(255);
        assert_eq!(project(&[bad], 20261002), Err(KinError::MalformedProtocol));
    }
    let mut bad_schema = row;
    bad_schema[0] = 2;
    assert_eq!(
        project(&[bad_schema], 20261002),
        Err(KinError::UnsupportedVersion)
    );
    let mut trailing = request(&[], 20261002);
    trailing.push(0);
    assert_eq!(
        decode_request_with_summary(&trailing),
        Err(KinError::MalformedProtocol)
    );
}

#[test]
fn maximum_routine_replay_and_projection_are_bounded_and_deterministic() {
    let rows: Vec<_> = (1..=10_000)
        .map(|seq| {
            let mut row = record(seq, 14, (seq % 2) as u8, 20261002, b"x");
            row[88..92].copy_from_slice(&seq.to_le_bytes());
            row
        })
        .collect();
    let req = decode_request_with_summary(&request(&rows, 20261002)).unwrap();
    let state = project(&rows, 20261002).unwrap();
    assert_eq!(state.routines.len(), 10_000);
    assert_eq!(
        state,
        rebuild_on(&req.events, 0, CivilDate::from_encoded(20261002).unwrap()).unwrap()
    );
    let summary = summarize_validated(&req.events, None, &state).unwrap();
    assert_eq!(summary.total_count, 10_000);
    assert!(encode_state_v7(&state, &summary).unwrap().len() < 64 * 1024 * 1024);
    let mut too_many = request(&[], 20261002);
    too_many[8..12].copy_from_slice(&10_001u32.to_le_bytes());
    assert_eq!(
        decode_request_with_summary(&too_many),
        Err(KinError::SizeLimit)
    );
}
