/**
 * The window's script time for switching between agents whose conversations are long, without a browser. Mounts the
 * real agent page (`HobkinScreen.tsx`, which draws durable hobkins and work runs alike) with the real agents list
 * beside it and the chat's always-mounted parts as stand-ins (`window/probes.ts`), on a page of plain objects
 * (`window/dom.ts`), with React's client renderer. A made-up host answers through the window's real connection code:
 * its `hobkin.read`, `activity.before` and other commands, and its watch resets, made by the host's own `Windows`
 * (`host/src/windows.ts`), go in as socket text. Each switch is timed by phase:
 *
 *   swap   the frame opens the next agent: the new page mounts with what the store holds, the old one starts to leave
 *   read   the conversation `hobkin.read` answers draws (a durable hobkin only)
 *   steps  the watched feeds and `activity.before` answers arrive and draw, as many rounds as the page asks for more
 *   leave  a second of animation frames and timers: the old page fades out and unmounts, the host sends its tails
 *
 * and by part, as self time: the socket's JSON.parse, `applyHostMessage`, the store's listeners and selectors, the rows
 * (`pageTurns`, `pageRows`, `exchangeOf`), react-markdown, and the rest, which is React's render and commit, the
 * components' own hooks, Motion and the plain-object DOM. With React's development build, or `--profile` in production
 * (React's profiling build), it also says how long React spent rendering each tree: the page, its header and lines,
 * the agents list and the chat's stand-ins. Nothing is laid out or painted, so these are floors under the window's
 * own times. Run from the repository root:
 *
 *   NODE_ENV=production node scripts/perf/agent-switch.ts [--hobkins 2] [--turns 300] [--runs 2] [--calls 2400] [--rounds 5] [--open] [--feeds read|held] [--windowed] [--profile] [--trace]
 *
 * `--windowed` turns on the switch `hobkin:windowed-steps` in the page's storage, so the transcript draws only the rows
 * in view and a view's height around them (`windowed-list.tsx`). A windowed list draws nothing in a view of no height,
 * so with it every element of the page reads as laid out at made-up sizes: each row 80 px tall, the transcript's box
 * 600 px tall and 800 px wide. Nothing else is laid out, and no scroll moves.
 *
 * `--open` opens every tool block, as Control+O does (they arrive closed by default); Shiki stays off the main thread,
 * as in the window, so it is not timed. `--feeds held` has the host hold each finished turn's feed, sent as watch
 * resets, in place of `activity.before` reads from the saved session. `--trace` prints each phase of each switch with
 * the rows it left drawn. Without NODE_ENV=production it measures React's development build, as `pnpm tauri dev` runs
 * it (without React Refresh).
 */
import { mock } from 'node:test'

