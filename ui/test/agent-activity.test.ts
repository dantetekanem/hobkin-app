import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { atOf, doingNow, exchangeOf, foldOf, looksSummary, pauseOf, stepCount, stepsOf, tailOf, type Step } from '../src/features/agent-activity/steps.ts'

const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const tool = (id: string, name: string, args: object, state: ActivityEntry['state'] = 'completed', output = ''): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name,
  state,
  input: JSON.stringify(args, null, 2),
  output,
})
const bash = (id: string, command: string, state: ActivityEntry['state'] = 'completed', output = '') => tool(id, 'bash', { command }, state, output)
const edit = (id: string, path: string, oldText: string, newText: string, state: ActivityEntry['state'] = 'completed') =>
  tool(id, 'edit', { path, edits: [{ oldText, newText }] }, state, state === 'failed' ? `Could not find the exact text in ${path}.` : `Successfully replaced 1 block(s) in ${path}.`)
const kinds = (steps: readonly Step[]) => steps.map((step) => step.kind)

test('the agent\'s own words are steps of their own, and a text not begun yet is not', () => {
  const steps = stepsOf([said('1:0', 'I will look at the **session** code.'), said('2:0', '')])
  assert.deepEqual(kinds(steps), ['says'])
  assert.equal(steps[0]!.kind === 'says' && steps[0]!.text, 'I will look at the **session** code.')
})

test('edits to one file in a row are one change, and another file starts a new one', () => {
  const steps = stepsOf([
    edit('1', 'src/auth/session.ts', 'const a = 1', 'const a = 2'),
    edit('2', 'src/auth/session.ts', 'return null', 'return session'),
    // An edit to text an earlier edit wrote: the change so far goes from the first old text to the latest new one.
    edit('3', 'src/auth/session.ts', 'const a = 2', 'const a = 3'),
    edit('4', 'src/auth/redirect.ts', 'next', 'safeNext(next)'),
    edit('5', 'src/auth/session.ts', 'x', 'y'),
  ])
  assert.deepEqual(kinds(steps), ['change', 'change', 'change'])
  const [first, other, again] = steps.map((step) => (step.kind === 'change' ? step.change : null))
  assert.equal(first?.path, 'src/auth/session.ts')
  assert.deepEqual(first?.hunks, [
    { oldText: 'const a = 1', newText: 'const a = 3' },
    { oldText: 'return null', newText: 'return session' },
  ])
  assert.equal(first?.calls, 3)
  assert.equal(other?.path, 'src/auth/redirect.ts')
  assert.equal(again?.path, 'src/auth/session.ts')
})

test('a whole file written is drawn whole, and an edit after it changes the file as written', () => {
  const [step] = stepsOf([
    tool('1', 'write', { path: '/repo/src/new.ts', content: 'export const a = 1\n' }),
    edit('2', '/repo/src/new.ts', 'a = 1', 'a = 2'),
  ], { cwd: '/repo' })
  assert.ok(step?.kind === 'change')
  assert.equal(step.change.path, 'src/new.ts', 'a path inside the agent\'s folder is shown from there')
  assert.equal(step.change.whole, 'export const a = 2\n')
})

test('an edit that failed is marked with its message and changes nothing', () => {
  const [step] = stepsOf([edit('1', 'a.ts', 'one', 'two'), edit('2', 'a.ts', 'missing', 'three', 'failed')])
  assert.ok(step?.kind === 'change')
  assert.deepEqual(step.change.hunks, [{ oldText: 'one', newText: 'two' }])
  assert.deepEqual(step.change.failures, ['Could not find the exact text in a.ts.'])
  assert.equal(step.change.state, 'done', 'what did apply still stands')
})

test('Pi\'s older edit shapes are read too', () => {
  const [single, text] = stepsOf([
    tool('1', 'edit', { path: 'a.ts', oldText: 'one', newText: 'two' }),
    said('2:0', 'Next.'),
    tool('3', 'edit', { path: 'a.ts', edits: JSON.stringify([{ oldText: 'two', newText: 'three' }]) }),
  ]).filter((step) => step.kind === 'change')
  assert.ok(single?.kind === 'change' && text?.kind === 'change')
  assert.deepEqual(single.change.hunks, [{ oldText: 'one', newText: 'two' }])
  assert.deepEqual(text.change.hunks, [{ oldText: 'two', newText: 'three' }])
})

