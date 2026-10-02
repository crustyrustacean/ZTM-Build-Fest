use crate::error::KinError;
use crate::event::{
    ActorId, DeviceId, EventEnvelope, EventId, EventKind, HandoffId, HouseholdId,
    ItemClassification, ItemId,
};
use crate::state::{HandoffStatus, HouseholdState, ItemStatus};

pub const PROTOCOL_V1: u16 = 1;
pub const PROTOCOL_V2: u16 = 2;
pub const PROTOCOL_V3: u16 = 3;
pub const PROTOCOL_VERSION: u16 = PROTOCOL_V3;
pub const ERROR_PROTOCOL_VERSION: u16 = PROTOCOL_V1;
pub const MAX_EVENT_COUNT: usize = 10_000;
pub const MAX_PROTOCOL_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_ITEM_TEXT_BYTES: usize = 4096;
const REQUEST_HEADER_BYTES: usize = 12;
const EVENT_HEADER_BYTES: usize = 88;
const RESULT_HEADER_BYTES: usize = 12;
const ITEM_HEADER_BYTES: usize = 48;

pub fn decode_request(bytes: &[u8]) -> Result<(u16, Vec<EventEnvelope>), KinError> {
    if bytes.len() > MAX_PROTOCOL_BYTES {
        return Err(KinError::SizeLimit);
    }
    if bytes.len() < REQUEST_HEADER_BYTES || &bytes[..4] != b"KINE" {
        return Err(KinError::MalformedProtocol);
    }

    let version = read_u16(bytes, 4)?;
    if !matches!(version, PROTOCOL_V1 | PROTOCOL_V2 | PROTOCOL_V3) {
        return Err(KinError::UnsupportedVersion);
    }
    if read_u16(bytes, 6)? != 0 {
        return Err(KinError::MalformedProtocol);
    }
    let event_count = read_u32(bytes, 8)? as usize;
    if event_count > MAX_EVENT_COUNT {
        return Err(KinError::SizeLimit);
    }

    let mut events = Vec::new();
    events
        .try_reserve_exact(event_count)
        .map_err(|_| KinError::SizeLimit)?;
    let mut offset = REQUEST_HEADER_BYTES;
    for _ in 0..event_count {
        let header_end = offset
            .checked_add(EVENT_HEADER_BYTES)
            .ok_or(KinError::MalformedProtocol)?;
        let header = bytes
            .get(offset..header_end)
            .ok_or(KinError::MalformedProtocol)?;
        let payload_length = read_u32(header, 84)? as usize;
        let record_end = header_end
            .checked_add(payload_length)
            .ok_or(KinError::MalformedProtocol)?;
        let record = bytes
            .get(offset..record_end)
            .ok_or(KinError::MalformedProtocol)?;
        events.push(decode_event(record, version)?);
        offset = record_end;
    }
    if offset != bytes.len() {
        return Err(KinError::MalformedProtocol);
    }
    Ok((version, events))
}

