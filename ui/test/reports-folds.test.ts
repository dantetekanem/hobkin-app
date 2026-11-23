import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldsOf, type ReportPart } from '../src/features/reports/folds.ts'
import { plainLine } from '../src/features/reports/report.ts'

const markdown = (text: string): ReportPart => ({ kind: 'markdown', text })
const fold = (summary: string, parts: ReportPart[], open = false): ReportPart => ({ kind: 'fold', summary, open, parts })

test('a details block is a fold with its summary as the label, between the Markdown around it', () => {
  const report = [
    'No new required action or deadline was identified.',
    '',
    '<details><summary>Evidence and limits</summary>',
    '',
    'Official draw data: https://example.invalid/rounds.json',
    '',
    'Detailed evidence: `/notes/2026-11-23.md`',
    '</details>',
    '',
    'Monitoring is complete.',
  ].join('\n')

  assert.deepEqual(foldsOf(report), [
    markdown('No new required action or deadline was identified.'),
    fold('Evidence and limits', [markdown('Official draw data: https://example.invalid/rounds.json\n\nDetailed evidence: `/notes/2026-11-23.md`')]),
    markdown('Monitoring is complete.'),
  ])
})

test('a report with no fold is its Markdown alone', () => {
  assert.deepEqual(foldsOf('# Notes\n\nText.'), [markdown('# Notes\n\nText.')])
  assert.deepEqual(foldsOf(''), [])
})

test('a fold holds another, and one that says open starts open', () => {
  const report = '<details open>\n<summary>Outer</summary>\n\nBefore.\n\n<details><summary>Inner</summary>\n\nDeep.\n\n</details>\n\nAfter.\n\n</details>'

  assert.deepEqual(foldsOf(report), [fold('Outer', [markdown('Before.'), fold('Inner', [markdown('Deep.')]), markdown('After.')], true)])
})

test('a fold with no summary is labelled Details, and a summary keeps its own Markdown', () => {
  assert.deepEqual(foldsOf('<details>\n\nBody.\n\n</details>'), [fold('Details', [markdown('Body.')])])
  assert.deepEqual(foldsOf('<details><summary>What `run` said,\n  in **short**</summary>Body.</details>'), [fold('What `run` said, in **short**', [markdown('Body.')])])
})

test('the tags of a fold written inside code stay the text they are', () => {
  const fenced = 'Write it so:\n\n```html\n<details><summary>More</summary>\nBody\n</details>\n```\n\nDone.'
  const inline = 'Use `<details>` and `</details>` around it.'
  const tilde = '~~~\n<details>\n~~~\n\n</details>'

  for (const report of [fenced, inline, tilde]) assert.deepEqual(foldsOf(report), [markdown(report)])
})

test('a fold that is never closed, a close with no opener, and any other tag stay text', () => {
  for (const report of [
    '<details><summary>Half</summary>\n\nNo end.',
    'Text.\n\n</details>\n\nMore.',
    '<details onclick="steal()"><summary>No</summary>Body</details>',
    '<script>alert(1)</script>\n\n<b>bold</b> and <img src="https://example.invalid/pixel">',
  ]) assert.deepEqual(foldsOf(report), [markdown(report)])
})

test("a failed run's raw error at the end of its report is a fold, whole, whatever the error holds", () => {
  const stack = 'Harness exited (1). Error: boom\n    at tool (file:///tool.js:1:1)'
  assert.deepEqual(foldsOf(`The run failed.\n\n<details><summary>Error details</summary>\n\n\`\`\`text\n${stack}\n\`\`\`\n\n</details>`), [
    markdown('The run failed.'),
    fold('Error details', [markdown(`\`\`\`text\n${stack}\n\`\`\``)]),
  ])

  // A longer fence keeps an error with backticks and a closing tag in it whole.
  const noisy = 'Failed: ```oops```\n</details>\n<details>'
  assert.deepEqual(foldsOf(`Pi crashed.\n\n<details><summary>Error details</summary>\n\n\`\`\`\`text\n${noisy}\n\`\`\`\`\n\n</details>\n`), [
    markdown('Pi crashed.'),
    fold('Error details', [markdown(`\`\`\`\`text\n${noisy}\n\`\`\`\``)]),
  ])
})

test("the list's one line for a report never shows a fold's tags", () => {
  assert.equal(plainLine('<details><summary>Evidence and limits</summary>'), 'Evidence and limits')
  assert.equal(plainLine('</details>'), '')
  assert.equal(plainLine('<details open>'), '')
})
