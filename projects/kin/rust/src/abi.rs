use std::collections::BTreeMap;
use std::sync::Mutex;

use crate::error::KinError;
use crate::protocol::{
    decode_request_with_summary, encode_state, encode_state_v6, encode_state_v7,
    ERROR_PROTOCOL_VERSION, MAX_PROTOCOL_BYTES, PROTOCOL_V6, PROTOCOL_V7,
};
use crate::state::{rebuild, rebuild_at, rebuild_on, summarize_validated};

struct AbiState {
    allocations: BTreeMap<u32, Box<[u8]>>,
    result: Vec<u8>,
    error: Vec<u8>,
}

impl AbiState {
    const fn new() -> Self {
        Self {
            allocations: BTreeMap::new(),
            result: Vec::new(),
            error: Vec::new(),
        }
    }
}

static ABI_STATE: Mutex<AbiState> = Mutex::new(AbiState::new());

fn lock_state() -> std::sync::MutexGuard<'static, AbiState> {
    ABI_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn range_is_valid(pointer: u32, length: u32, memory_length: u64) -> bool {
    if length == 0 {
        return true;
    }
    if pointer == 0 {
        return false;
    }
    u64::from(pointer)
        .checked_add(u64::from(length))
        .is_some_and(|end| end <= memory_length)
}

fn request_length_is_supported(length: u32) -> bool {
    usize::try_from(length).is_ok_and(|size| size <= MAX_PROTOCOL_BYTES)
}

#[cfg(target_arch = "wasm32")]
fn linear_memory_length() -> u64 {
    u64::from(core::arch::wasm32::memory_size(0) as u32) * 65_536
}

#[cfg(not(target_arch = "wasm32"))]
fn linear_memory_length() -> u64 {
    u64::MAX
}

fn error_buffer(error: KinError) -> Vec<u8> {
    let message = error.message().as_bytes();
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(12 + message.len()).is_err() {
        return bytes;
    }
    bytes.extend_from_slice(b"KERR");
    bytes.extend_from_slice(&ERROR_PROTOCOL_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(error.code() as u16).to_le_bytes());
    bytes.extend_from_slice(&(message.len() as u32).to_le_bytes());
    bytes.extend_from_slice(message);
    bytes
}

fn active_buffer_pointer(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        0
    } else {
        bytes.as_ptr() as usize as u32
    }
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_alloc(length: u32) -> u32 {
    if length == 0 || !request_length_is_supported(length) {
        return 0;
    }
    let Ok(capacity) = usize::try_from(length) else {
        return 0;
    };
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(capacity).is_err() {
        return 0;
    }
    bytes.resize(capacity, 0);
    let mut allocation = bytes.into_boxed_slice();
    let pointer = allocation.as_mut_ptr() as usize as u32;
    if pointer == 0 {
        return 0;
    }
    lock_state().allocations.insert(pointer, allocation);
    pointer
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_free(pointer: u32, length: u32) -> i32 {
    if pointer == 0 && length == 0 {
        return 0;
    }
    let mut state = lock_state();
    let Some(allocation) = state.allocations.get(&pointer) else {
        return KinError::InvalidAbi.code();
    };
    if allocation.len() != length as usize {
        return KinError::InvalidAbi.code();
    }
    state.allocations.remove(&pointer);
    0
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_apply_events(pointer: u32, length: u32) -> i32 {
    let mut state = lock_state();
    state.result.clear();
    state.error.clear();

    let outcome = if !request_length_is_supported(length) {
        Err(KinError::SizeLimit)
    } else if !range_is_valid(pointer, length, linear_memory_length()) {
        Err(KinError::InvalidAbi)
    } else if length == 0 {
        Err(KinError::MalformedProtocol)
    } else {
        let input = unsafe {
            // The WASM caller borrows an in-bounds byte range for this call only.
            std::slice::from_raw_parts(pointer as *const u8, length as usize)
        };
        decode_request_with_summary(input).and_then(|request| {
            let state = if let Some(date) = request.civil_date {
                rebuild_on(&request.events, request.as_of.unwrap(), date)
            } else {
                match request.as_of {
                    Some(time) => rebuild_at(&request.events, time),
                    None => rebuild(&request.events),
                }
            };
            state.and_then(|household| {
                if request.protocol_version >= PROTOCOL_V6 {
                    summarize_validated(&request.events, request.summary_cursor, &household)
                        .and_then(|summary| {
                            if request.protocol_version == PROTOCOL_V7 {
                                encode_state_v7(&household, &summary)
                            } else {
                                encode_state_v6(&household, &summary)
                            }
                        })
                } else {
                    encode_state(&household, request.protocol_version)
                }
            })
        })
    };

    match outcome {
        Ok(result) => {
            state.result = result;
            0
        }
        Err(error) => {
            state.error = error_buffer(error);
            error.code()
        }
    }
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_result_ptr() -> u32 {
    active_buffer_pointer(&lock_state().result)
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_result_len() -> u32 {
    lock_state().result.len() as u32
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_error_ptr() -> u32 {
    active_buffer_pointer(&lock_state().error)
}

#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn kin_error_len() -> u32 {
    lock_state().error.len() as u32
}

#[cfg(test)]
mod tests {
    use super::{range_is_valid, request_length_is_supported};
    use crate::protocol::MAX_PROTOCOL_BYTES;

    #[test]
    fn memory_ranges_reject_null_overflow_and_out_of_bounds() {
        assert!(range_is_valid(12, 8, 20));
        assert!(range_is_valid(20, 0, 20));
        assert!(!range_is_valid(0, 1, 20));
        assert!(!range_is_valid(19, 2, 20));
        assert!(!range_is_valid(u32::MAX, 2, u64::from(u32::MAX) + 1));
    }

    #[test]
    fn request_size_is_bounded_before_pointer_dereference() {
        assert!(request_length_is_supported(MAX_PROTOCOL_BYTES as u32));
        assert!(!request_length_is_supported(MAX_PROTOCOL_BYTES as u32 + 1));
    }
}
