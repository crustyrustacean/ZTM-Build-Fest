# Kin

> A private, lightweight household coordination app for the little things families need to know, remember, hand off, or discuss.

**Current status: `v0.0.3` — UX and implementation planning. No usable application has been implemented.** This release contains planning documentation only; there is nothing to install or run yet. Kin's first functional prototype is planned for `v0.1.0`.

## The problem

Household information gets scattered across memory, messages, calendars, sticky notes, verbal conversations, and assumptions. That makes small handoffs easy to miss and everyday coordination harder than it needs to be. The gaps can lead to "I thought you knew," "Why didn't you tell me?", "I thought you were doing that," or conversations happening at the wrong time.

Kin aims to make useful household context easier to share and find. It is not a promise to prevent conflict or fix relationships, and it will not decide who is right or measure anyone's contribution.

## Intended direction

Kin is planned as a private, lightweight shared household operating layer, initially for one household and two adults. Its long-term concepts include Today, Needs, Handoff, Talk, Pulse, and Since You Last Looked. These are not implemented features.

The intended technical direction is Rust compiled to WebAssembly, native Web Components, vanilla JavaScript, and browser APIs, with a local-first start and no external framework unless a demonstrated requirement justifies one.

## Planned releases

- `v0.0.1` — Product definition and principles (`kin-v0.0.1`)
- `v0.0.2` — Architecture, event model, and privacy design (`kin-v0.0.2`)
- `v0.0.3` — UX flows and implementation planning (`kin-v0.0.3`)
- `v0.1.0` — First functional prototype

## Install and run

There is currently no application to install or run. The `v0.0.x` releases are documentation-only; application source, build tooling, and runtime dependencies have deliberately not been added. The first implementation is planned for `v0.1.0`.

## AI usage

AI-assisted development tools are being used for brainstorming, product planning, architecture exploration, documentation, and implementation support. Kin is not currently designed around an AI runtime. The intended privacy posture is that household content is not sent to an AI service by default.

## Project documents

- [Product vision](docs/PRODUCT.md)
- [Principles and non-goals](docs/PRINCIPLES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Conceptual data model](docs/DATA-MODEL.md)
- [Privacy](docs/PRIVACY.md)
- [UX flows](docs/UX.md)
- [Roadmap](docs/ROADMAP.md)
- [v0.1.0 implementation specification](docs/V0.1.0.md)
