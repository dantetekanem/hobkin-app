import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { approvalGroups, groupPlan } from 'hobkin/src/cli/work/groups.mjs'
import { chooseProject, setProjectPaused, setProjectPrMode, setProjectPriority } from 'hobkin/src/cli/work/store.mjs'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { checkArguments } from '#shared/commands/registry.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { ActivityKeeper } from '../src/activity.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { runCommand } from '../src/commands.ts'
import { StateSync } from '../src/state-sync.ts'
import { workFrom, workHandlers, type WorkApp } from '../src/work.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

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

const handlersOf = (app: WorkApp, root = '/nowhere') => workHandlers({ app: () => app, root: () => root })

/** hobkin's work status as its snapshot carries it, with only what a test needs to say. */
const status = (rest: Record<string, unknown> = {}) => ({
  enabled: true,
  folder: '/Users/someone/code',
  autoPick: false,
  agents: 2,
  agentsAllowed: 2,
  paused: false,
  pause: null,
  waitingOn: null,
  queued: 0,
  plan: [],
  projects: [],
  forecast: { line: 'Next 8h: nothing starts.' },
  ...rest,
})

/** A finished change as hobkin lists it under `waiting.branches`: one row of its `readyItems` or `pullRequestRows`. */
const change = (slug: string, item: string, title: string, rest: Record<string, unknown> = {}) => ({
  slug,
  project: slug,
  item,
  title,
  grade: 'P1',
  kind: 'fix',
  branch: `hobkin/${item}-change`,
  head: `${item}${'0'.repeat(34)}`,
  summary: null,
  about: `What ${title} did.`,
  proof: 'pnpm test passes',
  left: null,
  at: '2026-11-10T08:00:00.000Z',
  behind: 0,
  conflict: false,
  size: { additions: 10, deletions: 2, files: 2 },
  safety: { grade: 'safe', rating: 'A' },
  quality: null,
  notices: null,
  launch: null,
  onlyDocs: false,
  landedOn: null,
  gap: 'land',
  holds: 0,
  described: true,
  proved: true,
  like: null,
  ...rest,
})

const branches = [
  change('storefront', 'a1a1a1', 'Fix the login redirect loop'),
  change('billing-api', 'b2b2b2', 'Round invoices once', { behind: 3, safety: null }),
  change('storefront', 'c3c3c3', 'Move the cart into one module', { gap: 'rebase', conflict: true }),
  change('docs-site', 'd4d4d4', 'Explain the new sign-in', { pr: 'https://github.com/hobkin-sample/docs/pull/71', safety: { grade: 'risky', rating: 'C' } }),
  change('storefront', 'e5e5e5', 'Already on the release branch', { gap: 'elsewhere', landedOn: 'release' }),
  change('billing-api', 'f6f6f6', 'Patch the webhook retry', { grade: 'P0' }),
]