test('commands in a row fold into one group with the newest open', () => {
  const five = ['pnpm install', 'pnpm lint', 'pnpm typecheck', 'pnpm build', 'pnpm test'].map((command, index) => bash(`${index}`, command))
  const [group] = stepsOf(five)
  assert.ok(group?.kind === 'shell')
  const { folded, open } = foldOf(group.commands)
  assert.deepEqual(folded.map((command) => command.command), ['pnpm install', 'pnpm lint', 'pnpm typecheck', 'pnpm build'])
  assert.deepEqual(open.map((command) => command.command), ['pnpm test'])

  // A sixth starts: the fifth joins the fold, and the sixth is open.
  const [six] = stepsOf([...five, bash('5', 'pnpm test auth', 'running')])
  assert.ok(six?.kind === 'shell')
  assert.equal(six.key, group.key, 'the group stays the same block')
  assert.equal(foldOf(six.commands).folded.length, 5)
  assert.deepEqual(foldOf(six.commands).open.map((command) => [command.command, command.state]), [['pnpm test auth', 'running']])

  // Words between commands end the run.
  assert.deepEqual(kinds(stepsOf([bash('a', 'ls'), said('1:0', 'Now the tests.'), bash('b', 'pnpm test')])), ['shell', 'says', 'shell'])
})

test('a step says when it began, and each command and read in a group when it happened', () => {
  const at = (entry: ActivityEntry, time: number): ActivityEntry => ({ ...entry, at: time })
  const steps = stepsOf([
    at(said('1:0', 'Looking first.'), 100),
    at(bash('a', 'ls'), 200),
    at(bash('b', 'pwd'), 300),
    at(tool('c', 'read', { path: 'a.ts' }), 400),
    // From a runtime that kept no times.
    tool('d', 'read', { path: 'b.ts' }),
  ])
  assert.deepEqual(steps.map(atOf), [100, 200, 400])
  const [, shell, looks] = steps
  assert.deepEqual(shell?.kind === 'shell' && shell.commands.map((command) => command.at), [200, 300])
  assert.deepEqual(looks?.kind === 'looks' && looks.looks.map((look) => look.at), [400, undefined])
  assert.equal(atOf(stepsOf([tool('e', 'read', { path: 'c.ts' })])[0]!), undefined)
})

test('a failed command stays out of the fold, with its exit code and its last lines', () => {
  const [group] = stepsOf([
    bash('1', 'pnpm install'),
    bash('2', 'pnpm test', 'failed', 'FAIL src/auth/session.test.ts\n  expected 302, got 200\n\nCommand exited with code 1'),
    bash('3', 'pnpm lint'),
    bash('4', 'pnpm build'),
  ])
  assert.ok(group?.kind === 'shell')
  const { folded, open } = foldOf(group.commands)
  assert.deepEqual(folded.map((command) => command.command), ['pnpm install', 'pnpm lint'], 'the fold counts only the ones that passed')
  assert.deepEqual(open.map((command) => command.command), ['pnpm test', 'pnpm build'])
  const failed = open[0]!
  assert.equal(failed.exitCode, 1)
  assert.equal(failed.failure, 'Command exited with code 1')
  assert.equal(failed.output, 'FAIL src/auth/session.test.ts\n  expected 302, got 200', "Pi's status line is said once, as the failure")
  assert.deepEqual(tailOf(failed.output, 12).lines, ['FAIL src/auth/session.test.ts', '  expected 302, got 200'])
})

test('a running command keeps a tail of twelve lines', () => {
  const output = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
  const [group] = stepsOf([bash('1', 'pnpm test', 'running', output)])
  assert.ok(group?.kind === 'shell')
  const tail = tailOf(group.commands[0]!.output, 12)
  assert.equal(tail.lines.length, 12)
  assert.equal(tail.lines[0], 'line 29')
  assert.equal(tail.lines.at(-1), 'line 40')
  assert.equal(tail.hidden, 28, 'and says how many lines are above it')
  assert.deepEqual(tailOf('', 12), { lines: [], hidden: 0 })
  assert.deepEqual(tailOf('one\ntwo\n', 12), { lines: ['one', 'two'], hidden: 0 }, 'a closing newline is not a line')

  // Once its job has ended, a command still marked running did not finish.
  const [ended] = stepsOf([bash('1', 'pnpm test', 'running')], { ended: true })
  assert.ok(ended?.kind === 'shell')
  assert.equal(ended.commands[0]!.state, 'stopped')
})

