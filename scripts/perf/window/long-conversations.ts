/**
 * Made-up long conversations in the host's own shapes (`#shared/protocol/hobkins.ts`, `#shared/protocol/activity.ts`),
 * for the agent-switch benchmark: durable hobkins of many turns, each turn a message, 5 to 30 tool calls (commands
 * with long output, edits with diffs, reads of files, searches) with the agent's words between them, and an answer of
 * 200 to 2000 words of Markdown with code; and work runs whose feed holds its newest 200 steps of thousands. Outputs are
 * kept as hobkin's feed keeps them (`MOST_OUTPUT`: the two ends of a longer one). The same seed gives the same text.
 */
import { FEED_STEPS, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'

/** hobkin's `MOST_OUTPUT`: a longer output keeps its first and last halves of this. */
const MOST_OUTPUT = 8192

const WORDS = (
  'the agent reads the file then changes the function so the test passes and the build stays green while it checks each ' +
  'case with care because a page that draws twice costs more than one that waits for its data before it shows anything ' +
  'store selector render commit effect hook memo reducer socket host window message step turn answer feed watch reset'
).split(' ')
const FILES = ['ui/src/app/AgentsDock.tsx', 'ui/src/lib/host/state.ts', 'host/src/windows.ts', 'shared/protocol/activity.ts', 'ui/src/features/hobkins/conversation.ts', 'ui/src/features/agent-activity/steps.ts', 'README.md', 'package.json']

export interface Random {
  next(): number
  int(low: number, high: number): number
  pick<Item>(items: readonly Item[]): Item
}

export function seeded(seed: number): Random {
  let state = seed
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  return {
    next,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
  }
}

const words = (random: Random, count: number) => Array.from({ length: count }, () => random.pick(WORDS)).join(' ')
const sentence = (random: Random) => {
  const text = words(random, random.int(6, 18))
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`
}
const paragraph = (random: Random, count: number) => {
  const sentences: string[] = []
  let total = 0
  while (total < count) {
    const next = sentence(random)
    sentences.push(random.next() < 0.15 ? next.replace(/ (\w+) /, ' `$1` ') : random.next() < 0.1 ? next.replace(/ (\w+ \w+) /, ' **$1** ') : next)
    total += next.split(' ').length
  }
  return sentences.join(' ')
}

const codeLine = (random: Random, index: number) =>
  random.pick([
    `const ${random.pick(WORDS)}${index} = ${random.pick(WORDS)}Of(${random.pick(WORDS)}, { ${random.pick(WORDS)}: ${index} })`,
    `if (!${random.pick(WORDS)}) return ${random.pick(['null', 'undefined', '[]', 'false'])}`,
    `export function ${random.pick(WORDS)}${index}(${random.pick(WORDS)}: string): number {`,
    `  return ${random.pick(WORDS)}.${random.pick(WORDS)}((${random.pick(WORDS)}) => ${random.pick(WORDS)} + ${index})`,
    '}',
    `// ${sentence(random)}`,
    `  ${random.pick(WORDS)}.set('${random.pick(WORDS)}', ${index})`,
  ])
const code = (random: Random, lines: number) => Array.from({ length: lines }, (_, index) => codeLine(random, index)).join('\n')

/** An answer of about `count` words: paragraphs, headings, lists, code blocks, now and then a table. */
export function markdownOf(random: Random, count: number): string {
  const parts: string[] = []
  let total = 0
  while (total < count) {
    const kind = random.next()
    if (kind < 0.45 || !parts.length) {
      const size = random.int(40, 120)
      parts.push(paragraph(random, size))
      total += size
    } else if (kind < 0.55) parts.push(`## ${sentence(random).slice(0, -1)}`)
    else if (kind < 0.72) {
      const items = random.int(3, 7)
      parts.push(Array.from({ length: items }, (_, index) => (random.next() < 0.5 ? '- ' : `${index + 1}. `) + paragraph(random, random.int(8, 24))).join('\n'))
      total += items * 16
    } else if (kind < 0.92) {
      const lines = random.int(4, 24)
      parts.push(`\`\`\`${random.pick(['ts', 'tsx', 'bash', 'json'])}\n${code(random, lines)}\n\`\`\``)
      total += lines * 6
    } else {
      const rows = random.int(3, 8)
      const head = '| Part | Before | After |\n| --- | --- | --- |'
      parts.push(`${head}\n${Array.from({ length: rows }, () => `| ${random.pick(WORDS)} | ${random.int(1, 900)} ms | ${random.int(1, 90)} ms |`).join('\n')}`)
      total += rows * 5
    }
  }
  return parts.join('\n\n')
}

const kept = (text: string) => (text.length <= MOST_OUTPUT ? { output: text } : { output: `${text.slice(0, MOST_OUTPUT / 2)}\n…\n${text.slice(-MOST_OUTPUT / 2)}`, outputLength: text.length })

/** One tool call, as hobkin's feed keeps it: its arguments as indented JSON, its output, how it ended, when it began. */
function toolCall(random: Random, id: string, at: number): ActivityEntry {
  const kind = random.next()
  const file = random.pick(FILES)
  const call = (name: string, args: object, output: string, failed = false): ActivityEntry => ({
    id: `tool:${id}`,
    kind: 'tool',
    name,
    state: failed ? 'failed' : 'completed',
    input: JSON.stringify(args, null, 2),
    ...kept(output),
    at,
  })
  if (kind < 0.35) {
    const lines = random.int(20, 400)
    const output = Array.from({ length: lines }, (_, index) => (index % 9 === 0 ? ` ✓ ${file} (${random.int(1, 40)} tests) ${random.int(2, 90)}ms` : `  ${words(random, random.int(4, 14))}`)).join('\n')
    return call('bash', { command: random.pick([`pnpm -s typecheck`, `node --test ui/test/${random.pick(WORDS)}.test.ts`, `rg -n "${random.pick(WORDS)}" ui/src`, `git diff --stat`]) }, output, random.next() < 0.05)
  }
  if (kind < 0.6) {
    const lines = random.int(40, 300)
    return call('read', { path: `/fake/proj/${file}` }, code(random, lines))
  }
  if (kind < 0.85) {
    const oldText = code(random, random.int(3, 30))
    const newText = code(random, random.int(3, 40))
    return call('edit', { path: `/fake/proj/${file}`, edits: [{ oldText, newText }] }, `Successfully replaced text in /fake/proj/${file}.`)
  }
  const hits = random.int(5, 60)
  return call('grep', { pattern: random.pick(WORDS), path: '/fake/proj' }, Array.from({ length: hits }, () => `/fake/proj/${random.pick(FILES)}:${random.int(1, 800)}: ${codeLine(random, hits)}`).join('\n'))
}

/** A turn's feed: words, calls with words between some of them, and the answer last, as the turn ended on it. */
function turnEntries(random: Random, run: string, calls: number, reply: string, at: number): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  let message = 0
  let clock = at
  const said = (text: string) => entries.push({ id: `message:${message++}:0`, kind: 'assistant', text, at: (clock += 900) })
  said(paragraph(random, random.int(15, 60)))
  for (let index = 0; index < calls; index++) {
    entries.push(toolCall(random, `${run}-${index}`, (clock += random.int(800, 20_000))))
    if (random.next() < 0.3) said(paragraph(random, random.int(10, 80)))
  }
  said(reply)
  return entries
}

