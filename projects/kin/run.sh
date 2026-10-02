#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$project_root/build-wasm.sh"
printf '%s\n' 'WASM build succeeded.'
printf '%s\n' 'Serving Kin at http://localhost:8000. Press Ctrl+C to stop.'
exec python3 -m http.server -b 127.0.0.1 -d "$project_root/web" 8000
