import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { atomicJson, initialize } from 'hobkin/src/cli/config.mjs'
import type { ScriptedCall } from '../src/scripted.ts'
import { afterTest, Client, hostFor, temporaryDirectory, type View } from './support.ts'

const said = (view: View) => view.messages.map(({ role, content }) => `${role}: ${content}`)
const mainRuns = (view: View) => (view.snapshot.runs ?? []).filter((run) => run.kind === 'main')

/** A model whose first reply waits until the test lets it go. */
function heldModel() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: ScriptedCall[] = []
  return {
    calls,
    release: () => release(),
    reply: async (call: ScriptedCall) => {
      calls.push(call)
      if (call.index === 0) await gate
      return { text: `Reply ${call.index + 1}` }
    },
  }
}

test('a send during a turn steers it', async (t) => {
  const model = heldModel()
  const host = await hostFor(t, { scripted: { reply: model.reply } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  const first = await client.run<{ id: string; queued: boolean }>('conversation.send', { text: 'Plan the week' })
  assert.equal(first.queued, false)
  await client.until((view) => view.snapshot.busy === true && model.calls.length === 1, 'the turn to start')

  // The turn is running, so this one is taken into it. hobkin accepts it before the model has read it.
  const steer = await client.run<{ id: string; queued: boolean }>('conversation.send', { text: 'Only weekdays' })
  assert.equal(steer.queued, true)
  assert.deepEqual(said(client.view), ['user: Plan the week'], 'the model has not read it yet')

  model.release()
  const view = await client.until((now) => now.snapshot.busy === false && now.messages.length === 4, 'the steered turn to end')
  assert.deepEqual(said(view), ['user: Plan the week', 'assistant: Reply 1', 'user: Only weekdays', 'assistant: Reply 2'])
  assert.equal(model.calls.length, 2, 'one more model call, in the same turn')
  assert.ok(model.calls[1]!.prompt.endsWith('Only weekdays'))

  // One turn, and the steering message belongs to it.
  assert.deepEqual(mainRuns(view).map(({ title, state }) => `${title}: ${state}`).sort(), ['Conversation: completed', 'Steering: completed'])
})

test('interrupt returns unsent text', async (t) => {
  const model = heldModel()
  const host = await hostFor(t, { scripted: { reply: model.reply } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  assert.deepEqual(await client.run('conversation.stop'), { stopped: false, unsent: [] }, 'with no turn running there is nothing to stop')

  await client.run('conversation.send', { text: 'Plan the week' })
  await client.until((view) => view.snapshot.busy === true && model.calls.length === 1, 'the turn to start')
  await client.run('conversation.send', { text: 'Only weekdays' })
  await client.run('conversation.send', { text: 'And skip Friday' })

  // What hobkin had not read comes back as the user typed it, for the input to take again.
  assert.deepEqual(await client.run('conversation.stop'), { stopped: true, unsent: ['Only weekdays', 'And skip Friday'] })

  const view = await client.until((now) => now.snapshot.busy === false && now.messages.some((message) => message.role === 'system'), 'the stop to show')
  assert.deepEqual(said(view), ['user: Plan the week', 'system: You stopped hobkin.'])
  assert.equal(view.snapshot.doing, null)
  assert.equal(model.calls.length, 1, 'the model never saw what was unsent')
  assert.deepEqual([...new Set(mainRuns(view).map(({ state }) => state))], ['interrupted'])

  // The conversation goes on from where it stopped.
  model.release()
  await client.run('conversation.send', { text: 'Start over' })
  const after = await client.until((now) => now.snapshot.busy === false && now.messages.at(-1)?.role === 'assistant', 'the next reply')
  assert.equal(after.messages.at(-1)?.content, 'Reply 2')
})

test('a message about a report carries the report to hobkin', async (t) => {
  // A report on record, as an imported one is: hobkin lists it with the rest.
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const report = { id: 'local:recap:1', title: 'Morning recap', body: 'Two builds failed overnight: checkout and billing.', at: '2026-11-09T07:00:00Z', outcome: 'imported', origin: 'legacy-state', path: '/recap.md', readState: 'read', readAt: '2026-11-09T08:00:00Z' }
  atomicJson(join(root, 'runtime', 'imported-reports.json'), { version: 1, reports: [report] })

  const prompts: string[] = []
  const host = await hostFor(t, { root, scripted: { reply: ({ prompt }) => (prompts.push(prompt), { text: 'About that recap.' }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const view = await client.live()
  assert.ok((view.snapshot.reports as { id: string }[]).some(({ id }) => id === report.id))

  // The same path as `r` on a report in the terminal app: hobkin puts the report ahead of the words.
  await client.run('conversation.send', { text: 'Which one should I look at first?', report: report.id })
  const replied = await client.until((now) => now.snapshot.busy === false && now.messages.length === 2, 'the reply')
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /<hobkin-report>[\s\S]*"title":"Morning recap"[\s\S]*Two builds failed overnight[\s\S]*<\/hobkin-report>[\s\S]*Which one should I look at first\?$/)
  // The conversation shows the words and what they were about, not the report itself.
  assert.deepEqual(
    replied.messages.map(({ role, content, about }) => [role, content, about]),
    [
      ['user', 'Which one should I look at first?', 'Morning recap'],
      ['assistant', 'About that recap.', undefined],
    ],
  )

  // A report that is not on record is refused, and nothing is sent.
  const gone = await client.command('conversation.send', { text: 'And this one?', report: 'nowhere' })
  assert.equal(!gone.ok && gone.error.code, 'unavailable')
  assert.match(!gone.ok ? gone.error.message : '', /report is not in hobkin's list/)
  assert.equal(prompts.length, 1)
})
