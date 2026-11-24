import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import type { ClaudeTiers } from '#shared/tiers/claude-code.ts'
import type { TierId } from '#shared/tiers/tiers.ts'
import { scheduleDirections } from '../src/claude-code/directions.ts'
import { routeHarness, type ClaudeLaunch, type HarnessRoute, type RunFacts } from '../src/claude-code/route.ts'

interface Call {
  harness: 'pi' | 'claude'
  request: Record<string, unknown>
  options: unknown
  launch?: ClaudeLaunch
}

/** A router over fake harnesses, with the runs hobkin has admitted by harness id. */
function router(
  settings: ClaudeCodeSettings & { tiers?: ClaudeTiers },
  runs: Record<string, RunFacts> = {},
  claudePath: string | null = '/usr/local/bin/claude',
  workTier?: (run: RunFacts, root: string | undefined) => TierId | null,
) {
  const calls: Call[] = []
  const lookups: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const run = routeHarness({
    ...(workTier ? { workTier } : {}),
    pi: async (request, options) => {
      calls.push({ harness: 'pi', request, options })
      return { status: 'completed', via: 'pi' }
    },
    claude: async (request, options, launch) => {
      calls.push({ harness: 'claude', request, options, launch })
      return { status: 'completed', via: 'claude' }
    },
    settings: () => settings,
    findClaude: () => claudePath,
    runFor: async (harnessId, signal) => {
      lookups.push(harnessId)
      signals.push(signal)
      return runs[harnessId]
    },
    directions: (purpose) => `directions for ${purpose ?? 'a routine'}`,
  })
  return { run, calls, lookups, signals }
}

const work = { id: 'w1', harness: 'pi', purpose: 'work-do', cwd: '/tmp/project', prompt: 'Do the item.', sessionFile: '/tmp/w1.jsonl' }
const routine = { id: 'r1', harness: 'pi', cwd: '/tmp', prompt: 'Check the inbox.', sessionFile: '/tmp/r1.jsonl' }
const session = { id: 's1', harness: 'pi', cwd: '/tmp', prompt: 'Read brief.md and follow it.', sessionFile: '/tmp/s1.jsonl' }
const runs: Record<string, RunFacts> = {
  w1: { scheduleId: 'work.project.item', title: 'Fix the login redirect' },
  r1: { scheduleId: 'daily-inbox', title: 'Inbox check' },
  s1: { scheduleId: 'session.research', title: 'Research the move' },
}

test('with Claude Code off every run goes to Pi', async () => {
  const { run, calls, lookups } = router(CLAUDE_CODE_DEFAULTS, runs)
  const options = { onEvent: () => {} }
  for (const request of [work, routine, session, { ...routine, id: 'x', purpose: 'reflection' }]) {
    assert.deepEqual(await run(request, options), { status: 'completed', via: 'pi' })
  }
  assert.deepEqual(calls.map((call) => call.harness), ['pi', 'pi', 'pi', 'pi'])
  // Pi gets the very request and options hobkin gave, so nothing about a Pi run changes.
  assert.equal(calls[0].request, work)
  assert.equal(calls[0].options, options)
  assert.deepEqual(lookups, [], 'with it off, no run is even looked up')
})

test("a run's kind decides its route", async () => {
  const workOnly = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, kinds: { sessions: false, routines: false } })
  const first = router(workOnly, runs)
  await first.run(work, {})
  await first.run(routine, {})
  await first.run(session, {})
  assert.deepEqual(first.calls.map((call) => call.harness), ['claude', 'pi', 'pi'])

  const everything = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }), runs)
  await everything.run(session, {})
  await everything.run(routine, {})
  // Runs that use no tools stay on Pi whatever the settings.
  for (const purpose of ['reflection', 'compatibility-check', 'humanizer', 'migration-repair', 'session-patterns']) {
    await everything.run({ ...routine, id: `p-${purpose}`, purpose }, {})
  }
  // A run hobkin has no record of stays on Pi, since its kind is unknown.
  await everything.run({ ...routine, id: 'unknown' }, {})
  assert.deepEqual(
    everything.calls.map((call) => call.harness),
    ['claude', 'claude', 'pi', 'pi', 'pi', 'pi', 'pi', 'pi'],
  )

  // A routine's kind is in its record, and looking for the record gives up once the run is stopped.
  const stop = new AbortController()
  await everything.run({ ...routine, signal: stop.signal }, {})
  assert.equal(everything.signals.at(-1), stop.signal)
})

