use crate::error::KinError;
use crate::event::PulseValue;
use crate::protocol::{decode_request, encode_state};
use crate::state::{rebuild, rebuild_at, HouseholdState, PulseStatus};

fn record(sequence: u64, actor: u8, value: Option<u8>, expiry: i64) -> Vec<u8> {
    let mut bytes = vec![0; if value.is_some() { 104 } else { 88 }];
    bytes[0] = 1;
    bytes[2] = if value.is_some() { 12 } else { 13 };
    bytes[4..12].copy_from_slice(&sequence.to_le_bytes());
    bytes[20..36].fill(0xaa);
    bytes[36..52].fill(actor);
    bytes[52..68].fill(0xcc);
    bytes[68..76].copy_from_slice(&1000i64.to_le_bytes());
    bytes[76..84].copy_from_slice(&sequence.to_le_bytes());
    if let Some(value) = value {
        bytes[84] = 16;
        bytes[88] = value;
        bytes[96..104].copy_from_slice(&expiry.to_le_bytes());
    }
    bytes
}

fn request(records: &[Vec<u8>], version: u16, as_of: i64) -> Vec<u8> {
    let mut bytes = b"KINE".to_vec();
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&[0; 2]);
    bytes.extend_from_slice(&(records.len() as u32).to_le_bytes());
    if version == 5 {
        bytes.extend_from_slice(&as_of.to_le_bytes());
    }
    for record in records {
        bytes.extend_from_slice(record);
    }
    bytes
}

fn project(records: &[Vec<u8>], as_of: i64) -> Result<HouseholdState, KinError> {
    let (_, events, time) = decode_request(&request(records, 5, as_of))?;
    rebuild_at(&events, time.unwrap())
}

#[test]
fn pulse_expiry_is_explicit_and_reversible() {
    let records = [record(1, 1, Some(2), 2000)];
    for time in [1999, 2000, 2001, 1000, 3000, -1000] {
        let state = project(&records, time).unwrap();
        assert_eq!(
            state.pulses[0].status,
            if time < 2000 {
                PulseStatus::Active
            } else {
                PulseStatus::Expired
            }
        );
        assert_eq!(state, project(&records, time).unwrap());
    }
}

#[test]
fn pulse_actor_replacement_clear_and_repeated_intent() {
    let mut records = vec![record(1, 2, Some(0), 2000), record(2, 1, Some(2), 3000)];
    let state = project(&records, 1500).unwrap();
    assert_eq!(state.pulses.len(), 2);
    assert_eq!(state.pulses[0].actor_id.0, [1; 16]);
    records.push(record(3, 2, Some(4), 4000));
    let state = project(&records, 1500).unwrap();
    assert_eq!(state.pulses[1].value, PulseValue::NeedQuiet);
    assert_eq!(state.pulses[0].value, PulseValue::Drained);
    records.push(record(4, 2, None, 0));
    records.push(record(5, 2, None, 0));
    assert_eq!(project(&records, 1500).unwrap().pulses.len(), 1);
    records.push(record(6, 2, Some(1), 5000));
    assert_eq!(
        project(&records, 1500).unwrap().pulses[1].value,
        PulseValue::Okay
    );
}

#[test]
fn pulse_legacy_protocols_fail_closed_and_identity_is_idempotent() {
    for kind in [Some(0), None] {
        for version in 1..=4 {
            assert_eq!(
                decode_request(&request(&[record(1, 1, kind, 2000)], version, 0)),
                Err(KinError::UnsupportedVersion)
            );
        }
    }
    let a = record(1, 1, Some(0), 2000);
    assert_eq!(
        project(&[a.clone(), a.clone()], 1500).unwrap().pulses.len(),
        1
    );
    assert_eq!(
        project(&[a.clone(), record(1, 1, Some(2), 2000)], 1500),
        Err(KinError::InvalidEvent)
    );
    let (_, events, _) = decode_request(&request(&[a], 5, 1500)).unwrap();
    assert_eq!(rebuild(&events), Err(KinError::UnsupportedVersion));
    let state = rebuild_at(&events, 1500).unwrap();
    for version in 1..=4 {
        assert_eq!(
            encode_state(&state, version),
            Err(KinError::UnsupportedVersion)
        );
    }
}

#[test]
fn pulse_v5_exact_result_and_empty_layout() {
    let state = project(&[record(1, 7, Some(3), 2000)], 2000).unwrap();
    let result = encode_state(&state, 5).unwrap();
    let mut expected = vec![75, 73, 78, 83, 5, 0, 0, 0];
    expected.extend_from_slice(&[0; 12]);
    expected.extend_from_slice(&1u32.to_le_bytes());
    expected.extend_from_slice(&[7; 16]);
    expected.extend_from_slice(&1000i64.to_le_bytes());
    expected.extend_from_slice(&2000i64.to_le_bytes());
    expected.extend_from_slice(&[3, 1, 0, 0, 0, 0, 0, 0]);
    assert_eq!(result, expected);
    assert_eq!(
        encode_state(&project(&[], 0).unwrap(), 5).unwrap().len(),
        24
    );
}

#[test]
fn pulse_basic_invalid_payload_and_duration() {
    assert_eq!(
        project(&[record(1, 1, Some(5), 2000)], 0),
        Err(KinError::MalformedProtocol)
    );
    for expiry in [999, 1000] {
        assert_eq!(
            project(&[record(1, 1, Some(0), expiry)], 0),
            Err(KinError::InvalidEvent)
        );
    }
    let mut bad = record(1, 1, Some(0), 2000);
    bad[89] = 1;
    assert_eq!(project(&[bad], 0), Err(KinError::MalformedProtocol));
}
