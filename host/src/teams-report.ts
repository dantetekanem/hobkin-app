import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The whole report of a pi-extended-teams agent that came back in a group (046-teams-layer): the group's own message
 * names only where teams keeps it, `~/.pi/agent/reports/<session>/<file>` (teams' `writeStandaloneReport`). The
 * registry lets through a session's folder name and a report file's name and nothing else, so no path leaves that folder.
 */

/** The most of a report the window is sent. */
const MOST_BYTES = 512 * 1024

export const defaultReportsDir = () => join(homedir(), '.pi', 'agent', 'reports')

export function teamsReportHandlers({ reports = defaultReportsDir }: { reports?: () => string } = {}): Pick<HostHandlers, 'teams.report'> {
  return {
    'teams.report': async ({ team, file }) => {
      const path = join(reports(), team, file)
      try {
        const { size, isFile } = await stat(path).then((found) => ({ size: found.size, isFile: found.isFile() }))
        if (!isFile) return null
        if (size > MOST_BYTES) throw new Unavailable(`The report is ${Math.round(size / 1024)} KB, more than the window is sent.`)
        return { text: await readFile(path, 'utf8') }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
  }
}
