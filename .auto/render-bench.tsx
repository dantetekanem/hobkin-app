import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ChatColumn } from '../ui/src/features/chat/ChatColumn.tsx'
import { ReportsScreen } from '../ui/src/features/reports/ReportsScreen.tsx'
import { hostStore } from '../ui/src/lib/host/client.ts'
import { initialHostState, applyHostMessage } from '../ui/src/lib/host/state.ts'
import { useReports } from '../ui/src/features/reports/store.ts'
import { createInbox } from '../ui/src/features/reports/inbox.ts'
import { useSettings } from '../ui/src/features/settings/store.ts'
import type { ChatMessage } from '../shared/protocol/snapshot.ts'
import type { Report } from '../ui/src/features/reports/report.ts'
import '../ui/src/styles/globals.css'

const NOW = Date.parse('2026-11-10T17:00:00Z')
const DAY = 86400000
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const settle = async () => { await frame(); await frame() }
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

// Different Markdown shapes and dates, not thousands of copies of one cheap paragraph.
function prose(index: number, holdout: boolean): string {
  const name = `${holdout ? 'Release' : 'Project'} ${index}`
  switch (index % 5) {
    case 0: return `## ${name}\n\nCheck **the latest change** and its *tests*.\n\n- Read the diff\n- Follow up with the author`
    case 1: return `${name}: see [the checklist](https://example.invalid/check/${index}).\n\n\`\`\`ts\nconst revision = ${index};\nconsole.log(revision);\n\`\`\``
    case 2: return `| ${name} | State |\n| --- | --- |\n| Build | Ready |\n| Review | Waiting |`
    case 3: return `> ${name} still needs a decision.\n\n1. Read the proposal\n2. Choose a time\n\nNothing has been sent.`
    default: return `${name}: a short note with \`inline code\`, a deadline and enough detail to wrap onto another line.`
  }
}

