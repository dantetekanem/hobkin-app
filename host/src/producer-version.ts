import { readFileSync } from 'node:fs'
import { producerVersion } from '#shared/agent-message.ts'

// This module is loaded with Reviews at host startup. Never re-read a later on-disk version for a saved job.
function clientVersion(): string | null {
  try {
    const metadata: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    return producerVersion(metadata && typeof metadata === 'object' && 'version' in metadata ? metadata.version : null)
  } catch {
    return null
  }
}

/** Client-owned generation, not the separately versioned hobkin core or the model it asks. */
export const CLIENT_PRODUCER_VERSION = clientVersion()