const flags = process.argv.slice(2)
function flag(name: string, fallback: string): string {
  const at = flags.indexOf(`--${name}`)
  return at < 0 ? fallback : (flags[at + 1] ?? fallback)
}
const count = (name: string, fallback: number) => {
  const value = Number(flag(name, String(fallback)))
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} takes a whole number above zero.`)
  return value
}
const HOBKINS = count('hobkins', 2)
const TURNS = count('turns', 300)
const RUNS = count('runs', 2)
const CALLS = count('calls', 2400)
const ROUNDS = count('rounds', 5)
const OPEN = flags.includes('--open')
const TRACE = flags.includes('--trace')
const PROFILE = process.env.NODE_ENV !== 'production' || flags.includes('--profile')
const FEEDS = flag('feeds', 'read')
const WINDOWED = flags.includes('--windowed')
if (FEEDS !== 'read' && FEEDS !== 'held') throw new Error('--feeds is read or held.')
const LEAVE_MS = 1000
const FRAME_MS = 1000 / 60

// The page first: the window's modules read it as they load.
const { installPage } = await import('./window/dom.ts')
const page = installPage()
/** The made-up sizes a windowed transcript reads: each row's height, and its box. */
const LAID_OUT = { row: 80, height: 600, width: 800 }
if (WINDOWED) {
  localStorage.setItem('hobkin:windowed-steps', 'on')
  const made = { html: page.document.createElement.bind(page.document), ns: page.document.createElementNS.bind(page.document) }
  const sized = <Element extends object>(element: Element) => Object.assign(element, { offsetHeight: LAID_OUT.row, clientHeight: LAID_OUT.height, clientWidth: LAID_OUT.width })
  page.document.createElement = (tag: string) => sized(made.html(tag))
  page.document.createElementNS = (space: string, tag: string) => sized(made.ns(space, tag))
}

// Self time by part. A part timed inside another is taken out of the other's time.
const realNow = performance.now.bind(performance)
const selfTime: Record<string, number> = {}
const calls: Record<string, number> = {}
const stack: { start: number; child: number }[] = []
function timed<Value>(label: string, run: () => Value): Value {
  const frame = { start: realNow(), child: 0 }
  stack.push(frame)
  try {
    return run()
  } finally {
    stack.pop()
    const took = realNow() - frame.start
    selfTime[label] = (selfTime[label] ?? 0) + took - frame.child
    calls[label] = (calls[label] ?? 0) + 1
    const parent = stack.at(-1)
    if (parent) parent.child += took
  }
}
const markdown = { chars: 0 }
/** React's own render time of each tree in a Profiler (its `actualDuration`), by the tree's name. */
const rendered: Record<string, number> = {}
/** The rows each conversation drew last, by its name (`useNewest`), for `--trace`. */
const drawn = new Map<string, readonly { key?: string; kind?: string }[]>()
Object.assign(globalThis, {
  __agentSwitch: {
    timed,
    drawn,
    rendered: (id: string, _phase: string, took: number) => void (rendered[id] = (rendered[id] ?? 0) + took),
    markdown: (props: { children?: unknown }, render: () => unknown) => {
      markdown.chars += typeof props.children === 'string' ? props.children.length : 0
      return timed('markdown', render)
    },
  },
})

// Timers and Date follow a made-up clock, and the clock Motion animates by runs a frame ahead at each frame, so a
// second of fading out is a second to the code however long it ran. The times measured are real.
const START = Date.UTC(2026, 10, 26, 12)
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START })
let ahead = 0
performance.now = () => realNow() + ahead

// Stand-ins that time the window's own functions, in place of their modules wherever those are imported.
const ui = (path: string) => new URL(`../../ui/src/${path}`, import.meta.url).href
const stand = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`
const CONVERSATION = ui('features/hobkins/conversation.ts')
const STEPS = ui('features/agent-activity/steps.ts')
const NEWEST = ui('features/agent-activity/newest.ts')
const HEADER = ui('features/hobkins/PageHeader.tsx')
const LINES = ui('features/agent-activity/AgentLines.tsx')
/** A stand-in that draws `name` from `url` inside a Profiler called `id`. */
const profiled = (url: string, name: string, id: string) =>
  stand(`
    import { createElement, Profiler } from ${JSON.stringify(import.meta.resolve('react'))}
    import * as real from ${JSON.stringify(`${url}?real`)}
    export * from ${JSON.stringify(`${url}?real`)}
    const { rendered } = globalThis.__agentSwitch
    export function ${name}(props) { return createElement(Profiler, { id: ${JSON.stringify(id)}, onRender: rendered }, createElement(real.${name}, props)) }
  `)
