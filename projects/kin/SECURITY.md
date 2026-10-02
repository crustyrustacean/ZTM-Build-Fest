# Security Policy

**Current security status:** Kin is a planning/documentation project. There is no runnable application, backend, authentication, sync service, or implemented encryption to test. The security architecture and threat model are specifications, not guarantees.

## Supported versions

No functional Kin version is currently supported. `v0.0.x` releases contain documentation only. Once a coded release exists, this section will list the versions receiving security fixes and the supported reporting process.

## Reporting a vulnerability

Please do not publish exploitable details, household data, credentials, pairing codes, private keys, or proof-of-concept material in a public issue.

Use GitHub's private vulnerability reporting for the hosting repository if that feature is enabled. If it is unavailable, contact the repository maintainer through a private contact method listed on their GitHub profile and identify the affected path/version. Kin does not operate a dedicated security mailbox or promise a response-time SLA.

Reports should include a concise impact description, affected version/commit, safe reproduction steps, and any mitigations already identified. Use synthetic data only. Do not access or retain another person's household information while investigating.

## Scope and response

Future security-sensitive areas include event import/migration, unsafe rendering, WASM protocol parsing and memory ownership, IndexedDB data handling, WebAuthn, Web Crypto, device authorization, and synchronization. Only report issues against behavior that actually exists; a documented future design is not a deployed attack surface.

Maintainers will acknowledge and assess reports when available, coordinate a fix and disclosure where applicable, and avoid publishing sensitive details before affected users can reasonably respond. No guarantee is made that a report can be fixed while the application is not implemented.
