# Development Workflow

**Status:** Current through v0.10.0 Portable Core + Local Data Security; earlier version sections are historical contracts.

## Build and run

```text
clone the ZTM Build Fest repository
        |
        v
work inside projects/kin/
        |
        v
install rustup/Cargo and the wasm32-unknown-unknown target
        |
        v
build the Rust/WASM module using the project-local manifest
        |
        v
        serve HTML, assets, and same-origin APIs from the Kin Node server
        |
        v
        open the supported browser and exercise Today + Needs + Handoff + Talk + Pulse + catch-up
```

From the repository root in PowerShell:

```powershell
./projects/kin/run.ps1
```

The launcher builds the WASM module and serves the web app at `http://localhost:8000`; press Ctrl+C to stop it. On macOS/Linux, run `sh projects/kin/run.sh` from the repository root. Never run Cargo from the Build Fest repository root for Kin; generated artifacts belong under `projects/kin/`.

## First-class operating systems

Windows, macOS, and Linux are intended development environments. Documentation and future scripts must not assume Bash, GNU-only utilities, POSIX path syntax, or a Unix package manager. Prefer Cargo/rustup and portable project commands. Where a command differs, show native PowerShell and shell equivalents rather than forcing developers to install a compatibility shell.

Windows developers should be able to use PowerShell and standard Rust tooling. macOS and Linux developers should be able to use their standard shells and rustup. Compiler/browser differences should be captured in issue reports with OS and version details.

## Intended minimal tools

- Rust toolchain (`rustup`, `cargo`) and the `wasm32-unknown-unknown` target
- A modern secure-context browser with WebAssembly, Web Crypto, IndexedDB, Web Locks, BroadcastChannel, service workers and the platform APIs in [IMPLEMENTATION](IMPLEMENTATION.md)
- Node.js 22 or later for the same-origin application/API server and built-in tests
- Python 3.11 or later for version checks and launcher smoke tests; it is not needed to serve the app

No npm dependency tree or framework runtime is planned. If static serving later requires a helper, prefer a minimal cross-platform option with a clear security/update story.

## Browser capabilities

The application requires WebAssembly, ES modules, Custom Elements, IndexedDB, Web Locks, `BroadcastChannel`, `CustomEvent`, text encoders/decoders and Web Crypto. WebAuthn is used for server identity and pairing. Credential-bound local unlock additionally requires actual PRF output; the independently held recovery key remains the explicit fallback and works offline. Web Locks are required for safe v0.9.3 migration. The service worker caches only an allowlisted static shell. Browser validation is recorded per release and does not certify the full support target.

## Development data

Use synthetic household text only. Never copy private family messages, health details, credentials, or real household history into test fixtures, screenshots, bug reports, or logs. Local test data can be removed through the browser's site-data controls for the local origin. Kin does not include a reset command that could accidentally remove household data.

## v0.5.0 Pulse

Pulse uses the established build/run scripts and complete regression runner. No runtime dependency or parent-level build changes. See [V0.5.0](V0.5.0.md).

## v0.6.0 Since You Last Looked

Catch-up behavior is local to the browser installation and uses the canonical event store plus the existing WASM build and browser regression workflows. Use synthetic test events only; do not put real household history into fixtures or diagnostics. The v0.6 browser suite exercises cursor races, reload, keyboard/focus, content-free tab invalidation, and accessibility modes. No additional runtime dependency or parent-level build change is required. See [V0.6.0](V0.6.0.md).
