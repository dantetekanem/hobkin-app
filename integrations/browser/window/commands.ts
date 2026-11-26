import { runnerFor } from '@/integration/commands.ts'
import manifest from '../integration.ts'
import type { BrowserResults } from '../protocol.ts'

/** The browser's own commands, typed from its manifest. */
export const run = runnerFor<BrowserResults>()(manifest)
