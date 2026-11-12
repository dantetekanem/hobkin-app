import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { addIssue } from 'hobkin/src/cli/work/issues.mjs'
import { chooseProject, setProjectIssues } from 'hobkin/src/cli/work/store.mjs'
import { checkArguments } from '#shared/commands/registry.ts'
import { runCommand, type CommandOutcome } from '../src/commands.ts'
import type { GhOutcome } from '../src/github-gh.ts'
import type { GhCall } from '../src/review/gh.ts'
import { workIssueHandlers } from '../src/work-issues.ts'
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

/** A home of the test's with one project taken, in a folder whose origin is acme/web on GitHub. Nothing ever fetches it. */
function homeWithProject(t: TestContext) {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const folder = join(base, 'web')
  mkdirSync(folder, { recursive: true })
  execFileSync('git', ['init', '-q', folder])
  execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', 'git@github.com:acme/web.git'])
  const { slug } = chooseProject(root, folder, 'important')
  return { root, slug }
}

/** gh as the test plays it: it writes down what it was asked and answers as told. It never reaches GitHub. */
function fakeGh(outcome: GhOutcome) {
  const asked: (readonly string[])[] = []
  const gh: GhCall = async (args) => {
    asked.push(args)
    return outcome
  }
  return { gh, asked }
}

const answered = (value: unknown): GhOutcome => ({ kind: 'done', stdout: JSON.stringify(value) })

/** An issue as `gh issue view --json number,title,body,url,labels` prints it. */
const ISSUE = { number: 12, title: 'Login fails after a password reset', body: 'Steps to see it.', url: 'https://github.com/acme/web/issues/12', labels: [{ name: 'bug' }, { name: 'checkout' }] }

const messageOf = (outcome: CommandOutcome): string => (outcome.ok ? (outcome.value as { message: string }).message : assert.fail(outcome.error.message))

test("Add to queue finds the project whose repository the issue is in, reads the issue through gh and hands it to hobkin's own issue action", async (t) => {
  const { root, slug } = homeWithProject(t)
  const said = 'Added "Login fails after a password reset" from Acme/Web#12 to web as 3fa9c1. It goes first in the queue, after anything picked before it.'
  const { app, calls } = fakeHobkin({ issue: () => ({ ok: true, message: said }) })
  const { gh, asked } = fakeGh(answered(ISSUE))

  const result = await runCommand(workIssueHandlers({ app: () => app, root: () => root, gh }), 'work.issue', { repo: 'Acme/Web', number: 12 })

  assert.deepEqual(result, { ok: true, value: { message: said } })
  assert.deepEqual(asked, [['issue', 'view', '12', '--repo', 'Acme/Web', '--json', 'number,title,body,url,labels']], 'gh only reads the issue')
  assert.deepEqual(calls, [
    ['issue', slug, { repo: 'Acme/Web', number: 12, title: 'Login fails after a password reset', body: 'Steps to see it.', url: 'https://github.com/acme/web/issues/12', labels: ['bug', 'checkout'] }],
  ])
})

test('what the host hands hobkin is what hobkin files: once, as a fix for a bug label, first in the queue', async (t) => {
  const { root, slug } = homeWithProject(t)
  const { app } = fakeHobkin({ issue: (project, value) => addIssue(root, String(project), value as Parameters<typeof addIssue>[2]) })
  const handlers = workIssueHandlers({ app: () => app, root: () => root, gh: fakeGh(answered(ISSUE)).gh })

  const first = messageOf(await runCommand(handlers, 'work.issue', { repo: 'acme/web', number: 12 }))
  const again = messageOf(await runCommand(handlers, 'work.issue', { repo: 'acme/web', number: 12 }))

  assert.match(first, /^Added "Login fails after a password reset" from acme\/web#12 to web as [0-9a-f]{6}\. It goes first in the queue/)
  assert.match(again, /^acme\/web#12 is already filed on web as [0-9a-f]{6}, open\. Nothing changed\.$/)
  const items = (await runWorkCommand(root, ['items', slug])) as { kind: string; title: string }[]
  assert.deepEqual(items.map(({ kind, title }) => [kind, title]), [['fix', 'Login fails after a password reset']])
})

test('with no hobkin project for the repository, Add to queue is refused with the reason, and neither gh nor hobkin is asked', async (t) => {
  const { root } = homeWithProject(t)
  const { app, calls } = fakeHobkin()
  const { gh, asked } = fakeGh(answered(ISSUE))

  const result = await runCommand(workIssueHandlers({ app: () => app, root: () => root, gh }), 'work.issue', { repo: 'acme/elsewhere', number: 3 })

  assert.deepEqual(result, { ok: false, error: { code: 'unavailable', message: 'No hobkin project is github.com/acme/elsewhere. Add it on the Work screen first.' } })
  assert.deepEqual([asked, calls], [[], []])
})

test('a host that never runs gh refuses, a gh that cannot read the issue says why, and hobkin is asked nothing', async (t) => {
  const { root } = homeWithProject(t)
  const { app, calls } = fakeHobkin()
  const add = (gh?: GhCall) => runCommand(workIssueHandlers({ app: () => app, root: () => root, gh }), 'work.issue', { repo: 'acme/web', number: 12 })

  assert.deepEqual(await add(), {
    ok: false,
    error: { code: 'unavailable', message: 'This host does not run gh, so the issue cannot be read and nothing was added. Start the host with --github to add issues.' },
  })
  const signedOut = fakeGh({ kind: 'failed', code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run: gh auth login' })
  assert.deepEqual(await add(signedOut.gh), { ok: false, error: { code: 'failed', message: 'gh is not signed in. Run `gh auth login` in Terminal.' } })
  assert.deepEqual(await add(fakeGh(answered({ number: 12 })).gh), { ok: false, error: { code: 'failed', message: 'gh sent no title for acme/web#12, so nothing was added.' } })
  assert.deepEqual(calls, [])
})

test('Add to queue takes a repository as owner/name and an issue number, and nothing else', () => {
  for (const args of [{ repo: 'acme/web', number: 1 }, { repo: 'Acme-Org/web.site_2', number: 99 }]) assert.equal(checkArguments('work.issue', args).ok, true, JSON.stringify(args))
  for (const args of [{ repo: 'acme', number: 1 }, { repo: '-x/web', number: 1 }, { repo: 'acme/web', number: 0 }, { repo: 'acme/web', number: 1.5 }, { repo: 'acme/web', number: 1, title: 'x' }, { repo: 'acme/web' }]) {
    assert.equal(checkArguments('work.issue', args).ok, false, JSON.stringify(args))
  }
})

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
