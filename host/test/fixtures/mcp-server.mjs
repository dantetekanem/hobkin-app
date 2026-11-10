// A small MCP server over stdio, for tests. It answers initialize and tools/list and nothing else, so Pi's own code
// can connect to something on this machine without the network.
// Given `--fail <text>`, or FAKE_MCP_FAIL, it writes that text to stderr and exits at once, as a server that cannot start does.
import { createInterface } from 'node:readline'

const failAt = process.argv.indexOf('--fail')
const fail = process.env.FAKE_MCP_FAIL ?? (failAt === -1 ? undefined : process.argv[failAt + 1])
if (fail) {
  process.stderr.write(`${fail}\n`)
  process.exit(1)
}

const tools = [
  { name: 'search_notes', description: 'Searches the notes. Returns the best matches first.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'write_note', description: 'Writes a note.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
  { name: 'tidy', description: 'Tidies up.\nIt moves old notes away.', inputSchema: { type: 'object' } },
]

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  // Notifications have no id and need no answer.
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1.0.0' } } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools } })
  } else if (message.method === 'ping') {
    send({ id: message.id, result: {} })
  } else {
    send({ id: message.id, error: { code: -32601, message: 'Method not found' } })
  }
})
