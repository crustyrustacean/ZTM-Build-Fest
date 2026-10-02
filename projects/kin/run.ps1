$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $projectRoot 'build-wasm.ps1')
Write-Host 'WASM build succeeded.'
$webRoot = Join-Path $projectRoot 'web'
Write-Host 'Serving Kin at http://localhost:8000. Press Ctrl+C to stop.'
py -3 -m http.server -b 127.0.0.1 -d $webRoot 8000
