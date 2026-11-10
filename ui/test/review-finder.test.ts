import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { findNodes } from '../src/features/review/graph/finder.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const titles = (query: string, limit?: number) => findNodes(sample.nodes, query, limit).map((hit) => sample.nodes.find((node) => node.id === hit.id)!.title)

test('finds a node by the start of its name first, then by a word in it, then anywhere in it', () => {
  // doingAfter starts with the word typed. toolDoing and streamedDoing have it as a word of their name,
  // and short names come before tests named in a whole sentence.
  assert.equal(titles('doing')[0], 'doingAfter')
  assert.deepEqual(titles('doing').slice(1, 3).sort(), ['streamedDoing', 'toolDoing'])
  assert.equal(titles('doing').includes('elapsed'), false, 'what does not match is left out')
  // The humps of a name: wr is workingRow, sd is streamedDoing.
  assert.equal(titles('wr')[0], 'workingRow')
  assert.equal(titles('sd')[0], 'streamedDoing')
  // Letters in order, when nothing better matches.
  assert.equal(titles('dngaftr')[0], 'doingAfter')
})

test('finds a node by its acceptance id, its path or its kind', () => {
  assert.equal(titles('a4')[0], 'A4')
  assert.deepEqual(titles('runtime').sort(), ['connectMain', 'send'])
  assert.deepEqual(new Set(findNodes(sample.nodes, 'context').map((hit) => sample.nodes.find((node) => node.id === hit.id)!.kind)), new Set(['context']))
  assert.equal(findNodes(sample.nodes, 'test', 20).length, 5)
  // Every word typed must match somewhere: in the name, the path or the kind.
  assert.equal(titles('doing tool')[0], 'toolDoing')
  assert.equal(titles('doing tool').includes('elapsed'), false)
})

test('with nothing typed, the list is the graph in reading order', () => {
  assert.deepEqual(titles('', 3), ['A1', 'A2', 'A3'])
  assert.equal(findNodes(sample.nodes, '', 100).length, sample.nodes.length)
  assert.equal(findNodes(sample.nodes, 'zzzz').length, 0)
  // Each hit says where its name matched, so the screen can mark it.
  const hit = findNodes(sample.nodes, 'after')[0]!
  assert.equal(sample.nodes.find((node) => node.id === hit.id)!.title, 'doingAfter')
  assert.deepEqual(hit.marks, [[5, 10]])
})
