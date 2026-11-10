import { create } from 'zustand'
import { catalogMatch } from '#shared/integrations/servers.ts'
import type { CatalogEntry, ConfiguredServer, ServerTool } from '#shared/integrations/types.ts'
import { begin, outcomeOf, remove, retry, settle, signIn, toolsOf, turnOff, turnOn, type Outcome } from './changes.ts'
import { SAMPLE_SERVERS } from './sample-data.ts'

/**
 * The Integrations screen's servers, on sample data. Every action changes this store only, so each one can be
 * seen and felt before the host reads and writes Pi's configuration (023-integrations, S3 and S4).
 * Nothing is saved: a reload brings the sample back.
 */

/** How long a sample connection takes, so connecting can be seen. */
const CONNECTING_MS = 1600

interface IntegrationsState {
  servers: ConfiguredServer[]
  /** Starts connecting a catalog service. Returns the new server's name, or null when it cannot be added. */
  connect: (entry: CatalogEntry, values: Readonly<Record<string, string>>) => string | null
  signIn: (name: string) => void
  retry: (name: string) => void
  turnOff: (name: string) => void
  turnOn: (name: string) => void
  remove: (name: string) => void
}

export const useIntegrations = create<IntegrationsState>()((set, get) => {
  const finish = (name: string, outcome: Outcome, tools: readonly ServerTool[]) => {
    setTimeout(() => set({ servers: settle(get().servers, name, outcome, tools) }), CONNECTING_MS)
  }
  /** The tools a server had, or the ones its maker names. */
  const toolsFor = (name: string): ServerTool[] => {
    const server = get().servers.find((candidate) => candidate.name === name)
    if (!server) return []
    return server.tools.length > 0 ? server.tools : toolsOf(catalogMatch(server))
  }

  return {
    servers: [...SAMPLE_SERVERS],
    connect: (entry, values) => {
      const begun = begin(get().servers, entry, values)
      if (!begun) return null
      set({ servers: begun.servers })
      finish(begun.name, outcomeOf(entry), toolsOf(entry))
      return begun.name
    },
    signIn: (name) => {
      set({ servers: signIn(get().servers, name) })
      finish(name, 'connected', toolsFor(name))
    },
    retry: (name) => {
      set({ servers: retry(get().servers, name) })
      finish(name, 'connected', toolsFor(name))
    },
    turnOff: (name) => set({ servers: turnOff(get().servers, name) }),
    turnOn: (name) => {
      set({ servers: turnOn(get().servers, name) })
      finish(name, 'connected', toolsFor(name))
    },
    remove: (name) => set({ servers: remove(get().servers, name) }),
  }
})
