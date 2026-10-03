# Cryptographic Posture

**Status:** Implemented through v0.9.3 for local incubation. In addition to v0.8 passkey/pairing primitives, the browser uses Web Crypto AES-GCM, ECDSA P-256/SHA-256, ECDH P-256, and HKDF-SHA-256 for encrypted events, device signatures, and recipient-bound key wrapping. No independent cryptographic audit or production certification is claimed.

## Non-negotiable rule

> Kin will use established cryptographic primitives exposed by standards-based implementations such as Web Crypto and appropriate server-side equivalents.

Do not invent cryptographic algorithms, encryption formats, key exchanges, random generators, or authentication schemes. Do not hand-roll cryptography. Any selected primitive and protocol must use a standardized API and established mode, with a reviewed design and test vectors appropriate to the implementation. Algorithm and parameter choices remain open until a qualified review; this document does not make a custom construction or cipher commitment.

## Desired properties

If remote sync is introduced, the design should provide:

- Confidentiality and integrity/authenticity for household event payloads in transit and on relay storage
- Cryptographically secure random generation for keys and pairing secrets
- Explicit authorization of each receiving device
- Separation between member authentication credentials, device identity keys, and household content keys
- Versioned key envelopes and a deliberate key-rotation path
- No plaintext household content key available to the sync service
- Standard transport security in addition to payload encryption

IndexedDB is not inherently encrypted storage. Local data protection depends on browser/device security and the threat model; do not imply otherwise.

## Conceptual household-key flow

```text
trusted authorized device
          |
          | obtains a household content key through reviewed enrollment
          v
household key held by authorized clients
          |
          | authenticated encryption using a reviewed standard protocol
          v
ciphertext event payload
          |
          v
sync relay stores and forwards ciphertext plus limited metadata
```

The key must be generated with a cryptographically secure source or established by a reviewed standard key-agreement protocol. It must be delivered only to explicitly authorized devices over an authenticated, transcript-bound enrollment channel. Exact key derivation, wrapping, storage, backup/recovery, rotation, and algorithm selection are unresolved design decisions.

## Passkeys are not encryption keys

A passkey/WebAuthn credential authenticates a member to a relying party. It does not by itself provide a household encryption key, encrypt events, prove a device is the only holder of content, or define recovery. Do not derive household keys directly from a passkey assertion or treat a biometric/PIN as a key. Authentication, device keys, and household encryption are separate protocols.

## Enrollment, revocation, and rotation

Each authorized device needs an explicit, authenticated means to obtain access to the household key without exposing it to the relay. Pairing must verify the same session and recipient device before enrollment. On device/member revocation, the service rejects future access and remaining trusted devices must rotate the key for future events. Previously downloaded plaintext or key material cannot be recalled. Whether and how old history is re-encrypted for remaining members is a deliberate future decision; see [PAIRING](PAIRING.md).

## Browser execution risk

Browser-side encryption protects against some server/database exposure but not malicious JavaScript executing in an authorized browser. XSS or a compromised dependency could read plaintext and key material. Minimize external scripts/dependencies, render household text as text, avoid unsafe HTML and `eval`, review Content Security Policy, and keep key lifetimes narrow where practical. These defenses reduce risk; they do not make a compromised client trustworthy.

## v0.9.x Implementation Record

- Household content uses one random 256-bit AES-GCM key per monotonically increasing epoch; each event has a 96-bit CSPRNG nonce and 128-bit tag. AAD binds protocol/envelope version, household, event, author device, device sequence, Lamport time and epoch. The relay bounds a household history at 100,000 events, below the documented 2^20 envelopes per-epoch nonce budget.
- Each trusted device has separate non-extractable P-256 ECDH and ECDSA private `CryptoKey`s. Public JWKs are fingerprinted and compared locally during pairing approval. The approver signs a certificate binding the claimant's household/member/device IDs and public keys; recipients validate certificate chains against locally pinned/comparison-approved roots before using directory keys. Device signatures bind opaque envelope metadata and ciphertext; receivers verify before decrypting.
- Provisioning uses ephemeral ECDH P-256, HKDF-SHA-256, and AES-GCM wrapping. Packages bind household, sender, recipient ID/fingerprint, epoch, grant and expiry, and are signed by the sender. The recipient proves possession by unwrapping. Grants are recipient-bound and expiring; exact retries are idempotent.
- Epoch keys are non-extractable at runtime. IndexedDB stores only AES-GCM-sealed raw bytes, wrapped by a key derived from the device's non-extractable ECDH key and fresh salt. Raw bytes are transient only during explicit provisioning and zeroed afterward. This does not protect an executing authorized runtime.
- Existing canonical event bytes are encrypted directly. Historical placeholder identities remain byte-for-byte intact; a separate signed, encrypted identity-binding control record establishes the authenticated importing identity for v8 replay. No semantic JSON event replacement is used.
- Tests cover roundtrip, wrong keys, metadata substitution, ciphertext/signature/nonce mutation, unsupported/truncated envelopes, nonce variation, sealed-key restore, correct/wrong recipient, expiry, signature tampering, and actual two-trusted-device opaque relay exchange.

Key generation and authenticated encryption use platform Web Crypto. The implementation has no custom cipher, MAC, nonce counter, or password-derived content key.

## Claims boundary

Kin implements client-side authenticated event encryption and a relay that stores/forwards opaque envelopes. This is not a zero-knowledge claim. The service sees identifiers, timing, counts, ciphertext sizes, membership, cursors, public keys and network metadata; it controls availability and can withhold history. An authorized compromised browser/runtime can read plaintext and invoke keys. The identity service and relay are memory-only in this incubation. Do not claim independent security audit, production hardening, anonymity, durable recovery, or protection from an unlocked compromised device.
