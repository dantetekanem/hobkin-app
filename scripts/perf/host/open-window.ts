/**
 * The agent-open lab's fake window (`agent-open.ts`): one socket to the host, in a process of its own, that asks what a
 * window asks when an agent's page opens and counts what comes back. It parses every message and keeps the snapshot's
 * `hobkins` and the jobs' steps (`applyActivity`), as the window does, so it can react the way the page does.
 *
 * What each page asks, as the window's code asks it:
 * - A durable hobkin's page (`ui/src/features/hobkins/HobkinScreen.tsx`): `hobkin.seen` while its wait is unseen
 *   (`useMarkSeen`, `seenToSend`), `hobkin.shown` while it waits on Pi (`usePageShown`, `pageShownId`), `hobkin.read`
 *   (`useConversation`), `schedule.runs` (`useScheduleRuns`); once the read answers, each turn drawn among the newest
 *   NEWEST_STEPS rows is held watched, one `watch` message per job held (`Watched.hold` in `ui/src/lib/host/watch.ts`),
 *   and `activity.before` is read for each drawn turn the host holds too few steps of (`useTurnSteps` in `turn-steps.ts`).
 *   While it shows, a change of `reloadKey` (`conversation.ts`) reads the conversation again.
 * - A run's page (`ui/src/features/work/RunPage.tsx`): the run watched, `agent.notes`, `schedule.runs`; reading older
 *   steps is `activity.before` before the feed's oldest, and once pages are held each move of the feed's oldest step
 *   reads again (`follow` in `ui/src/features/agent-activity/older-pages.ts`).
 *
 * Usage (forked by `open-lab.ts`): node open-window.ts <port> <token> <origin> <seconds to live> <run folder>
 * The lab drives it over IPC: { type: 'do', step, ... } answers { type: 'done', step, ... }.
 */