test('a run on Claude Code gets the binary, the settings, its title and its directions', async () => {
  const settings = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, model: 'opus', permissions: 'ask' })
  const { run, calls } = router(settings, runs)
  const options = { onEvent: () => {} }
  await run(work, options)
  const [call] = calls
  assert.equal(call.request, work)
  assert.equal(call.options, options)
  assert.deepEqual(call.launch, {
    claude: '/usr/local/bin/claude',
    settings,
    title: 'Fix the login redirect',
    directions: 'directions for work-do',
  })
})

test('Claude Code missing fails the run with a reason instead of moving it to Pi', async () => {
  const { run, calls } = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }), runs, null)
  const result = (await run(work, {})) as { status: string; error: string; harness: string }
  assert.equal(result.status, 'failed')
  assert.equal(result.harness, 'claude')
  assert.match(result.error, /Claude Code is not installed/)
  assert.deepEqual(calls, [], 'neither harness started')
})

test("a request to start a durable hobkin's Pi process ahead of its turn goes to Pi as given, whatever the settings", async () => {
  // hobkin admits no run for it, so looking one up would wait for a run that never comes.
  const ahead = { id: 'a1', harness: 'pi', purpose: 'durable', warm: true, cwd: '/tmp/project', sessionFile: '/tmp/a1.jsonl' }
  for (const settings of [CLAUDE_CODE_DEFAULTS, changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true })]) {
    const { run, calls, lookups } = router(settings, runs)
    assert.deepEqual(await run(ahead, undefined), { status: 'completed', via: 'pi' })
    assert.deepEqual(calls.map((call) => [call.harness, call.request]), [['pi', ahead]])
    assert.deepEqual(lookups, [])
  }
})

/** As hobkin's levels say for an important project: a look on mid and a do on high. Discover has no tier. */
const importantProject = (roots: (string | undefined)[]) => (run: RunFacts, root: string | undefined): TierId | null => {
  roots.push(root)
  const lane = (run.work as { lane?: string } | undefined)?.lane
  return lane === 'do' ? 'high' : lane === 'look' ? 'mid' : null
}

test("a run at a tier on Claude Code goes there with the tier's model and level", async () => {
  // The tile's switch is off, so only the tier sends runs to Claude Code.
  const settings = { ...CLAUDE_CODE_DEFAULTS, model: 'sonnet' as const, tiers: { high: { model: 'opus', effort: 'xhigh' } } satisfies ClaudeTiers }
  const tiered: Record<string, RunFacts> = {
    s1: { scheduleId: 'session.research', title: 'Research the move', tier: 'high' },
    s2: { scheduleId: 'session.notes', title: 'Tidy the notes', tier: 'mid' },
    r1: { scheduleId: 'daily-inbox', title: 'Inbox check', tier: 'high' },
    r2: { scheduleId: 'weekly-report', title: 'Weekly report' },
    w1: { scheduleId: 'work.shop.do', title: 'Shop: Fix the login', work: { slug: 'shop', lane: 'do', item: 'i1' } },
    w2: { scheduleId: 'work.shop.look', title: 'Shop: bugs', work: { slug: 'shop', lane: 'look' } },
    w3: { scheduleId: 'work.discover', title: 'Finding projects', work: { lane: 'discover' } },
  }
  const roots: (string | undefined)[] = []
  const { run, calls } = router(settings, tiered, '/usr/local/bin/claude', importantProject(roots))
  // hobkin gives every run its data root, where Work keeps its projects.
  const options = { metricsRoot: '/home/data' }
  await run({ ...session, id: 's1' }, options)
  await run({ ...session, id: 's2' }, options)
  await run({ ...routine, id: 'r1' }, options)
  await run({ ...routine, id: 'r2' }, options)
  await run({ ...work, id: 'w1', purpose: 'work-do' }, options)
  await run({ ...work, id: 'w2', purpose: 'work-look' }, options)
  await run({ ...work, id: 'w3', purpose: 'work-discover' }, options)
  // Runs that use no tools stay on Pi whatever their tier.
  await run({ ...session, id: 's1', purpose: 'reflection' }, options)

  assert.deepEqual(
    calls.map((call) => [call.request.id, call.harness]),
    [['s1', 'claude'], ['s2', 'pi'], ['r1', 'claude'], ['r2', 'pi'], ['w1', 'claude'], ['w2', 'pi'], ['w3', 'pi'], ['s1', 'pi']],
  )
  for (const call of calls.filter((each) => each.harness === 'claude')) {
    assert.deepEqual([call.launch?.settings.model, call.launch?.settings.effort, call.launch?.settings.permissions], ['opus', 'xhigh', 'auto'])
  }
  assert.ok(roots.length > 0 && roots.every((root) => root === '/home/data'))
})

