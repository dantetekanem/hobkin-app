import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ReportsScreen } from '../ui/src/features/reports/ReportsScreen.tsx'
import { ChatColumn } from '../ui/src/features/chat/ChatColumn.tsx'
import { useReports } from '../ui/src/features/reports/store.ts'
import { createInbox } from '../ui/src/features/reports/inbox.ts'
import { useSettings } from '../ui/src/features/settings/store.ts'
import { hostStore } from '../ui/src/lib/host/client.ts'
import { applyHostMessage, initialHostState } from '../ui/src/lib/host/state.ts'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(`Motion: ${message}`) }
const opacity = (element: Element) => Number(getComputedStyle(element).opacity)
const transform = (element: Element) => new DOMMatrixReadOnly(getComputedStyle(element).transform)
const atRest = (element: Element) => {
  const matrix = transform(element)
  return Math.abs(matrix.m41) < 0.05 && Math.abs(matrix.m42) < 0.05 && Math.abs(matrix.m11 - 1) < 0.002 && Math.abs(matrix.m22 - 1) < 0.002
}
async function until(check: () => boolean, label: string) {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > 5000) throw new Error(`Motion timed out: ${label}`)
    await frame()
  }
}

// Untimed acceptance checks: observe motion across real animation frames, not source strings.
export async function verifyMotion() {
  useSettings.getState().setMovement('lively')
  const container = document.getElementById('app')!
  container.style.width = '960px'
  const now = Date.now()
  const reports = Array.from({ length: 4 }, (_, index) => ({ id: `motion:${index}`, title: `Motion report ${index}`, body: `Useful: Result ${index}\n\nReport details.`, outcome: 'completed', at: new Date(now - index * 60000).toISOString() }))
  useReports.setState({ sample: false, inbox: createInbox(reports), kind: 'all', title: '', openId: null })
  let root = createRoot(container)
  flushSync(() => root.render(<ReportsScreen />))
  const button = container.querySelector<HTMLButtonElement>('[data-report-row="motion:0"]')!
  const row = button.parentElement!
  assert(!atRest(row), 'a report row starts displaced')
  await until(() => opacity(row) > 0.05 && opacity(row) < 0.98, 'report row fades in')
  await until(() => opacity(row) >= 0.999 && atRest(row), 'report row finishes its spring')
  flushSync(() => button.click())
  const reader = container.querySelector<HTMLElement>('[data-reader]')!
  assert(reader && !atRest(reader), 'reader grows from the clicked row')
  await until(() => opacity(reader) > 0.05 && !atRest(reader), 'reader growth is animated')
  await until(() => opacity(reader) >= 0.999 && atRest(reader), 'reader growth settles')
  flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Older report"]')!.click())
  const page = container.querySelector<HTMLElement>('[data-reader-page="motion:1"]')!
  assert(page && !atRest(page), 'next report starts to the side')
  assert(container.querySelector('[data-reader-page="motion:0"]'), 'outgoing page stays for its exit')
  await until(() => opacity(page) > 0.05 && !atRest(page), 'next report slides in')
  await until(() => atRest(page) && !container.querySelector('[data-reader-page="motion:0"]'), 'page slide completes')
  flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Close the report"]')!.click())
  assert(reader.isConnected, 'reader remains mounted for its closing animation')
  await until(() => !atRest(reader), 'reader travels back on close')
  await until(() => !reader.isConnected, 'reader leaves after its animation')
  flushSync(() => root.unmount())

  container.style.width = '420px'
  const first = { id: 'first', role: 'user' as const, content: 'Previous message', at: now }
  hostStore.setState({ ...initialHostState, home: '/synthetic-motion-check', link: 'lost', messages: [first] }, true)
  root = createRoot(container)
  flushSync(() => root.render(<ChatColumn />))
  await frame()
  await frame()
  flushSync(() => hostStore.setState({ messages: [first, { ...first, id: 'second', content: 'New message' }] }))
  const rows = container.querySelectorAll('[role="log"] > ol > li > ol > li')
  const message = rows[1]!.firstElementChild!
  assert(!atRest(message), 'new chat message starts below its final position')
  await until(() => opacity(message) > 0.05 && !atRest(message), 'new chat message rises and fades')
  await until(() => opacity(message) >= 0.999 && atRest(message), 'chat message rise completes')
  flushSync(() => hostStore.setState((state) => applyHostMessage(state, { type: 'turn', seq: 1, event: { kind: 'message-start', role: 'assistant' } }), true))
  flushSync(() => hostStore.setState((state) => applyHostMessage(state, { type: 'turn', seq: 2, event: { kind: 'text-delta', index: 0, delta: '## New reply\n\nWords arriving now.' } }), true))
  const block = container.querySelector('[aria-busy="true"] h2')!
  const fresh = container.querySelector('[data-fresh]')!
  assert(block && !atRest(block), 'streaming Markdown block starts displaced')
  await until(() => opacity(fresh) > 0.05 && opacity(fresh) < 0.98, 'fresh words fade in')
  await until(() => atRest(block) && opacity(block) >= 0.999, 'streamed block rise completes')
  flushSync(() => hostStore.setState((state) => applyHostMessage(state, { type: 'turn', seq: 3, event: { kind: 'message-end', role: 'assistant', stop: 'stop' } }), true))
  assert(!container.querySelector('[aria-busy="true"]') && container.textContent?.includes('Words arriving now.'), 'completed reply remains and is no longer announced as writing')
  const edited = { ...first, role: 'assistant' as const, content: 'Corrected historical content', at: now + 60000, about: 'Corrected report', images: 2 }
  flushSync(() => hostStore.setState({ messages: [edited], live: null }))
  const changed = container.querySelector('[role="log"] > ol > li > ol > li')!
  assert(changed.textContent?.includes('hobkin') && changed.textContent?.includes(edited.content), 'same-key role and text changes appear')
  assert(changed.textContent?.includes('About Corrected report') && changed.textContent?.includes('2 images'), 'same-key metadata changes appear')
  assert(changed.querySelector('time')?.dateTime === new Date(edited.at).toISOString(), 'same-key time changes appear')
  flushSync(() => root.unmount())
  return ['report row arrival', 'reader grow', 'page slide and exit', 'reader return', 'chat message rise', 'streaming block rise', 'fresh-word fade']
}

