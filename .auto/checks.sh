#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm typecheck > .auto/out/typecheck.log 2>&1 || { tail -80 .auto/out/typecheck.log; exit 1; }
node --test ui/test/conversation.test.ts ui/test/conversation-draft.test.ts ui/test/markdown.test.ts ui/test/reports.test.ts ui/test/reports-host.test.ts ui/test/reports-keys.test.ts ui/test/routines-timeline.test.ts ui/test/routines-sky.test.ts ui/test/routines-rules.test.ts ui/test/routines-host.test.ts > .auto/out/checks.log 2>&1 || { tail -80 .auto/out/checks.log; exit 1; }
git diff --check