test('finished changes keep hobkin\'s groups and reasons', () => {
  const work = workFrom({ work: status(), waiting: { branches } })
  assert.ok(work)

  // hobkin's own grouping of the rows its Decisions shows: approval rows, the most urgent first.
  const approval = branches.filter(({ gap }) => gap !== 'elsewhere').toSorted((first, second) => Number(first.grade.slice(1)) - Number(second.grade.slice(1)))
  const expected = approvalGroups(approval).map(({ name, rows }) => ({ name, keys: rows.map(({ slug, item }) => `${slug}:${item}`) }))
  assert.deepEqual(
    work.finished.map(({ name, changes }) => ({ name, keys: changes.map(({ key }) => key) })),
    expected,
  )
  assert.deepEqual(
    work.finished.map(({ heading }) => heading),
    ['Ready to merge', 'Refresh then merge', 'Needs you'],
  )

  const card = (key: string) => work.finished.flatMap(({ changes }) => changes).find((entry) => entry.key === key)!
  assert.ok(work.finished.every(({ changes }) => changes.every(({ reason }) => reason.length > 0)), 'every card says why it is where it is')
  assert.match(card('storefront:c3c3c3').reason, /conflicts/)
  assert.match(card('docs-site:d4d4d4').reason, /risky/)
  assert.match(card('billing-api:b2b2b2').reason, /3 behind|behind/)
  assert.equal(work.finished.find(({ name }) => name === 'needs')!.action, null, 'only the user can act on what needs them, one card at a time')

  // What each card offers, in hobkin's order: the merge first, its review first when a review rated it risky, a rebase instead of a merge when it conflicts.
  assert.deepEqual(card('storefront:a1a1a1').choices.map(({ value }) => value), ['merge', 'diff', 'review', 'decline'])
  assert.deepEqual(card('billing-api:b2b2b2').choices.map(({ value }) => value), ['refreshMerge', 'diff', 'review', 'decline'])
  assert.deepEqual(card('storefront:c3c3c3').choices.map(({ value }) => value), ['rebase', 'diff', 'review', 'decline'])
  assert.deepEqual(card('docs-site:d4d4d4').choices.map(({ value }) => value), ['review', 'diff', 'open', 'mergePr', 'decline'])
  assert.equal(card('docs-site:d4d4d4').choices.find(({ value }) => value === 'mergePr')!.label, 'Merge the PR on GitHub anyway: it is rated risky')
  assert.equal(card('docs-site:d4d4d4').pr, 'https://github.com/hobkin-sample/docs/pull/71')
  assert.match(card('storefront:a1a1a1').yes, /on this machine\. Nothing is pushed\./)
  assert.equal(card('storefront:a1a1a1').review, 'Reviewed: safe A at this commit.')

  // A view the terminal saved has no work mode in it, and says nothing about it.
  assert.equal(workFrom({ reports: [] }), null)
})

test('a group action lists its targets before acting', async () => {
  const work = workFrom({ work: status(), waiting: { branches } })!
  const ready = work.finished.find(({ name }) => name === 'merge')!
  assert.equal(ready.action?.label, `Merge all ${ready.changes.length}`)
  // The page the user says yes to lists every title it acts on, in the order they go, as hobkin's own page does.
  const rows = ready.changes.map(({ key }) => branches.find(({ slug, item }) => `${slug}:${item}` === key)!)
  assert.deepEqual(ready.action?.plan, groupPlan('merge', rows))
  assert.deepEqual(
    ready.action?.plan.projects.flatMap(({ steps }) => steps.map(({ title }) => title)),
    ready.changes.map(({ title }) => title),
  )

  // The yes carries out exactly those rows, each at the commit its card showed, and each one's result comes back.
  const told = [
    { did: 'merged it locally', line: 'Merged "Patch the webhook retry" into main on billing-api. Nothing was pushed.' },
    { did: 'could not merge it', line: '"Fix the login redirect loop" on storefront moved since it was offered, so nothing merged.' },
    { did: 'summed up a group', line: 'Merged 1 of 2 here, with nothing pushed. 1 did not go, and its line says why.', heard: true },
  ]
  const { app, calls } = fakeHobkin({ group: () => ({ ok: true, message: told[2]!.line, told }) })
  const asked = ready.changes.map(({ slug, item, landing, head }) => ({ slug, item, how: landing, head: head! }))
  const result = await runCommand(handlersOf(app), 'work.group', { rows: asked })
  assert.deepEqual(calls, [['group', asked]])
  assert.deepEqual(result, { ok: true, value: { message: told[2]!.line, lines: [told[0]!.line, told[1]!.line] } })
})

test('queue actions call hobkin\'s work actions', async () => {
  const { app, calls } = fakeHobkin()
  const handlers = handlersOf(app)
  const key = 'item:storefront:a1a1a1'
  for (const action of ['run', 'skip', 'back'] as const) assert.equal((await runCommand(handlers, 'work.queue', { row: key, action })).ok, true)
  // The terminal's keys on a queue row: Enter runs it next, s skips it, and s on a skipped row puts it back.
  assert.deepEqual(calls, [
    ['run', key],
    ['later', key],
    ['back', key],
  ])
  const refused = await runCommand(handlers, 'work.queue', { row: key, action: 'delete' })
  assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')
  assert.equal(calls.length, 3, 'nothing else reached hobkin')
})