export interface LongHobkin {
  summary: HobkinSummary
  conversation: HobkinConversation
  /** Each finished turn's feed, by its run: what `activity.before` reads back from the turn's saved session. */
  turnSteps: Map<string, ActivityEntry[]>
}

/** A durable hobkin with `turns` finished turns, waiting for its next message. */
export function longHobkin(index: number, { turns, now }: { turns: number; now: number }): LongHobkin {
  const random = seeded(101 + index)
  const id = (0x1000_0000 + index * 0x1111).toString(16).slice(0, 8)
  const start = now - turns * 600_000
  const turnSteps = new Map<string, ActivityEntry[]>()
  const list: HobkinTurn[] = []
  for (let n = 1; n <= turns; n++) {
    const run = `run-${id}-${n}`
    const askedAt = start + (n - 1) * 600_000
    const reply = markdownOf(random, random.int(200, 2000))
    const entries = turnEntries(random, run, random.int(5, 30), reply, askedAt)
    turnSteps.set(run, entries.slice(-FEED_STEPS))
    list.push({
      n,
      run,
      asked: paragraph(random, random.int(10, 60)),
      from: { kind: 'user' },
      askedAt: new Date(askedAt).toISOString(),
      status: 'completed',
      reply,
      error: null,
      endedAt: new Date((entries.at(-1)!.at ?? askedAt) + 1000).toISOString(),
    })
  }
  const last = list.at(-1)!
  const summary: HobkinSummary = {
    id,
    title: `Durable ${index + 1}: the ${random.pick(WORDS)} work`,
    cwd: `/fake/proj-${index}`,
    engine: { kind: 'tier', tier: 'mid' } as HobkinSummary['engine'],
    state: 'waiting',
    turns,
    run: null,
    last: { status: 'completed', said: last.reply!.slice(0, 200), at: last.endedAt! },
    waiting: { since: last.endedAt!, seen: true },
    createdAt: new Date(start).toISOString(),
  }
  return { summary, conversation: { hobkin: summary, turns: list }, turnSteps }
}

export interface LongRun {
  id: string
  run: Record<string, unknown>
  /** The newest FEED_STEPS steps of `calls` tool calls, as the host's feed holds them. */
  feed: ActivityEntry[]
}

/** A work run at work with `calls` tool calls behind it; its feed holds the newest 200 steps. */
export function longRun(index: number, { calls, now }: { calls: number; now: number }): LongRun {
  const random = seeded(901 + index)
  const id = `work-run-${index}`
  const entries: ActivityEntry[] = []
  let clock = now - calls * 20_000
  let message = 0
  const first = Math.max(0, calls - FEED_STEPS)
  for (let call = first; call < calls && entries.length < FEED_STEPS; call++) {
    if (random.next() < 0.3) entries.push({ id: `message:${message++}:0`, kind: 'assistant', text: random.next() < 0.2 ? markdownOf(random, random.int(100, 600)) : paragraph(random, random.int(10, 80)), at: (clock += 900) })
    entries.push(toolCall(random, `${id}-${call}`, (clock += random.int(800, 20_000))))
  }
  const feed = entries.slice(-FEED_STEPS)
  const run = {
    id,
    kind: 'background',
    state: 'running',
    title: `Work run ${index + 1} rebuilds the ${random.pick(WORDS)} flow`,
    cwd: `/fake/work-${index}`,
    effort: 'high',
    startedAt: new Date(now - calls * 20_000).toISOString(),
    work: { slug: `work-${index}` },
  }
  return { id, run, feed }
}

/** Every job's feed the host holds: the work runs' newest steps. A durable hobkin that waits has no turn in flight. */
export function hostActivity(runs: readonly LongRun[]): JobActivity {
  return Object.fromEntries(runs.map((run) => [run.id, run.feed]))
}
