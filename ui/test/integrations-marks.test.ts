import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG } from '#shared/integrations/catalog.ts'
import { serviceMark } from '../src/features/integrations/marks.ts'

test('GitHub keeps its mark outside the MCP catalog, and no catalog service takes its hue', () => {
  const github = serviceMark('github')
  assert.deepEqual(github, { symbol: 'Gh', hue: 162 })
  for (const entry of CATALOG) assert.notEqual(serviceMark(entry.id).hue, github.hue, entry.id)
})