pub fn encode_state(state: &HouseholdState, protocol_version: u16) -> Result<Vec<u8>, KinError> {
    if !matches!(protocol_version, PROTOCOL_V1 | PROTOCOL_V2 | PROTOCOL_V3) {
        return Err(KinError::UnsupportedVersion);
    }
    if protocol_version < PROTOCOL_V3 && !state.handoffs.is_empty() {
        return Err(KinError::UnsupportedVersion);
    }
    if state.items.len().saturating_add(state.handoffs.len()) > MAX_EVENT_COUNT {
        return Err(KinError::SizeLimit);
    }
    let item_count = u32::try_from(state.items.len()).map_err(|_| KinError::SizeLimit)?;
    let mut result = Vec::new();
    result
        .try_reserve_exact(RESULT_HEADER_BYTES)
        .map_err(|_| KinError::SizeLimit)?;
    result.extend_from_slice(b"KINS");
    push_u16(&mut result, protocol_version);
    push_u16(&mut result, 0);
    push_u32(&mut result, item_count);
    if protocol_version == PROTOCOL_V3 {
        push_u32(&mut result, state.handoffs.len() as u32);
    }

    for item in &state.items {
        let text_bytes = item.text.as_bytes();
        let text_length = u32::try_from(text_bytes.len()).map_err(|_| KinError::SizeLimit)?;
        let expected_length = result
            .len()
            .checked_add(ITEM_HEADER_BYTES)
            .and_then(|length| length.checked_add(text_bytes.len()))
            .ok_or(KinError::SizeLimit)?;
        if expected_length > MAX_PROTOCOL_BYTES {
            return Err(KinError::SizeLimit);
        }
        result
            .try_reserve(expected_length - result.len())
            .map_err(|_| KinError::SizeLimit)?;
        result.extend_from_slice(&item.item_id.0);
        result.extend_from_slice(&item.created_by.0);
        result.extend_from_slice(&item.created_at.to_le_bytes());
        if protocol_version == PROTOCOL_V1 {
            if item.classification != ItemClassification::Today
                || item.status == ItemStatus::Archived
            {
                return Err(KinError::UnsupportedVersion);
            }
            result.push(match item.status {
                ItemStatus::Active => 0,
                ItemStatus::Completed => 1,
                ItemStatus::Archived => unreachable!(),
            });
            result.extend_from_slice(&[0; 3]);
        } else {
            result.push(match item.classification {
                ItemClassification::Today => 0,
                ItemClassification::Need => 1,
            });
            result.push(match item.status {
                ItemStatus::Active => 0,
                ItemStatus::Completed => 1,
                ItemStatus::Archived => 2,
            });
            result.extend_from_slice(&[0; 2]);
        }
        push_u32(&mut result, text_length);
        result.extend_from_slice(text_bytes);
    }
    for handoff in &state.handoffs {
        let text = handoff.text.as_bytes();
        let additional = ITEM_HEADER_BYTES
            .checked_add(text.len())
            .ok_or(KinError::SizeLimit)?;
        if result
            .len()
            .checked_add(additional)
            .ok_or(KinError::SizeLimit)?
            > MAX_PROTOCOL_BYTES
        {
            return Err(KinError::SizeLimit);
        }
        result
            .try_reserve(additional)
            .map_err(|_| KinError::SizeLimit)?;
        result.extend_from_slice(&handoff.handoff_id.0);
        result.extend_from_slice(&handoff.created_by.0);
        result.extend_from_slice(&handoff.created_at.to_le_bytes());
        result.push(match handoff.status {
            HandoffStatus::Unacknowledged => 0,
            HandoffStatus::Acknowledged => 1,
            HandoffStatus::Archived => 2,
        });
        result.extend_from_slice(&[0; 3]);
        push_u32(&mut result, text.len() as u32);
        result.extend_from_slice(text);
    }
    Ok(result)
}

