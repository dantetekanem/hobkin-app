import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { progressOf, taskLine, tasksOf, type AgentTask } from '../src/features/agent-activity/tasks.ts'

// Entries as hobkin keeps them (src/cli/job-activity.mjs): the arguments as indented JSON, the result's text only.
const call = (id: string, name: string, args: object, output: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name,
  state,
  input: JSON.stringify(args, null, 2),
  output,
})

// The words pi-solid-tasks prints (src/index.ts and prompts/task-done-handoff.md).
const handoff = (id: string, state: 'ready' | 'waiting' | 'complete', context: object) =>
  [
    `Task #${id} completed.`,
    `Queue state: ${state}`,
    '',
    JSON.stringify(context, null, 2),
    '',
    '- ready: Use nextTask directly and claim/start it with task_update. The suggestion is not a reservation; the tool rechecks readiness. Do not refetch unless stale.',
    '- waiting: Respect unfinished owners and blockers. Continue eligible authorized work; otherwise preserve state and report the blocker or await the existing delegated result. Do not poll, invent a wake-up, or undo work just to empty the queue.',
    '- complete: After verifying the overall outcome, call tasks_done unless the user requested retaining records.',
    '',
    'No new permission is granted. Complete each task only when its acceptance criteria pass.',
  ].join('\n')

const plan = call(
  'b1',
  'tasks_create_in_batch',
  {
    tasks: [
      { subject: 'Read the protocol specs', description: 'Read public specifications.\nReturn dates and licenses.', activeForm: 'Reading the specs' },
      { subject: 'Write the landscape report', description: 'Integrate the evidence into protocols.md.', activeForm: 'Writing the landscape' },
      { subject: 'Verify and record protocols.md', description: 'Read the finished report.\n#9 [pending] is how a list line looks, not a task.' },
    ],
  },
  [
    '#1 [pending] Read the protocol specs',
    'Read public specifications.',
    'Return dates and licenses.',
    '#2 [pending] Write the landscape report',
    'Integrate the evidence into protocols.md.',
    '#3 [pending] Verify and record protocols.md',
    'Read the finished report.',
    '#9 [pending] is how a list line looks, not a task.',
  ].join('\n'),
)
const start = (n: string, id: string) => call(n, 'task_update', { taskId: id, owner: 'lead', status: 'in_progress' }, `Updated task #${id} status, owner`)
const doneOne = call('d1', 'task_done', { taskId: '1' }, handoff('1', 'ready', {
  owner: 'lead',
  nextTask: { id: '2', subject: 'Write the landscape report', description: 'Integrate the evidence into protocols.md.', status: 'pending', order: 0, activeForm: 'Writing the landscape', metadata: {}, blocks: [], blockedBy: [], createdAt: 1794002042095, updatedAt: 1794002073706 },
}))
const appended = call(
  'a1',
  'task_append',
  { taskId: '2', subject: 'Post-process the completed change and verify', description: 'Run the post-processing skills on the changed files.' },
  'Task #4 created successfully: Post-process the completed change and verify\nExecution queue: #2, #4, #3',
)
const prepended = call(
  'p1',
  'task_prepend',
  { taskId: '4', subject: 'Check remaining protocol coverage', description: 'Run a bounded gap inventory.', activeForm: 'Checking coverage' },
  'Task #6 created successfully: Check remaining protocol coverage\nExecution queue: #2, #6, #4, #3',
)

const run = [plan, start('u1', '1'), doneOne, start('u2', '2'), appended]
const brief = (tasks: readonly AgentTask[]) => tasks.map((task) => `${task.id} ${task.state} ${task.title}`)

test('an agent that used no task tool has no tasks', () => {
  const work: ActivityEntry[] = [
    { id: 'message:1:0', kind: 'assistant', text: 'I will read the code first.' },
    call('r1', 'read', { path: 'src/main.ts' }, 'export {}'),
    call('s1', 'bash', { command: 'git status' }, 'nothing to commit'),
  ]
  assert.deepEqual(tasksOf(work), [])
  assert.deepEqual(tasksOf([]), [])
})

