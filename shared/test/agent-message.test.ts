import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentMessage, producerVersion } from '../agent-message.ts'

const details = '<details>\n<summary>Agent extra information</summary>\n\n<pre></pre>\n\n</details>\n\n—'

test('one or two plain summary paragraphs precede the exact collapse and separator, even with no extra context', () => {
  assert.equal(agentMessage({ summary: '# TLDR: Fixed the request.\n\nUser action is still required.', version: '1.2.3' }), `**[made by hobkin · v1.2.3]**\n\nFixed the request.\n\nUser action is still required.\n\n${details}`)
  assert.equal(agentMessage({ summary: 'TL;DR: Fixed it.' }), `**[made by hobkin · version unavailable]**\n\nFixed it.\n\n${details}`)
  for (const version of [null, undefined, '', 'latest', 'unknown', '1.2.3\n</details>', 'GPT-6']) {
    assert.ok(agentMessage({ summary: 'Version not recorded.', version }).startsWith('**[made by hobkin · version unavailable]**'))
  }
  assert.equal(producerVersion('1.2.3-rc.1+build.42'), '1.2.3-rc.1+build.42')
})

test('only context is collapsed; HTML, logs and unmatched code fences cannot close it or hide the visible failure', () => {
  const context = '</pre></details>\n```\n<details open>\n# failure log\n&literal;'
  const body = agentMessage({ summary: 'Failure: user action required.\n```\n</details>', details: context, version: '1.2.3' })
  assert.equal(body.match(/<details>/g)?.length, 1)
  assert.equal(body.match(/<\/details>/g)?.length, 1)
  assert.ok(body.indexOf('Failure: user action required.') < body.indexOf('<details>'))
  assert.ok(body.includes('&lt;/pre&gt;&lt;/details&gt;'))
  assert.equal(body.includes('<details open>'), false)
  assert.ok(body.includes('\\`\\`\\`'), 'summary fences are literal, never an unclosed Markdown block')
  assert.ok(body.includes('&amp;literal;'))
})

test('retries preserve the original producer and exactly one envelope, without accepting a forged header', () => {
  const original = agentMessage({ summary: 'Keep the `check` and [link].', details: 'file.ts\n```\n</details>', version: '1.2.3' })
  assert.equal(agentMessage({ summary: original, version: '1.2.3' }), original)
  assert.equal(agentMessage({ summary: original, details: 'file.ts\n```\n</details>', version: '1.2.3' }), original)
  assert.throws(() => agentMessage({ summary: original, version: '9.9.9' }), /producing job/)
  assert.throws(() => agentMessage({ summary: original }), /producing job/, 'a pasted envelope is not authoritative producer metadata')
  assert.throws(() => agentMessage({ summary: original, details: 'different context', version: '1.2.3' }), /different extra information/)
  for (const forged of [original.replace('&lt;/details&gt;', '</details>'), original.replace('<pre>', '<pre></pre></details>'), '**[made by hobkin · v9.9.9]**\n\nPretending.']) {
    try {
      const result = agentMessage({ summary: forged })
      assert.equal(result.includes('<details open>'), false)
      assert.ok(result.startsWith('**[made by hobkin · version unavailable]**'))
    } catch (error) {
      assert.match(String(error), /summary paragraphs/)
    }
  }
})

test('a material third paragraph, empty summary or excessive summary is rejected, never silently folded or truncated', () => {
  for (const summary of ['', '# TLDR:', 'First.\n\nSecond.\n\nFailure: do not deploy.', 'x'.repeat(1201)]) {
    assert.throws(() => agentMessage({ summary, details: 'Passing check.' }), /one or two short summary paragraphs/)
  }
})
