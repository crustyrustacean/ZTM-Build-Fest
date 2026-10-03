# Security Policy

**Current security status:** Kin v0.10.0 is an incubation prototype with encrypted local household storage, recovery/optional-PRF unlock, encrypted archives, passkey-authenticated pairing and client-encrypted sync. Locked startup does not replay household content or retain usable local/sync private keys. The same-origin Node identity/relay service remains memory-only. This release has not received an independent audit or production hardening. Encryption cannot protect a compromised unlocked runtime, origin, privileged extension or OS, and revocation cannot erase data or keys already copied. See [THREAT-MODEL](docs/THREAT-MODEL.md), [CRYPTOGRAPHY](docs/CRYPTOGRAPHY.md) and [V0.10.0](docs/V0.10.0.md).

## Supported versions

Kin is a prototype and has no staffed security-support commitment or guaranteed response time. Follow the private reporting guidance below and include only synthetic data.

## Reporting a vulnerability

Please do not publish exploitable details, household data, credentials, pairing codes, private keys, or proof-of-concept material in a public issue.

Use GitHub's private vulnerability reporting for the hosting repository if that feature is enabled. If it is unavailable, contact the repository maintainer through a private contact method listed on their GitHub profile and identify the affected path/version. Kin does not operate a dedicated security mailbox or promise a response-time SLA.

Reports should include a concise impact description, affected version/commit, safe reproduction steps, and any mitigations already identified. Use synthetic data only. Do not access or retain another person's household information while investigating.

## Scope and response

Implemented security-sensitive areas include safe rendering, WASM protocol/archive parsing and memory ownership, encrypted IndexedDB migration, recovery/PRF root wrapping, WebAuthn, device authorization, encrypted archive import, lock cancellation, static shell caching, and sync authorization/relay. Report issues against behavior that actually exists. Encrypted backup restores local history but does not recover the memory-only server identity. No durable relay or production service is provided.

Maintainers will acknowledge and assess reports when available, coordinate a fix and disclosure where applicable, and avoid publishing sensitive details before affected users can reasonably respond. No response-time or remediation guarantee is made.
