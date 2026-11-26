import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import {
  drawNext,
  firstMessageNext,
  latestWins,
  pageReady,
  pageRows,
  pageState,
  pageTurns,
  reloadKey,
  seenToSend,
  talkOpen,
  withDrawnTurns,
  type PageRow,
  type SentNote,
} from '../src/features/hobkins/conversation.ts'

const summary: HobkinSummary = {
  id: '0a1b2c3d',
  title: 'Tidy the docs',
  cwd: '/Users/someone/code/site',
  engine: { kind: 'tier', tier: 'mid' },
  state: 'working',
  turns: 3,
  run: 'hobkin:0a1b2c3d:3',
  last: { status: 'failed', said: '', at: '2026-11-13T10:04:00.000Z' },
  waiting: null,
  createdAt: '2026-11-13T10:00:00.000Z',
}

const turn = (n: number, status: HobkinTurn['status'], reply: string | null = null, error: string | null = null): HobkinTurn => ({
  n,
  run: `hobkin:0a1b2c3d:${n}`,
  asked: `message ${n}`,
  askedAt: `2026-11-13T10:0${n}:00.000Z`,
  status,
  reply,
  error,
  endedAt: status === 'running' ? null : `2026-11-13T10:0${n}:30.000Z`,
})

test('the page orders the turns and keeps the talk box until the hobkin is ended', () => {
  // Oldest first, and the turn in flight last, live, with what the user added while it works.
  const conversation: HobkinConversation = {
    hobkin: summary,
    turns: [turn(3, 'running'), turn(1, 'completed', 'Done.'), turn(2, 'failed', null, 'The model refused.')],
  }
  const steer: SentNote = { text: 'also the README', at: 5, run: 'hobkin:0a1b2c3d:3', started: false }
  const shown = pageTurns(conversation, summary, [steer])
  assert.deepEqual(shown.map(({ n, live }) => [n, live]), [[1, false], [2, false], [3, true]])
  assert.equal(shown[1]!.error, 'The model refused.', 'a failed turn keeps why')
  assert.deepEqual(shown[2]!.notes, [steer])
  assert.deepEqual(shown[0]!.notes, [])

  // The host has started a turn that the last read did not have yet: it shows at once, with the message that started it.
  const next = { ...summary, turns: 4, run: 'hobkin:0a1b2c3d:4' }
  const done = { hobkin: next, turns: [turn(1, 'completed', 'Done.'), turn(2, 'failed', null, 'The model refused.'), turn(3, 'completed', 'Both done.')] }
  const started: SentNote = { text: 'Now the changelog', at: 9, run: 'hobkin:0a1b2c3d:4', started: true }
  const waitingRead = pageTurns(done, next, [steer, started])
  assert.deepEqual(waitingRead.map(({ n, live, asked }) => [n, live, asked]), [
    [1, false, 'message 1'],
    [2, false, 'message 2'],
    [3, false, 'message 3'],
    [4, true, 'Now the changelog'],
  ])
  assert.deepEqual(waitingRead[2]!.notes, [steer], 'what was added to a turn stays with it after it ends')
  assert.deepEqual(waitingRead[3]!.notes, [], 'the message that started a turn is its own, not a note')
  assert.deepEqual(pageTurns({ ...done, turns: [...done.turns, turn(4, 'running')] }, next, [started]).at(-1)!.asked, 'message 4', 'once read, the turn is the host\'s')

  // While it waits nothing is in flight, and nothing is shown before the first read.
  const resting = { ...summary, state: 'waiting' as const, run: null }
  assert.ok(pageTurns(done, resting, []).every(({ live }) => !live))
  assert.deepEqual(pageTurns(null, resting, []), [])

  // The page reads again whenever the hobkin's turns, state or last words change, and only then.
  assert.notEqual(reloadKey(summary), reloadKey(next))
  assert.notEqual(reloadKey(summary), reloadKey(resting))
  assert.notEqual(reloadKey(resting), reloadKey({ ...resting, last: { status: 'completed', said: 'Done', at: '2026-11-13T10:09:00.000Z' } }))
  assert.equal(reloadKey(summary), reloadKey({ ...summary, title: 'Renamed', waiting: null }))
  assert.equal(reloadKey(undefined), null)

  // The talk box is there until the hobkin is ended: while it is being started, while it waits and while it works.
  assert.equal(pageState(summary, { known: true, started: false, ready: true }), 'live')
  assert.equal(pageState(undefined, { known: false, started: true, ready: true }), 'starting', 'just started, before the snapshot has it')
  assert.equal(pageState(undefined, { known: false, started: false, ready: false }), 'starting', 'before the host has said')
  assert.equal(pageState(undefined, { known: true, started: true, ready: true }), 'ended', 'gone from the snapshot once it was there')
  assert.equal(pageState(undefined, { known: false, started: false, ready: true }), 'ended', 'never there')
  assert.deepEqual((['live', 'starting', 'ended'] as const).map(talkOpen), [true, true, false])
})