test('a plan made in one call lists its tasks in order, each waiting, and skips a description line that only looks like a task', () => {
  const tasks = tasksOf([plan])
  assert.deepEqual(brief(tasks), ['1 queued Read the protocol specs', '2 queued Write the landscape report', '3 queued Verify and record protocols.md'])
  assert.deepEqual(tasks.map((task) => task.order), [0, 1, 2])
  assert.equal(tasks[0]!.doing, 'Reading the specs')
})

test('a task started is the one worked on now, and a finished one is done', () => {
  assert.deepEqual(brief(tasksOf([plan, start('u1', '1')])), ['1 now Read the protocol specs', '2 queued Write the landscape report', '3 queued Verify and record protocols.md'])
  assert.deepEqual(brief(tasksOf([plan, start('u1', '1'), doneOne])), ['1 done Read the protocol specs', '2 queued Write the landscape report', '3 queued Verify and record protocols.md'])
  // Completing through task_update does the same.
  const completed = call('u9', 'task_update', { taskId: '1', status: 'completed' }, 'Updated task #1 status')
  assert.deepEqual(brief(tasksOf([plan, completed])).slice(0, 1), ['1 done Read the protocol specs'])
})

test('an appended task takes its place in the execution queue the tool printed', () => {
  const tasks = tasksOf(run)
  assert.deepEqual(brief(tasks), ['1 done Read the protocol specs', '2 now Write the landscape report', '4 queued Post-process the completed change and verify', '3 queued Verify and record protocols.md'])
  assert.deepEqual(progressOf(tasks), { done: 1, total: 4, now: [tasks[1]], next: tasks[2] })
})

test('the queue reordered by a prepended task, and by a later list, is the order shown', () => {
  assert.deepEqual(tasksOf([...run, prepended]).map((task) => task.id), ['1', '2', '6', '4', '3'])
  // task_list prints the open tasks in the order they run, with owners and blockers after the titles.
  const listed = call(
    'l1',
    'task_list',
    {},
    [
      '#2 [in_progress] Write the landscape report (lead)',
      '#3 [pending] Verify and record protocols.md',
      '#6 [pending] Check remaining protocol coverage [blocked by #2]',
      '#4 [pending] Post-process the completed change and verify [blocked by #3, #6]',
      '#1 [completed] Read the protocol specs',
    ].join('\n'),
  )
  const tasks = tasksOf([...run, prepended, listed])
  assert.deepEqual(brief(tasks), [
    '1 done Read the protocol specs',
    '2 now Write the landscape report',
    '3 queued Verify and record protocols.md',
    '6 queued Check remaining protocol coverage',
    '4 queued Post-process the completed change and verify',
  ])
})

test('every result read twice, as activity replayed, gives the same list', () => {
  const once = tasksOf([...run, prepended])
  const twice = tasksOf([...run, prepended, ...run, prepended])
  assert.deepEqual(twice, once)
  // The same calls under new ids, as a session replayed into a fresh feed.
  const again = [...run, prepended].map((entry) => ({ ...entry, id: `${entry.id}:again` }))
  assert.deepEqual(tasksOf([...run, prepended, ...again]), once)
})

test('a task tool whose output is an error changes nothing', () => {
  const before = tasksOf(run)
  const refused = call('u3', 'task_update', { taskId: '3', status: 'in_progress', owner: 'lead' }, 'Task #3 cannot start before earlier tasks #4 are completed or actively owned by another owner')
  const missing = call('a2', 'task_append', { taskId: '9', subject: 'Nowhere to go', description: '...' }, 'Task #9 not found', 'failed')
  const anchored = call('c1', 'task_create', { subject: 'After a done one', description: '...', position: { type: 'after', taskId: '1' } }, 'Task #1 is completed; choose an open task as the position anchor')
  const notFound = call('u4', 'task_update', { taskId: '12', status: 'completed' }, 'Task #12 not found')
  const waitRefused = call('w1', 'task_wait', { taskId: '2', reason: 'CI', expectedSignal: 'green' }, 'No unique caller-owned review subscription. Use agentic_code_review_subscribe before task_wait.', 'failed')
  assert.deepEqual(tasksOf([...run, refused, missing, anchored, notFound, waitRefused]), before)
})

test('a task call still running changes nothing until it finishes', () => {
  const pending = call('c2', 'task_create', { subject: 'Not yet', description: '...' }, '', 'running')
  assert.deepEqual(tasksOf([...run, pending]), tasksOf(run))
})