test('reads and searches in a row are one group', () => {
  const steps = stepsOf([
    tool('1', 'read', { path: 'src/auth/session.ts' }),
    tool('2', 'read', { path: 'src/auth/redirect.ts', offset: 40, limit: 41 }),
    tool('3', 'grep', { pattern: 'redirect', path: 'src' }),
    tool('4', 'find', { pattern: '**/*.test.ts' }),
    tool('5', 'ls', { path: 'src/auth' }),
    tool('6', 'fetch_content', { url: 'https://nextjs.org/docs/app/redirects' }),
    tool('7', 'read', { path: 'src/auth/session.ts' }),
    tool('8', 'read', { path: 'missing.ts' }, 'failed', 'ENOENT: no such file or directory'),
    bash('9', 'pnpm test'),
  ])
  assert.deepEqual(kinds(steps), ['looks', 'shell'])
  const [group] = steps
  assert.ok(group?.kind === 'looks')
  assert.deepEqual(
    group.looks.map(({ kind, what, where }) => [kind, what, where]),
    [
      ['read', 'src/auth/session.ts', undefined],
      ['read', 'src/auth/redirect.ts', 'lines 40 to 80'],
      ['search', 'redirect', 'in src'],
      ['search', '**/*.test.ts', undefined],
      ['list', 'src/auth', undefined],
      ['fetch', 'https://nextjs.org/docs/app/redirects', undefined],
      ['read', 'src/auth/session.ts', undefined],
      ['read', 'missing.ts', undefined],
    ],
  )
  assert.equal(group.looks.at(-1)!.failure, 'ENOENT: no such file or directory')
  assert.equal(looksSummary(group.looks), 'Read 3 files, searched twice, listed a folder and fetched a page')
  assert.equal(looksSummary(group.looks.slice(2, 3)), 'Searched once')
})

test('a read keeps the text it gave back, from the line it started at, without Pi\'s closing note', () => {
  const [group] = stepsOf([
    tool('1', 'read', { path: 'src/a.ts', offset: 40, limit: 2 }, 'completed', 'const a = 1\nconst b = 2\n\n[3 more lines in file. Use offset=42 to continue.]'),
    tool('2', 'read', { path: 'b.ts' }, 'completed', '# B'),
    tool('3', 'read', { path: 'c.ts' }, 'running'),
  ])
  assert.ok(group?.kind === 'looks')
  assert.deepEqual(
    group.looks.map(({ text, from, notice }) => [text, from, notice]),
    [
      ['const a = 1\nconst b = 2', 40, '3 more lines in file. Use offset=42 to continue.'],
      ['# B', 1, undefined],
      [undefined, undefined, undefined],
    ],
  )
})

test('any other tool is one step with its name, its first argument and its output', () => {
  const [step] = stepsOf([tool('1', 'sparsity_scan', { path: 'src', depth: 2 }, 'failed', 'Scan stopped: too many files')])
  assert.ok(step?.kind === 'tool')
  assert.equal(step.name, 'sparsity_scan')
  assert.equal(step.summary, 'src')
  assert.equal(step.state, 'failed')
  assert.equal(step.failure, 'Scan stopped: too many files')
})

test('where the page shows the tasks in their own line, task calls are not steps, and one that failed still is', () => {
  const work = [
    bash('1', 'git status'),
    tool('2', 'task_update', { taskId: '2', status: 'in_progress' }, 'completed', 'Updated task #2 status'),
    bash('3', 'pnpm test'),
    tool('4', 'task_done', { taskId: '9' }, 'failed', 'Task #9 not found'),
    tool('5', 'task_output', { task_id: 'b1' }, 'completed', 'build finished'),
  ]
  const steps = stepsOf(work, { tasksOnLine: true })
  // The commands on either side of a task call are one group, as if it were not there.
  assert.deepEqual(kinds(steps), ['shell', 'tool', 'tool'])
  assert.equal(steps[0]!.kind === 'shell' && steps[0]!.commands.length, 2)
  assert.deepEqual(steps.slice(1).map((step) => step.kind === 'tool' && [step.name, step.state]), [['task_done', 'failed'], ['task_output', 'done']])
  // A page without the line still draws every call.
  assert.deepEqual(kinds(stepsOf(work)), ['shell', 'tool', 'shell', 'tool', 'tool'])
})