test("each finished turn's steps show between its message and its answer, less the words the answer is", () => {
  const says = (id: string, text: string, at: number): ActivityEntry => ({ id, kind: 'assistant', text, at })
  const bash = (id: string, command: string, at: number): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state: 'completed', input: JSON.stringify({ command }), output: 'ok', at })
  const steps = (entries: ActivityEntry[]) => ({ entries, seenAt: () => undefined })
  const conversation: HobkinConversation = { hobkin: summary, turns: [turn(1, 'completed', 'Done.'), turn(2, 'failed', null, 'The model refused.'), turn(3, 'running')] }
  const steer: SentNote = { text: 'also the README', at: 2.5, run: 'hobkin:0a1b2c3d:1', started: false }
  const turns = pageTurns(conversation, summary, [steer])
  const finished = {
    'hobkin:0a1b2c3d:1': steps([says('message:3:0', 'Looking.', 1), bash('a', 'npm test', 2), says('message:7:0', 'Done.', 3)]),
    'hobkin:0a1b2c3d:2': steps([bash('b', 'npm run lint', 4), says('message:5:0', 'I could not finish.', 5)]),
  }
  const activity = steps([bash('c', 'npm run build', 6)])
  const rows = pageRows(turns, { sending: null, activity, finished })
  const read = (row: PageRow) => {
    if (row.kind === 'said') return `said ${row.text}`
    if (row.kind === 'step') return `${row.run.slice(-1)} ${row.step.kind}`
    return row.kind === 'answer' ? `answer ${row.turn.n}` : row.kind
  }
  assert.deepEqual(rows.map(read), [
    // What the user added while it worked stands where it was sent, and the words it ended on are its answer.
    'said message 1', '1 says', '1 shell', 'said also the README', 'answer 1',
    // A turn with no answer keeps the last words it said.
    'said message 2', '2 shell', '2 says', 'answer 2',
    'said message 3', '3 shell', 'thinking',
  ])
  assert.ok(rows.every((row) => row.kind !== 'step' || row.ended === (row.run !== 'hobkin:0a1b2c3d:3')), 'only the turn in flight still runs')
  const runs = (shown: readonly PageRow[]) => shown.flatMap((row) => (row.kind === 'step' ? [row.run] : []))
  assert.deepEqual(runs(pageRows(turns, { sending: null, activity })), ['hobkin:0a1b2c3d:3'], 'a finished turn whose steps the page has not read shows its message and answer')

  // The page watches the steps of each turn it draws, the one in flight too, so they are there the moment it ends, and
  // keeps a turn once drawn, so a turn whose steps push it out of sight is not let go.
  const drawn = withDrawnTurns([], rows.slice(-4))
  assert.deepEqual(drawn, ['hobkin:0a1b2c3d:2', 'hobkin:0a1b2c3d:3'])
  assert.equal(withDrawnTurns(drawn, rows.slice(-4)), drawn, 'the same list when no turn is new')
  assert.deepEqual(withDrawnTurns(drawn, rows), ['hobkin:0a1b2c3d:2', 'hobkin:0a1b2c3d:3', 'hobkin:0a1b2c3d:1'])
  assert.equal(withDrawnTurns(drawn, []), drawn)
})

