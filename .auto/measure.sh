#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check .auto/browser.mjs
if [[ "${TRIAGE_CHECK:-0}" == "1" ]]; then
  node .auto/triage-bench.mjs > .auto/out/triage-comparison.log
fi
node .auto/browser.mjs
