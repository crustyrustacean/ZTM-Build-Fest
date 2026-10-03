# Security Policy

**Current security status:** Kin v0.9.3 is an incubation prototype with passkey-authenticated household pairing and opt-in client-encrypted event sync. The same-origin Node service authorizes devices and relays opaque encrypted records, but its identity and relay state are memory-only. This release has not received an independent security audit or production hardening. Encryption does not protect against a compromised unlocked browser/runtime, and device revocation cannot erase data or keys already copied to that device. See [THREAT-MODEL](docs/THREAT-MODEL.md) and [SYNC](docs/SYNC.md) for the implemented boundary and limitations.

## Supported versions

Kin is a prototype and has no staffed security-support commitment or guaranteed response time. Follow the private reporting guidance below and include only synthetic data.

## Reporting a vulnerability

Please do not publish exploitable details, household data, credentials, pairing codes, private keys, or proof-of-concept material in a public issue.

Use GitHub's private vulnerability reporting for the hosting repository if that feature is enabled. If it is unavailable, contact the repository maintainer through a private contact method listed on their GitHub profile and identify the affected path/version. Kin does not operate a dedicated security mailbox or promise a response-time SLA.

Reports should include a concise impact description, affected version/commit, safe reproduction steps, and any mitigations already identified. Use synthetic data only. Do not access or retain another person's household information while investigating.

## Scope and response

Implemented security-sensitive areas include safe rendering, WASM protocol parsing and memory ownership, IndexedDB event handling, WebAuthn, device authorization, Web Crypto encryption/key wrapping, and sync authorization/relay. Report issues against behavior that actually exists; a documented future design is not a deployed attack surface. No durable relay, all-device recovery, or production service is provided.

Maintainers will acknowledge and assess reports when available, coordinate a fix and disclosure where applicable, and avoid publishing sensitive details before affected users can reasonably respond. No response-time or remediation guarantee is made.
