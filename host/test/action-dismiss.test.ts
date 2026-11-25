import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { fileDecision, openDecisions } from 'hobkin/src/cli/decisions.mjs'
import { listActionItems } from 'hobkin/src/cli/pending-read.mjs'
import { afterTest, Client, hostFor, temporaryDirectory, type View } from './support.ts'

const choices = [
  { value: 'yes', label: 'Unsubscribe' },
  { value: 'no', label: 'Keep it' },
]
const listed = (view: View) => ((view.snapshot.decisions ?? []) as { id: string }[]).map(({ id }) => id)

test("a dismissed Action Item leaves every list at once through hobkin's own dismissal, unanswered, and stays gone for a new window", { timeout: 60000 }, async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const card = fileDecision(root, { from: 'Routine inbox-sweep', question: 'Unsubscribe from the newsletter?', choices, answerTo: { kind: 'routine', id: 'inbox-sweep' } })
  const other = fileDecision(root, { from: 'Routine inbox-sweep', question: 'Unsubscribe from the store?', choices, answerTo: { kind: 'routine', id: 'inbox-sweep' } })

  const host = await hostFor(t, { root })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  await client.until((view) => [card.id, other.id].every((id) => listed(view).includes(id)), 'both cards in Action Items')

  assert.deepEqual(await client.run('action.dismiss', { ids: [card.id] }), { dismissed: 1, remaining: 1 })
  // The window's row leaves as it asks and stays gone once the answer comes, so hobkin's list has dropped it by then.
  assert.deepEqual(listed(client.view), [other.id])
  assert.deepEqual(listActionItems(root).items.map(({ id }) => id), [other.id])
  // Dismissed is not answered: whoever asked hears nothing, and hobkin still holds the question.
  assert.deepEqual(openDecisions(root).map(({ id }) => id).sort(), [card.id, other.id].sort())

  const fresh = await Client.connect(host)
  afterTest(t, () => fresh.close())
  await fresh.live()
  assert.deepEqual(listed(fresh.view), [other.id])

  // A stale window's second press dismisses nothing more.
  assert.deepEqual(await client.run('action.dismiss', { ids: [card.id] }), { dismissed: 0, remaining: 1 })
  const empty = await client.command('action.dismiss', { ids: [] })
  assert.equal(!empty.ok && empty.error.code, 'invalid-arguments')
})
