import { BACKUP_LIMIT_MAX, type BackupState } from '#shared/backup/types.ts'

/** 1536 -> "1.5 KB". Backups run from kilobytes to tens of gigabytes. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** What the limit field holds, as a limit the host takes, or null when it is not one. */
export function parseLimit(text: string): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null
  const limit = Number(text)
  return limit >= 1 && limit <= BACKUP_LIMIT_MAX ? limit : null
}

/** The line under the switch: what the schedule is doing. */
export function scheduleLine(state: Pick<BackupState, 'config' | 'busy' | 'nextAt'>, now: number): string {
  if (state.busy === 'backup') return 'Backing up now…'
  if (state.busy === 'restore') return 'Restoring…'
  if (!state.config.enabled) return 'Automatic backup is off. Back up now still works.'
  if (state.nextAt === null) return 'Waiting for the schedule.'
  const minutes = Math.round((state.nextAt - now) / 60_000)
  if (minutes <= 0) return 'The next backup starts any moment.'
  if (minutes < 60) return `The next backup runs in ${minutes} minute${minutes === 1 ? '' : 's'}.`
  const hours = Math.round(minutes / 60)
  return `The next backup runs in about ${hours} hour${hours === 1 ? '' : 's'}.`
}

/**
 * Why a restore must wait, or null: a restore swaps hobkin's records under it, so it waits while hobkin answers and
 * while any run is going or waiting, the way the host waits before it restarts.
 */
export function restoreWaitsFor(snapshot: { busy?: boolean; runs?: readonly { title: string; state: string }[] }): string | null {
  if (snapshot.busy) return 'hobkin is answering. Restore once it is done.'
  const going = (snapshot.runs ?? []).filter(({ state }) => ['running', 'queued', 'cancelling'].includes(state))
  if (going.length === 0) return null
  return `${going[0]!.title}${going.length > 1 ? ` and ${going.length - 1} more` : ''} ${going.length > 1 ? 'are' : 'is'} running. Restore once nothing runs.`
}

/** The word the user types to confirm a restore. */
export const RESTORE_WORD = 'restore'
export const confirmsRestore = (typed: string): boolean => typed.trim().toLowerCase() === RESTORE_WORD
