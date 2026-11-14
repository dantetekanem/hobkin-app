import type { ExtensionsState, PiPackage } from '#shared/pi-resources/wire.ts'

/** How long Pi's check for updates stays fresh. Opening the page again within it does not ask the registries again. */
export const UPDATES_FRESH_MS = 10 * 60_000

/** Whether opening the page should ask Pi to check for updates: none was made in the last ten minutes, and none is under way. */
export function needsUpdateCheck(state: ExtensionsState | null, now: number): boolean {
  if (!state || state.updates.checking) return false
  return state.updates.checkedAt === null || now - Date.parse(state.updates.checkedAt) > UPDATES_FRESH_MS
}

/** What a package's card says about updates, from what Pi's check found and what Pi never checks. */
export function updateLine(pkg: PiPackage, checking: boolean): { text: string; tone: 'ok' | 'warn' | 'quiet' } {
  if (!pkg.installed) return { text: 'Not installed yet. Pi installs it when it next starts.', tone: 'warn' }
  if (pkg.kind === 'local') return { text: 'A folder on this Mac. Pi does not check it for updates.', tone: 'quiet' }
  if (pkg.pinned) return { text: pkg.kind === 'npm' && pkg.version ? `Pinned to ${pkg.version}. Pi does not update it.` : 'Pinned to one version. Pi does not update it.', tone: 'quiet' }
  if (pkg.update === 'available') return { text: 'Update available. pi update --extensions installs it.', tone: 'ok' }
  if (checking) return { text: 'Checking for an update', tone: 'quiet' }
  if (pkg.update === 'none') return { text: 'No update found.', tone: 'quiet' }
  return { text: 'Not checked yet.', tone: 'quiet' }
}
