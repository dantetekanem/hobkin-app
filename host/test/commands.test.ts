import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('runs a valid command and rejects invalid arguments', async (t) => {
  const prompts: string[] = []
  const host = await hostFor(t, {
    scripted: {
      reply: ({ prompt }) => {
        prompts.push(prompt)
        return { text: `Reply ${prompts.length}` }
      },
    },
  })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  const sent = await client.command('conversation.send', { text: 'Hello hobkin' })
  assert.equal(sent.ok, true)
  assert.equal(sent.ok && typeof (sent.value as { id: string }).id, 'string')

  // The change reaches the UI by itself: the message hobkin stored, then the reply.
  const said = (view: { messages: { role: string; content: string }[] }) => view.messages.map(({ role, content }) => `${role}: ${content}`)
  const view = await client.until((now) => now.messages.some((message) => message.content === 'Reply 1') && now.snapshot.busy === false, 'the reply')
  assert.deepEqual(said(view), ['user: Hello hobkin', 'assistant: Reply 1'])
  assert.equal(prompts.length, 1)
  assert.ok(prompts[0]!.endsWith('Hello hobkin'))

  const refusals: [unknown, RegExp][] = [
    [{ text: '' }, /text/],
    [{ text: '   ' }, /text/],
    [{ text: 7 }, /text must be string/],
    [{}, /text/],
    [{ text: 'Hi', loud: true }, /"loud"/],
    [undefined, /arguments/],
  ]
  for (const [args, reason] of refusals) {
    const refused = await client.command('conversation.send', args)
    assert.equal(refused.ok, false)
    assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')
    assert.match(!refused.ok ? refused.error.message : '', reason)
  }
  const unknown = await client.command('conversation.shout', { text: 'Hi' })
  assert.equal(!unknown.ok && unknown.error.code, 'unknown-command')

  // hobkin was never called for any of them: the next message is the second the model sees.
  await client.run('conversation.send', { text: 'Second' })
  const after = await client.until((now) => now.messages.some((message) => message.content === 'Reply 2') && now.snapshot.busy === false, 'the second reply')
  assert.deepEqual(said(after), ['user: Hello hobkin', 'assistant: Reply 1', 'user: Second', 'assistant: Reply 2'])
  assert.equal(prompts.length, 2)
})

interface Listed {
  name: string
  description: string
  source: string
  count: number
}

test('running a command counts it, across restarts', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  const open = async () => {
    const host = await hostFor(t, { root, scripted: { reply: ({ prompt }) => ({ text: `Heard: ${prompt.split('\n').at(-1)}` }) } })
    const client = await Client.connect(host)
    afterTest(t, () => client.close())
    await client.live()
    const list = async () => (await client.run<{ commands: Listed[] }>('slash.list')).commands
    return { host, client, list }
  }

  const first = await open()
  const fresh = await first.list()
  // hobkin's own commands, in the terminal app's order, each with one line on what it does and nothing counted yet.
  assert.deepEqual(fresh.filter(({ source }) => source === 'hobkin').map(({ name }) => name), ['/help', '/setup', '/clear', '/reset', '/navigate', '/work', '/learning', '/feedback'])
  assert.ok(fresh.every(({ description, count }) => description.length > 0 && count === 0))

  // Each run counts, whatever the command does.
  const learning = await first.client.run<{ said?: string }>('slash.run', { name: '/learning' })
  assert.match(learning.said ?? '', /^Learning on\./)
  assert.match((await first.client.run<{ said?: string }>('slash.run', { name: '/learning' })).said ?? '', /^Learning off\./)
  const help = await first.client.run<{ shown?: string }>('slash.run', { name: '/help' })
  assert.match(help.shown ?? '', /`\/setup`/, "hobkin's own help text")
  const counts = async (list: () => Promise<Listed[]>) => Object.fromEntries((await list()).filter(({ count }) => count > 0).map(({ name, count }) => [name, count]))
  assert.deepEqual(await counts(first.list), { '/learning': 2, '/help': 1 })

  // A command that is not on the list is not run and not counted.
  const unknown = await first.client.command('slash.run', { name: '/nope' })
  assert.equal(unknown.ok, false)
  assert.deepEqual(await counts(first.list), { '/learning': 2, '/help': 1 })

  // /work opens in the app and only counts here. /feedback is not built, and does not send anyone to the terminal.
  assert.deepEqual(await first.client.run('slash.run', { name: '/work' }), {})
  const feedback = await first.client.command('slash.run', { name: '/feedback' })
  assert.equal(feedback.ok, false)
  assert.match(JSON.stringify(feedback), /not built yet/)
  assert.doesNotMatch(JSON.stringify(feedback), /terminal/)

  // /setup asks hobkin in the conversation, as the terminal app does.
  await first.client.run('slash.run', { name: '/setup' })
  const asked = await first.client.until((view) => view.snapshot.busy === false && view.messages.length === 2, 'the setup turn')
  assert.deepEqual(asked.messages.map(({ content }) => content), ['Help me set up hobkin.', 'Heard: Help me set up hobkin.'])

  // /clear hides what is on screen and keeps it in hobkin's conversation.
  assert.match((await first.client.run<{ said?: string }>('slash.run', { name: '/clear' })).said ?? '', /cleared/)
  await first.client.until((view) => view.messages.length === 0, 'the conversation to clear')

  // The counts are in the home, readable by the user only, and the next host starts from them.
  const file = join(root, 'client', 'slash-counts.json')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, counts: { '/learning': 2, '/help': 1, '/work': 1, '/setup': 1, '/clear': 1 } })
  assert.equal(statSync(file).mode & 0o777, 0o600)
  await first.host.close()

  const second = await open()
  assert.deepEqual(await counts(second.list), { '/learning': 2, '/help': 1, '/work': 1, '/setup': 1, '/clear': 1 })
  assert.deepEqual(second.client.view.messages, [], 'what was cleared stays hidden after a restart')
  await second.client.run('slash.run', { name: '/help' })
  assert.equal((await counts(second.list))['/help'], 2)
})

test('help does not list feedback, which the app cannot run, and the list says so', async () => {
  const { helpGuide } = await import('../src/slash.ts')
  const help = helpGuide()
  assert.doesNotMatch(help, /`\/feedback`/)
  assert.match(help, /`\/work`/)
  assert.match(help, /`\/navigate`/)
})