test('tasks made one by one go where their position says, and a deleted one leaves the list', () => {
  const first = call('c1', 'task_create', { subject: 'Write the failing test', description: '...', activeForm: 'Writing the test' }, 'Task #1 created successfully: Write the failing test')
  const second = call('c2', 'task_create', { subject: 'Make it pass', description: '...' }, 'Task #2 created successfully: Make it pass')
  const front = call('c3', 'task_create', { subject: '#81 Read the issue', description: '...', position: { type: 'beginning' } }, 'Task #3 created successfully: #81 Read the issue')
  assert.deepEqual(brief(tasksOf([first, second, front])), ['3 queued #81 Read the issue', '1 queued Write the failing test', '2 queued Make it pass'])
  const deleted = call('u1', 'task_update', { taskId: '1', status: 'deleted' }, 'Updated task #1 deleted')
  assert.deepEqual(tasksOf([first, second, front, deleted]).map((task) => task.id), ['3', '2'])
  const renamed = call('u2', 'task_update', { taskId: '2', subject: 'Make the test pass' }, 'Updated task #2 subject')
  assert.equal(tasksOf([first, second, renamed])[1]!.title, 'Make the test pass')
})

test('a finish that lists what is still open settles the whole queue, and finished tasks stay once cleared', () => {
  const waiting = call('d2', 'task_done', { taskId: '2' }, handoff('2', 'waiting', {
    unfinished: [
      { id: '6', subject: 'Check remaining protocol coverage', status: 'in_progress', owner: 'network-standards', blockedBy: [] },
      { id: '4', subject: 'Post-process the completed change and verify', status: 'pending', blockedBy: ['6'] },
      { id: '3', subject: 'Verify and record protocols.md', status: 'pending', blockedBy: ['4'] },
    ],
  }))
  const tasks = tasksOf([...run, prepended, waiting])
  assert.deepEqual(brief(tasks), [
    '1 done Read the protocol specs',
    '2 done Write the landscape report',
    '6 now Check remaining protocol coverage',
    '4 queued Post-process the completed change and verify',
    '3 queued Verify and record protocols.md',
  ])
  const finish = ['6', '4', '3'].map((id) => call(`f${id}`, 'task_update', { taskId: id, status: 'completed' }, `Updated task #${id} status`))
  const complete = call('d9', 'task_done', { taskId: '3' }, handoff('3', 'complete', { unfinished: [] }))
  const cleared = call('x1', 'tasks_done', {}, 'Cleared 5 completed tasks. No tasks found')
  const all = tasksOf([...run, prepended, waiting, ...finish, complete, cleared])
  assert.equal(all.length, 5)
  assert.ok(all.every((task) => task.state === 'done'))
  assert.deepEqual(progressOf(all), { done: 5, total: 5, now: [] })
})

test('a stopped task waits again, and a wait keeps it the one worked on', () => {
  const stopped = call('s1', 'task_stop', { task_id: '2' }, 'Task #2 stopped successfully and returned to pending')
  assert.equal(tasksOf([...run, stopped]).find((task) => task.id === '2')!.state, 'queued')
  const waits = call('w1', 'task_wait', { taskId: '2', schedulerTaskId: 'ci', reason: 'CI runs', expectedSignal: 'CI result' }, 'Waiting on #2: CI runs\nExpected signal: CI result\nScheduler: ci. Task remains in progress; the next agent run clears this wait.')
  assert.equal(tasksOf([...run, stopped, waits]).find((task) => task.id === '2')!.state, 'now')
})

test('a task only seen by its number is listed under that number until its title is known', () => {
  const update = call('u1', 'task_update', { taskId: '7', status: 'in_progress' }, 'Updated task #7 status')
  assert.deepEqual(brief(tasksOf([update])), ['7 now '])
  const got = call('g1', 'task_get', { taskId: '7' }, 'Task #7: Redesign Balance history\nStatus: in_progress\nOwner: lead\nDescription: Keep the totals.')
  assert.deepEqual(brief(tasksOf([update, got])), ['7 now Redesign Balance history'])
})

