import type { ConfiguredServer } from './types.ts'

/**
 * Integrations as the host reads them from Pi, the way they travel to the UI: every server in Pi's user-level
 * configuration, with the state Pi reports for it. Entries and messages arrive with every secret already hidden
 * (redact.ts). See _specs/023-integrations.
 */
export interface IntegrationsState {
  /** The configuration file Pi reads, with the home folder written as ~. Null until the host has looked. */
  path: string | null
  /** In the order of the file. A server that is still being checked is `connecting`. */
  servers: ConfiguredServer[]
  /** What Pi could not read in the file, in its own words: an entry it skipped, or a file that is not JSON. */
  problems: string[]
  /** A look at the servers is under way. */
  checking: boolean
  /** When the servers were last checked, as an ISO time. Null before the first look. */
  checkedAt: string | null
  /** What kept the host from reading Pi's configuration at all, or null. */
  error: string | null
}

/** Before the host has looked. A host sends it from the start, so a UI can tell it reads Pi's configuration. */
export const INTEGRATIONS_UNKNOWN: IntegrationsState = { path: null, servers: [], problems: [], checking: false, checkedAt: null, error: null }
