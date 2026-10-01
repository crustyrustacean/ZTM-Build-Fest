# Privacy

**Status:** intended posture, not an implemented guarantee. Kin currently has no application, storage, account system, encryption, or sync service.

Household information can be highly personal. Future implementation must minimize exposure and communicate clearly what is stored and shared.

## Intended principles

- **Local-first:** Begin with data stored and processed on the user's device where practical.
- **Minimum server knowledge:** If a service is introduced, design it to know as little household content as reasonably possible.
- **No advertising and no sale of data:** These are product commitments for the intended direction.
- **No household-content analytics:** Do not collect household content for analytics.
- **No default AI processing:** Household content will not be sent to an AI service by default. Kin is not designed around an AI runtime.
- **Encrypted synchronization later:** Sync, if introduced, should protect household content in transit and at rest on the service; the threat model and key design must be specified before claiming end-to-end confidentiality.
- **Explicit device authorization:** Pairing or trusting a device must be intentional and understandable.
- **Device revocation:** Future users should be able to revoke a device's access.
- **Clear export and deletion controls:** These should be designed before meaningful household data is stored or synchronized.

## Local-first progression

The first coded releases are expected to store a local event history in browser storage and reconstruct state locally:

```text
Browser
   |
   v
IndexedDB
   |
   v
Rust reconstructs state
```

No remote sync is planned for v0.1.0. Local-first is an architectural direction, not a claim that browser storage alone is secure against device compromise, shared browser profiles, or malicious extensions.

## Future encrypted sync concept

```text
Parent A
    |
  passkey
    |
 household key
    |
 encrypted events
    v
 sync service
    v
 encrypted events
    |
 household key
    |
  Parent B
```

This is a conceptual direction only. Passkeys, household keys, encryption, pairing, authorization, revocation, and sync are not yet implemented. A passkey is not itself a household encryption design. Key creation, backup/recovery, device enrollment, revocation, metadata exposure, and failure recovery all need an explicit threat model before implementation.

The planning design for these boundaries is documented in [Identity](IDENTITY.md), [Pairing](PAIRING.md), [Synchronization](SYNC.md), [Cryptography](CRYPTOGRAPHY.md), and the [Threat Model](THREAT-MODEL.md). These documents specify intended properties and open decisions; they do not establish implemented security guarantees.

## Data lifecycle questions

Before remote sync, the project must specify which data is retained, how event history can be corrected or deleted, how deletion propagates to devices and backups, what metadata remains visible to a service, and how exports work. Event-oriented history is not an excuse to keep personal data indefinitely.

## Claims boundary

Documentation describes intent, not verified security properties. Kin must not be described as encrypted, private-by-design in a technically verified sense, or safe for sensitive content until implementation and review support those claims.
