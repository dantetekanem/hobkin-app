import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { commandDefinition } from '#shared/commands/registry.ts'
import type { RoutineTemplatesList } from '#shared/protocol/routine-templates.ts'
import { runCommand } from '../src/commands.ts'
import { routineTemplateHandlers } from '../src/routine-templates.ts'
import { temporaryDirectory } from './support.ts'

const yours = (root: string, name: string, header: string) => {
  const folder = join(root, 'routines', 'templates')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `${name}.md`), `---\n${header}\n---\n\nRead what changed.\n`)
}

test("the Routines screen gets hobkin's templates and the user's own, one per name, without their files, and hobkin may ask for them", async (t) => {
  const root = temporaryDirectory(t)
  yours(root, 'email', 'title: My mail\nsummary: Only the mail I care about.\nrecurrence: Daily\nfits: Me')
  yours(root, 'garden', 'title: Garden\nsummary: What to water.\nrecurrence: Weekly\nfits: Me\ngroup: life')

  const outcome = await runCommand(routineTemplateHandlers({ root: () => root }), 'routine.templates', {})

  assert.ok(outcome.ok)
  const { templates } = outcome.value as RoutineTemplatesList
  const byId = new Map(templates.map((template) => [template.id, template]))
  assert.equal(templates.filter(({ id }) => id === 'email').length, 1, 'one per name')
  assert.equal(byId.get('email')?.title, 'My mail', "the user's own wins")
  assert.equal(byId.get('email')?.source, 'yours')
  assert.deepEqual(byId.get('garden')?.goals, ['life'], 'an old group reads as its goal')
  assert.equal(byId.get('job-openings')?.source, 'hobkin')
  assert.deepEqual(byId.get('job-openings')?.goals.at(0), 'job')
  // The window needs what a template is, not where it lives on this Mac.
  assert.ok(templates.every((template) => !('file' in template)))

  assert.equal(commandDefinition('routine.templates')?.hobkin, true, 'it only reads, so hobkin may run it')
})