function messages(count: number, holdout: boolean): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message:${index}`, role: index % 7 === 0 ? 'notice' : index % 2 ? 'assistant' : 'user',
    content: index % 7 === 0 ? `Check ${index} finished` : prose(index, holdout),
    at: NOW - Math.floor((count - index) / 11) * DAY - (count - index) * 60000,
    ...(index % 7 === 0 ? { tone: 'useful' as const } : {}),
  }))
}

function reports(count: number, holdout: boolean): Report[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `report:${index}`, title: `${index % 2 ? 'Build' : 'Review'} ${index}`,
    scheduleId: index % 3 ? `daily-${index % 9}` : `work.project-${index % 11}.check`,
    at: new Date(NOW - index * 3600000).toISOString(), outcome: index % 13 ? 'completed' : 'failed',
    body: `${index % 4 ? 'Useful: A change is ready to read.' : 'Nothing new.'}\n\n${prose(index, holdout)}`,
  }))
}

async function exerciseChat(count: number, holdout: boolean) {
  hostStore.setState({ ...initialHostState, home: '/synthetic-render-benchmark', link: 'lost', messages: messages(count, holdout) }, true)
  const container = document.getElementById('app')!
  container.style.width = holdout ? '520px' : '420px'
  const root = createRoot(container)
  const samples: number[] = []
  const measure = (change: () => void) => {
    const start = performance.now()
    flushSync(change)
    container.getBoundingClientRect()
    // Reading the real scroll area includes style/layout work the user needs to see the new reply.
    container.querySelector('[role="log"]')?.getBoundingClientRect()
    return performance.now() - start
  }
  const mount = measure(() => root.render(<ChatColumn />))
  await settle()
  const messageRows = container.querySelectorAll('[role="log"] > ol > li > ol > li').length
  assert(messageRows === count, `all stored messages are rendered: expected ${count}, got ${messageRows}`)
  const turn = (event: Parameters<typeof applyHostMessage>[1] & { type: 'turn' }) => hostStore.setState((state) => applyHostMessage(state, event), true)
  flushSync(() => turn({ type: 'turn', seq: 0, event: { kind: 'message-start', role: 'assistant' } }))
  let reply = '## Streaming response\n\n'
  for (let index = 0; index < 8; index++) {
    const delta = index === 0 ? reply : `Update ${index}: **checked** the result.\n\n`
    if (index) reply += delta
    samples.push(measure(() => turn({ type: 'turn', seq: index + 1, event: { kind: 'text-delta', index: 0, delta } })))
    assert(container.querySelector('[aria-busy="true"]')?.textContent?.includes(index ? `Update ${index}` : 'Streaming response'), 'streaming text is current')
    await settle()
  }
  // A history replacement must update both old text and date groups, not just append forever.
  const changed = hostStore.getState().messages.map((message, index) => index === 1 ? { ...message, content: 'Corrected stored reply' } : message)
  samples.push(measure(() => hostStore.setState({ messages: changed })))
  assert(container.textContent?.includes('Corrected stored reply'), 'stored edits reach the DOM')
  const nodes = container.querySelectorAll('*').length
  flushSync(() => root.unmount())
  await settle()
  return { mount, update: samples.reduce((sum, value) => sum + value, 0), samples, nodes }
}

async function exerciseReports(count: number, holdout: boolean) {
  const rows = reports(count, holdout)
  useReports.setState({ sample: false, inbox: createInbox(rows), kind: 'all', title: '', openId: null })
  const container = document.getElementById('app')!
  container.style.width = holdout ? '1100px' : '960px'
  const root = createRoot(container)
  const samples: number[] = []
  const measure = (change: () => void) => {
    const start = performance.now()
    flushSync(change)
    container.getBoundingClientRect()
    container.querySelector('[aria-label="Reports"]')?.getBoundingClientRect()
    return performance.now() - start
  }
  const mount = measure(() => root.render(<ReportsScreen />))
  await settle()
  assert(container.querySelectorAll('[data-report-row]').length === count, 'all reports are reachable')
  for (const index of [0, 1, Math.floor(count / 2), count - 1]) {
    samples.push(measure(() => useReports.getState().open(rows[index]!.id)))
    assert(container.querySelector(`[data-report-row="${rows[index]!.id}"]`)?.getAttribute('aria-current') === 'true', 'selected report updates')
    await settle()
  }
  samples.push(measure(() => useReports.getState().close()))
  await settle()
  for (const title of ['Build', 'Review', '']) {
    samples.push(measure(() => useReports.getState().setTitle(title)))
    await settle()
    // Exiting rows stay briefly for motion; the store is the immediate filter contract.
    assert(useReports.getState().title === title, 'filter applied')
  }
  const nodes = container.querySelectorAll('*').length
  flushSync(() => root.unmount())
  await settle()
  return { mount, update: samples.reduce((sum, value) => sum + value, 0), samples, nodes }
}

async function verifyReportChanges() {
  const row: Report = { id: 'same-id', title: 'Original title', body: 'Useful: Original summary', outcome: 'completed', scheduleId: 'daily', at: new Date(NOW).toISOString() }
  useReports.setState({ sample: false, inbox: createInbox([row]), kind: 'all', title: '', openId: null })
  const container = document.getElementById('app')!
  const root = createRoot(container)
  const button = () => container.querySelector('[data-report-row="same-id"]')!
  flushSync(() => root.render(<ReportsScreen />))
  assert(button().textContent?.includes('unread'), 'new report is announced as unread')
  flushSync(() => useReports.getState().open(row.id))
  assert(!button().textContent?.includes('unread'), 'opening updates the accessible read mark')
  const changed = { ...row, title: 'Corrected title', body: 'Critical: Corrected summary', scheduleId: 'work.changed-project.check', at: new Date(NOW + DAY).toISOString() }
  flushSync(() => useReports.setState({ inbox: createInbox([changed], [changed.id]) }))
  assert(button().textContent?.includes('Corrected title') && button().textContent?.includes('Corrected summary'), 'same-id report replacements update title and summary')
  assert(button().textContent?.includes('Critical') && button().textContent?.includes('changed-project'), 'tone and source update')
  assert(button().querySelector('time')?.dateTime === changed.at, 'timestamp updates')
  flushSync(() => useReports.getState().close())
  flushSync(() => button().dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert(useReports.getState().openId === changed.id, 'row click retains current callback')
  flushSync(() => root.unmount())
  await settle()
}

export async function runBenchmark(holdout = false) {
  useSettings.getState().setMovement(holdout ? 'still' : 'lively')
  await exerciseChat(7, holdout)
  await exerciseReports(9, holdout)
  const cases: Record<string, Awaited<ReturnType<typeof exerciseChat>>[]> = {}
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const count of holdout ? [23, 91, 337] : [16, 128, 512]) {
      const key = `chat_${count}`
      ;(cases[key] ??= []).push(await exerciseChat(count, holdout))
    }
    for (const count of holdout ? [41, 157, 431] : [32, 192, 512]) {
      const key = `reports_${count}`
      ;(cases[key] ??= []).push(await exerciseReports(count, holdout))
    }
  }
  const metrics: Record<string, number> = { render_ms: 0, chat_mount_ms: 0, chat_update_ms: 0, reports_mount_ms: 0, reports_update_ms: 0, update_p95_ms: 0, max_dom_nodes: 0 }
  const durations: number[] = []
  for (const [name, runs] of Object.entries(cases)) {
    const family = name.startsWith('chat') ? 'chat' : 'reports'
    metrics[`${family}_mount_ms`] += median(runs.map((run) => run.mount))
    metrics[`${family}_update_ms`] += median(runs.map((run) => run.update))
    metrics.max_dom_nodes = Math.max(metrics.max_dom_nodes!, ...runs.map((run) => run.nodes))
    durations.push(...runs.flatMap((run) => run.samples))
  }
  metrics.render_ms = metrics.chat_mount_ms! + metrics.chat_update_ms! + metrics.reports_mount_ms! + metrics.reports_update_ms!
  metrics.update_p95_ms = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)]!
  await verifyReportChanges()
  return { metrics, cases, holdout, userAgent: navigator.userAgent }
}

Object.assign(window, { runBenchmark })
