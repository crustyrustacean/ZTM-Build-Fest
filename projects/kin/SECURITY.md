# Security Policy

**Current security status:** Kin's v0.3.x prototype runs locally in the browser and stores household events in IndexedDB. There is no backend, authentication, sync service, or implemented encryption. Browser-local storage is not protection against device compromise, shared profiles, or malicious extensions. The security architecture and threat model are specifications, not guarantees.

## Supported versions

Kin is a prototype and has no staffed security-support commitment or guaranteed response time. `v0.0.x` releases contain documentation only; the `v0.3.x` line is pre-release software. Follow the private reporting guidance below and include only synthetic data.

## Reporting a vulnerability

Please do not publish exploitable details, household data, credentials, pairing codes, private keys, or proof-of-concept material in a public issue.

Use GitHub's private vulnerability reporting for the hosting repository if that feature is enabled. If it is unavailable, contact the repository maintainer through a private contact method listed on their GitHub profile and identify the affected path/version. Kin does not operate a dedicated security mailbox or promise a response-time SLA.

Reports should include a concise impact description, affected version/commit, safe reproduction steps, and any mitigations already identified. Use synthetic data only. Do not access or retain another person's household information while investigating.

## Scope and response

Implemented security-sensitive areas include safe rendering, WASM protocol parsing and memory ownership, and IndexedDB event handling. Future areas include import/migration, WebAuthn, Web Crypto, device authorization, and synchronization. Only report issues against behavior that actually exists; a documented future design is not a deployed attack surface.

Maintainers will acknowledge and assess reports when available, coordinate a fix and disclosure where applicable, and avoid publishing sensitive details before affected users can reasonably respond. No response-time or remediation guarantee is made.
