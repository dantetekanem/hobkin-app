import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultUrlTransform } from 'react-markdown'
import { keepSlackLinks } from '../src/features/viewer/slack-links.ts'

test('a slack link keeps its address, and no other address is widened', () => {
  const transform = keepSlackLinks(defaultUrlTransform)
  assert.equal(transform('slack://channel?team=T1&id=C1'), 'slack://channel?team=T1&id=C1')
  assert.equal(transform('SLACK://open'), 'SLACK://open')
  assert.equal(transform('https://example.invalid/a'), 'https://example.invalid/a')
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'slackx://a', 'slack:javascript:1']) assert.equal(transform(url), '', url)
})
