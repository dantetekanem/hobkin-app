import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { TEMPLATE_GOALS } from 'hobkin/src/cli/routine-templates.mjs'
import { commandDefinition } from '#shared/commands/registry.ts'
import { GOALS, type SetupWatchers } from '#shared/protocol/setup.ts'
import { runCommand } from '../src/commands.ts'
import { setupWatcherHandlers } from '../src/setup-watchers.ts'
import { temporaryDirectory } from './support.ts'

test('the app and hobkin know the same goals, in the same order', () => {
  assert.deepEqual([...GOALS], [...TEMPLATE_GOALS])
})

test('setup.watchers lists each goal\'s starters and more with their parts, the user\'s own winning, and hobkin may run it', async (t) => {
  const root = temporaryDirectory(t)
  const folder = join(root, 'routines', 'templates')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'email.md'), '---\ntitle: My mail\nsummary: Only the mail I care about.\nrecurrence: Daily\nfits: Me\ngoals: life\n---\n\nRead it.\n')
  const handlers = setupWatcherHandlers({ root: () => root })

  const outcome = await runCommand(handlers, 'setup.watchers', { goals: ['life', 'project'] })

  assert.ok(outcome.ok)
  const { goals } = outcome.value as SetupWatchers
  assert.deepEqual(goals.map(({ goal }) => goal), ['project', 'life'], "in the goals' order")
  const [project, life] = goals
  assert.ok(project!.starters.some(({ id }) => id === 'deadlines-ahead'), 'a starter shows under the first picked goal it starts')
  assert.ok(!life!.starters.some(({ id }) => id === 'deadlines-ahead'), 'and only there')

  const email = life!.starters.find(({ id }) => id === 'email')
  assert.equal(email?.title, 'My mail', "the user's own wins by name")
  assert.equal(email?.source, 'yours')
  assert.equal(email?.tells, null, 'a part their template leaves out is null')

  const milestones = project!.starters.find(({ id }) => id === 'project-milestones')
  assert.ok(milestones?.tells && milestones.gives.length && Number.isInteger(milestones.version), "hobkin's own card has its parts")
  assert.ok(life!.more.length > 0, 'the rest that name a goal are its more')

  const unknown = await runCommand(handlers, 'setup.watchers', { goals: ['travel'] })
  assert.equal(!unknown.ok && unknown.error.code, 'invalid-arguments', 'only the five goals')
  assert.equal(commandDefinition('setup.watchers')?.hobkin, true, 'it only reads, so hobkin may run it')
})
