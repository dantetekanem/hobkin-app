import { Plus, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MEMORY_KINDS, MEMORY_NOW_MAX, type MemoryEntry } from '#shared/protocol/memory.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { Empty, Notices, PageHeading, pieces, useLanding, walkWithArrows } from '@/features/skills/page-parts.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { countsOf, isPast, KIND_WORDS, pageOf, todayOf, type MemoryCounts, type MemoryFilter, type WordsAt } from './groups.ts'
import { MemoryEditor } from './MemoryEditor.tsx'
import { LinkPress } from './LinkPress.tsx'
import { MemoryRow } from './MemoryRow.tsx'
import { NowList } from './NowList.tsx'
import { NEW_DRAFT, type MemoryDraft } from './store.ts'
import { memoryActions, memoryStore, useMemory, useMemoryPage } from './use-memories.ts'

const NO_MEMORIES: readonly MemoryEntry[] = []
const NO_LINES: readonly string[] = []

/** What the page says it is, and where a memory goes once an agent reads it. */
const PAGE_LINE =
  'What hobkin remembers about you and your life, for every agent it runs. An agent that reads a memory sends it to its model provider. A private one reaches only the main chat and your durable hobkins.'

/**
 * Memory (`057-shared-memory`): everything hobkin remembers for its agents, by kind, with where each memory came from
 * and when, a search by words, and Add. A memory is edited in its row, forgotten with Undo, and made private or shared
 * from its menu. The Right now list sits on the page with its own edits. With no host, the sample shows, and its
 * changes stay in this window. This file is the entry the frame mounts, under Settings.
 *
 * Keys: the arrows move between controls by where they sit. An Escape with nothing of the page's own open is left for
 * the frame, which steps back up to Settings.
 */
export function MemoryScreen() {
  useMemoryPage()
  const live = useHasHost()
  const list = useMemory((state) => state.list)
  const problem = useMemory((state) => state.problem)
  const forgotten = useMemory((state) => state.forgotten)
  const seek = useMemory((state) => state.seek)
  const adding = useMemory((state) => state.drafts[NEW_DRAFT] !== undefined)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const still = useStill()
  const togglePage = useView((view) => view.togglePage)
  // The page reads the time once as it opens: nothing on it ticks.
  const [at] = useState<WordsAt>(() => ({ now: Date.now() }))
  const today = useMemo(() => todayOf(new Date(at.now)), [at])

  useLanding(root, scroller)

  // A memory forgotten here stays in its place, as one line, until the page is left.
  const memories = useMemo(() => {
    const held = list?.memories ?? NO_MEMORIES
    const gone = Object.values(forgotten).filter(({ entry }) => !held.some((memory) => memory.name === entry.name))
    return gone.length === 0 ? held : [...held, ...gone.map(({ entry }) => entry)]
  }, [list, forgotten])
  const now = list?.now ?? NO_LINES
  const counts = useMemo(() => countsOf(list?.memories ?? NO_MEMORIES, now, today), [list, now, today])
  const parts = useMemo(() => pageOf({ memories, now, query, filter, today }), [memories, now, query, filter, today])

  // A link or a chat line's See brings its memory into view, out of a search or a kind if it is hidden there.
  useEffect(() => {
    if (!seek || !list) return
    if (!memories.some((memory) => memory.name === seek)) {
      setNotice('That memory is not here any more.')
      memoryStore.sought()
      return
    }
    const row = scroller.current?.querySelector<HTMLElement>(`[data-memory="${CSS.escape(seek)}"]`)
    if (!row) {
      setQuery('')
      setFilter('all')
      return
    }
    memoryStore.sought()
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
  }, [seek, list, memories, parts, still])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    // Inside a field the arrows move its caret and its choices.
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type !== 'search')) return
    if (target instanceof HTMLElement && target.closest('[role="listbox"],[role="menu"],[role="switch"]')) return
    walkWithArrows(event, scroller.current, still)
  }

  const notices = [...(notice ? [notice] : []), ...(problem ? [problem] : []), ...(list?.unavailable ? [list.unavailable] : []), ...unreadableNotice(list?.unreadable)]
  const empty = list !== null && memories.length === 0 && now.length === 0 && !query
  const searching = query.trim().length > 0

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full outline-none">
      <div ref={scroller} className={`${SCREEN_SCROLLER} pb-12`}>
        {/* The page loads on demand and may arrive after the canvas has played its entrance, so it starts its own. */}
        <motion.div variants={pieces} initial="enter" animate="center" className={`flex flex-col gap-8 ${SCREEN_COLUMN}`}>
          <Hero>
            <PageHeading title="Memory" line={PAGE_LINE} />
            {!live ? <p className="mt-2 text-[12.5px] text-muted-foreground">Sample memories, made up. With no hobkin running, a change stays in this window until it reloads.</p> : null}
          </Hero>

          <Rise>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <label className="relative flex min-w-0 flex-1 items-center">
                  <Search className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" aria-hidden="true" />
                  <input
                    data-key-stop=""
                    type="search"
                    aria-label="Find a memory"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Find a memory by its words"
                    className="h-8 w-full max-w-[360px] rounded-full border border-input bg-surface pr-3 pl-8 text-[13px] outline-offset-2 placeholder:text-muted-foreground/70"
                  />
                </label>
                <Button data-key-stop="" disabled={adding || list === null || Boolean(list.unavailable) || problem !== null} onClick={() => memoryStore.add(filter !== 'all' && filter !== 'now' && filter !== 'past' ? filter : 'user')}>
                  <Plus aria-hidden="true" />
                  Add a memory
                </Button>
              </div>
              <FilterChips counts={counts} filter={filter} onFilter={setFilter} />
            </div>
          </Rise>

          {notices.length > 0 ? <Notices items={notices} /> : null}

          {adding ? <NewMemory /> : null}

          <Rise>
            <div className="flex flex-col gap-9">
              {list === null && !problem ? <Empty>Reading what hobkin remembers.</Empty> : null}
              {empty ? (
                <Empty>hobkin remembers nothing yet. Tell it in Chat, such as “remember that I live in Lisbon”, or add a memory here.</Empty>
              ) : list !== null ? (
                parts.map((part) =>
                  part.key === 'now' ? (
                    <NowList key="now" lines={part.lines} total={now.length} searching={searching} />
                  ) : (
                    <section key={part.key} aria-label={part.label} className="flex flex-col gap-3">
                      <h3 className="eyebrow">{part.label}</h3>
                      {part.memories.length === 0 ? (
                        <Empty>{part.key === 'found' ? `Nothing holds every word of “${query.trim()}”.` : part.key === 'past' ? 'Nothing has passed its day.' : 'Nothing of this kind yet.'}</Empty>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {part.memories.map((memory) => (
                            <MemoryRow key={memory.name} memory={memory} forgotten={forgotten[memory.name]} past={isPast(memory, today)} at={at} />
                          ))}
                        </div>
                      )}
                    </section>
                  ),
                )
              ) : null}
            </div>
          </Rise>

          <p className="border-t border-border pt-5 text-[12.5px] text-muted-foreground">
            Every agent also follows your directions and knows what you told setup. Both are in{' '}
            <LinkPress onPress={() => togglePage('memory')}>Settings</LinkPress>.
          </p>
        </motion.div>
      </div>
    </div>
  )
}