test('a hobkin started with no message shows no conversation and waits for its first', () => {
  const fresh: HobkinSummary = { ...summary, title: 'New hobkin', state: 'waiting', turns: 0, run: null, last: null }
  assert.deepEqual(pageTurns({ hobkin: fresh, turns: [] }, fresh, []), [], 'nothing to show')
  assert.equal(firstMessageNext({ hobkin: fresh, started: true }), true)
  assert.equal(firstMessageNext({ hobkin: undefined, started: true }), true, 'just started, before the snapshot has it')
  assert.equal(firstMessageNext({ hobkin: undefined, started: false }), false, 'a page the host has not told about yet')
  assert.equal(firstMessageNext({ hobkin: summary, started: false }), false, 'one that has had turns')

  // The first message sent from the page starts its first turn, which shows at once with that message.
  const begun: HobkinSummary = { ...fresh, state: 'working', turns: 1, run: 'hobkin:0a1b2c3d:1' }
  const first: SentNote = { text: 'Fix the build', at: 1, run: 'hobkin:0a1b2c3d:1', started: true }
  assert.deepEqual(pageTurns({ hobkin: fresh, turns: [] }, begun, [first]).map(({ n, live, asked }) => [n, live, asked]), [[1, true, 'Fix the build']])
  assert.equal(firstMessageNext({ hobkin: begun, started: true }), false)
})

test('images sent from the page show with their message, on its way, once sent and once read', () => {
  const fresh: HobkinSummary = { ...summary, title: 'New hobkin', state: 'waiting', turns: 0, run: null, last: null }
  const begun: HobkinSummary = { ...fresh, state: 'working', turns: 1, run: 'hobkin:0a1b2c3d:1' }
  const chart = { id: 'local:1', name: 'chart.png', mimeType: 'image/png', preview: 'blob:chart', handle: 'host-chart' }
  const saidRows = (rows: ReturnType<typeof pageRows>) => rows.flatMap((row) => (row.kind === 'said' ? [[row.text, row.images ?? []]] : []))

  // Pictures alone, on their way, show as the user's message.
  assert.deepEqual(saidRows(pageRows([], { sending: { text: '', at: 1, images: [chart] }, activity: null })), [['', [chart]]])
  // Once sent they start the first turn, which shows them before any read has its words.
  const first: SentNote = { text: '', at: 1, run: 'hobkin:0a1b2c3d:1', started: true, images: [chart] }
  const turns = pageTurns({ hobkin: fresh, turns: [] }, begun, [first])
  assert.deepEqual(saidRows(pageRows(turns, { sending: null, activity: null })), [['', [chart]]])
  // A read has hobkin's words for them, and the row keeps the images the window sent.
  const read = pageTurns({ hobkin: begun, turns: [{ ...turn(1, 'running'), asked: 'Look at what I pasted.' }] }, begun, [first])
  assert.deepEqual(saidRows(pageRows(read, { sending: null, activity: null })), [['Look at what I pasted.', [chart]]])
  // Added while it works, they stay with the note.
  const added: SentNote = { text: 'and this', at: 2, run: 'hobkin:0a1b2c3d:1', started: false, images: [chart] }
  const later = pageTurns({ hobkin: begun, turns: [{ ...turn(1, 'running'), asked: 'Look at what I pasted.' }] }, begun, [first, added])
  assert.deepEqual(saidRows(pageRows(later, { sending: null, activity: null })).at(-1), ['and this', [chart]])
})