test('done clears a work item through hobkin\'s own done action', async () => {
  const { app, calls } = fakeHobkin({ done: () => ({ ok: true, message: '"Refresh jsdom" is done.' }) })
  const result = await runCommand(handlersOf(app), 'work.change', { slug: 'rpsleague', item: 'b94256', action: 'done' })
  assert.deepEqual(result, { ok: true, value: { message: '"Refresh jsdom" is done.' } })
  assert.deepEqual(calls, [['done', 'rpsleague', 'b94256']])
})

test('merge passes hobkin\'s refusal through', async () => {
  const refusal = '"Move the cart into one module" conflicts with main, so nothing changed. Send an agent back to rebase it.'
  const { app, calls } = fakeHobkin({
    merge: (slug) => {
      if (slug === 'storefront') throw Error(refusal)
      return { ok: true, message: 'Merged "Round invoices once" into main on billing-api. Nothing was pushed.' }
    },
  })
  const handlers = handlersOf(app)

  const refused = await runCommand(handlers, 'work.change', { slug: 'storefront', item: 'c3c3c3', action: 'merge', head: 'c3c3c3c' })
  assert.deepEqual(refused, { ok: false, error: { code: 'failed', message: refusal } }, "hobkin's own words, as they are")
  const merged = await runCommand(handlers, 'work.change', { slug: 'billing-api', item: 'b2b2b2', action: 'merge', head: 'b2b2b2b' })
  assert.deepEqual(merged, { ok: true, value: { message: 'Merged "Round invoices once" into main on billing-api. Nothing was pushed.' } })

  // Each choice is hobkin's own, at the commit the card showed.
  await runCommand(handlers, 'work.change', { slug: 'docs-site', item: 'd4d4d4', action: 'merge-pr', head: 'd4d4d4d' })
  await runCommand(handlers, 'work.change', { slug: 'billing-api', item: 'b2b2b2', action: 'refresh-merge' })
  await runCommand(handlers, 'work.change', { slug: 'storefront', item: 'c3c3c3', action: 'ask', note: 'Keep the old cart for one release.' })
  await runCommand(handlers, 'work.change', { slug: 'storefront', item: 'c3c3c3', action: 'review' })
  await runCommand(handlers, 'work.change', { slug: 'storefront', item: 'c3c3c3', action: 'decline' })
  assert.deepEqual(calls, [
    ['merge', 'storefront', 'c3c3c3', { head: 'c3c3c3c' }],
    ['merge', 'billing-api', 'b2b2b2', { head: 'b2b2b2b' }],
    ['mergePr', 'docs-site', 'd4d4d4', { head: 'd4d4d4d' }],
    ['refreshMerge', 'billing-api', 'b2b2b2', {}],
    ['ask', 'storefront', 'c3c3c3', 'Keep the old cart for one release.'],
    ['review', 'storefront', 'c3c3c3'],
    ['decline', 'storefront', 'c3c3c3'],
  ])
})

/** The work slice a UI holds after the messages received so far. */
function workOf(client: Client): WorkState | null {
  let work: WorkState | null = null
  for (const message of client.received) {
    if (message.type !== 'state') continue
    if (message.reset) work = null
    if (message.work) work = message.work
  }
  return work
}

test('turning work mode on starts nothing', { timeout: 40000 }, async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  await client.until(() => workOf(client)?.enabled === false, 'work mode, off')

  // hobkin's own switch, from a folder with nothing in it.
  const folder = temporaryDirectory(t)
  assert.deepEqual(await client.run('work.mode', { on: true, folder }), { enabled: true })
  await client.until(() => workOf(client)?.enabled === true, 'work mode, on')
  assert.equal(workOf(client)?.autoPick, false, 'only what the user starts runs')
  assert.equal(workOf(client)?.folder, folder)

  // hobkin plans once a second. After a few of its ticks no work has started, not even the look for projects.
  await pause(3000)
  const started = (client.view.snapshot.runs ?? []).filter((run) => run.state === 'running' && run.work)
  assert.deepEqual(started, [])

  assert.deepEqual(await client.run('work.mode', { on: false }), { enabled: false })
  await client.until(() => workOf(client)?.enabled === false, 'work mode, off again')
  assert.deepEqual(await client.run('work.mode', { on: false }), { enabled: false }, 'off twice stays off')
  await pause(1200)
  assert.equal(workOf(client)?.enabled, false, 'it did not come back on')
})

