/**
 * The window's script time for host messages, without a page. Replays one activity message per 25 ms for running
 * agents through the real host store, its module listeners and the hooks the always-mounted views call (stand-ins in
 * `window/probes.ts`), with animation frames every 16.7 ms on a made-up clock, and prints the script time and React
 * commits per message. No page is drawn, so the times are a floor. Run from the repository root:
 *
 *   NODE_ENV=production node scripts/perf/window-frames.ts [--agents 100] [--frames 200] [--entries 60] [--screen home|agent] [--rows list|own]
 *
 * `--frames` is how many messages are timed, after 40 that warm up. `--entries` is how many steps each agent holds.
 * `--rows` is how a dock row reads its words; it defaults to what `ui/src/app/AgentsDock.tsx` does now. Without
 * NODE_ENV=production it measures React's development build.
 */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
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
const AGENTS = count('agents', 100)
const FRAMES = count('frames', 200)
const ENTRIES = count('entries', 60)
const SCREEN = flag('screen', 'home')
if (SCREEN !== 'home' && SCREEN !== 'agent') throw new Error('--screen is home or agent.')
const dock = readFileSync(new URL('../../ui/src/app/AgentsDock.tsx', import.meta.url), 'utf8')
const ROWS = flag('rows', dock.includes('useAgentWords(') ? 'own' : 'list')
if (ROWS !== 'list' && ROWS !== 'own') throw new Error('--rows is list or own.')
const WARM_UP = 40
const MESSAGE_MS = 25
const FRAME_MS = 1000 / 60

// The app's `@/` imports point at ui/src, as Vite resolves them.
const SOURCE = new URL('../../ui/src/', import.meta.url).href
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? SOURCE + specifier.slice(2) : specifier, context) })

// What the window's modules read of a page, and animation frames that run when the replay says a frame is due.
const storage = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
}
const frames: FrameRequestCallback[] = []
const requestAnimationFrame = (run: FrameRequestCallback) => frames.push(run)
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })
Object.assign(globalThis, {
  window: { localStorage, requestAnimationFrame, HTMLIFrameElement: class {} },
  requestAnimationFrame,
  cancelAnimationFrame: () => {},
  IS_REACT_ACT_ENVIRONMENT: false,
})
// React tells a devtools hook about every commit, in its production build too, which is how commits are counted here.
let commits = 0
const devtools = {
  supportsFiber: true,
  isDisabled: false,
  inject: () => 1,
  onCommitFiberRoot: () => {
    commits += 1
  },
  onCommitFiberUnmount: () => {},
  onPostCommitFiberRoot: () => {},
}
Object.assign(globalThis, { __REACT_DEVTOOLS_GLOBAL_HOOK__: devtools })
// Timers and Date follow the replay's clock, so a 25 ms message gap is 25 ms to the code under test however long it ran.
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })

const { HostConnection } = await import('../../ui/src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {})
mock.method(HostConnection.prototype, 'command', async () => {
  throw new Error('The replay sends no commands.')
})
const { hostStore } = await import('../../ui/src/lib/host/client.ts')
const { applyHostMessage } = await import('../../ui/src/lib/host/state.ts')
// The module-level host listeners the window loads with its frame, each subscribing on import.
await import('../../ui/src/features/actions/store.ts')
await import('../../ui/src/features/routines/store.ts')
await import('../../ui/src/features/work/store.ts')
await import('../../ui/src/features/chat/chat-store.ts')
await import('../../ui/src/features/work/agent-threads.ts')
await import('../../ui/src/features/chat/use-first-word.ts')
const { useReports } = await import('../../ui/src/features/reports/store.ts')
const { draws, resetDraws, screenTree } = await import('./window/probes.ts')
const { synthetic } = await import('./window/synthetic.ts')
const { createRoot } = await import('react-dom/client')
const { createElement, Fragment } = await import('react')

const data = synthetic({ agents: AGENTS, entries: ENTRIES })
const deliver = (text: string) => hostStore.setState((state) => applyHostMessage(state, JSON.parse(text)), true)
deliver(JSON.stringify(data.hello))
deliver(JSON.stringify(data.reset))
useReports.setState({ ready: true, sample: false })

let clock = 0
const settle = () => new Promise((resolve) => setImmediate(resolve))
async function advance(to: number) {
  mock.timers.tick(to - clock)
  clock = to
  await settle()
}
async function frame(at: number) {
  await advance(at)
  for (const run of frames.splice(0)) run(at)
  await settle()
}

const ignore = () => {}
const page = { nodeType: 9, addEventListener: ignore, removeEventListener: ignore }
const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: page, addEventListener: ignore, removeEventListener: ignore, textContent: '' }
const root = createRoot(container as never)
root.render(createElement(Fragment, null, screenTree(SCREEN, data.ids[1]!, ROWS)))
await settle()

/** Replays `messages` messages 25 ms apart, with every animation frame due between them. Answers the script time of each, and the bytes. */
async function replay(messages: number): Promise<{ took: number[]; bytes: number }> {
  const texts = Array.from({ length: messages }, () => data.next())
  const took: number[] = []
  let nextFrame = Math.ceil(clock / FRAME_MS) * FRAME_MS
  for (const text of texts) {
    const at = clock + MESSAGE_MS
    const start = performance.now()
    while (nextFrame <= at) {
      await frame(nextFrame)
      nextFrame += FRAME_MS
    }
    await advance(at)
    deliver(text)
    await settle()
    took.push(performance.now() - start)
  }
  return { took, bytes: texts.reduce((sum, text) => sum + text.length, 0) / messages }
}

await replay(WARM_UP)
resetDraws()
commits = 0
const { took, bytes } = await replay(FRAMES)
root.unmount()
mock.timers.reset()

const total = took.reduce((sum, value) => sum + value, 0)
const perMessage = total / FRAMES
const sorted = took.toSorted((a, b) => a - b)
const react = process.env.NODE_ENV === 'production' ? 'production' : 'development'
console.log(`${AGENTS} agents of ${ENTRIES} steps, ${FRAMES} messages 25 ms apart (about ${Math.round(bytes / 1000)} KB each), screen ${SCREEN}, rows read ${ROWS === 'own' ? 'their own agent' : 'the agents list'}, ${react} React`)
console.log(`script per message: ${perMessage.toFixed(2)} ms (median ${sorted[Math.floor(FRAMES / 2)]!.toFixed(2)}, worst ${sorted.at(-1)!.toFixed(2)}), ${(perMessage * 4).toFixed(1)}% of a core at 40 messages a second`)
console.log(`React commits per message: ${(commits / FRAMES).toFixed(2)}`)
console.log(`draws per message: ${Object.entries(draws).map(([name, value]) => `${name} ${(value / FRAMES).toFixed(2)}`).join(', ')}`)
