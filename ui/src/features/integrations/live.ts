import { useEffect, useMemo, useRef } from 'react'
import type { CatalogEntry, ConfiguredServer } from '#shared/integrations/types.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import { runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { shouldLookAtServers, shownServers } from './source.ts'
import { useIntegrations } from './store.ts'

/** What the screen draws, and where it came from. */
export interface Servers {
  /** A host is connected. What is shown is what it read from Pi, and every action changes Pi's configuration through it. */
  live: boolean
  servers: readonly ConfiguredServer[]
  /** The host's reading of Pi's configuration. Null on sample data, and from a host that does not read Pi. */
  pi: IntegrationsState | null
}

export function useServers(): Servers {
  const live = useHasHost()
  const pi = useHost((state) => state.integrations)
  const sample = useIntegrations((state) => state.servers)
  return useMemo(() => ({ live, pi: live ? pi : null, servers: shownServers({ live, pi, sample }) }), [live, pi, sample])
}

/** What the screen can do. Each rejects with the reason it did not happen, in words the screen shows. */
export interface IntegrationActions {
  connect(entry: CatalogEntry, values: Record<string, string>): Promise<void>
  signIn(name: string): Promise<void>
  retry(name: string): Promise<void>
  turnOff(name: string): Promise<void>
  turnOn(name: string): Promise<void>
  remove(name: string): Promise<void>
  /** Reads Pi's configuration again and looks at every server. Nothing to do on sample data. */
  refresh(): Promise<void>
}

/** On sample data the actions change the screen's own store, so each can be seen before a host is there. */
const sampleActions: IntegrationActions = {
  connect: async (entry, values) => {
    if (!useIntegrations.getState().connect(entry, values)) throw Error(`${entry.name} could not be added.`)
  },
  signIn: async (name) => useIntegrations.getState().signIn(name),
  retry: async (name) => useIntegrations.getState().retry(name),
  turnOff: async (name) => useIntegrations.getState().turnOff(name),
  turnOn: async (name) => useIntegrations.getState().turnOn(name),
  remove: async (name) => useIntegrations.getState().remove(name),
  refresh: async () => {},
}

/**
 * With a host, each action is a command the host carries out through Pi's own code, and the screen redraws from what
 * the host then reports. Signing in happens in a terminal, with `pi mcp login`, so here it means looking again.
 */
const hostActions: IntegrationActions = {
  connect: async (entry, values) => {
    await runCommand('integrations.add', { service: entry.id, ...(Object.keys(values).length > 0 ? { values } : {}) })
  },
  signIn: async () => {
    await runCommand('integrations.refresh')
  },
  retry: async () => {
    await runCommand('integrations.refresh')
  },
  turnOff: async (name) => {
    await runCommand('integrations.turn-off', { name })
  },
  turnOn: async (name) => {
    await runCommand('integrations.turn-on', { name })
  },
  remove: async (name) => {
    await runCommand('integrations.remove', { name })
  },
  refresh: async () => {
    await runCommand('integrations.refresh')
  },
}

export const actionsFor = (live: boolean): IntegrationActions => (live ? hostActions : sampleActions)

/**
 * Looks at Pi's servers once per connection when nothing has been read, for a screen that shows them without being
 * the Integrations screen. The host reads Pi only when asked, so until someone asks its state is empty and a
 * dashboard built from it is incomplete.
 */
export function useLookAtServers(): void {
  const connected = useHost((state) => state.home !== null && state.link === 'open')
  const pi = useHost((state) => state.integrations)
  const looked = useRef(false)
  useEffect(() => {
    if (!connected) looked.current = false
    else if (shouldLookAtServers({ connected, asked: looked.current, pi, now: Date.now() })) {
      looked.current = true
      void runCommand('integrations.refresh').catch(() => {})
    }
  }, [connected, pi])
}
