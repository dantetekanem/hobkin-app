/**
 * Made-up host messages for the window's frame replay: a hello, a reset with `agents` running background runs of
 * `entries` steps each, 700 reports and 100 chat messages, and then one activity message per 25 ms. In each message
 * every agent whose last step is words says 8 more characters (the host resends the whole entry), and one agent starts
 * or ends a tool. With 100 agents that is about 40 tool changes a second, as the audit of 2026-11-21 measured.
 * The text is the same for every run: the random words come from a fixed seed.
 */

const WORDS = 'the agent reads the file then changes the function so the test passes and the build stays green while it checks each case with care'.split(' ')

interface Entry {
  id: string
  kind: 'assistant' | 'tool'
  text?: string
  name?: string
  state?: string
  input?: string
  output?: string
  at?: number
}

export interface Synthetic {
  ids: string[]
  hello: object
  reset: object
  /** The next activity message, as the JSON text the socket carries. */
  next: () => string
}

export function synthetic({ agents, entries, reports = 700 }: { agents: number; entries: number; reports?: number }): Synthetic {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const text = (chars: number) => {
    let out = ''
    while (out.length < chars) out += WORDS[Math.floor(random() * WORDS.length)] + (random() < 0.08 ? '.\n\n' : ' ')
    return out.slice(0, chars)
  }

  const ids = Array.from({ length: agents }, (_, index) => `run-${index}`)
  const at = Date.now() - 3_600_000
  const jobs = new Map<string, Entry[]>()
  const messageOf = new Map<string, number>()
  for (const id of ids) {
    const steps: Entry[] = []
    for (let k = 0; k < entries - 1; k++) {
      const kind = k % 4
      if (kind === 0) steps.push({ id: `message:${k}:0`, kind: 'assistant', text: `## Step ${k}\n\n${text(600)}`, at: at + k })
      else if (kind === 1) steps.push({ id: `tool:r${k}`, kind: 'tool', name: 'read', state: 'completed', input: JSON.stringify({ path: `/fake/src/file-${k}.ts` }), output: text(3000), at: at + k })
      else if (kind === 2) steps.push({ id: `tool:b${k}`, kind: 'tool', name: 'bash', state: 'completed', input: JSON.stringify({ command: `pnpm test file-${k}` }), output: text(1500), at: at + k })
      else steps.push({ id: `tool:e${k}`, kind: 'tool', name: 'edit', state: 'completed', input: JSON.stringify({ path: `/fake/src/file-${k}.ts`, edits: [{ oldText: text(200), newText: text(240) }] }), output: 'Successfully replaced text.', at: at + k })
    }
    messageOf.set(id, entries)
    steps.push({ id: `message:${entries}:0`, kind: 'assistant', text: text(200), at: at + entries })
    jobs.set(id, steps)
  }

  const runs = ids.map((id, index) => ({
    id,
    kind: 'background',
    state: 'running',
    title: `Agent ${index} fixes the ${WORDS[index % WORDS.length]} flow`,
    cwd: `/fake/proj-${index % 12}`,
    effort: ['low', 'medium', 'high'][index % 3],
    startedAt: new Date(at).toISOString(),
    ...(index % 3 === 0 ? { work: { slug: `proj-${index % 12}` } } : {}),
  }))
  const stopControls = {
    home: '/fake/home',
    epoch: 'e1',
    targets: [
      { kind: 'main', runId: 'main', parentId: null, rootId: 'main', label: 'hobkin', canStop: true, canForce: true },
      ...ids.map((id) => ({ kind: 'run', runId: id, parentId: null, rootId: id, label: id, canStop: true, canForce: true })),
    ],
  }
  const reportRows = Array.from({ length: reports }, (_, index) => ({ id: `report-${index}`, title: `Report ${index}`, body: text(1500), outcome: 'completed', at: new Date(at - index * 60_000).toISOString(), scheduleId: `routine-${index % 20}` }))
  const chat = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: text(300), at: at + index * 1000 }))

  const hello = { type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: { providers: [], models: [{ id: 'x' }] }, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } }
  const reset = {
    type: 'state',
    rev: 1,
    reset: true,
    set: { connection: 'connected', busy: false, runs, reports: reportRows, stopControls, main: { harness: 'pi', model: 'm', effort: 'high' }, decisions: [], waiting: {} },
    messages: [{ op: 'reset', messages: chat }],
    activity: ids.map((job) => ({ op: 'reset', job, entries: jobs.get(job)! })),
  }

  let rev = 2
  let turn = 0
  let count = 0
  function next(): string {
    const frame = count++
    const steps: unknown[] = []
    const job = ids[(turn++ * 37) % agents]!
    const held = jobs.get(job)!
    const last = held.at(-1)!
    if (last.kind === 'assistant') {
      const tool: Entry = { id: `tool:f${frame}`, kind: 'tool', name: 'bash', state: 'running', input: JSON.stringify({ command: `pnpm test ${frame}` }), at: Date.now() }
      held.push(tool)
      steps.push({ op: 'append', job, entries: [tool] })
    } else {
      const done = { ...last, state: 'completed', output: text(1500) }
      held[held.length - 1] = done
      const message = messageOf.get(job)! + 1
      messageOf.set(job, message)
      const words: Entry = { id: `message:${message}:0`, kind: 'assistant', text: text(20), at: Date.now() }
      held.push(words)
      steps.push({ op: 'update', job, entry: done }, { op: 'append', job, entries: [words] })
    }
    for (const id of ids) {
      if (id === job) continue
      const entriesOf = jobs.get(id)!
      const latest = entriesOf.at(-1)!
      if (latest.kind !== 'assistant') continue
      const grown = { ...latest, text: latest.text + text(8) }
      entriesOf[entriesOf.length - 1] = grown
      steps.push({ op: 'update', job: id, entry: grown })
    }
    return JSON.stringify({ type: 'state', rev: rev++, activity: steps })
  }

  return { ids, hello, reset, next }
}