test('project settings round trip', async (t) => {
  // hobkin's own store in a home of the test's, with one project taken. Nothing here runs git.
  const root = temporaryDirectory(t)
  const folder = join(root, 'code', 'storefront')
  mkdirSync(folder, { recursive: true })
  const { slug } = chooseProject(root, folder, 'important')
  // hobkin's `workAction` for these keys, as its application has them.
  const { app, calls } = fakeHobkin({
    priority: (project, value) => setProjectPriority(root, String(project), String(value)),
    prs: (project, value) => setProjectPrMode(root, String(project), String(value)),
    pauseProject: (project) => setProjectPaused(root, String(project), true),
    resumeProject: (project) => setProjectPaused(root, String(project), false),
  })
  const handlers = handlersOf(app, root)

  const reported = async () => {
    const project = workFrom({ work: await runWorkCommand(root, []), waiting: null })!.projects.find((entry) => entry.slug === slug)!
    return { priority: project.priority, prMode: project.prMode, paused: project.paused }
  }
  assert.deepEqual(await reported(), { priority: 'P1', prMode: 'off', paused: false })

  assert.equal((await runCommand(handlers, 'work.project', { slug, priority: 'P0' })).ok, true)
  assert.equal((await runCommand(handlers, 'work.project', { slug, prs: 'draft' })).ok, true)
  assert.deepEqual(calls, [
    ['priority', slug, 'P0'],
    ['prs', slug, 'draft'],
  ])
  // What `hobkin work` reports afterwards is the change, and the screen reads the same.
  assert.deepEqual(await reported(), { priority: 'P0', prMode: 'draft', paused: false })

  // The project's switch: off pauses work mode there alone, on resumes it.
  assert.equal((await runCommand(handlers, 'work.project', { slug, paused: true })).ok, true)
  assert.equal((await reported()).paused, true)
  assert.equal((await runCommand(handlers, 'work.project', { slug, paused: false })).ok, true)
  assert.equal((await reported()).paused, false)

  const both = await runCommand(handlers, 'work.project', { slug, priority: 'P2', prs: 'off' })
  assert.equal(!both.ok && both.error.code, 'invalid-arguments', 'one setting at a time')
  const wrong = await runCommand(handlers, 'work.project', { slug, priority: 'P9' })
  assert.equal(!wrong.ok && wrong.error.code, 'invalid-arguments')
  assert.equal(calls.length, 4)
})

test('projects show their state, and a proposal is answered as in the terminal', async () => {
  const projects = [
    { slug: 'old-site', name: 'old-site', state: 'dropped', priority: 'P3' },
    { slug: 'docs-site', name: 'docs-site', state: 'chosen', priority: 'P2', prMode: 'published' },
    { slug: 'design-kit', name: 'design-kit', state: 'proposed', level: 'casual', rank: 2 },
    { slug: 'storefront', name: 'storefront', state: 'chosen', priority: 'P0' },
    { slug: 'labs', name: 'labs', state: 'skipped' },
    { slug: 'billing-api', name: 'billing-api', state: 'proposed', level: 'important', rank: 1 },
  ]

  const work = workFrom({ work: status({ projects }), waiting: null })!

  // The ones taken by priority, then the proposals as the look ranked them, then the ones left alone.
  assert.deepEqual(
    work.projects.map(({ state, slug }) => `${state} ${slug}`),
    ['chosen storefront', 'chosen docs-site', 'proposed billing-api', 'proposed design-kit', 'skipped labs', 'dropped old-site'],
  )
  // How much of a project's work has merged is hobkin's own count, and a project that says none has none.
  const counted = workFrom({ work: status({ projects: [{ ...projects[3]!, merged: 7 }, projects[1]!] }), waiting: null })!
  assert.deepEqual(counted.projects.map(({ slug, merged }) => [slug, merged]), [['storefront', 7], ['docs-site', 0]])

  const { app, calls } = fakeHobkin()
  const handlers = handlersOf(app)

  // y and n on a proposal in the terminal. A project left alone is taken again the same way.
  assert.equal((await runCommand(handlers, 'work.proposal', { slug: 'billing-api', answer: 'take' })).ok, true)
  assert.equal((await runCommand(handlers, 'work.proposal', { slug: 'design-kit', answer: 'skip' })).ok, true)
  assert.equal((await runCommand(handlers, 'work.proposal', { slug: 'labs', answer: 'take' })).ok, true)

  assert.deepEqual(calls, [
    ['choose', 'billing-api'],
    ['skip', 'design-kit'],
    ['choose', 'labs'],
  ])
})