const MARKDOWN = import.meta.resolve('react-markdown')
const { loadWindowModules } = await import('./window/load.ts')
loadWindowModules({
  swap: {
    [CONVERSATION]: stand(`
      import * as real from ${JSON.stringify(`${CONVERSATION}?real`)}
      export * from ${JSON.stringify(`${CONVERSATION}?real`)}
      const { timed } = globalThis.__agentSwitch
      export const pageTurns = (...args) => timed('rows: pageTurns', () => real.pageTurns(...args))
      export const pageRows = (...args) => timed('rows: pageRows', () => real.pageRows(...args))
    `),
    [STEPS]: stand(`
      import * as real from ${JSON.stringify(`${STEPS}?real`)}
      export * from ${JSON.stringify(`${STEPS}?real`)}
      const { timed } = globalThis.__agentSwitch
      export const exchangeOf = (...args) => timed('rows: exchangeOf', () => real.exchangeOf(...args))
    `),
    [NEWEST]: stand(`
      import * as real from ${JSON.stringify(`${NEWEST}?real`)}
      export * from ${JSON.stringify(`${NEWEST}?real`)}
      const kept = globalThis.__agentSwitch.drawn
      export function useNewest(name, items) {
        const newest = real.useNewest(name, items)
        kept.set(name, newest.shown)
        return newest
      }
    `),
    [HEADER]: profiled(HEADER, 'PageHeader', 'header and face'),
    [LINES]: profiled(LINES, 'AgentLines', 'lines'),
    [MARKDOWN]: stand(`
      import Real from ${JSON.stringify(`${MARKDOWN}?real`)}
      export * from ${JSON.stringify(`${MARKDOWN}?real`)}
      const { markdown } = globalThis.__agentSwitch
      export default function Markdown(props) { return markdown(props, () => Real(props)) }
    `),
  },
})

// React tells a devtools hook about every commit, in its production build too, which is how commits are counted here.
let commits = 0
Object.assign(globalThis, {
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: true,
    isDisabled: false,
    inject: () => 1,
    onCommitFiberRoot: () => void (commits += 1),
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
  },
})
// The highlighter's worker answers nothing: Shiki works off the window's thread, and lines draw plain until it answers.
Object.assign(globalThis, { Worker: class { addEventListener() {} postMessage() {} terminate() {} } })

const { HostConnection } = await import('../../ui/src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {})
const { hostStore } = await import('../../ui/src/lib/host/client.ts')
const { useView } = await import('../../ui/src/app/view-store.ts')
const { useBlocks } = await import('../../ui/src/features/agent-activity/blocks.ts')
const { useReports } = await import('../../ui/src/features/reports/store.ts')
// The module-level host listeners the window loads with its frame, each subscribing on import (as `window-frames.ts`).
await import('../../ui/src/features/actions/store.ts')
await import('../../ui/src/features/routines/store.ts')
await import('../../ui/src/features/work/store.ts')
await import('../../ui/src/features/chat/chat-store.ts')
await import('../../ui/src/features/work/agent-threads.ts')
await import('../../ui/src/features/chat/use-first-word.ts')
const { HobkinScreen } = await import('../../ui/src/features/hobkins/HobkinScreen.tsx')
const { AgentsDock } = await import('../../ui/src/app/AgentsDock.tsx')
const { screenTree } = await import('./window/probes.ts')
const { Windows } = await import('../../host/src/windows.ts')
const { hostActivity, longHobkin, longRun } = await import('./window/long-conversations.ts')
const { hobkinAgentId } = await import('../../shared/protocol/hobkins.ts')
// React times each Profiler's render only in its development build, and in production in its profiling build.
const { createRoot } = (await import(process.env.NODE_ENV === 'production' && PROFILE ? 'react-dom/profiling' : 'react-dom/client')) as typeof import('react-dom/client')
const { createElement, Fragment, isValidElement, Profiler } = await import('react')
const { rendered: onRender } = (globalThis as unknown as { __agentSwitch: { rendered: (id: string, phase: string, took: number) => void } }).__agentSwitch
const tree = (id: string, ...children: Parameters<typeof createElement>[2][]) => createElement(Profiler, { key: id, id, onRender }, ...children)

// The made-up host. Agents visited only to warm the code come first: the first switch in a fresh window is its own row.
const hobkins = Array.from({ length: HOBKINS + 1 }, (_, index) => longHobkin(index, { turns: TURNS, now: START }))
const runs = Array.from({ length: RUNS + 1 }, (_, index) => longRun(index, { calls: CALLS, now: START }))
const activity = hostActivity(runs)
if (FEEDS === 'held') for (const hobkin of hobkins) for (const [run, steps] of hobkin.turnSteps) activity[run] = steps
const steps = new Map(hobkins.flatMap((hobkin) => [...hobkin.turnSteps]))
const read = new Map(hobkins.map((hobkin) => [hobkin.summary.id, JSON.stringify(hobkin.conversation)]))
const chat = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `Message ${index} about the agents and their pages.`, at: START - (100 - index) * 60_000 }))
const set = {
  connection: 'connected',
  busy: false,
  runs: runs.map((run) => run.run),
  hobkins: hobkins.map((hobkin) => hobkin.summary),
  reports: [],
  decisions: [],
  waiting: {},
  main: { harness: 'pi', model: 'm', effort: 'high' },
}
const owner = { state: 'live', limits: { images: 4, imageBytes: 1 } }
const signIn = { status: 'signed-in' }
const sync = {
  full: () => ({ type: 'state', rev: 1, reset: true, set, messages: [{ op: 'reset', messages: chat }], owner, signIn }),
  activityNow: () => activity,
  revision: () => 1,
  update: () => null,
}
const windows = new Windows({ sync: sync as never, later: () => () => {} })

