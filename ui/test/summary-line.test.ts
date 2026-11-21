import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summaryLine } from '../src/lib/summary-line.ts'

test("an agent's long Markdown message reads as its first plain line", () => {
  const message = [
    '## Finboard #64 — read-only consumer inventory',
    '**Cutover blockers:** Redirecting HTTP now would break three active bearer-key paths.',
    '| Consumer | Current evidence |',
    '|---|---|',
  ].join('\n')
  assert.equal(summaryLine(message), 'Finboard #64 — read-only consumer inventory')
})

test('a long first line ends at its first sentence, or at a word with an ellipsis', () => {
  assert.equal(summaryLine('Ran the **tests** in `bin/test`. Then I looked at the [logs](https://x.invalid) for a while.'), 'Ran the tests in bin/test.')
  const long = `${'word '.repeat(60)}end`
  const line = summaryLine(long) ?? ''
  assert.ok(line.length <= 140, `${line.length} characters`)
  assert.ok(line.endsWith('…'))
  assert.equal(line.includes('wor…'), false, 'never inside a word')
})

test('rules, blank lines and table rows are skipped, and nothing telling gives nothing', () => {
  assert.equal(summaryLine('\n---\n|---|---|\n\n- Checked the queue: nothing waits.'), 'Checked the queue: nothing waits.')
  assert.equal(summaryLine('  \n---\n'), undefined)
})