/** The files hobkin could not read as a memory, named, so a broken one is never silently missing. */
function unreadableNotice(unreadable: readonly string[] | undefined): string[] {
  if (!unreadable?.length) return []
  const names = unreadable.slice(0, 5).join(', ')
  const more = unreadable.length > 5 ? ` and ${unreadable.length - 5} more` : ''
  return [`hobkin could not read ${unreadable.length === 1 ? 'one file' : `${unreadable.length} files`} in its memories folder: ${names}${more}.`]
}

/**
 * The counts by kind, as a way to show one kind, the Right now list or the past ones. They count what the page holds,
 * so they stay as they are while a search runs.
 */
function FilterChips({ counts, filter, onFilter }: { counts: MemoryCounts; filter: MemoryFilter; onFilter: (filter: MemoryFilter) => void }) {
  const chips: { value: MemoryFilter; label: string; count: string }[] = [
    { value: 'all', label: 'All', count: String(counts.all) },
    ...MEMORY_KINDS.map((kind) => ({ value: kind, label: KIND_WORDS[kind].heading, count: String(counts.kinds[kind]) })),
    { value: 'now', label: 'Right now', count: `${counts.now} of ${MEMORY_NOW_MAX}` },
    { value: 'past', label: 'Past', count: String(counts.past) },
  ]
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const chosen = chip.value === filter
        return (
          <button
            key={chip.value}
            type="button"
            data-key-stop=""
            aria-pressed={chosen}
            onClick={() => onFilter(chosen && chip.value !== 'all' ? 'all' : chip.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap outline-offset-2 transition-colors duration-[160ms] ease-[ease]',
              chosen ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-surface-2',
            )}
          >
            {chip.label}
            <span className={cn('tabular-nums', chosen ? 'text-background/70' : 'text-muted-foreground')}>{chip.count}</span>
          </button>
        )
      })}
    </div>
  )
}

const BLANK: MemoryDraft = { description: '', kind: 'user', until: '', private: false, text: '' }

/** A memory being added, above the list. It joins its kind once hobkin keeps it. */
function NewMemory() {
  const draft = useMemory((state) => state.drafts[NEW_DRAFT])
  const busy = useMemory((state) => state.busy[NEW_DRAFT] === true)
  const refused = useMemory((state) => state.refused[NEW_DRAFT] ?? null)
  const field = useRef<HTMLElement | null>(null)
  useEffect(() => {
    field.current?.querySelector<HTMLElement>('[data-first-field]')?.focus({ preventScroll: true })
  }, [])
  if (!draft) return null
  const dirty = draft.description !== BLANK.description || draft.text !== BLANK.text || draft.until !== BLANK.until || draft.private !== BLANK.private
  return (
    <section ref={field} aria-label="New memory" className="flex flex-col gap-3">
      <h3 className="eyebrow">New memory</h3>
      <div className="rounded-[22px] bg-background p-4 ring-1 ring-border-strong/50">
        <MemoryEditor
          label="New memory"
          draft={draft}
          dirty={dirty}
          busy={busy}
          refused={refused}
          onChange={(patch) => memoryStore.change(NEW_DRAFT, patch)}
          onSave={() => void memoryActions.save(NEW_DRAFT)}
          onCancel={() => memoryStore.cancel(NEW_DRAFT)}
        />
      </div>
    </section>
  )
}