test("the tile's switch still sends every tier, with the tile's model unless the tier names its own", async () => {
  const settings = {
    ...changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, kinds: { sessions: false, routines: false }, model: 'sonnet' }),
    tiers: { high: { model: 'opus', effort: 'max' } } satisfies ClaudeTiers,
  }
  const tiered: Record<string, RunFacts> = {
    look: { scheduleId: 'work.shop.look', title: 'Shop: bugs', work: { slug: 'shop', lane: 'look' } },
    do: { scheduleId: 'work.shop.do', title: 'Shop: Fix the login', work: { slug: 'shop', lane: 'do', item: 'i1' } },
    high: { scheduleId: 'session.research', title: 'Research the move', tier: 'high' },
    mid: { scheduleId: 'session.notes', title: 'Tidy the notes', tier: 'mid' },
  }
  const { run, calls } = router(settings, tiered, '/usr/local/bin/claude', importantProject([]))
  await run({ ...work, id: 'look', purpose: 'work-look' }, {})
  await run({ ...work, id: 'do', purpose: 'work-do' }, {})
  await run({ ...session, id: 'high' }, {})
  await run({ ...session, id: 'mid' }, {})
  assert.deepEqual(
    calls.map((call) => [call.request.id, call.harness, call.launch?.settings.model, call.launch?.settings.effort]),
    [
      ['look', 'claude', 'sonnet', 'tier'],
      ['do', 'claude', 'opus', 'max'],
      ['high', 'claude', 'opus', 'max'],
      ['mid', 'pi', undefined, undefined],
    ],
  )

  // A host that keeps tiers, with none on Claude Code and the switch off, looks nothing up, as before.
  const none = router({ ...CLAUDE_CODE_DEFAULTS, tiers: {} }, tiered, '/usr/local/bin/claude', importantProject([]))
  await none.run({ ...work, id: 'do', purpose: 'work-do' }, {})
  assert.deepEqual([none.calls.map((call) => call.harness), none.lookups], [['pi'], []])
})

test("a work run whose request names its tier goes by that tier, whatever its project's level says", async () => {
  const settings = { ...CLAUDE_CODE_DEFAULTS, tiers: { high: { model: 'opus', effort: 'xhigh' } } satisfies ClaudeTiers }
  const record: Record<string, RunFacts> = { w1: { scheduleId: 'work.shop.do', title: 'Shop: Fix the login', work: { slug: 'shop', lane: 'do', item: 'i1' } } }
  // The project's level would give this run mid, which is not on Claude Code.
  const levelSays = (): TierId | null => 'mid'

  const named = router(settings, record, '/usr/local/bin/claude', levelSays)
  await named.run({ ...work, id: 'w1', tier: 'high' }, {})
  assert.deepEqual(named.calls.map((call) => [call.harness, call.launch?.settings.model]), [['claude', 'opus']])

  // A runtime from before sends no tier, and the run still goes by its project's level.
  const older = router(settings, record, '/usr/local/bin/claude', levelSays)
  await older.run({ ...work, id: 'w1' }, {})
  assert.deepEqual(older.calls.map((call) => call.harness), ['pi'])
})

/** A router over fake harnesses whose runtime hands each run sent to Claude Code an environment for `hobkin schedule`. */
function schedulingRouter(settings: ClaudeCodeSettings, scheduling: HarnessRoute['scheduling']) {
  const calls: Call[] = []
  const run = routeHarness({
    pi: async (request, options) => {
      calls.push({ harness: 'pi', request, options })
      return { status: 'completed', via: 'pi' }
    },
    claude: async (request, options, launch) => {
      calls.push({ harness: 'claude', request, options, launch })
      return { status: 'completed', via: 'claude' }
    },
    settings: () => settings,
    findClaude: () => '/usr/local/bin/claude',
    runFor: async (harnessId) => ({ ...runs, d1: { scheduleId: 'hobkin.a1b2c3d4', title: 'Tests' } })[harnessId],
    directions: (purpose) => `directions for ${purpose ?? 'a routine'}`,
    ...(scheduling ? { scheduling } : {}),
  })
  return { run, calls }
}

const SCHEDULING = { HOBKIN_SCHEDULE_TOKEN: 'c'.repeat(32), HOBKIN_HOME: '/home/data' }
const durableTurn = { id: 'd1', harness: 'claude', purpose: 'durable', cwd: '/tmp/project', prompt: 'Go.', directions: 'You are a durable hobkin.', env: { HOBKIN_TURN: 'a'.repeat(32), HOBKIN_HOME: '/home/data' }, sessionFile: '/tmp/d1.jsonl' }