test('thinking is hidden except when long or important', () => {
  // hobkin keeps no thinking, so none can be drawn. Between steps the canvas says the agent is thinking, and since when.
  const steps = stepsOf([said('1:0', 'Looking.'), bash('1', 'ls')])
  assert.ok(steps.every((step) => !('thinking' in step)))
  assert.equal(pauseOf([said('1:0', 'Looking.'), bash('1', 'ls')]), 'thinking', 'after a tool, the agent is thinking')
  assert.equal(pauseOf([bash('1', 'ls', 'running')]), null, 'not while a tool runs')
  assert.equal(pauseOf([said('1:0', 'Looking.')]), null, 'not while it writes')
  assert.equal(pauseOf([bash('1', 'ls')], { ended: true }), null, 'not once it has ended')
  assert.equal(pauseOf([]), 'thinking', 'before its first step')
})

test('what it is doing now fits one line: the tool it runs, or the last thing it said', () => {
  assert.deepEqual(doingNow([bash('1', 'pnpm test auth\n# and more', 'running')]), { lead: 'Running', subject: 'pnpm test auth', code: true })
  assert.deepEqual(doingNow([edit('1', '/repo/src/app.ts', 'a', 'b', 'running')], { cwd: '/repo' }), { lead: 'Editing', subject: 'src/app.ts', code: true })
  assert.deepEqual(doingNow([tool('1', 'read', { path: 'README.md' }, 'running')]), { lead: 'Reading', subject: 'README.md', code: true })
  assert.deepEqual(doingNow([tool('1', 'grep', { pattern: 'redirect' }, 'running')]), { lead: 'Searching for', subject: 'redirect', code: true })
  assert.deepEqual(doingNow([bash('1', 'pnpm test', 'failed', 'x\n\nCommand exited with code 1')]), { lead: 'Failed', subject: 'pnpm test', code: true, failed: true, note: 'exit code 1' })
  assert.deepEqual(doingNow([bash('1', 'pnpm lint')]), { lead: 'Ran', subject: 'pnpm lint', code: true })
  assert.deepEqual(doingNow([said('1:0', 'The redirect loop came from `next`. I fixed it in **session.ts**. Running the tests again.'), said('2:0', '')]), { lead: 'Running the tests again.' })
  assert.equal(doingNow([]), null)
  assert.equal(stepCount([said('1:0', 'Hi.'), said('2:0', ''), bash('1', 'ls'), edit('2', 'a.ts', 'a', 'b')]), 3)
})

test('the user\'s messages sit where they were sent, and split a run of steps around them', () => {
  const entries = [bash('1', 'ls'), bash('2', 'pnpm test'), bash('3', 'pnpm lint')]
  const seen: Record<string, number> = { 'tool:1': 100, 'tool:2': 200, 'tool:3': 300 }
  const items = exchangeOf(entries, [{ id: 'n1', text: 'Skip the lint.', at: 250 }, { id: 'n2', text: 'Thanks.', at: 400 }], { seenAt: (id) => seen[id] })
  assert.deepEqual(
    items.map((item) => (item.kind === 'note' ? item.note.text : item.kind === 'shell' ? item.commands.map(({ command }) => command).join(', ') : item.kind)),
    ['ls, pnpm test', 'Skip the lint.', 'pnpm lint', 'Thanks.'],
  )
  // Steps the window saw before it could time them come before any message.
  assert.deepEqual(exchangeOf(entries, [{ id: 'n1', text: 'Hi', at: 1 }], { seenAt: () => undefined }).map((item) => item.kind), ['shell', 'note'])
  // A step hobkin timed is placed by that time, the one its row shows, whenever the window first saw it.
  const timed = entries.map((entry, index) => ({ ...entry, at: 1000 + index * 100 }))
  const late = exchangeOf(timed, [{ id: 'n1', text: 'Skip the lint.', at: 1150 }], { seenAt: () => 5000 })
  assert.deepEqual(late.map((item) => (item.kind === 'note' ? 'note' : item.kind === 'shell' ? item.commands.length : item.kind)), [2, 'note', 1])
})