fn decode_event(record: &[u8], protocol_version: u16) -> Result<EventEnvelope, KinError> {
    if record.len() < EVENT_HEADER_BYTES {
        return Err(KinError::MalformedProtocol);
    }
    let event_version = read_u16(record, 0)?;
    if !(event_version == 1 || (event_version == 2 && protocol_version >= PROTOCOL_V2)) {
        return Err(KinError::UnsupportedVersion);
    }
    let event_kind = read_u16(record, 2)?;
    let payload_length = read_u32(record, 84)? as usize;
    let expected_length = EVENT_HEADER_BYTES
        .checked_add(payload_length)
        .ok_or(KinError::MalformedProtocol)?;
    if record.len() != expected_length {
        return Err(KinError::MalformedProtocol);
    }

    let payload = &record[EVENT_HEADER_BYTES..];
    let kind = match (event_version, event_kind) {
        (1, 1) => {
            if payload.len() < 20 {
                return Err(KinError::MalformedProtocol);
            }
            let text_length = read_u32(payload, 16)? as usize;
            if !(1..=MAX_ITEM_TEXT_BYTES).contains(&text_length)
                || payload.len()
                    != 20usize
                        .checked_add(text_length)
                        .ok_or(KinError::MalformedProtocol)?
            {
                return Err(KinError::MalformedProtocol);
            }
            let decoded_text =
                std::str::from_utf8(&payload[20..]).map_err(|_| KinError::MalformedProtocol)?;
            let mut text = String::new();
            text.try_reserve_exact(text_length)
                .map_err(|_| KinError::SizeLimit)?;
            text.push_str(decoded_text);
            EventKind::ItemAdded {
                item_id: ItemId(read_id(payload, 0)?),
                text,
                classification: ItemClassification::Today,
            }
        }
        (2, 1) => {
            if protocol_version < PROTOCOL_V2 || payload.len() < 24 {
                return Err(KinError::MalformedProtocol);
            }
            let classification = match payload[16] {
                0 => ItemClassification::Today,
                1 => ItemClassification::Need,
                _ => return Err(KinError::MalformedProtocol),
            };
            if payload[17..20] != [0; 3] {
                return Err(KinError::MalformedProtocol);
            }
            let text_length = read_u32(payload, 20)? as usize;
            if !(1..=MAX_ITEM_TEXT_BYTES).contains(&text_length)
                || payload.len()
                    != 24usize
                        .checked_add(text_length)
                        .ok_or(KinError::MalformedProtocol)?
            {
                return Err(KinError::MalformedProtocol);
            }
            let decoded_text =
                std::str::from_utf8(&payload[24..]).map_err(|_| KinError::MalformedProtocol)?;
            let mut text = String::new();
            text.try_reserve_exact(text_length)
                .map_err(|_| KinError::SizeLimit)?;
            text.push_str(decoded_text);
            EventKind::ItemAdded {
                item_id: ItemId(read_id(payload, 0)?),
                text,
                classification,
            }
        }
        (1, 2) => {
            if payload.len() != 16 {
                return Err(KinError::MalformedProtocol);
            }
            EventKind::ItemCompleted {
                item_id: ItemId(read_id(payload, 0)?),
            }
        }
        (1, 3) if protocol_version >= PROTOCOL_V2 => {
            if payload.len() != 16 {
                return Err(KinError::MalformedProtocol);
            }
            EventKind::ItemReopened {
                item_id: ItemId(read_id(payload, 0)?),
            }
        }
        (1, 4) if protocol_version >= PROTOCOL_V2 => {
            if payload.len() != 16 {
                return Err(KinError::MalformedProtocol);
            }
            EventKind::ItemArchived {
                item_id: ItemId(read_id(payload, 0)?),
            }
        }
        (1, 5) if protocol_version == PROTOCOL_V3 => {
            if payload.len() < 20 {
                return Err(KinError::MalformedProtocol);
            }
            let length = read_u32(payload, 16)? as usize;
            if !(1..=MAX_ITEM_TEXT_BYTES).contains(&length)
                || payload.len()
                    != 20usize
                        .checked_add(length)
                        .ok_or(KinError::MalformedProtocol)?
            {
                return Err(KinError::MalformedProtocol);
            }
            let text =
                std::str::from_utf8(&payload[20..]).map_err(|_| KinError::MalformedProtocol)?;
            EventKind::HandoffAdded {
                handoff_id: HandoffId(read_id(payload, 0)?),
                text: text.to_owned(),
            }
        }
        (1, 6 | 7) if protocol_version == PROTOCOL_V3 => {
            if payload.len() != 16 {
                return Err(KinError::MalformedProtocol);
            }
            let handoff_id = HandoffId(read_id(payload, 0)?);
            if event_kind == 6 {
                EventKind::HandoffAcknowledged { handoff_id }
            } else {
                EventKind::HandoffArchived { handoff_id }
            }
        }
        _ => return Err(KinError::UnsupportedVersion),
    };

    let mut canonical_bytes = Vec::new();
    canonical_bytes
        .try_reserve_exact(record.len())
        .map_err(|_| KinError::SizeLimit)?;
    canonical_bytes.extend_from_slice(record);
    Ok(EventEnvelope {
        event_id: EventId(read_id(record, 4)?),
        household_id: HouseholdId(read_id(record, 20)?),
        actor_id: ActorId(read_id(record, 36)?),
        device_id: DeviceId(read_id(record, 52)?),
        timestamp: read_i64(record, 68)?,
        logical_time: read_u64(record, 76)?,
        event_version,
        kind,
        canonical_bytes,
    })
}

fn read_id(bytes: &[u8], offset: usize) -> Result<[u8; 16], KinError> {
    let id_bytes = bytes
        .get(offset..offset + 16)
        .ok_or(KinError::MalformedProtocol)?;
    let mut id = [0; 16];
    id.copy_from_slice(id_bytes);
    Ok(id)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, KinError> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or(KinError::MalformedProtocol)?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, KinError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or(KinError::MalformedProtocol)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, KinError> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or(KinError::MalformedProtocol)?;
    Ok(u64::from_le_bytes(
        value.try_into().map_err(|_| KinError::MalformedProtocol)?,
    ))
}

fn read_i64(bytes: &[u8], offset: usize) -> Result<i64, KinError> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or(KinError::MalformedProtocol)?;
    Ok(i64::from_le_bytes(
        value.try_into().map_err(|_| KinError::MalformedProtocol)?,
    ))
}

