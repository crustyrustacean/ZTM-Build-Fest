# Pairing and Device Enrollment

**Status:** Current through v0.8.2. Manual short-lived pairing codes, invitation URLs, passkey identity, explicit approval, and trusted-device revocation are implemented. QR, key exchange, encrypted sync, and durable service storage are not implemented.

## Distinct operations

Inviting another household member changes household membership. Adding a device authorizes another installation for an existing member. They are separate operations with different confirmation and recovery requirements.

## Invite a household member

```text
Member A authenticates
        |
        v
Create household
        |
        v
Start invitation session
        |
        v
Display short-lived QR / pairing code
        |
        v
Member B scans or enters code
        |
        v
Both verify the same pairing session
        |
        v
Member B accepts and creates a passkey
        |
        v
Authorize Member B's device and enroll its key
```

The pairing invitation must not itself be a durable login credential or contain the household encryption key in plaintext. It carries only the minimum short-lived session material required to authenticate a secure enrollment exchange.

## Pairing session requirements

- Generate an unpredictable, high-entropy, single-use secret; store only a verifier server-side if a server is involved.
- Expire quickly (for example, within a few minutes); show a visible countdown and require the inviter to explicitly restart after expiry.
- Bind acceptance to the intended household, inviter, recipient device, and one pairing-session ID.
- Consume the code atomically on successful acceptance. A second submission or replay is rejected.
- Rate-limit guesses and return a generic failure that does not disclose household/member existence.
- Allow either person to cancel. Cancellation, expiry, or failed verification invalidates the session and any derived ephemeral secret.
- A scan alone must not add a member, authorize a device, or disclose prior household content.
- If a code is entered on the wrong or accidental device, either side can cancel; no membership or key access is granted before both sides confirm.
- Bind confirmation to the exact key-exchange transcript. Both devices should show matching human-readable verification information (such as a short fingerprint/word sequence derived using a standard protocol) before approval. The representation and usability must be security-reviewed; it is not an ad hoc cryptographic primitive.
- Show the inviter and invitee which household and member/device are being added, and require clear confirmation from both.

The exact expiry, cryptographic exchange, and server state machine remain implementation decisions informed by threat modeling. These requirements are not executable protocol code.

## Add a device for an existing member

```text
Existing member authenticates on an authorized device
        |
        v
Choose “Add this member's device”
        |
        v
New device presents a short-lived enrollment request
        |
        v
Existing device verifies the request and new-device fingerprint
        |
        v
Member confirms on the existing device
        |
        v
New device authenticates with a member credential
        |
        v
Authorize device and provision its household-key access
```

This flow must not create another member. It requires proof of the existing member's authority, binds the new device key to that member, and separately approves access to household content. If no authorized device remains, recovery must use a deliberately designed recovery path; possession of an old pairing code is not recovery.

## Revocation

A member should be able to inspect trusted devices and revoke a specific device through an understandable control such as:

```text
Settings
→ Household
→ Trusted devices
→ Revoke device
```

Revocation should immediately mark the device unauthorized at the service, reject future sessions/uploads/downloads, invalidate its sync tokens, and notify remaining household members. Offline events produced by a revoked device must not silently re-enter the household.

Revocation cannot erase plaintext, screenshots, exports, or encryption keys already copied to a lost/compromised device. To provide forward confidentiality, the household content key must be rotated after revocation and new events encrypted under the new key. Existing history may need controlled re-encryption for remaining devices; the exact policy, recovery, and effects on backups are open decisions. Do not promise retroactive erasure.

Member removal and device revocation are different actions. Removing a member must revoke that member's devices and initiate key rotation, but still cannot reclaim data already downloaded.
