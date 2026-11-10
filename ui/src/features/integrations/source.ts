import type { ConfiguredServer } from '#shared/integrations/types.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'

/**
 * Where the screen's servers come from. With a host, only what it read from Pi's configuration: the sample is never
 * mixed in, and a host that does not read Pi shows none. Without a host, the sample, labelled as such.
 */
export function shownServers({ live, pi, sample }: { live: boolean; pi: IntegrationsState | null; sample: readonly ConfiguredServer[] }): readonly ConfiguredServer[] {
  return live ? (pi?.servers ?? []) : sample
}

/** How long a look at the servers stays fresh. Opening the screen again within it does not connect to them again. */
export const FRESH_MS = 60_000

/** Whether opening the screen should look at the servers: the host reads them, no look is under way, and none was made in the last minute. */
export function needsLook(pi: IntegrationsState | null, now: number): boolean {
  if (!pi || pi.checking) return false
  return pi.checkedAt === null || now - Date.parse(pi.checkedAt) > FRESH_MS
}