import { performance } from 'node:perf_hooks'
import { WebSocket } from 'ws'
import { applyActivity, FEED_STEPS, type ActivityEntry, type ActivityStep, type JobActivity } from '#shared/protocol/activity.ts'
import type { HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import { NEWEST_STEPS } from '../../../ui/src/features/agent-activity/newest.ts'

const [port, token, origin, live] = process.argv.slice(2)
if (Number(port) === 5188) throw Error('The fake window never connects to the live host.')
setTimeout(() => process.exit(2), Number(live) * 1000).unref()
process.on('disconnect', () => process.exit(0))

const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token!)}&reads=tails,extend`, { origin })

// ---------- what the window holds ----------
let values: Record<string, unknown> = {}
let activity: JobActivity = {}
let takesWatch = false
let firstState = 0

const hobkinOf = (id: string) => (values.hobkins as HobkinSummary[] | undefined)?.find((summary) => summary.id === id)

/** `reloadKey` in `ui/src/features/hobkins/conversation.ts`. */
const reloadKey = (hobkin: HobkinSummary | undefined) => (hobkin ? JSON.stringify([hobkin.id, hobkin.turns, hobkin.state, hobkin.last?.at ?? null]) : null)

// ---------- counting ----------
interface Tally { messages: number; bytes: number; largest: number; parseMs: number; ops: Record<string, number>; opSizes: Record<string, number>; opBytes: number }
const tally = (): Tally => ({ messages: 0, bytes: 0, largest: 0, parseMs: 0, ops: {}, opSizes: {}, opBytes: 0 })
let counted = tally()

interface Asked { rid: string; name: string; job?: string; rtMs: number; bytes: number; ok: boolean; error?: string; parseMs: number; steps?: number; turns?: number }
const pending = new Map<string, { name: string; job?: string; t0: number; resolve: (asked: Asked & { value: any }) => void }>()
let nextId = 0

function ask(name: string, args: Record<string, unknown>): Promise<Asked & { value: any }> {
  const rid = `w${++nextId}`
  return new Promise((resolve) => {
    pending.set(rid, { name, ...(typeof args.job === 'string' ? { job: args.job } : {}), t0: performance.now(), resolve })
    socket.send(JSON.stringify({ type: 'command', id: rid, name, args }))
  })
}

/** What a request record says, without its value. */
const record = ({ value: _value, ...asked }: Asked & { value: any }): Asked => asked

// ---------- watching, as `Watched` does it: a message for each job that starts or stops being watched ----------
const holds = new Map<string, number>()
let watchMessages = 0
let watchBytes = 0
const tellWatched = () => {
  if (!takesWatch) return
  const text = JSON.stringify({ type: 'watch', jobs: [...holds.keys()].sort() })
  watchMessages++
  watchBytes += text.length
  socket.send(text)
}
function hold(job: string): () => void {
  const count = (holds.get(job) ?? 0) + 1
  holds.set(job, count)
  if (count === 1) tellWatched()
  let held = true
  return () => {
    if (!held) return
    held = false
    const left = holds.get(job)! - 1
    if (left > 0) return void holds.set(job, left)
    holds.delete(job)
    tellWatched()
  }
}

// ---------- what reacts to each state message ----------
const listeners = new Set<() => void>()
const resetsSeen = new Map<string, number>()

socket.on('message', (data: Buffer) => {
  const bytes = data.length
  const t = performance.now()
  const message = JSON.parse(data.toString()) as Record<string, any>
  const parseMs = performance.now() - t
  if (message.type === 'hello') takesWatch = message.watch === true
  if (message.type === 'result') {
    const asked = pending.get(message.id)
    if (!asked) return
    pending.delete(message.id)
    const value = message.ok ? message.value : null
    asked.resolve({
      rid: message.id, name: asked.name, ...(asked.job ? { job: asked.job } : {}), rtMs: performance.now() - asked.t0, bytes, ok: message.ok === true, parseMs,
      ...(message.ok ? {} : { error: String(message.message ?? message.code) }),
      ...(Array.isArray(value?.steps) ? { steps: value.steps.length } : {}),
      ...(Array.isArray(value?.turns) ? { turns: value.turns.length } : {}),
      value,
    })
    return
  }
  if (message.type !== 'state') return
  counted.messages++
  counted.bytes += bytes
  counted.parseMs += parseMs
  counted.largest = Math.max(counted.largest, bytes)
  if (message.reset) {
    values = { ...(message.set ?? {}) }
    activity = {}
  } else {
    Object.assign(values, message.set ?? {})
    for (const key of message.unset ?? []) delete values[key]
  }
  const steps = (message.activity ?? []) as ActivityStep[]
  if (steps.length) {
    for (const step of steps) {
      counted.ops[step.op] = (counted.ops[step.op] ?? 0) + 1
      counted.opSizes[step.op] = (counted.opSizes[step.op] ?? 0) + JSON.stringify(step).length
      if (step.op === 'reset') resetsSeen.set(step.job, (resetsSeen.get(step.job) ?? 0) + 1)
    }
    counted.opBytes += JSON.stringify(steps).length
    activity = applyActivity(activity, steps)
  }
  if (!firstState) {
    firstState = bytes
    process.send?.({ type: 'ready', firstState, takesWatch })
  }
  for (const listener of listeners) listener()
})
socket.on('error', (error) => process.send?.({ type: 'error', message: error.message }))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, ms = 30_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw Error('The fake window waited too long.')
    await sleep(5)
  }
}

// ---------- a durable hobkin's page ----------

/**
 * The runs of the turns among the page's newest rows before any steps are read: each finished turn draws the message
 * that began it and its answer (`pageRows` in `conversation.ts`), the live one its message, and the newest
 * NEWEST_STEPS rows are drawn (`useNewest`). The page holds each of them watched from then on (`withDrawnTurns`).
 */
function drawnTurns(turns: readonly HobkinTurn[], hobkin: HobkinSummary | undefined): string[] {
  const live = hobkin?.state === 'working' ? hobkin.run : null
  const rows: string[] = []
  for (const turn of [...turns].sort((left, right) => left.n - right.n)) {
    if (turn.asked) rows.push(turn.run)
    if (turn.run !== live) rows.push(turn.run)
  }
  if (live && !turns.some((turn) => turn.run === live)) rows.push(live)
  return [...new Set(rows.slice(-NEWEST_STEPS))]
}

/** `joinsOf` in `turn-steps.ts`: null when the host holds none of the turn, the oldest id when it holds a full feed, else undefined. */
function joinsOf(feed: readonly ActivityEntry[] | undefined): string | null | undefined {
  if (!feed?.length) return null
  return feed.length >= FEED_STEPS ? feed[0]!.id : undefined
}

function readTurn(run: string): Promise<Asked & { value: any }> {
  const feed = activity[run]
  const joins = joinsOf(feed)
  const oldest = joins === null ? undefined : feed?.[0]
  return ask('activity.before', { job: run, ...(oldest ? { before: oldest.id, ...(oldest.at === undefined ? {} : { at: oldest.at }) } : {}) })
}

interface Page { id: string; letGo: (() => void)[]; drawn: string[]; read: Set<string>; key: string | null }
let page: Page | null = null

/** Opens a hobkin's page and waits for everything it asks. */
async function openHobkin(id: string) {
  const before = { ...counted, ops: { ...counted.ops } }
  const watchBefore = { messages: watchMessages, bytes: watchBytes }
  const t0 = performance.now()
  const hobkin = hobkinOf(id)
  if (!hobkin) throw Error(`No hobkin ${id} in the snapshot.`)
  const first: Promise<Asked & { value: any }>[] = []
  if (hobkin.state === 'waiting' && hobkin.waiting && !hobkin.waiting.seen) first.push(ask('hobkin.seen', { id }))
  if (hobkin.state === 'waiting' && hobkin.engine.kind !== 'claude') first.push(ask('hobkin.shown', { id }))
  const read = ask('hobkin.read', { id })
  first.push(ask('schedule.runs', { kind: 'hobkin', id }))
  const opened: Page = { id, letGo: [], drawn: [], read: new Set(), key: reloadKey(hobkin) }
  page = opened
  // The live turn is watched at once: its steps, its mood and the agent's lines all hold it.
  if (hobkin.run) opened.letGo.push(hold(hobkin.run))
  const conversation = await read
  const readMs = performance.now() - t0
  opened.drawn = drawnTurns(conversation.value?.turns ?? [], hobkinOf(id))
  for (const run of opened.drawn) opened.letGo.push(hold(run))
  const live = hobkinOf(id)?.state === 'working' ? hobkinOf(id)?.run : null
  const reads = opened.drawn.filter((run) => run !== live && joinsOf(activity[run]) !== undefined).map((run) => {
    opened.read.add(run)
    return readTurn(run)
  })
  const answers = await Promise.all([conversation, ...first, ...reads])
  const pageMs = performance.now() - t0
  return {
    pageMs,
    readMs,
    drawn: opened.drawn.length,
    requests: answers.map(record),
    watch: { messages: watchMessages - watchBefore.messages, bytes: watchBytes - watchBefore.bytes },
    state: { messages: counted.messages - before.messages, bytes: counted.bytes - before.bytes },
  }
}

/** Leaves the page: every hold lets go, one watch message each. */
function leave() {
  for (const letGo of page?.letGo ?? []) letGo()
  page = null
}

/**
 * A working turn on the open page: the user's words go with `hobkin.say`, the live run is watched once the snapshot
 * names it, the conversation is read again each time `reloadKey` changes, the user sees the wait at its end
 * (`hobkin.seen`), and the finished turn is read with `activity.before` once the host lets its feed go.
 */
async function workingTurn(id: string, text: string) {
  if (!page || page.id !== id) throw Error('Open the page first.')
  const open = page
  const before = { ...counted, ops: { ...counted.ops }, opSizes: { ...counted.opSizes } }
  const requests: Promise<Asked & { value: any }>[] = []
  let run: string | null = null
  let ended = false
  let seenTold: string | null = null
  const react = () => {
    const hobkin = hobkinOf(id)
    const key = reloadKey(hobkin)
    if (key !== open.key) {
      open.key = key
      requests.push(ask('hobkin.read', { id }))
    }
    if (hobkin?.state === 'working' && hobkin.run && hobkin.run !== run) {
      run = hobkin.run
      open.letGo.push(hold(run))
    }
    if (run && hobkin?.state === 'waiting') ended = true
    const wait = hobkin?.state === 'waiting' && hobkin.waiting && !hobkin.waiting.seen ? `${id}@${hobkin.waiting.since}` : null
    if (wait && wait !== seenTold) {
      seenTold = wait
      requests.push(ask('hobkin.seen', { id }))
    }
    if (ended && run && !open.read.has(run) && joinsOf(activity[run]) === null) {
      open.read.add(run)
      requests.push(readTurn(run))
    }
  }
  listeners.add(react)
  const t0 = performance.now()
  const said = await ask('hobkin.say', { id, text })
  if (!said.ok) throw Error(`hobkin.say was refused: ${said.error}`)
  await until(() => ended && run !== null, 120_000).catch(() => {
    const hobkin = hobkinOf(id)
    throw Error(`The turn did not end as the page sees it: run ${run}, ended ${ended}, state ${hobkin?.state} on ${hobkin?.run}, turns ${hobkin?.turns}`)
  })
  const turnMs = performance.now() - t0
  // The host publishes an ended turn's feed until its next full refresh, and the page reads the turn once it lets go.
  await sleep(3000)
  const heldAfter = run ? (activity[run]?.length ?? 0) : 0
  listeners.delete(react)
  const answers = await Promise.all(requests)
  const liveOps = { ...counted.ops }
  for (const [op, count] of Object.entries(before.ops)) liveOps[op] = (liveOps[op] ?? 0) - count
  const liveSizes = { ...counted.opSizes }
  for (const [op, bytes] of Object.entries(before.opSizes)) liveSizes[op] = (liveSizes[op] ?? 0) - bytes
  return {
    turnMs,
    run,
    heldAfter,
    requests: [record(said), ...answers.map(record)],
    rereads: answers.filter(({ name }) => name === 'hobkin.read').length,
    state: { messages: counted.messages - before.messages, bytes: counted.bytes - before.bytes, ops: liveOps, opSizes: liveSizes, opBytes: counted.opBytes - before.opBytes },
  }
}

// ---------- a run's page ----------
interface RunPage { run: string; letGo: (() => void)[]; older: { steps: readonly ActivityEntry[]; joins: string | null; loading: boolean } }
let runPage: RunPage | null = null

async function openRun(run: string) {
  const t0 = performance.now()
  const before = { ...counted }
  const resets = resetsSeen.get(run) ?? 0
  // Its steps and its lines both hold it, so one watch message goes.
  const opened: RunPage = { run, letGo: [hold(run), hold(run)], older: { steps: [], joins: null, loading: false } }
  runPage = opened
  const answers = await Promise.all([ask('agent.notes', { run }), ask('schedule.runs', { kind: 'run', id: run })])
  await until(() => (resetsSeen.get(run) ?? 0) > resets, 10_000)
  return {
    pageMs: performance.now() - t0,
    feed: activity[run]?.length ?? 0,
    feedBytes: JSON.stringify(activity[run] ?? []).length,
    requests: answers.map(record),
    state: { messages: counted.messages - before.messages, bytes: counted.bytes - before.bytes, largest: counted.largest },
  }
}

/** "Earlier steps": the page right before the oldest step held, the pages' first or the feed's (`loadMore`). */
async function loadOlder() {
  const open = runPage
  if (!open) throw Error('Open the run first.')
  const feed = activity[open.run] ?? []
  const oldest = open.older.steps[0] ?? feed[0]
  if (!oldest) throw Error('The run holds no steps.')
  const answer = await ask('activity.before', { job: open.run, before: oldest.id, ...(oldest.at === undefined ? {} : { at: oldest.at }) })
  open.older = { steps: [...(answer.value?.steps ?? []), ...open.older.steps], joins: open.older.joins ?? feed[0]?.id ?? null, loading: false }
  return { request: record(answer), held: open.older.steps.length }
}

/** While older pages are held: each time the feed's oldest step moves, the page right before it is read again (`follow`). */
const follows: Promise<Asked & { value: any }>[] = []
const follow = () => {
  const open = runPage
  if (!open || !open.older.steps.length || open.older.loading) return
  const oldest = activity[open.run]?.[0]
  if (!oldest || open.older.joins === oldest.id) return
  open.older.loading = true
  const asked = ask('activity.before', { job: open.run, before: oldest.id, ...(oldest.at === undefined ? {} : { at: oldest.at }) })
  follows.push(asked)
  void asked.then((answer) => {
    open.older = { steps: answer.value?.steps ?? open.older.steps, joins: oldest.id, loading: false }
  })
}

function leaveRun() {
  for (const letGo of runPage?.letGo ?? []) letGo()
  runPage = null
}

// ---------- the lab's steps ----------
type Step = { type: 'do'; step: string; id?: string; run?: string; text?: string }

process.on('message', async (message: Step | { type: 'close' }) => {
  if (message?.type === 'close') {
    socket.close()
    setTimeout(() => process.exit(0), 50)
    return
  }
  if (message?.type !== 'do') return
  try {
    let result: unknown
    if (message.step === 'open-hobkin') result = await openHobkin(message.id!)
    else if (message.step === 'leave') result = leave()
    else if (message.step === 'working-turn') result = await workingTurn(message.id!, message.text!)
    else if (message.step === 'open-run') result = await openRun(message.run!)
    else if (message.step === 'load-older') result = await loadOlder()
    else if (message.step === 'leave-run') result = leaveRun()
    else if (message.step === 'follow') {
      listeners.add(follow)
      follows.length = 0
      result = null
    } else if (message.step === 'unfollow') {
      listeners.delete(follow)
      result = { requests: (await Promise.all(follows)).map(record) }
    } else if (message.step === 'count') {
      result = counted
      counted = tally()
    } else throw Error(`No step ${message.step}`)
    process.send?.({ type: 'done', step: message.step, result })
  } catch (error) {
    process.send?.({ type: 'done', step: message.step, error: error instanceof Error ? error.message : String(error) })
  }
})