// The window's own connection, on a socket that keeps what the window sends until the host is asked to answer it.
const connection = (globalThis as unknown as { __hobkinHost: { connection: { receive(text: string): void; socket: unknown } } }).__hobkinHost.connection
const sent: string[] = []
const inbox: string[] = []
const socket = { readyState: 1, OPEN: 1, send: (text: string) => void sent.push(text), close() {} }
connection.socket = socket
const hostSocket = { readyState: 1, OPEN: 1, send: (text: string) => void inbox.push(text) }
const received = { bytes: 0, messages: 0 }
const deliver = (text: string) => {
  received.bytes += text.length
  received.messages += 1
  timed('socket: JSON.parse', () => connection.receive(text))
}
// The store's listeners: the module ones above and every mounted `useHost` selector, with applyHostMessage inside.
const setState = hostStore.setState
hostStore.setState = ((update: Parameters<typeof setState>[0], replace?: boolean) =>
  timed('store: listeners', () => setState(typeof update === 'function' ? (state) => timed('store: applyHostMessage', () => update(state)) : update, replace as never))) as typeof setState

// The mirrors React reads the host's state through, once a frame and five times a second (`screen.ts`): their
// listeners are the mounted `useHost` selectors.
const screens = (globalThis as unknown as { __hobkinScreen: { frame: { store: typeof hostStore }; list: { store: typeof hostStore } } | null }).__hobkinScreen
if (!screens) throw new Error('The window should read the host through its frame mirrors here.')
for (const { store } of [screens.frame, screens.list]) {
  const take = store.setState
  store.setState = ((...args: Parameters<typeof take>) => timed('store: listeners', () => take(...args))) as typeof take
}

const unknown = new Set<string>()
const result = (id: string, value: string) => `{"type":"result","id":${JSON.stringify(id)},"ok":true,"value":${value}}`
/** What the host answers a command, as the socket text it sends. */
function answer({ id, name, args }: { id: string; name: string; args: Record<string, unknown> }): string {
  switch (name) {
    case 'hobkin.read':
      return result(id, read.get(String(args.id))!)
    case 'activity.before': {
      const all = steps.get(String(args.job)) ?? []
      const at = args.before ? all.findIndex((entry) => entry.id === args.before) : all.length
      return result(id, JSON.stringify({ steps: all.slice(0, Math.max(0, at)), more: false, found: true }))
    }
    case 'agent.notes':
      return result(id, '{"notes":[]}')
    case 'schedule.runs':
      return result(id, '{"schedules":[]}')
    case 'hobkin.seen':
    case 'hobkin.shown':
      return result(id, '{"ok":true}')
    default:
      unknown.add(name)
      return JSON.stringify({ type: 'result', id, ok: false, error: { code: 'unknown', message: `The made-up host has no ${name}.` } })
  }
}