test('a session run on Claude Code gets its schedule token and home, and directions that say how to schedule', async () => {
  const asked: unknown[][] = []
  const scheduling = async (harnessId: string, options: { commands: boolean }) => (asked.push([harnessId, options]), SCHEDULING)
  const { run, calls } = schedulingRouter(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, permissions: 'all' }), scheduling)

  await run(session, {})

  const [call] = calls
  assert.deepEqual(asked, [['s1', { commands: true }]], 'permissions "all" may schedule a command')
  assert.equal(call!.launch?.env?.HOBKIN_SCHEDULE_TOKEN, SCHEDULING.HOBKIN_SCHEDULE_TOKEN)
  assert.equal(call!.launch?.env?.HOBKIN_HOME, '/home/data')
  assert.equal(call!.launch?.env?.PATH, process.env.PATH, 'with the rest of the host environment')
  assert.equal(call!.launch?.directions, `directions for a routine\n\n${scheduleDirections({ durable: false, commands: true })}`)
  assert.match(call!.launch!.directions, /hobkin schedule make/)
  assert.match(call!.launch!.directions, /end when its turn ends/)
  assert.doesNotMatch(call!.launch!.directions, /plain wakes only/)
})

test('a run whose permissions are not "all" asks for wakes only, and its directions say so', async () => {
  for (const permissions of ['auto', 'ask', 'edits'] as const) {
    const asked: unknown[][] = []
    const scheduling = async (harnessId: string, options: { commands: boolean }) => (asked.push([harnessId, options]), SCHEDULING)
    const { run, calls } = schedulingRouter(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, permissions }), scheduling)

    await run(session, {})

    assert.deepEqual(asked, [['s1', { commands: false }]], permissions)
    assert.match(calls[0]!.launch!.directions, /plain wakes only/, permissions)
  }
})

test("a durable turn on Claude Code gets its schedule token beside its own, and is told a wake starts its next turn", async () => {
  const asked: unknown[][] = []
  const scheduling = async (harnessId: string, options: { commands: boolean }) => (asked.push([harnessId, options]), SCHEDULING)
  const { run, calls } = schedulingRouter(CLAUDE_CODE_DEFAULTS, scheduling)

  await run(durableTurn, {})

  const { launch } = calls[0]!
  assert.deepEqual(asked, [['d1', { commands: true }]], 'a durable turn runs with every permission')
  assert.deepEqual([launch?.env?.HOBKIN_TURN, launch?.env?.HOBKIN_SCHEDULE_TOKEN, launch?.env?.HOBKIN_HOME], ['a'.repeat(32), SCHEDULING.HOBKIN_SCHEDULE_TOKEN, '/home/data'])
  assert.equal(launch?.directions, `You are a durable hobkin.\n\n${scheduleDirections({ durable: true, commands: true })}`)
  assert.match(launch!.directions, /wake starts your next turn/)
})

test('a runtime without schedules, one that keeps none for the run, or one that fails leaves the run on Claude Code as it was', async () => {
  const settings = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true })
  const before = schedulingRouter(settings, undefined)
  await before.run(session, {})
  await before.run(durableTurn, {})
  const [sessionAsBefore, durableAsBefore] = before.calls.map((call) => call.launch)
  assert.equal(sessionAsBefore && 'env' in sessionAsBefore, false, 'a session run gets no environment of its own, as before')

  const answers: HarnessRoute['scheduling'][] = [
    async () => null,
    async () => ({ HOBKIN_SCHEDULE_TOKEN: 7 }),
    async () => {
      throw Error('the runtime broke')
    },
  ]
  for (const scheduling of answers) {
    const { run, calls } = schedulingRouter(settings, scheduling)
    await run(session, {})
    await run(durableTurn, {})
    assert.deepEqual(calls.map((call) => call.launch), [sessionAsBefore, durableAsBefore])
  }

  // A run that stays on Pi never asks, nor does a Work run or a routine on Claude Code, which keep no schedules.
  const asked: unknown[] = []
  const onPi = schedulingRouter(CLAUDE_CODE_DEFAULTS, async (...args) => (asked.push(args), SCHEDULING))
  await onPi.run(session, {})
  const onClaude = schedulingRouter(settings, async (...args) => (asked.push(args), SCHEDULING))
  await onClaude.run(work, {})
  await onClaude.run(routine, {})
  assert.deepEqual(onClaude.calls.map((call) => [call.harness, call.launch?.env]), [['claude', undefined], ['claude', undefined]])
  assert.deepEqual(asked, [])
})