export async function verifyReportReflow() {
  useSettings.getState().setMovement('lively')
  const container = document.getElementById('app')!
  container.style.width = '960px'
  const now = Date.now()
  const reports = Array.from({ length: 6 }, (_, index) => ({ id: `reflow:${index}`, title: `${index % 2 ? 'Skip' : 'Keep'} ${index}`, body: 'Useful: A report to read.', outcome: 'completed', at: new Date(now - index * 60000).toISOString() }))
  useReports.setState({ sample: false, inbox: createInbox(reports), kind: 'all', title: '', openId: null })
  const root = createRoot(container)
  flushSync(() => root.render(<ReportsScreen />))
  const retained = container.querySelector('[data-report-row="reflow:4"]')!.parentElement!
  const removed = container.querySelector('[data-report-row="reflow:1"]')!.parentElement!
  await until(() => opacity(retained) >= 0.999 && atRest(retained), 'retained row initial spring settles')
  const before = retained.getBoundingClientRect().top
  flushSync(() => useReports.getState().setTitle('Keep'))
  assert(removed.isConnected, 'filtered row stays for its fade-out')
  await until(() => !atRest(retained), 'retained row animates into the filtered gap')
  await until(() => opacity(removed) < 0.98, 'filtered row fades out')
  await until(() => !removed.isConnected && atRest(retained), 'filter reflow completes')
  assert(retained.getBoundingClientRect().top < before - 10, 'retained row settles in its new position')
  flushSync(() => useReports.getState().setTitle(''))
  const returning = container.querySelector('[data-report-row="reflow:1"]')!.parentElement!
  assert(!atRest(returning), 'restored row starts its arrival transform')
  await until(() => opacity(returning) > 0.05 && !atRest(returning), 'restored row rises and fades')
  await until(() => opacity(returning) >= 0.999 && atRest(returning), 'restored row arrival completes')
  flushSync(() => root.unmount())
  return ['filtered-row exit', 'retained-row layout spring', 'restored-row arrival']
}