test('a turn that ends on screen is marked seen', () => {
  const wait = { ...summary, state: 'waiting' as const, run: null, waiting: { since: '2026-11-13T10:05:00.000Z', seen: false } }
  assert.equal(seenToSend({ hobkin: summary, onScreen: true, told: null }), null, 'not while it works')
  const told = seenToSend({ hobkin: wait, onScreen: true, told: null })
  assert.ok(told, 'its turn ended with the page on screen')
  assert.equal(seenToSend({ hobkin: wait, onScreen: true, told }), null, 'once for that wait')
  assert.equal(seenToSend({ hobkin: wait, onScreen: false, told: null }), null, 'not while the page is away')
  assert.equal(seenToSend({ hobkin: { ...wait, waiting: { ...wait.waiting, seen: true } }, onScreen: true, told: null }), null, 'not when the host knows already')
  const later = seenToSend({ hobkin: { ...wait, waiting: { since: '2026-11-13T10:20:00.000Z', seen: false } }, onScreen: true, told })
  assert.ok(later && later !== told, 'the next wait is told again')
  assert.equal(seenToSend({ hobkin: undefined, onScreen: true, told: null }), null)
})

test('a stale answer never replaces a newer one', () => {
  const reads = latestWins()
  const first = reads.begin()
  const second = reads.begin()
  assert.equal(reads.accept(second), true)
  assert.equal(reads.accept(first), false, 'the older read came back last')
  const third = reads.begin()
  assert.equal(reads.accept(third), true)
  const fourth = reads.begin()
  const fifth = reads.begin()
  assert.equal(reads.accept(fourth), true, 'an older one that comes back first still shows until the newer one does')
  assert.equal(reads.accept(fifth), true)
})

test('a turn another hobkin began says who sent it and has no checks, and the user\'s own turns name nobody', () => {
  const waiting: HobkinSummary = { ...summary, state: 'waiting', run: null, turns: 4 }
  const conversation: HobkinConversation = {
    hobkin: waiting,
    turns: [
      // One read from before messages between hobkins names nobody, which means the user.
      turn(1, 'completed', 'Done.'),
      { ...turn(2, 'completed', 'Told them.'), from: { kind: 'main' } },
      { ...turn(3, 'completed', 'Passing.'), from: { kind: 'hobkin', id: '9f8e7d6c', title: 'Check the build' } },
      { ...turn(4, 'completed', 'Yes.'), from: { kind: 'user' } },
    ],
  }
  const said = pageRows(pageTurns(conversation, waiting, []), { sending: null, activity: null }).flatMap((row) => (row.kind === 'said' ? [[row.text, row.from, row.delivery]] : []))
  assert.deepEqual(said, [
    ['message 1', null, 'received'],
    ['message 2', 'the main hobkin', null],
    ['message 3', 'Check the build', null],
    ['message 4', null, 'received'],
  ])
})

test("a turn a schedule began is one row named by its schedule, where its message was, and not a message from anyone", () => {
  const waiting: HobkinSummary = { ...summary, state: 'waiting', run: null, turns: 2 }
  const schedules = [{ id: 'sch-1', name: 'Watch CI for #412', note: 'Read the checks.', what: 'fired' }]
  const wake = `<hobkin-schedule>\n${JSON.stringify({ schedules })}\n</hobkin-schedule>`
  const woken = { ...turn(2, 'completed', 'CI failed on lint.'), asked: wake }
  const conversation: HobkinConversation = { hobkin: waiting, turns: [turn(1, 'completed', 'Watching.'), woken] }

  const rows = pageRows(pageTurns(conversation, waiting, []), { sending: null, activity: null })

  assert.deepEqual(rows.map((row) => row.kind), ['said', 'answer', 'wake', 'answer'])
  const row = rows[2] as Extract<PageRow, { kind: 'wake' }>
  assert.equal(row.wake.title, 'Watch CI for #412')
  assert.equal(row.key, 'hobkin:0a1b2c3d:2:asked', 'keyed as its message was')
  assert.equal(row.at, Date.parse('2026-11-13T10:02:00.000Z'), 'timed when the turn was asked')
  assert.equal(row.run, 'hobkin:0a1b2c3d:2')
})

