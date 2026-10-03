# Cryptographic Posture

**Status:** Current through v0.8.8. Pairing uses platform cryptographic randomness with rejection sampling over its code alphabet, HMAC-SHA-256 code verifiers, SHA-256 WebAuthn checks, member-bound approval assertions, and hardened ES256/RS256 passkey verification. Household content encryption, key exchange, rotation, and encrypted sync remain unimplemented and unreviewed.

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

## Claims boundary

Pairing and passkey verification are implemented for the local incubation service, but have not received independent security review. Content encryption, key storage/transfer, rotation, and sync are not implemented. Kin must not claim end-to-end encryption, a zero-knowledge service, production hardening, or verified security.
