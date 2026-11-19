import assert from 'node:assert/strict'
import { test } from 'node:test'
import { utf8Bytes } from '../src/features/settings/directions.ts'

test('the byte count matches what the host saves, for every width of character', () => {
  const samples = [
    '',
    'Be brief.\n',
    'Café, naïve, ü',
    '日本語の指示',
    'Emoji 🦊 and 👩‍💻 joined',
    'a lone high \ud83e and a lone low \udd8a, and a pair in the wrong order \udd8a\ud83e',
    'ends on a high surrogate \ud83e',
  ]
  for (const text of samples) assert.equal(utf8Bytes(text), Buffer.byteLength(text, 'utf8'), JSON.stringify(text))
})
