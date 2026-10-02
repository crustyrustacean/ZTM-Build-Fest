# JavaScript–WASM ABI

**Status:** proposed v0.1.0 manual ABI contract. No WASM module or ABI code exists. The protocol byte layout is specified below; module responsibilities are in [IMPLEMENTATION](IMPLEMENTATION.md), and state semantics are in [EVENTS](EVENTS.md) and [STATE](STATE.md).

## Target and exports

Compile Rust for `wasm32-unknown-unknown` and expose a narrow C-compatible ABI. Names below are the planned v0.1.0 names:

```text
kin_alloc(length: u32) -> ptr: u32
kin_free(ptr: u32, length: u32) -> status: i32
kin_apply_events(ptr: u32, length: u32) -> status: i32
kin_result_ptr() -> ptr: u32
kin_result_len() -> length: u32
kin_error_ptr() -> ptr: u32
kin_error_len() -> length: u32
```

Pointers are byte offsets into the current WebAssembly linear memory, represented as `u32`; JavaScript must not treat them as host pointers. `kin_apply_events` uses the stable status codes defined in the protocol section; `kin_free` returns `0` on success and `1` for an invalid range. Error text is diagnostic only; clients branch on codes.

## Protocol version 1

All multibyte integers are little-endian. IDs are exactly 16 opaque bytes; never parse or sort their internal bytes except for the explicit bytewise tie-break defined in [EVENTS](EVENTS.md). Text is strict UTF-8 with no terminator. Reserved fields must be zero. Reject truncated input, trailing bytes, integer overflow, unknown kind codes, invalid UTF-8, and unsupported versions; do not attempt to reinterpret a different layout.

The request begins with a 12-byte header:

```text
offset  size  field
0       4     ASCII "KINE"
4       2     protocol_version = 1
6       2     reserved = 0
8       4     event_count
```

It is followed by exactly `event_count` consecutive records, each with an 88-byte fixed header and the declared payload:

```text
size  field
2     event_version = 1
2     event_kind (1 = ITEM_ADDED, 2 = ITEM_COMPLETED)
16    event_id
16    household_id
16    actor_id
16    device_id
8     timestamp (signed UTC Unix milliseconds)
8     logical_time (unsigned)
4     payload_length in bytes
N     payload bytes
```

The `ITEM_ADDED` payload is `item_id[16]`, `text_length:u32`, then exactly that many UTF-8 text bytes. Text length must be 1–4096 bytes. The `ITEM_COMPLETED` payload is exactly `item_id[16]`. Every request is limited to 10,000 events and 64 MiB total; results are subject to the same 64 MiB output limit. All events in one v0.1.0 request must have the same household ID and must appear in IndexedDB `local_sequence` order. The protocol does not encode local sequence; the caller supplies records in that order.

A successful state result begins with a 12-byte header:

```text
offset  size  field
0       4     ASCII "KINS"
4       2     protocol_version = 1
6       2     reserved = 0
8       4     item_count
```

Each item record is 48 bytes followed by its UTF-8 text:

```text
size  field
16    item_id
16    created_by actor_id
8     created_at UTC Unix milliseconds
1     status (0 = active, 1 = completed)
3     reserved = 0
4     text_length in bytes
N     text bytes
```

Items are serialized in `ITEM_ADDED` event order, not hash-map iteration order. Empty household state is a valid 12-byte `KINS` response with `item_count = 0`.

On failure, the error buffer is:

```text
ASCII "KERR" | protocol_version:u16 | error_code:u16 | message_length:u32 | UTF-8 message
```

The error code is also returned from `kin_apply_events`: `0` success, `1` invalid ABI pointer/range, `2` malformed protocol/payload, `3` unsupported protocol/event version or kind, `4` invalid domain event/state, `5` size/allocation limit, `6` internal error. The same failure must always produce the same category; the message is not a machine-readable contract and must not contain household text.

## Ownership and lifetime

- `kin_alloc(n)` allocates an input buffer owned by JavaScript. For `n == 0`, it returns `0`. Allocation failure returns `0`; the bridge treats that as failure and does not call apply.
- JavaScript writes exactly `n` bytes within the current `memory.buffer`, refreshes its view after any operation that may grow memory, and calls `kin_apply_events(ptr, n)`.
- The input pointer is borrowed only for the duration of `kin_apply_events`. Rust must validate pointer/length bounds before reading and must not retain the pointer after return.
- JavaScript calls `kin_free(ptr, n)` exactly once after apply returns, whether apply succeeds or fails. `(0, 0)` is a no-op; other invalid free ranges fail safely and never free an unrelated allocation.
- Rust owns result/error buffers. `kin_result_ptr/len` refer to the most recent successful result; `kin_error_ptr/len` refer to the most recent failed call. The inactive pair returns `(0, 0)`.
- Result/error bytes stay valid until the next `kin_apply_events` call or module teardown. JavaScript must copy them into host-owned memory before another call. The bridge must not retain a view that may become stale if WASM memory grows.
- Each call clears the previous result and error before processing. Repeated calls are independent full replays; the module has no hidden household state between calls.
- A valid empty household response is a non-empty protocol result containing a zero item count. A zero-length error/result accessor means that no buffer is available, not a successful empty state.
- Output allocation is released by Rust on the next apply call/module teardown; JavaScript must not call `kin_free` on result/error pointers.

## Call behavior

`kin_apply_events` accepts one complete, ordered event batch. It validates the entire request and reconstructs from scratch. On success it publishes exactly one complete result and returns zero. On failure it publishes an error and no partial result; stored IndexedDB bytes remain untouched. Unknown protocol/event versions fail with a stable unsupported-version code; malformed payload, bounds overflow, and invalid state transitions fail deterministically.

The function may grow memory while parsing or building output. JavaScript must reacquire `memory.buffer` after the call before copying result/error bytes. Length arithmetic is checked for overflow in both languages. Cap a request and result at 64 MiB, a request at 10,000 events, and individual item text at 4096 UTF-8 bytes for v0.1.0; reject larger input before unbounded allocation. The matching 10,000-event storage limit is specified in [STORAGE](STORAGE.md).

## JavaScript bridge responsibilities

The high-level bridge owns loading/instantiation, ABI export checks, buffer allocation/copy/free, memory view refresh, binary protocol encode/decode, and conversion of stable ABI errors to UI-safe messages. It must not implement event replay or state transitions.