test('agents at once round trip', async (t) => {
  // hobkin's own store in a home of the test's.
  const root = temporaryDirectory(t)
  const { app, calls } = fakeHobkin()
  const handlers = handlersOf(app, root)
  const reported = async () => workFrom({ work: await runWorkCommand(root, []), waiting: null })!.agentsAllowed

  assert.equal(await reported(), 2, "hobkin's own default")

  const set = await runCommand(handlers, 'work.agents', { agents: 4 })

  assert.deepEqual(set, { ok: true, value: { agents: 4 } })
  // What `hobkin work` reports afterwards is the change, and the window hears of it at once.
  assert.equal(await reported(), 4)
  assert.deepEqual(calls, [['refresh']])

  const tooMany = await runCommand(handlers, 'work.agents', { agents: 9 })
  assert.equal(!tooMany.ok && tooMany.error.code, 'invalid-arguments')
  assert.equal(await reported(), 4)
})

test("when work mode runs fewer agents than the user chose, the window gets hobkin's reason, and none otherwise", () => {
  const held = workFrom({ work: status({ agents: 1, agentsAllowed: 8, subscription: { known: false, windows: [] } }), waiting: null })!
  assert.equal(held.agentsHeld, 'Subscription: not known yet, so one agent runs at a time.')
  const free = workFrom({ work: status({ agents: 8, agentsAllowed: 8, subscription: { known: true, windows: [] } }), waiting: null })!
  assert.equal(free.agentsHeld, null)
  assert.equal(workFrom({ work: status(), waiting: null })!.agentsHeld, null, 'a hobkin that sends no reading holds nothing back')
})

test("the daily budget is hobkin's own, and a change of it is saved where work mode reads it", async (t) => {
  const root = temporaryDirectory(t)
  const { app, calls } = fakeHobkin()
  const handlers = handlersOf(app, root)
  const reported = async () => workFrom({ work: await runWorkCommand(root, []), waiting: null })!

  assert.deepEqual([(await reported()).dailyTokens, (await reported()).tokensToday], [100_000_000, 0], "hobkin's default and nothing used")
  assert.deepEqual([workFrom({ work: status(), waiting: null })!.dailyTokens, workFrom({ work: status(), waiting: null })!.tokensToday], [null, null], 'a host that reports none is unknown')

  const set = await runCommand(handlers, 'work.tokens', { tokens: 40_000_000 })

  assert.deepEqual(set, { ok: true, value: { tokens: 40_000_000 } })
  assert.equal((await reported()).dailyTokens, 40_000_000)
  assert.deepEqual(calls, [['refresh']])

  const none = await runCommand(handlers, 'work.tokens', { tokens: 0 })
  assert.equal(!none.ok && none.error.code, 'invalid-arguments')
  assert.equal((await reported()).dailyTokens, 40_000_000)
})

/** hobkin's runs as its snapshot lists them: its own conversation, a work agent, a routine, and one that has finished. */
const RUNS: RunSummary[] = [
  { id: 'main', title: 'Conversation', state: 'running', kind: 'main' },
  { id: 'work:storefront:do:1', title: 'Fix the login redirect loop', state: 'running', kind: 'background', scheduleId: 'work.storefront.do', work: { slug: 'storefront', lane: 'do', item: 'a1a1a1' } },
  { id: 'once:recap', title: 'Morning recap', state: 'running', kind: 'background', scheduleId: 'morning-recap' },
  { id: 'old', title: 'Yesterday', state: 'completed', kind: 'background', scheduleId: 'morning-recap' },
]

/**
 * Stands in for hobkin's application for its agents: its work actions, its `kill`, and its runner's `message_check`,
 * which reaches only the running jobs that take messages (`reachable`, by schedule). Each call is written down.
 */
