import { randomUUID } from 'node:crypto'
import type { AppStateRead } from '#shared/commands/registry.ts'
import type { OwnerState } from '#shared/protocol/messages.ts'
import { withoutNothingNew } from '#shared/reports/nothing-new.ts'
import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { Unavailable, type HostHandlers } from './commands.ts'

interface ReadableApp {
  runtime: { main: unknown }
  refresh(): Promise<HobkinSnapshot>
}
interface AppReadOptions {
  root: string
  owner: { state: OwnerState; app: ReadableApp | null; snapshot: HobkinSnapshot | null }
  revision(): number
}

const sessionId = (main: unknown): string | null => {
  if (!main || typeof main !== 'object' || !('sessionId' in main)) return null
  return typeof main.sessionId === 'string' && main.sessionId.length > 0 ? main.sessionId : null
}
const count = (rows: unknown): number | null => Array.isArray(rows) ? rows.length : null
const boolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null

/** Only reads the current owner's projection. No loader, restart, config or process controls. */
export function appStateHandlers({ root, owner, revision }: AppReadOptions): HostHandlers {
  const identities = new WeakMap<ReadableApp, string>()
  const read = async (command: 'app.state' | 'app.refresh'): Promise<AppStateRead> => {
    const operation = { id: randomUUID(), command, requestedAt: Date.now() }
    const app = owner.app
    if (owner.state.state !== 'live' || !app) throw new Unavailable('App information needs a live owner.')
    const main = app.runtime.main, session = sessionId(main)
    if (!session) throw new Unavailable('The current main session identity is unknown.')
    const snapshot = command === 'app.refresh' ? await app.refresh() : owner.snapshot
    if (owner.state.state !== 'live' || owner.app !== app || app.runtime.main !== main || sessionId(main) !== session) {
      throw new Unavailable('The app owner or main session changed during this read. Its result is stale.')
    }
    if (!snapshot) throw new Unavailable('The current app projection is unavailable.')
    let id = identities.get(app)
    if (!id) { id = randomUUID(); identities.set(app, id) }
    return {
      operation: { ...operation, status: 'completed', completedAt: Date.now() },
      home: root, owner: { state: 'live', id }, sessionId: session,
      loadedRevision: null, stateRevision: revision(),
      counts: {
        messages: count(snapshot.messages), reports: count(Array.isArray(snapshot.reports) ? withoutNothingNew(snapshot.reports) : snapshot.reports), runs: count(snapshot.runs),
        activeRuns: Array.isArray(snapshot.runs) ? snapshot.runs.filter((run) => run?.state === 'running').length : null,
      },
      activity: {
        busy: boolean(snapshot.busy), tooling: boolean(snapshot.tooling),
        doing: typeof snapshot.doing === 'string' ? snapshot.doing.slice(0, 240) : null,
      },
    }
  }
  return { 'app.state': () => read('app.state'), 'app.refresh': () => read('app.refresh') }
}
