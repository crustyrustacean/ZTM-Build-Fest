# Identity and Trusted Devices

**Status:** Current through v0.7.4 Routine Stale-Action Correctness; design specification for future releases. No accounts, credentials, device registry, authentication, or trusted-device implementation exists. Pairing, sync, and cryptographic boundaries are specified in [PAIRING](PAIRING.md), [SYNC](SYNC.md), and [CRYPTOGRAPHY](CRYPTOGRAPHY.md).

## Separate identities

```text
Household
├── Member A
│   ├── Credential A1
│   ├── Device A1
│   └── Device A2
└── Member B
    ├── Credential B1
    └── Device B1
```

The initial multi-device target is one household, two adult members, and multiple trusted devices. Child accounts, extended-family roles, teams, organizations, admin panels, and complex RBAC are out of scope.

| Concept    | Identity                 | Meaning                                                                                                                     |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Household  | `household_id`           | Stable opaque ID for one private coordination space and its event stream.                                                   |
| Member     | `member_id`              | Stable opaque ID for a person. It survives device replacement and credential rotation.                                      |
| Device     | `device_id`              | ID for one application/browser installation authorized to act for a member. A reinstall or replacement is a new device.     |
| Credential | credential ID/public key | An authenticator used to prove control of a member account, likely a passkey. It is not a household key or device identity. |

Events carry household, actor/member, and originating device IDs as specified in [EVENTS](EVENTS.md). IDs are references, not secrets or proof of authorization. In v0.1.0 all are local placeholders; no identity in that version asserts a verified human or remote household.

## Membership and lifecycle

Membership is an explicit relation between a household and a member, not inferred from possession of a device or from event authorship. Conceptual states are invited, active, and removed. Creation, acceptance, and removal must be explicit, attributable events with defined authorization before implementation. Removal blocks future household access but cannot retract data already learned or copied.

The planned first shared household has two adult members. Kin does not infer family relationships, rank members, or assign contribution scores. A member may have multiple devices and credentials; removing one device must not silently remove the member.

## Passkey direction

Prefer passkeys through WebAuthn over email/password as the primary authentication experience. The intended interaction is:

```text
Open Kin
   |
   v
Face ID / fingerprint / device PIN
   |
   v
Household view
```

The authenticator's local biometric/PIN operation is handled by the platform; Kin should not collect a biometric or device PIN. Passkeys authenticate a member to the service. They do not automatically encrypt household data, create a household key, identify a particular installation, or provide a general-purpose key-agreement API. Those require separate reviewed key and device protocols.

Passkey enrollment, multiple credentials, recovery, loss, credential revocation, account recovery, and session expiry must be decided before shipping identity. v0.1.0 has no login.

## Device authorization

A device is trusted only after explicit enrollment by an active member through the pairing flow. The device has its own ID and device key material, separate from the member's credential and household content key. Each accepted event records its originating `device_id` for later sync and audit context; this must not become a covert activity feed.

Conceptual device states are pending, authorized, and revoked. Only authorized devices may submit or receive encrypted household events. Revocation is a server-side authorization change plus a key-rotation decision; it cannot erase content or keys already copied to a device. See [Pairing](PAIRING.md) and [Sync](SYNC.md).

## v0.1.0 boundary

The first coded release uses local household, actor, and device placeholders only. No account, passkey, membership, pairing, authorization, remote session, or multi-device behavior is implied.
