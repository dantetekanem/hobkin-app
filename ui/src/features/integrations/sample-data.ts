import { catalogEntry } from '#shared/integrations/catalog.ts'
import { fillEntry } from '#shared/integrations/entry.ts'
import type { ConfiguredServer, PiServerEntry, ServerTool } from '#shared/integrations/types.ts'
import { toolsOf } from './changes.ts'

/**
 * Made-up servers, so every state of the screen can be seen before the host reads Pi's configuration
 * (023-integrations, S3). Nothing here comes from a real configuration, and no value in it is a real one.
 */

function fromCatalog(id: string, values: Record<string, string> = {}): PiServerEntry {
  return fillEntry(catalogEntry(id)!.entry, values)
}

function catalogTools(id: string): ServerTool[] {
  return toolsOf(catalogEntry(id))
}

/** A client ID that is plainly not a real one. */
const SAMPLE_GOOGLE_CLIENT = 'sample-client.apps.googleusercontent.com'

const HOME_TOOLS: ServerTool[] = [
  { name: 'GetLiveContext', does: 'Reads the state of the exposed devices', effect: 'reads' },
  { name: 'GetDateTime', does: 'Reads the date and time', effect: 'reads' },
  { name: 'HassTurnOn', does: 'Turns a device on', effect: 'changes' },
  { name: 'HassTurnOff', does: 'Turns a device off', effect: 'changes' },
  { name: 'HassLightSet', does: 'Sets the brightness or color of a light', effect: 'changes' },
  { name: 'HassBroadcast', does: 'Says a message on the speakers', effect: 'changes' },
]

export const SAMPLE_SERVERS: readonly ConfiguredServer[] = [
  { name: 'github', entry: fromCatalog('github'), state: 'connected', tools: catalogTools('github'), error: null },
  {
    name: 'docs',
    entry: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' }, description: 'Search and read the product documentation' },
    state: 'connected',
    tools: [
      { name: 'search', does: 'Searches the documentation', effect: 'reads' },
      { name: 'read_page', does: 'Reads a page', effect: 'reads' },
    ],
    error: null,
  },
  { name: 'gmail', entry: fromCatalog('gmail', { 'google-client-id': SAMPLE_GOOGLE_CLIENT }), state: 'connected', tools: catalogTools('gmail'), error: null },
  {
    name: 'google-calendar',
    entry: fromCatalog('google-calendar', { 'google-client-id': SAMPLE_GOOGLE_CLIENT }),
    state: 'connected',
    tools: catalogTools('google-calendar'),
    error: null,
  },
  { name: 'linear', entry: fromCatalog('linear'), state: 'sign-in', tools: [], error: null },
  {
    name: 'home-assistant',
    entry: fromCatalog('home-assistant', { address: 'http://homeassistant.local:8123' }),
    state: 'connected',
    tools: HOME_TOOLS,
    error: null,
  },
  { name: 'notion', entry: fromCatalog('notion'), state: 'failed', tools: [], error: 'Request timed out after 60 seconds.' },
  { name: 'stripe', entry: { ...fromCatalog('stripe'), enabled: false }, state: 'off', tools: [], error: null },
  {
    name: 'filesystem',
    entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    state: 'connected',
    tools: [
      { name: 'read_text_file', does: 'Reads a file', effect: 'reads' },
      { name: 'list_directory', does: 'Lists a folder', effect: 'reads' },
      { name: 'search_files', does: 'Finds files by name', effect: 'reads' },
      { name: 'write_file', does: 'Writes a file', effect: 'changes' },
      { name: 'edit_file', does: 'Edits a file', effect: 'changes' },
      { name: 'move_file', does: 'Moves or renames a file', effect: 'changes' },
    ],
    error: null,
  },
]

/** Routines that use each service, by the service's catalog id or the server's name. */
const SAMPLE_ROUTINES: Record<string, string[]> = {
  github: ['Morning recap', 'Dependency watch'],
  gmail: ['Morning recap', 'Inbox sweep'],
  'google-calendar': ['Morning recap', 'Week ahead'],
  'home-assistant': ['Leaving home'],
  linear: ['Standup notes'],
  notion: ['Weekly review'],
  docs: ['Release notes check'],
}

export function sampleRoutines(id: string): string[] {
  return SAMPLE_ROUTINES[id] ?? []
}
