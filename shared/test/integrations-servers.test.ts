import assert from 'node:assert/strict'
import { test } from 'node:test'
import { targetOf, toolEffect } from '../integrations/servers.ts'

test('a server is shown by its address or by its command line, with references left as references', () => {
  assert.deepEqual(targetOf({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } }), { kind: 'remote', text: 'https://example.com/mcp' })
  assert.deepEqual(targetOf({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] }), { kind: 'command', text: 'npx -y @modelcontextprotocol/server-filesystem .' })
  assert.deepEqual(targetOf({ command: 'uvx' }), { kind: 'command', text: 'uvx' })
})

test('a tool counts as changing unless its server says it only reads', () => {
  assert.equal(toolEffect({ readOnlyHint: true }), 'reads')
  assert.equal(toolEffect({ readOnlyHint: false }), 'changes')
  assert.equal(toolEffect({}), 'changes', 'no hint is treated as the riskier case')
  assert.equal(toolEffect(undefined), 'changes')
  assert.equal(toolEffect({ readOnlyHint: true, destructiveHint: true }), 'changes', 'a tool that says both is not trusted to only read')
})
