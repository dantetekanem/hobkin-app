import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { chooseProject, setProjectIssues } from 'hobkin/src/cli/work/store.mjs'
import { runCommand } from '../src/commands.ts'
import { workFrom, workHandlers, type WorkApp } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

/** Stands in for hobkin's application: it writes down every work action it is asked for, and answers as told. */
function fakeHobkin(answers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: unknown[][] = []
  const app: WorkApp = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      const answer = answers[String(args[0])]
      return answer ? answer(...args.slice(1)) : { ok: true, message: `hobkin did ${String(args[0])}.` }
    },
    refresh: async () => {
      calls.push(['refresh'])
    },
  }
  return { app, calls }
}

test("which issues a project picks up is one of its settings: set with hobkin's own issues action, and read back on the Work screen", async (t) => {
  const root = temporaryDirectory(t)
  const folder = join(root, 'code', 'storefront')
  mkdirSync(folder, { recursive: true })
  const { slug } = chooseProject(root, folder, 'important')
  const { app, calls } = fakeHobkin({ issues: (project, value) => setProjectIssues(root, String(project), String(value)) })
  const handlers = workHandlers({ app: () => app, root: () => root })
  const reported = async () => workFrom({ work: await runWorkCommand(root, []), waiting: null })!.projects.find((entry) => entry.slug === slug)!.issues

  assert.equal(await reported(), 'off')
  assert.equal((await runCommand(handlers, 'work.project', { slug, issues: 'labeled' })).ok, true)
  assert.deepEqual(calls, [['issues', slug, 'labeled']])
  assert.equal(await reported(), 'labeled')

  for (const args of [{ slug, prs: 'off', issues: 'all' }, { slug, issues: 'some' }, { slug }]) {
    const wrong = await runCommand(handlers, 'work.project', args)
    assert.equal(!wrong.ok && wrong.error.code, 'invalid-arguments', JSON.stringify(args))
  }
  assert.equal(calls.length, 1)
})
