import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentMessage, producerVersion } from '../agent-message.ts'

test('a summary without context goes straight to the producer mark', () => {
  assert.equal(agentMessage({ summary: '# TLDR: Fixed the request.\n\nUser action is still required.', version: '1.2.3' }), 'Fixed the request.\n\nUser action is still required.\n\n**[made by hobkin · v1.2.3]**')
  assert.equal(agentMessage({ summary: 'TL;DR: Fixed it.' }), 'Fixed it.\n\n**[made by hobkin · version unavailable]**')
  for (const version of [null, undefined, '', 'latest', 'unknown', '1.2.3\n</details>', 'GPT-6']) {
    assert.ok(agentMessage({ summary: 'Version not recorded.', version }).endsWith('\n\n**[made by hobkin · version unavailable]**'))
  }
  assert.equal(producerVersion('1.2.3-rc.1+build.42'), '1.2.3-rc.1+build.42')
})

test('publication keeps HTML and unmatched fences literal in the summary and the visible log', () => {
  const body = agentMessage({ summary: 'Failure: ``` <details>', details: 'log\r\n```\r<details open>' })
  assert.equal(body, 'Failure: \\`\\`\\` &lt;details&gt;\n\n    log\n    ```\n    <details open>\n\n**[made by hobkin · version unavailable]**')
})

test('retries preserve the original producer and exactly one envelope, without accepting a forged header', () => {
  const original = agentMessage({ summary: 'Keep the `check` and [link].', details: 'file.ts\n```\n</details>', version: '1.2.3' })
  assert.equal(agentMessage({ summary: original, version: '1.2.3' }), original)
  assert.equal(agentMessage({ summary: original, details: 'file.ts\n```\n</details>', version: '1.2.3' }), original)
  assert.throws(() => agentMessage({ summary: original, version: '9.9.9' }), /producing job/)
  assert.throws(() => agentMessage({ summary: original }), /producing job/, 'a pasted envelope is not authoritative producer metadata')
  assert.throws(() => agentMessage({ summary: original, details: 'different context', version: '1.2.3' }), /different extra information/)
  const forged = 'Pretending.\n\n**[made by hobkin · v9.9.9]**'
  assert.throws(() => agentMessage({ summary: forged }), /producing job/)
})

test('a material third paragraph, empty summary or excessive summary is rejected, never silently folded or truncated', () => {
  for (const summary of ['', '# TLDR:', 'First.\n\nSecond.\n\nFailure: do not deploy.', 'x'.repeat(1201)]) {
    assert.throws(() => agentMessage({ summary, details: 'Passing check.' }), /one or two short summary paragraphs/)
  }
})