function fakeAgents({ reachable = [] as string[] } = {}) {
  const calls: unknown[][] = []
  const app: AgentsApp = {
    workAction: async (...args) => {
      calls.push(['workAction', ...args])
      const line = args[2] === 'decline' ? 'Stopped "Fix the login redirect loop" on storefront: not approved, so it will not run again.' : 'Stopped "Fix the login redirect loop" on storefront for now; it waits at the end of the queue.'
      return { ok: true, message: line, told: { did: 'stopped it', line } }
    },
    kill: async (run) => {
      calls.push(['kill', run])
      return true
    },
    runner: {
      messageCheck: async (request) => {
        calls.push(['messageCheck', request])
        if (!request.scheduleId) return { running: reachable.map((scheduleId) => ({ scheduleId, title: scheduleId })) }
        if (!reachable.includes(request.scheduleId)) throw Error('That check is not running.')
        return { scheduleId: request.scheduleId, status: 'queued' }
      },
    },
  }
  return { app, calls, handlers: agentHandlers({ app: () => app, runs: () => RUNS }) }
}

test('execution Stop admits only captured identities and explicit user modes', () => {
  const target = { home: '/isolated/home', epoch: 'app-a', kind: 'agent', runId: 'root-run', agentId: 'owned-child' }
  const args = { target, mode: 'force', attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  assert.deepEqual(checkArguments('execution.stop', args), { ok: true })
  for (const invalid of [
    { ...args, pid: 123 }, { ...args, autoForce: true }, { ...args, attemptId: 'not-a-uuid' },
    { ...args, target: { ...target, name: 'owned-child' } },
    { ...args, target: { ...target, agentId: undefined } },
    { ...args, target: { ...target, kind: 'main' } }, { ...args, how: 'for-now' },
  ]) assert.equal(checkArguments('execution.stop', invalid).ok, false)
  assert.equal(checkArguments('execution.stop', { ...args, target: { ...target, kind: 'run', agentId: undefined }, how: 'not-approved' }).ok, true)
})

test('stopping an agent ends its run as stopped', async () => {
  const { calls, handlers } = fakeAgents()

  // A work agent stops the two ways the terminal's k stops one: for now, or not approved.
  assert.deepEqual(await runCommand(handlers, 'agent.stop', { run: 'work:storefront:do:1' }), {
    ok: true,
    value: { message: 'Stopped "Fix the login redirect loop" on storefront for now; it waits at the end of the queue.' },
  })
  assert.equal((await runCommand(handlers, 'agent.stop', { run: 'work:storefront:do:1', how: 'not-approved' })).ok, true)
  // A routine is cancelled, as k does on a job.
  assert.deepEqual(await runCommand(handlers, 'agent.stop', { run: 'once:recap' }), { ok: true, value: { message: 'Stopped "Morning recap".' } })
  // One that has finished, and hobkin's own conversation, are nothing to stop here.
  assert.deepEqual(await runCommand(handlers, 'agent.stop', { run: 'old' }), { ok: false, error: { code: 'unavailable', message: 'It had already finished, so nothing was stopped.' } })
  assert.equal((await runCommand(handlers, 'agent.stop', { run: 'main' })).ok, false)
  assert.deepEqual(calls, [
    ['workAction', 'stop', 'work:storefront:do:1', 'later'],
    ['workAction', 'stop', 'work:storefront:do:1', 'decline'],
    ['kill', 'once:recap'],
  ])
})

test('a message to a running agent is queued as steering, and refused once it finished', async () => {
  // Today hobkin's runner takes messages for the routines it runs, and not yet for work agents (proposed hobkin change 03).
  const today = fakeAgents({ reachable: ['morning-recap'] })
  const noteId = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(await runCommand(today.handlers, 'agent.say', { run: 'once:recap', text: 'Keep it to the calendar.', noteId }), { ok: true, value: { queued: true } })
  assert.deepEqual(today.calls.at(-1), ['messageCheck', { scheduleId: 'morning-recap', runId: 'once:recap', message: 'Keep it to the calendar.', noteId }])
  assert.equal((await runCommand(today.handlers, 'agent.say', { run: 'once:recap', text: 'Invalid', noteId: 'not-a-uuid' })).ok, false)

  const workAgent = await runCommand(today.handlers, 'agent.say', { run: 'work:storefront:do:1', text: 'Keep the old cart for one release.' })
  assert.deepEqual(workAgent, { ok: false, error: { code: 'unavailable', message: 'hobkin cannot pass a message to this agent while it runs.' } })
  assert.equal(today.calls.filter(([, request]) => (request as { message?: string }).message === 'Keep the old cart for one release.').length, 0, 'nothing was sent')

  // With work agents taking messages, the same words go to the work agent's run.
  const patched = fakeAgents({ reachable: ['morning-recap', 'work.storefront.do'] })
  assert.equal((await runCommand(patched.handlers, 'agent.say', { run: 'work:storefront:do:1', text: 'Keep the old cart for one release.' })).ok, true)
  assert.deepEqual(patched.calls.at(-1), ['messageCheck', { scheduleId: 'work.storefront.do', runId: 'work:storefront:do:1', message: 'Keep the old cart for one release.', noteId: undefined }])

  // Once it has finished, the words go nowhere and the user is told.
  const calls = patched.calls.length
  assert.deepEqual(await runCommand(patched.handlers, 'agent.say', { run: 'old', text: 'Are you still there?' }), { ok: false, error: { code: 'unavailable', message: 'It has finished, so nothing was sent.' } })
  assert.equal(patched.calls.length, calls)
})

test('steering handled input is refused and unknown acknowledgements stay uncertain', async () => {
  const fake = fakeAgents({ reachable: ['morning-recap'] })
  const original = fake.app.runner.messageCheck
  for (const status of ['handled', 'unconfirmed']) {
    fake.app.runner.messageCheck = request => request.scheduleId ? Promise.resolve({ status }) : original(request)
    const result = await runCommand(fake.handlers, 'agent.say', { run: 'once:recap', text: 'Wait' })
    if (status === 'handled') assert.equal(result.ok, false)
    else assert.deepEqual(result, { ok: true, value: { queued: false } })
  }
})

test('job activity is forwarded and kept', () => {
  const tool = (id: string, state: string) => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state })
  const keeper = new ActivityKeeper({ most: 2 })
  const pass = (jobActivity: Record<string, unknown[]>) => keeper.keep({ jobActivity, runs: [] }).jobActivity

  assert.deepEqual(pass({ a: [tool('1', 'running')] }), { a: [tool('1', 'running')] }, 'what hobkin sends goes on as it is')
  assert.deepEqual(pass({ a: [tool('1', 'done')], b: [tool('2', 'running')] }), { a: [tool('1', 'done')], b: [tool('2', 'running')] })
  // hobkin drops a job's activity once it ends. Its last steps stay, so its canvas can still be read.
  assert.deepEqual(pass({ b: [tool('2', 'done')] }), { a: [tool('1', 'done')], b: [tool('2', 'done')] })
  assert.deepEqual(pass({ c: [tool('3', 'running')] }), { a: [tool('1', 'done')], b: [tool('2', 'done')], c: [tool('3', 'running')] })
  // Only the newest that ended are kept.
  assert.deepEqual(pass({ d: [] }), { b: [tool('2', 'done')], c: [tool('3', 'running')], d: [] })
  assert.deepEqual(keeper.keep({ runs: [] }).jobActivity, { b: [tool('2', 'done')], c: [tool('3', 'running')], d: [] }, 'a snapshot with no activity keeps what ended')
})

test('the work slice travels whole, only when some of it changed', () => {
  const owner = { state: 'live', limits: { images: 4, imageBytes: 1024 } } as const
  const signIn = { status: 'signed-in' } as const
  const sync = new StateSync({ owner: { state: 'opening' }, signIn, models: null })
  const work = workFrom({ work: status(), waiting: { branches } })!

  const first = sync.update({ owner, signIn, models: null, snapshot: null, work })
  assert.deepEqual(first?.work, work, 'a UI starting over gets it with the reset')
  assert.equal(sync.update({ owner, signIn, models: null, snapshot: null, work: structuredClone(work) }), null, 'nothing changed, nothing sent')
  const off = { ...work, enabled: false }
  assert.deepEqual(sync.update({ owner, signIn, models: null, snapshot: null, work: off })?.work, off)
  assert.deepEqual(sync.full().work, off, 'a UI that connects later gets it at once')
})