test('a page draws its turns newest first, and the next older one only while the drawn ones are known and their rows do not fill the window', () => {
  const run = (n: number) => `hobkin:0a1b2c3d:${n}`
  const resting: HobkinSummary = { ...summary, state: 'waiting', run: null, turns: 5 }
  const conversation: HobkinConversation = { hobkin: resting, turns: [1, 2, 3, 4, 5].map((n) => turn(n, 'completed', `Done ${n}.`)) }
  const turns = pageTurns(conversation, resting, [])

  // Turns 5 and 4 have three steps each, a command, words and a command: a row each. The page has none of the others.
  const bash = (id: string, at: number): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state: 'completed', input: JSON.stringify({ command: `npm test -- ${id}` }), output: 'ok', at })
  const says = (id: string, at: number): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text: `Looking at ${id}.`, at })
  const steps = (n: number, count: number) => {
    const entries = Array.from({ length: count }, (_, index) => (index % 2 ? says : bash)(`${n}-${index}`, n * 10 + index))
    return { entries, seenAt: () => undefined }
  }
  const finished = { [run(5)]: steps(5, 3), [run(4)]: steps(4, 3) }
  /** The page's rows with the steps of the turns drawn that it has. */
  const rows = (drawn: readonly string[]) => {
    const drawnSteps = Object.fromEntries(drawn.filter((each) => finished[each]).map((each) => [each, finished[each]!]))
    return pageRows(turns, { sending: null, activity: null, finished: drawnSteps })
  }
  const known = (...runs: string[]) => (each: string) => runs.includes(each)
  const window = 8

  assert.deepEqual(drawNext([], { turns, rows: rows([]), known: known(), window }), { next: run(5), settled: false }, 'none drawn: the newest')
  assert.deepEqual(drawNext([run(5)], { turns, rows: rows([run(5)]), known: known(), window }), { next: null, settled: false }, 'its steps are on their way')
  // Its message, three steps and answer are five rows: fewer than eight, so the turn before it too.
  assert.deepEqual(drawNext([run(5)], { turns, rows: rows([run(5)]), known: known(run(5)), window }), { next: run(4), settled: false })
  // Five more rows: ten from turn 4's message to the end fill the window.
  const both = [run(5), run(4)]
  assert.deepEqual(drawNext(both, { turns, rows: rows(both), known: known(...both), window }), { next: null, settled: true })
  assert.deepEqual(drawNext(both, { turns, rows: rows(both), known: known(...both), window: 20 }), { next: run(3), settled: false }, 'a longer window takes more turns')
  const all = [5, 4, 3, 2, 1].map(run)
  assert.deepEqual(drawNext(all, { turns, rows: rows(all), known: known(...all), window: 100 }), { next: null, settled: true }, 'every turn drawn')
  assert.deepEqual(drawNext([], { turns: [], rows: [], known: known(), window }), { next: null, settled: true }, 'no turns')

  // A turn in flight is the newest: the page draws it first and, known, counts its rows.
  const live = pageTurns({ hobkin: summary, turns: [turn(1, 'completed', 'Done.'), turn(2, 'completed', 'Done.'), turn(3, 'running')] }, summary, [])
  const liveRows = pageRows(live, { sending: null, activity: steps(3, 2), finished: {} })
  assert.deepEqual(drawNext([run(3)], { turns: live, rows: liveRows, known: known(run(3)), window }), { next: run(2), settled: false })
})

test('a page shows whole once what it draws first is there, and at once when there is nothing to wait for', () => {
  const ready = { connected: true, state: 'live' as const, fresh: false, problem: null, read: true, settled: true }
  assert.equal(pageReady(ready), true)
  assert.equal(pageReady({ ...ready, read: false }), false, 'before its conversation is read')
  assert.equal(pageReady({ ...ready, settled: false }), false, 'before its newest turns\' steps are known')
  assert.equal(pageReady({ ...ready, read: false, settled: false, connected: false }), true, 'no host to wait for')
  assert.equal(pageReady({ ...ready, read: false, settled: false, problem: 'refused' }), true, 'the read failed: the page says so')
  assert.equal(pageReady({ ...ready, read: false, settled: false, fresh: true }), true, 'no turn yet')
  assert.equal(pageReady({ ...ready, read: false, settled: false, state: 'ended' }), true, 'ended')
})
