import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('a reply to an action item carries the item to hobkin, as a reply to a report does', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const prompts: string[] = []
  const host = await hostFor(t, { root, scripted: { reply: ({ prompt }) => (prompts.push(prompt), { text: 'I can fix that.' }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  const item = {
    id: 'waiting:yours:approval-1',
    title: 'Fix what "Keep model registry refresh on file storage" broke',
    body: 'Shipping approval · rpsleague\nReturn HTTP 400 for conflicting client-IP headers.',
  }
  await client.run('conversation.send', { text: 'Do it with work mode off.', item })
  const replied = await client.until((now) => now.snapshot.busy === false && now.messages.length === 2, 'the reply')

  // hobkin gets the item ahead of the words, the way it gets a report.
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /<hobkin-report>[\s\S]*"title":"Action item: Fix what[\s\S]*Return HTTP 400 for conflicting client-IP headers\.[\s\S]*<\/hobkin-report>[\s\S]*Do it with work mode off\.$/)
  // The conversation shows the words and what they were about, not the item itself.
  assert.deepEqual(
    replied.messages.map(({ role, content, about }) => [role, content, about]),
    [
      ['user', 'Do it with work mode off.', `Action item: ${item.title}`],
      ['assistant', 'I can fix that.', undefined],
    ],
  )

  // A message is about one thing at a time.
  const both = await client.command('conversation.send', { text: 'And this?', item, report: 'r1' })
  assert.equal(!both.ok && both.error.code, 'invalid-arguments')
})
