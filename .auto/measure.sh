#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check .auto/browser.mjs
node .auto/browser.mjs