fn push_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::rebuild;

    fn request_with(record: &[u8], version: u16, count: u32) -> Vec<u8> {
        let mut bytes = b"KINE".to_vec();
        bytes.extend_from_slice(&version.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(record);
        bytes
    }

    fn added_record(text: &[u8]) -> Vec<u8> {
        let mut payload = vec![0x11; 16];
        payload.extend_from_slice(&(text.len() as u32).to_le_bytes());
        payload.extend_from_slice(text);
        let mut record = Vec::new();
        record.extend_from_slice(&1u16.to_le_bytes());
        record.extend_from_slice(&1u16.to_le_bytes());
        record.extend_from_slice(&[1; 16]);
        record.extend_from_slice(&[0xaa; 16]);
        record.extend_from_slice(&[0xbb; 16]);
        record.extend_from_slice(&[0xcc; 16]);
        record.extend_from_slice(&1i64.to_le_bytes());
        record.extend_from_slice(&1u64.to_le_bytes());
        record.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        record.extend_from_slice(&payload);
        record
    }

    fn numbered_id(value: u32) -> [u8; 16] {
        let mut id = [0; 16];
        id[..4].copy_from_slice(&value.to_le_bytes());
        id
    }

    fn added_record_v2(
        event_number: u32,
        item_number: u32,
        text: &[u8],
        classification: u8,
    ) -> Vec<u8> {
        let mut payload = numbered_id(item_number).to_vec();
        payload.push(classification);
        payload.extend_from_slice(&[0; 3]);
        payload.extend_from_slice(&(text.len() as u32).to_le_bytes());
        payload.extend_from_slice(text);
        let mut record = Vec::new();
        record.extend_from_slice(&2u16.to_le_bytes());
        record.extend_from_slice(&1u16.to_le_bytes());
        record.extend_from_slice(&numbered_id(event_number));
        record.extend_from_slice(&[0xaa; 16]);
        record.extend_from_slice(&[0xbb; 16]);
        record.extend_from_slice(&[0xcc; 16]);
        record.extend_from_slice(&i64::from(event_number).to_le_bytes());
        record.extend_from_slice(&u64::from(event_number).to_le_bytes());
        record.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        record.extend_from_slice(&payload);
        record
    }

    #[test]
    fn empty_request_rebuilds_empty_state() {
        for version in [PROTOCOL_V1, PROTOCOL_V2] {
            let request = request_with(&[], version, 0);
            let (protocol_version, events) = decode_request(&request).unwrap();
            let result = encode_state(&rebuild(&events).unwrap(), protocol_version).unwrap();
            assert_eq!(
                result,
                [b"KINS".as_slice(), &[version as u8, 0, 0, 0, 0, 0, 0, 0]].concat()
            );
        }
    }

    #[test]
    fn protocol_v1_history_keeps_its_bytes_and_normalizes_to_today() {
        let request = request_with(&added_record(b"Milk"), PROTOCOL_V1, 1);
        let (version, events) = decode_request(&request).unwrap();
        assert_eq!(version, PROTOCOL_V1);
        assert_eq!(events[0].event_version, 1);
        assert!(matches!(
            events[0].kind,
            EventKind::ItemAdded {
                classification: ItemClassification::Today,
                ..
            }
        ));
        let state = rebuild(&events).unwrap();
        let result = encode_state(&state, PROTOCOL_V1).unwrap();
        assert_eq!(read_u16(&result, 4), Ok(PROTOCOL_V1));
        assert_eq!(result[RESULT_HEADER_BYTES + 40], 0);
        assert_eq!(
            &result[RESULT_HEADER_BYTES + 41..RESULT_HEADER_BYTES + 44],
            &[0; 3]
        );
    }

    #[test]
    fn protocol_v2_carries_classification_and_status() {
        let request = request_with(&added_record_v2(1, 0x22, b"Buy wipes", 1), PROTOCOL_V2, 1);
        let (version, events) = decode_request(&request).unwrap();
        assert_eq!(version, PROTOCOL_V2);
        assert!(matches!(
            events[0].kind,
            EventKind::ItemAdded {
                classification: ItemClassification::Need,
                ..
            }
        ));
        let state = rebuild(&events).unwrap();
        let result = encode_state(&state, PROTOCOL_V2).unwrap();
        assert_eq!(read_u16(&result, 4), Ok(PROTOCOL_V2));
        assert_eq!(result[RESULT_HEADER_BYTES + 40], 1);
        assert_eq!(result[RESULT_HEADER_BYTES + 41], 0);
        assert_eq!(
            &result[RESULT_HEADER_BYTES + 42..RESULT_HEADER_BYTES + 44],
            &[0; 2]
        );
    }

    #[test]
    fn protocol_v2_mixed_legacy_and_current_events_replay() {
        let legacy = added_record(b"Legacy item");
        let current = added_record_v2(2, 0x22, b"Current item", 1);
        let mut request = request_with(&legacy, PROTOCOL_V2, 2);
        request.extend_from_slice(&current);
        let (_, events) = decode_request(&request).unwrap();
        let state = rebuild(&events).unwrap();
        assert_eq!(state.items.len(), 2);
        assert_eq!(state.items[0].classification, ItemClassification::Today);
        assert_eq!(state.items[1].classification, ItemClassification::Need);
        assert_eq!(state.items[0].text, "Legacy item");
        assert_eq!(state.items[1].text, "Current item");
    }

    #[test]
    fn maximum_event_count_projects_deterministically_within_result_limit() {
        let mut request = Vec::with_capacity(REQUEST_HEADER_BYTES + MAX_EVENT_COUNT * 109);
        request.extend_from_slice(b"KINE");
        push_u16(&mut request, PROTOCOL_V2);
        push_u16(&mut request, 0);
        push_u32(&mut request, MAX_EVENT_COUNT as u32);
        for value in 1..=MAX_EVENT_COUNT as u32 {
            request.extend_from_slice(&added_record_v2(value, value, b"x", 1));
        }

        assert!(request.len() <= MAX_PROTOCOL_BYTES);
        let (_, events) = decode_request(&request).unwrap();
        let state = rebuild(&events).unwrap();
        assert_eq!(state.items.len(), MAX_EVENT_COUNT);
        assert_eq!(state.items[0].text, "x");
        assert_eq!(
            state.items[MAX_EVENT_COUNT - 1].classification,
            ItemClassification::Need
        );

        let first_result = encode_state(&state, PROTOCOL_V2).unwrap();
        let second_result = encode_state(&rebuild(&events).unwrap(), PROTOCOL_V2).unwrap();
        assert!(first_result.len() <= MAX_PROTOCOL_BYTES);
        assert_eq!(first_result, second_result);
    }

    #[test]
    fn protocol_v2_rejects_invalid_classification_and_reserved_bytes() {
        for invalid_field in [16usize, 17] {
            let mut record = added_record_v2(1, 0x11, b"Milk", 0);
            record[EVENT_HEADER_BYTES + invalid_field] = if invalid_field == 16 { 2 } else { 1 };
            let request = request_with(&record, PROTOCOL_V2, 1);
            assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
        }
    }

    #[test]
    fn protocol_v2_truncated_add_payload_fails_at_every_boundary() {
        let record = added_record_v2(1, 0x11, b"Milk", 1);
        for record_length in EVENT_HEADER_BYTES..record.len() {
            let request = request_with(&record[..record_length], PROTOCOL_V2, 1);
            assert_eq!(
                decode_request(&request),
                Err(KinError::MalformedProtocol),
                "length {record_length}"
            );
        }
    }

    #[test]
    fn protocol_v1_rejects_new_lifecycle_kinds() {
        let mut record = added_record(b"Milk");
        record[2..4].copy_from_slice(&3u16.to_le_bytes());
        record[84..88].copy_from_slice(&16u32.to_le_bytes());
        record.truncate(EVENT_HEADER_BYTES + 16);
        let request = request_with(&record, PROTOCOL_V1, 1);
        assert_eq!(decode_request(&request), Err(KinError::UnsupportedVersion));
    }

    #[test]
    fn unsupported_protocol_is_rejected() {
        let request = request_with(&[], 99, 0);
        assert_eq!(decode_request(&request), Err(KinError::UnsupportedVersion));
    }

    #[test]
    fn truncated_request_header_is_rejected_at_every_short_length() {
        let header = request_with(&[], PROTOCOL_VERSION, 0);
        for length in 0..REQUEST_HEADER_BYTES {
            assert_eq!(
                decode_request(&header[..length]),
                Err(KinError::MalformedProtocol),
                "length {length}"
            );
        }
    }

    #[test]
    fn nonzero_request_reserved_field_is_rejected() {
        let mut request = request_with(&[], PROTOCOL_VERSION, 0);
        request[6] = 1;
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn truncated_event_header_is_rejected_at_every_short_length() {
        let record = added_record(b"Milk");
        for record_length in 0..EVENT_HEADER_BYTES {
            let request = request_with(&record[..record_length], PROTOCOL_VERSION, 1);
            assert_eq!(
                decode_request(&request),
                Err(KinError::MalformedProtocol),
                "record length {record_length}"
            );
        }
    }

    #[test]
    fn truncated_event_payload_is_rejected_at_every_short_length() {
        let record = added_record(b"Milk");
        for record_length in EVENT_HEADER_BYTES..record.len() {
            let request = request_with(&record[..record_length], PROTOCOL_VERSION, 1);
            assert_eq!(
                decode_request(&request),
                Err(KinError::MalformedProtocol),
                "record length {record_length}"
            );
        }
    }

    #[test]
    fn declared_payload_larger_than_available_bytes_is_rejected() {
        let mut record = added_record(b"Milk");
        record[84..88].copy_from_slice(&u32::MAX.to_le_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn unsupported_event_schema_is_rejected() {
        let mut record = added_record(b"Buy milk");
        record[..2].copy_from_slice(&3u16.to_le_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::UnsupportedVersion));
    }

    #[test]
    fn unsupported_event_kind_is_rejected() {
        let mut record = added_record(b"Buy milk");
        record[2..4].copy_from_slice(&99u16.to_le_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::UnsupportedVersion));
    }

    #[test]
    fn completion_payload_with_wrong_length_is_rejected() {
        let mut record = added_record(b"Milk");
        record[2..4].copy_from_slice(&2u16.to_le_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn reopen_and_archive_payload_lengths_are_exact() {
        for kind in [3u16, 4u16] {
            for payload_length in (0..=17).filter(|length| *length != 16) {
                let mut record = added_record(b"Milk");
                record[2..4].copy_from_slice(&kind.to_le_bytes());
                record[84..88].copy_from_slice(&(payload_length as u32).to_le_bytes());
                record.resize(EVENT_HEADER_BYTES + payload_length, 0);
                let request = request_with(&record, PROTOCOL_V2, 1);
                assert_eq!(
                    decode_request(&request),
                    Err(KinError::MalformedProtocol),
                    "kind {kind}, payload length {payload_length}"
                );
            }
        }
    }

    #[test]
    fn protocol_v1_cannot_serialize_unrepresentable_current_state() {
        let (_, events) = decode_request(&request_with(
            &added_record_v2(1, 0x11, b"Milk", 1),
            PROTOCOL_V2,
            1,
        ))
        .unwrap();
        let mut state = rebuild(&events).unwrap();
        assert_eq!(
            encode_state(&state, PROTOCOL_V1),
            Err(KinError::UnsupportedVersion)
        );
        state.items[0].classification = ItemClassification::Today;
        state.items[0].status = ItemStatus::Archived;
        assert_eq!(
            encode_state(&state, PROTOCOL_V1),
            Err(KinError::UnsupportedVersion)
        );
    }

    #[test]
    fn malformed_text_length_is_rejected() {
        let mut record = added_record(b"hi");
        record[EVENT_HEADER_BYTES + 16..EVENT_HEADER_BYTES + 20]
            .copy_from_slice(&5u32.to_le_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn empty_or_oversized_text_payloads_are_rejected() {
        for (declared_length, text) in [(0u32, b"".as_slice()), (4097, b"x".as_slice())] {
            let mut record = added_record(text);
            record[EVENT_HEADER_BYTES + 16..EVENT_HEADER_BYTES + 20]
                .copy_from_slice(&declared_length.to_le_bytes());
            let request = request_with(&record, PROTOCOL_VERSION, 1);
            assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
        }
    }

    #[test]
    fn invalid_utf8_is_rejected() {
        let record = added_record(&[0xff]);
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn trailing_request_bytes_are_rejected() {
        let mut request = request_with(&[], PROTOCOL_VERSION, 0);
        request.push(0);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn event_count_limit_is_enforced_before_record_parsing() {
        let request = request_with(&[], PROTOCOL_VERSION, (MAX_EVENT_COUNT + 1) as u32);
        assert_eq!(decode_request(&request), Err(KinError::SizeLimit));
    }

    #[test]
    fn maximum_utf8_item_text_is_accepted() {
        let record = added_record(&vec![b'x'; MAX_ITEM_TEXT_BYTES]);
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        let (_, events) = decode_request(&request).unwrap();
        assert!(
            matches!(&events[0].kind, EventKind::ItemAdded { text, .. } if text.len() == MAX_ITEM_TEXT_BYTES)
        );
    }

    #[test]
    fn bom_and_emoji_text_are_preserved() {
        let text = "\u{feff}milk 🥛";
        let record = added_record(text.as_bytes());
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        let (_, events) = decode_request(&request).unwrap();
        assert!(
            matches!(&events[0].kind, EventKind::ItemAdded { text: decoded, .. } if decoded == text)
        );
    }

    #[test]
    fn item_text_above_byte_limit_is_rejected() {
        let record = added_record(&vec![b'x'; MAX_ITEM_TEXT_BYTES + 1]);
        let request = request_with(&record, PROTOCOL_VERSION, 1);
        assert_eq!(decode_request(&request), Err(KinError::MalformedProtocol));
    }
    fn handoff_record(kind: u16, sequence: u8) -> Vec<u8> {
        let mut record = added_record(b"Dishwasher running");
        record[2..4].copy_from_slice(&kind.to_le_bytes());
        record[4..20].fill(sequence);
        record[76..84].copy_from_slice(&u64::from(sequence).to_le_bytes());
        if kind != 5 {
            record.truncate(104);
            record[84..88].copy_from_slice(&16u32.to_le_bytes());
        }
        record
    }

    fn handoff_replay(records: &[Vec<u8>]) -> Result<HouseholdState, KinError> {
        let (_, events) =
            decode_request(&request_with(&records.concat(), 3, records.len() as u32))?;
        rebuild(&events)
    }

    #[test]
    fn handoff_lifecycle_and_terminal_archive() {
        for kinds in [
            vec![5],
            vec![5, 6],
            vec![5, 6, 6],
            vec![5, 7],
            vec![5, 6, 7],
        ] {
            let records: Vec<_> = kinds
                .iter()
                .enumerate()
                .map(|(i, k)| handoff_record(*k, i as u8 + 1))
                .collect();
            let state = handoff_replay(&records).unwrap();
            let handoff = &state.handoffs[0];
            assert_eq!(handoff.created_by, ActorId([0xbb; 16]));
            assert_eq!(handoff.created_at, 1);
            assert_eq!(handoff.text, "Dishwasher running");
            assert_eq!(
                handoff.status,
                match kinds.last().unwrap() {
                    5 => HandoffStatus::Unacknowledged,
                    6 => HandoffStatus::Acknowledged,
                    _ => HandoffStatus::Archived,
                }
            );
            assert_eq!(handoff_replay(&records).unwrap(), state);
            for version in [1, 2] {
                assert_eq!(
                    encode_state(&state, version),
                    Err(KinError::UnsupportedVersion)
                );
            }
            if handoff.status == HandoffStatus::Archived {
                for kind in [5, 6, 7] {
                    let mut invalid = records.clone();
                    invalid.push(handoff_record(kind, invalid.len() as u8 + 1));
                    assert_eq!(handoff_replay(&invalid), Err(KinError::InvalidEvent));
                }
            }
        }
        for kind in [6, 7] {
            assert_eq!(
                handoff_replay(&[handoff_record(kind, 1)]),
                Err(KinError::InvalidEvent)
            );
        }
    }

    #[test]
    fn handoff_identity_deduplication_and_mixed_replay() {
        let added = handoff_record(5, 1);
        assert_eq!(
            handoff_replay(&[added.clone(), added.clone()])
                .unwrap()
                .handoffs
                .len(),
            1
        );
        let mut conflict = added.clone();
        *conflict.last_mut().unwrap() = b'x';
        assert_eq!(
            handoff_replay(&[added.clone(), conflict]),
            Err(KinError::InvalidEvent)
        );
        assert_eq!(
            handoff_replay(&[added.clone(), handoff_record(5, 2)]),
            Err(KinError::InvalidEvent)
        );
        let item = added_record_v2(2, 2, b"Milk", 1);
        let records = vec![added.clone(), item.clone(), handoff_record(6, 3)];
        let state = handoff_replay(&records).unwrap();
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.handoffs.len(), 1);
        let bytes = encode_state(&state, 3).unwrap();
        assert_eq!(
            &bytes[..16],
            &[75, 73, 78, 83, 3, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
        );
        let (_, events) = decode_request(&request_with(&records.concat(), 3, 3)).unwrap();
        assert_eq!(events[0].canonical_bytes, added);
        assert_eq!(events[1].canonical_bytes, item);
        for version in [1, 2] {
            for kind in [5, 6, 7] {
                assert_eq!(
                    decode_request(&request_with(&handoff_record(kind, 1), version, 1)),
                    Err(KinError::UnsupportedVersion)
                );
            }
        }
    }
    #[test]
    fn handoff_payload_boundaries_and_versions_fail_closed() {
        for kind in [5, 6, 7] {
            let record = handoff_record(kind, 1);
            for length in 0..record.len() - 88 {
                let mut truncated = record[..88 + length].to_vec();
                truncated[84..88].copy_from_slice(&(length as u32).to_le_bytes());
                assert_eq!(
                    decode_request(&request_with(&truncated, 3, 1)),
                    Err(KinError::MalformedProtocol)
                );
            }
            let mut trailing = record.clone();
            trailing.push(0);
            let length = (trailing.len() - 88) as u32;
            trailing[84..88].copy_from_slice(&length.to_le_bytes());
            assert_eq!(
                decode_request(&request_with(&trailing, 3, 1)),
                Err(KinError::MalformedProtocol)
            );
            for version in [0u16, 2, 3, u16::MAX] {
                let mut invalid = record.clone();
                invalid[..2].copy_from_slice(&version.to_le_bytes());
                assert_eq!(
                    decode_request(&request_with(&invalid, 3, 1)),
                    Err(KinError::UnsupportedVersion)
                );
            }
            let mut extreme = record.clone();
            extreme[84..88].copy_from_slice(&u32::MAX.to_le_bytes());
            assert_eq!(
                decode_request(&request_with(&extreme, 3, 1)),
                Err(KinError::MalformedProtocol)
            );
        }
    }

    #[test]
    fn handoff_text_validation_and_actor_provenance() {
        for text in [vec![], vec![b'x'; 4097], vec![0xff]] {
            let mut record = added_record(&text);
            record[2..4].copy_from_slice(&5u16.to_le_bytes());
            assert_eq!(handoff_replay(&[record]), Err(KinError::MalformedProtocol));
        }
        let mut blank = added_record(b" \t\n");
        blank[2..4].copy_from_slice(&5u16.to_le_bytes());
        assert_eq!(handoff_replay(&[blank]), Err(KinError::InvalidEvent));
        for same_actor in [false, true] {
            let added = handoff_record(5, 1);
            let mut ack = handoff_record(6, 2);
            if !same_actor {
                ack[36..52].fill(0xdd);
            }
            let (_, events) =
                decode_request(&request_with(&[added, ack.clone()].concat(), 3, 2)).unwrap();
            assert_eq!(
                events[1].actor_id,
                ActorId(if same_actor { [0xbb; 16] } else { [0xdd; 16] })
            );
            assert_eq!(events[1].canonical_bytes, ack);
            let state = rebuild(&events).unwrap();
            assert_eq!(state.handoffs[0].created_by, ActorId([0xbb; 16]));
            assert_eq!(state.handoffs[0].status, HandoffStatus::Acknowledged);
        }
    }

    #[test]
    fn handoff_ids_have_separate_namespace_and_exact_result_bytes() {
        let legacy = added_record(b"Item");
        let added = handoff_record(5, 2); // same raw entity ID; distinct typed namespace
        let state = handoff_replay(&[legacy, added]).unwrap();
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.handoffs.len(), 1);
        let bytes = encode_state(&state, 3).unwrap();
        let offset = 16 + 48 + 4;
        assert_eq!(&bytes[offset..offset + 16], &[0x11; 16]);
        assert_eq!(&bytes[offset + 16..offset + 32], &[0xbb; 16]);
        assert_eq!(&bytes[offset + 32..offset + 40], &1i64.to_le_bytes());
        assert_eq!(&bytes[offset + 40..offset + 44], &[0; 4]);
        assert_eq!(&bytes[offset + 44..offset + 48], &18u32.to_le_bytes());
        assert_eq!(&bytes[offset + 48..], b"Dishwasher running");
    }
    #[test]
    fn handoff_request_header_and_length_hardening() {
        let request = request_with(&handoff_record(5, 1), 3, 1);
        for length in 0..100 {
            assert_eq!(
                decode_request(&request[..length]),
                Err(KinError::MalformedProtocol)
            );
        }
        for offset in [6, 7] {
            let mut invalid = request.clone();
            invalid[offset] = 1;
            assert_eq!(decode_request(&invalid), Err(KinError::MalformedProtocol));
        }
        for length in [0u32, 4097, u32::MAX] {
            let mut invalid = request.clone();
            invalid[116..120].copy_from_slice(&length.to_le_bytes());
            assert_eq!(decode_request(&invalid), Err(KinError::MalformedProtocol));
        }
        let mut trailing = request;
        trailing.push(0);
        assert_eq!(decode_request(&trailing), Err(KinError::MalformedProtocol));
    }

    #[test]
    fn maximum_mixed_handoff_replay_is_deterministic() {
        let mut records = Vec::new();
        for number in 1..=MAX_EVENT_COUNT as u32 {
            let mut record = if number % 2 == 0 {
                added_record_v2(number, number, b"x", 1)
            } else {
                let mut row = added_record(b"x");
                row[2..4].copy_from_slice(&5u16.to_le_bytes());
                row
            };
            record[4..20].copy_from_slice(&numbered_id(number));
            record[88..104].copy_from_slice(&numbered_id(number));
            record[76..84].copy_from_slice(&u64::from(number).to_le_bytes());
            records.push(record);
        }
        let state = handoff_replay(&records).unwrap();
        assert_eq!(state.handoffs.len(), 5000);
        assert_eq!(state.items.len(), 5000);
        let result = encode_state(&state, 3).unwrap();
        assert_eq!(result.len(), 16 + 10000 * 49);
        assert_eq!(
            result,
            encode_state(&handoff_replay(&records).unwrap(), 3).unwrap()
        );
    }
}