/** The host's work for what the window sent: answers, and the resets of the jobs whose watching turned. Not timed. */
function hostWork(): { texts: string[]; kinds: Set<string> } {
  const kinds = new Set<string>()
  for (const text of sent.splice(0)) {
    const message = JSON.parse(text) as { type: string; id: string; name: string; args: Record<string, unknown>; jobs: string[] }
    if (message.type === 'watch') {
      windows.watch(hostSocket, message.jobs)
      kinds.add('watch')
    } else if (message.type === 'command') {
      inbox.push(answer(message))
      kinds.add(message.name)
    }
  }
  return { texts: inbox.splice(0), kinds }
}

const hop = () => new Promise((resolve) => setImmediate(resolve))
/** Until React has committed nothing for three turns of the event loop. */
async function settle() {
  let seen = commits
  for (let quiet = 0; quiet < 3; ) {
    await hop()
    if (commits === seen) quiet += 1
    else {
      seen = commits
      quiet = 0
    }
  }
}

deliver(JSON.stringify({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: { providers: [{ id: 'fake', name: 'Fake' }], models: [{ id: 'm', provider: 'fake', name: 'Model', thinking: ['high'] }] }, viewState: null, owner, signIn, watch: true, timings: true }))
deliver(JSON.stringify(windows.open(hostSocket, { tails: true, extend: true })))
useReports.setState({ ready: true, sample: false })
if (OPEN) useBlocks.setState({ open: true, turn: 1 })
const ids = [...hobkins.map((hobkin) => hobkinAgentId(hobkin.summary.id)), ...runs.map((run) => run.id)]
useView.setState({ screen: 'agent', openAgent: null })

// The chat's always-mounted parts and the menu's agents row, as stand-ins; the real agents list and the real page.
const chatParts = (screenTree('agent', '', 'own') as unknown[]).filter((element) => isValidElement(element) && element.key !== 'page' && element.key !== 'dock')
const failed = (error: unknown) => console.error('the page failed:', (error as Error)?.stack ?? error)
const root = createRoot(page.container as never, { onUncaughtError: failed, onCaughtError: failed, onRecoverableError: failed })
root.render(
  createElement(
    Fragment,
    null,
    tree('agents list', createElement(AgentsDock)),
    tree('chat stand-ins', ...(chatParts as never[])),
    tree('agent page', createElement('section', null, createElement(HobkinScreen))),
  ),
)
for (const text of hostWork().texts) deliver(text)
await settle()

interface Switch {
  agent: string
  kind: 'durable' | 'run'
  visit: 'fresh window' | 'first open' | 'back'
  /** Each phase's time, and how many react-markdown renders it made. */
  phases: Record<string, { ms: number; markdown: number }>
  parts: Record<string, number>
  /** React's render time of each tree during the switch (Profiler), when this build of React times them. */
  rendered: Record<string, number>
  /** A second of frames on the new page once the switch is over, not counted in it: what the page costs standing still. */
  idle: number
  rounds: number
  commits: number
  nodes: number
  markdownKB: number
  receivedKB: number
  messages: number
}

const PARTS = ['socket: JSON.parse', 'store: applyHostMessage', 'store: listeners', 'rows: pageTurns', 'rows: pageRows', 'rows: exchangeOf', 'markdown'] as const

/** One animation frame, 16.7 ms on the made-up clock after the last, with the timers due before it. */
async function frame(): Promise<{ frames: number }> {
  mock.timers.tick(FRAME_MS)
  ahead += FRAME_MS
  const frames = page.frames.splice(0)
  for (const run of frames) run(performance.now())
  await settle()
  return { frames: frames.length }
}

/** A second of animation frames. */
async function second() {
  for (let elapsed = 0; elapsed < LEAVE_MS; elapsed += FRAME_MS) {
    const was = { commits, nodes: page.document.made, md: calls.markdown ?? 0 }
    const { frames } = await frame()
    if (TRACE && commits !== was.commits) console.log(`    at ${elapsed.toFixed(0)} ms: ${frames} frames, ${commits - was.commits} commits, ${page.document.made - was.nodes} nodes, ${(calls.markdown ?? 0) - was.md} md`)
  }
}

