import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { hashLines, lineCount, sliceLines, splitLines } from '../review/lines.ts'
import { sha256 } from '../review/sha256.ts'

const trusted = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

test('sha256 matches the platform digest for empty, short, long and non-ASCII text', () => {
  const samples = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(1000),
    'hobkin is thinking…',
    'astral 🙂 and combining é',
    'lone surrogate \ud83d end',
    'x'.repeat(100_000),
  ]
  for (const sample of samples) assert.equal(sha256(sample), trusted(sample), JSON.stringify(sample.slice(0, 24)))
})

// Ported from pi-coder's workbench target tests: an anchor hashes the exact characters of its lines.
test('an anchor covers the exact characters of its lines, whatever the line endings', () => {
  const cases = [
    { name: 'byte order mark', text: '﻿first\nsecond', range: [1, 1], slice: '﻿first' },
    { name: 'mixed separators', text: 'one\r\ntwo\rthree\nfour', range: [1, 3], slice: 'one\r\ntwo\rthree' },
    { name: 'the empty line after a final newline', text: 'one\n', range: [2, 2], slice: '' },
    { name: 'an empty file', text: '', range: [1, 1], slice: '' },
    { name: 'astral characters', text: '🙂\nend', range: [1, 1], slice: '🙂' },
  ] as const
  for (const { name, text, range, slice } of cases) {
    assert.equal(sliceLines(text, range[0], range[1]), slice, name)
    assert.equal(hashLines(text, range[0], range[1]), trusted(slice), name)
  }
})

test('lines are counted and split the way a diff shows them', () => {
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('one\ntwo\n'), ['one', 'two'])
  assert.deepEqual(splitLines('one\r\ntwo'), ['one', 'two'])
  assert.deepEqual(splitLines('one\n\n'), ['one', ''])
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('one\ntwo\n'), 2)
  assert.equal(lineCount('one\ntwo'), 2)
})