test('tasks in a group carry its title, and the group itself is not a task', () => {
  const grouped = call(
    'b2',
    'tasks_create_in_batch',
    { tasks: [{ kind: 'group', subject: 'Ship the release', description: 'Everything for 0.9.0.', children: [{ subject: 'Bump the version', description: 'Bump it.' }, { subject: 'Tag it', description: 'Tag it.' }] }] },
    ['#1 [pending] Ship the release', 'Everything for 0.9.0.', '├─ #2 [pending] Bump the version (parent #1)', 'Bump it.', '└─ #3 [pending] Tag it (parent #1)', 'Tag it.'].join('\n'),
  )
  const tasks = tasksOf([grouped])
  assert.deepEqual(tasks.map((task) => [task.id, task.group]), [['2', 'Ship the release'], ['3', 'Ship the release']])
  const listed = call('l1', 'task_list', {}, ['#1 [in_progress] Ship the release [1/2 tasks · 50%]', '├─ #2 [completed] Bump the version', '└─ #3 [in_progress] Tag it (lead)', 'Execution queue: #3'].join('\n'))
  assert.deepEqual(brief(tasksOf([grouped, listed])), ['2 done Bump the version', '3 now Tag it'])
})

test('an empty list from the tool leaves only what was finished', () => {
  const empty = call('l2', 'task_list', {}, 'No tasks found')
  assert.deepEqual(brief(tasksOf([...run, empty])), ['1 done Read the protocol specs'])
})

test('each task keeps the description it was given, and a later one replaces it', () => {
  const described = (tasks: readonly AgentTask[]) => Object.fromEntries(tasks.map((task) => [task.id, task.description]))
  assert.deepEqual(described(tasksOf(run)), {
    '1': 'Read public specifications.\nReturn dates and licenses.',
    '2': 'Integrate the evidence into protocols.md.',
    '4': 'Run the post-processing skills on the changed files.',
    '3': 'Read the finished report.\n#9 [pending] is how a list line looks, not a task.',
  })
  const created = call('c1', 'task_create', { subject: 'Write the failing test', description: 'A test that fails first.' }, 'Task #1 created successfully: Write the failing test')
  const changed = call('u1', 'task_update', { taskId: '1', description: 'A test that fails for the right reason.' }, 'Updated task #1 description')
  assert.equal(tasksOf([created, changed])[0]!.description, 'A test that fails for the right reason.')
  // Known only by what task_get printed, or by the next task a finish handed over.
  const update = call('u2', 'task_update', { taskId: '7', status: 'in_progress' }, 'Updated task #7 status')
  const got = call('g1', 'task_get', { taskId: '7' }, 'Task #7: Redesign Balance history\nStatus: in_progress\nOwner: lead\nDescription: Keep the totals.\nAnd the dates.\nBlocks: #8')
  assert.equal(tasksOf([update, got])[0]!.description, 'Keep the totals.\nAnd the dates.')
  const next = call('d1', 'task_done', { taskId: '1' }, handoff('1', 'ready', { nextTask: { id: '2', subject: 'Make it pass', description: 'Only what the test needs.', status: 'pending' } }))
  assert.equal(tasksOf([created, next]).find((task) => task.id === '2')!.description, 'Only what the test needs.')
})

test('the tasks read as one line: how many are done, then the one in progress, the next one, or that all are done', () => {
  assert.equal(taskLine(progressOf(tasksOf(run))).text, '1 of 4 tasks · in progress: Write the landscape report')
  assert.equal(taskLine(progressOf(tasksOf([plan]))).text, '0 of 3 tasks · next: Read the protocol specs')
  const done = tasksOf([plan, ...['1', '2', '3'].map((id) => call(`f${id}`, 'task_update', { taskId: id, status: 'completed' }, `Updated task #${id} status`))])
  assert.equal(taskLine(progressOf(done)).text, '3 of 3 tasks · all done')
  // One task is a task, two in progress name the first and count the other, and a task known by its number is named by it.
  const one = call('u1', 'task_update', { taskId: '7', status: 'in_progress' }, 'Updated task #7 status')
  assert.equal(taskLine(progressOf(tasksOf([one]))).text, '0 of 1 task · in progress: Task 7')
  const both = tasksOf([plan, start('u1', '1'), start('u2', '2')])
  assert.deepEqual(taskLine(progressOf(both)), { count: '0 of 3 tasks', lead: 'in progress', title: 'Read the protocol specs', more: 1, text: '0 of 3 tasks · in progress: Read the protocol specs +1' })
})
