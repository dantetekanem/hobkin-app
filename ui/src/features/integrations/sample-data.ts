import type { ConfiguredServer, ServerTool } from '#shared/integrations/types.ts'

/**
 * Made-up servers, so every state of the screen can be seen before the host reads Pi's configuration
 * (023-integrations, S3). Nothing here comes from a real configuration, and no value in it is a real one.
 */

const HOME_TOOLS: ServerTool[] = [
  { name: 'GetLiveContext', does: 'Reads the state of the exposed devices', effect: 'reads' },
  { name: 'GetDateTime', does: 'Reads the date and time', effect: 'reads' },
  { name: 'HassTurnOn', does: 'Turns a device on', effect: 'changes' },
  { name: 'HassTurnOff', does: 'Turns a device off', effect: 'changes' },
  { name: 'HassLightSet', does: 'Sets the brightness or color of a light', effect: 'changes' },
  { name: 'HassBroadcast', does: 'Says a message on the speakers', effect: 'changes' },
]

export const SAMPLE_SERVERS: readonly ConfiguredServer[] = [
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
  { name: 'tickets', entry: { url: 'https://tickets.example.com/mcp' }, state: 'sign-in', tools: [], error: null },
  {
    name: 'home-assistant',
    entry: { url: 'http://homeassistant.local:8123/api/mcp' },
    state: 'connected',
    tools: HOME_TOOLS,
    error: null,
  },
  { name: 'wiki', entry: { url: 'https://wiki.example.com/mcp' }, state: 'failed', tools: [], error: 'Request timed out after 60 seconds.' },
  { name: 'archive', entry: { url: 'https://archive.example.com/mcp', enabled: false }, state: 'off', tools: [], error: null },
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

/** Routines that use each server, by its name. */
const SAMPLE_ROUTINES: Record<string, string[]> = {
  'home-assistant': ['Leaving home'],
  tickets: ['Standup notes'],
  wiki: ['Weekly review'],
  docs: ['Release notes check'],
}

export function sampleRoutines(id: string): string[] {
  return SAMPLE_ROUTINES[id] ?? []
}

/** What a sample server reports once it connects, for one that had no tools yet. */
export function sampleToolsOf(name: string): ServerTool[] {
  return SAMPLE_SERVERS.find((server) => server.name === name)?.tools ?? [{ name: 'search', does: 'Searches it', effect: 'reads' }]
}