let lastDrawn = new Set<string>()

async function switchTo(agent: string, visit: Switch['visit']): Promise<Switch> {
  lastDrawn = new Set()
  const before = { ...selfTime }
  const renderedBefore = { ...rendered }
  const start = { commits, nodes: page.document.made, chars: markdown.chars, bytes: received.bytes, messages: received.messages }
  const phases: Switch['phases'] = { swap: { ms: 0, markdown: 0 }, read: { ms: 0, markdown: 0 }, steps: { ms: 0, markdown: 0 }, leave: { ms: 0, markdown: 0 } }
  const during = async (phase: string, run: () => Promise<unknown>, what = '') => {
    const at = realNow()
    const renders = calls.markdown ?? 0
    const was = { commits, nodes: page.document.made }
    await run()
    phases[phase]!.ms += realNow() - at
    phases[phase]!.markdown += (calls.markdown ?? 0) - renders
    if (TRACE) {
      const shown = drawn.get(agent.startsWith('hobkin:') ? agent.slice('hobkin:'.length) : agent) ?? []
      const tally = new Map<string, number>()
      for (const row of shown) tally.set(row.kind ?? '?', (tally.get(row.kind ?? '?') ?? 0) + 1)
      const kinds = [...tally].map(([kind, rows]) => `${rows} ${kind}`).join(', ')
      const kept = shown.filter((row) => lastDrawn.has(row.key ?? '')).length
      lastDrawn = new Set(shown.map((row) => row.key ?? ''))
      console.log(`  ${agent} ${phase}${what}: ${(realNow() - at).toFixed(1)} ms, ${(calls.markdown ?? 0) - renders} md, ${commits - was.commits} commits, ${page.document.made - was.nodes} nodes; rows drawn: ${kinds || 'none'} (${kept} drawn before)`)
    }
  }
  let rounds = 0
  /** Delivers what the host has for the window, round after round, each round in its phase. */
  const drain = async (phase?: string) => {
    for (;;) {
      const { texts, kinds } = hostWork()
      if (!texts.length) return
      rounds += 1
      // React reads the host's state once a frame (`screen.ts`), so what a message changes draws at the next one.
      await during(phase ?? (kinds.has('hobkin.read') ? 'read' : 'steps'), async () => {
        for (const text of texts) deliver(text)
        await settle()
        await frame()
      }, ` [${[...kinds].join(' ')}]`)
    }
  }

  await during('swap', async () => {
    useView.getState().openAgentCanvas(agent)
    await settle()
    await frame()
  })
  await drain()
  // The old page fades out over the next frames and goes; its feeds go back to tails.
  await during('leave', second)
  await drain('leave')
  const total = Object.values(phases).reduce((sum, { ms }) => sum + ms, 0)
  const parts: Record<string, number> = {}
  for (const part of PARTS) parts[part] = (selfTime[part] ?? 0) - (before[part] ?? 0)
  parts['React, components, Motion, DOM'] = total - Object.values(parts).reduce((sum, value) => sum + value, 0)
  const counted = { commits: commits - start.commits, nodes: page.document.made - start.nodes }
  const renders = Object.fromEntries(Object.keys(rendered).map((id) => [id, rendered[id]! - (renderedBefore[id] ?? 0)]))
  const still = realNow()
  await second()
  await drain('leave')
  return {
    agent,
    kind: agent.startsWith('hobkin:') ? 'durable' : 'run',
    visit,
    phases,
    parts,
    rendered: renders,
    idle: realNow() - still,
    rounds,
    ...counted,
    markdownKB: (markdown.chars - start.chars) / 1000,
    receivedKB: (received.bytes - start.bytes) / 1000,
    messages: received.messages - start.messages,
  }
}

