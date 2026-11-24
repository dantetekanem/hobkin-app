import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setWindowParts } from '../src/integration/registry.ts'
import { ownMark, serviceMark } from '../src/features/integrations/marks.ts'

test('a full integration has the mark its window part sets, and an MCP server has the one its name gives', () => {
  try {
    setWindowParts([{ manifest: { id: 'acme' }, unknown: null, sample: () => null, mark: { symbol: 'Ac', hue: 40 } } as never])
    assert.deepEqual(serviceMark('acme'), { symbol: 'Ac', hue: 40 })
    assert.deepEqual(serviceMark('notes'), ownMark('notes'))
    assert.equal(ownMark('notes').symbol, 'No')
    assert.equal(ownMark('notes').hue, ownMark('notes').hue, 'the same name keeps the same hue')
  } finally {
    setWindowParts([])
  }
})
