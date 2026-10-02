# Development Workflow

**Status:** intended future workflow. Kin is currently documentation-only; there is no Cargo manifest, source tree, build command, server, or runnable app. The sequence below is a plan, not an executable setup guide.

## Planned setup

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
serve the static web files from localhost
        |
        v
open the supported browser and exercise v0.1.0
```

The exact commands will be added only after the implementation layout and build process exist. Never run Cargo from the Build Fest repository root for Kin; manifests and generated artifacts belong under `projects/kin/`.

## First-class operating systems

Windows, macOS, and Linux are intended development environments. Documentation and future scripts must not assume Bash, GNU-only utilities, POSIX path syntax, or a Unix package manager. Prefer Cargo/rustup and portable project commands. Where a command differs, show native PowerShell and shell equivalents rather than forcing developers to install a compatibility shell.

Windows developers should be able to use PowerShell and standard Rust tooling. macOS and Linux developers should be able to use their standard shells and rustup. Compiler/browser differences should be captured in issue reports with OS and version details.

## Intended minimal tools

- Rust toolchain (`rustup`, `cargo`) and the `wasm32-unknown-unknown` target
- A modern browser with the platform APIs in [IMPLEMENTATION](IMPLEMENTATION.md)
- A lightweight static-file server bound to localhost during development
- Optional system Python for serving static files (`py -m http.server` on Windows or `python3 -m http.server` on macOS/Linux); this is not an application dependency

No npm dependency tree or framework runtime is planned. If static serving later requires a helper, prefer a minimal cross-platform option with a clear security/update story.

## Browser capabilities

The intended baseline is specified in [IMPLEMENTATION](IMPLEMENTATION.md): WebAssembly, ES modules, Custom Elements, IndexedDB, CustomEvent, text encoders/decoders, and secure-context browser APIs. WebAuthn and Web Crypto for content security belong to later identity/sync work, not v0.1.0 authentication or encryption. Record exact browser and OS versions actually tested when implementation starts; the support target is not a current compatibility claim.

## Development data

Use synthetic household text only. Never copy private family messages, health details, credentials, or real household history into test fixtures, screenshots, bug reports, or logs. Once a local prototype exists, document a deliberate reset procedure that clearly removes only the developer's local test household and never points at production data. No reset command or storage implementation exists today.