// The warm-up agents (index 0 of each kind) first, then every other agent once, then back to each, round after round.
const durable = ids.filter((id) => id.startsWith('hobkin:'))
const work = ids.filter((id) => !id.startsWith('hobkin:'))
const switches: Switch[] = []
switches.push(await switchTo(durable[0]!, 'fresh window'))
switches.push(await switchTo(work[0]!, 'fresh window'))
const visited = new Set<string>()
for (let round = 0; round < ROUNDS; round++) {
  for (const agent of [...durable.slice(1), ...work.slice(1)]) {
    switches.push(await switchTo(agent, visited.has(agent) ? 'back' : 'first open'))
    visited.add(agent)
  }
}
root.unmount()
mock.timers.reset()

const median = (values: number[]) => {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const ms = (values: number[]) => (values.length === 1 ? `${values[0]!.toFixed(1)}` : `${median(values).toFixed(1)} [${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}]`)
const react = process.env.NODE_ENV === 'production' ? 'production' : 'development'
console.log(`${HOBKINS} durable hobkins of ${TURNS} turns (5–30 calls each, answers of 200–2000 words), ${RUNS} work runs of ${CALLS} calls (feed: newest 200), ${react} React, blocks ${OPEN ? 'all open' : 'closed'}, finished turns ${FEEDS === 'read' ? 'read from the saved session' : 'held by the host'}`)
if (WINDOWED) console.log(`windowed transcript (hobkin:windowed-steps on): rows read as ${LAID_OUT.row} px, the box as ${LAID_OUT.height} px tall and ${LAID_OUT.width} px wide`)
console.log(`${ROUNDS} rounds; ms are median [min–max] over the switches in each row; parts are self time. Not laid out or painted: floors.`)
if (unknown.size) console.log(`commands the made-up host refused: ${[...unknown].join(', ')}`)
for (const kind of ['durable', 'run'] as const) {
  for (const visit of ['fresh window', 'first open', 'back'] as const) {
    const rows = switches.filter((each) => each.kind === kind && each.visit === visit)
    if (!rows.length) continue
    const total = rows.map((row) => Object.values(row.phases).reduce((sum, { ms }) => sum + ms, 0))
    console.log(`\n${kind === 'durable' ? 'durable hobkin' : 'work run'}, ${visit} (${rows.length}): ${ms(total)} ms in all; a second on the page after it, not counted: ${ms(rows.map((row) => row.idle))} ms`)
    console.log(`  phases: ${Object.keys(rows[0]!.phases).map((phase) => `${phase} ${ms(rows.map((row) => row.phases[phase]!.ms))} (${median(rows.map((row) => row.phases[phase]!.markdown))} md)`).join(', ')}`)
    console.log(`  parts:  ${Object.keys(rows[0]!.parts).map((part) => `${part} ${ms(rows.map((row) => row.parts[part]!))}`).join(', ')}`)
    if (PROFILE) {
      const of = (id: string) => rows.map((row) => row.rendered[id] ?? 0)
      const pageOnly = rows.map((row) => (row.rendered['agent page'] ?? 0) - (row.rendered['header and face'] ?? 0) - (row.rendered.lines ?? 0))
      console.log(`  React render by tree: agent page ${ms(of('agent page'))} (header and face ${ms(of('header and face'))}, lines ${ms(of('lines'))}, conversation and talk box ${ms(pageOnly)}), agents list ${ms(of('agents list'))}, chat stand-ins ${ms(of('chat stand-ins'))}`)
    }
    const per = (field: 'rounds' | 'commits' | 'nodes' | 'markdownKB' | 'receivedKB' | 'messages') => median(rows.map((row) => row[field]))
    console.log(`  host rounds ${per('rounds')}, socket messages ${per('messages')} (${per('receivedKB').toFixed(0)} KB), commits ${per('commits')}, DOM nodes made ${per('nodes')}, Markdown rendered ${per('markdownKB').toFixed(0)} KB`)
  }
}
process.exit(0)
