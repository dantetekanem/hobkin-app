import { CircleAlert, RotateCw } from 'lucide-react'
import { AnimatePresence, type Variants } from 'motion/react'
import { useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { GITHUB_LIMIT, type GitHubConnection } from '#shared/protocol/github.ts'
import { useRemembered } from '@/app/location.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { useSettings } from '../settings/store.ts'
import { SCREEN_COLUMN, SCREEN_SCROLLER_UNDER_SECOND_ROW, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { rowVariants, useArriving } from '@/features/reports/list-motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { waited } from '@/features/reports/time.ts'
import { runCommand, useGitHub, useHasHost, type GitHubState } from '@/lib/host/index.ts'
import { stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { rowsOf } from '@/features/work/ai-reviews.ts'
import { PageTabs, TabCount } from '@/features/work/PageTabs.tsx'
import { useReviewList } from '@/features/work/use-review-list.ts'
import { pullSections, type PullSections } from './pull-reviews.ts'
import { GroupHeading, IssueRow, NoteRow, PullCard } from './rows.tsx'

/** The rows of the page (`rows.tsx` marks them) and the Refresh button: where the keyboard lands and returns to. */
const ROW = '[data-github-row]'
const REFRESH = '[data-github-refresh]'

/** As in the lists' own variants: how many rows wait their turn as the screen arrives. */
const MOST_IN_TURN = 10

/**
 * With Movement set to Still a row only fades, in turn as the screen arrives. The lists' own still variants leave the
 * transform out of `enter` and in `center`, and Motion then grows the row from nothing, Still or not.
 */
const STILL_ROWS: Variants = {
  enter: { opacity: 0 },
  center: (order: number = -1) => {
    const delay = order < 0 ? 0 : staggerDelay + Math.min(order, MOST_IN_TURN) * stagger
    return { opacity: 1, transition: { ...tween.enter, delay } }
  },
  gone: { opacity: 0, transition: tween.exit },
}

const DOT: Record<GitHubConnection, string> = {
  connected: 'bg-ok',
  unknown: 'bg-border-strong',
  missing: 'bg-warn',
  'signed-out': 'bg-warn',
}

const rowsIn = (container: HTMLElement | null): HTMLElement[] => [...(container?.querySelectorAll<HTMLElement>(ROW) ?? [])]

/** Reads GitHub again. A window with no host has nobody to ask, and its sample stays as it is. */
function refresh(): void {
  void runCommand('github.refresh').catch(() => {})
}

/**
 * When the frame hands the keyboard to the screen, it lands on the first row, or on Refresh when there is none.
 * This runs after useStops, so it has the last word, and it moves the keyboard on from Refresh, where useStops put
 * it while the screen loaded.
 */
function useLanding(root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const element = root.current
    const screen = element?.closest<HTMLElement>('[data-canvas-screen]')
    if (!element || !screen) return

    const landOnFirstRow = () => element.querySelector<HTMLElement>(ROW)?.focus({ preventScroll: true })
    const onScreenFocus = (event: Event) => {
      if (event.target === screen) landOnFirstRow()
    }
    screen.addEventListener('focus', onScreenFocus)

    const active = document.activeElement
    const placedByStops = active instanceof HTMLElement && active.matches(REFRESH)
    if (active === screen || placedByStops) landOnFirstRow()

    return () => screen.removeEventListener('focus', onScreenFocus)
  }, [root])
}

function titleOf({ connection, reviews }: GitHubState): string {
  if (connection === 'missing') return 'gh is not installed'
  if (connection === 'signed-out') return 'gh is not signed in'
  if (connection === 'unknown') return 'Looking at GitHub'
  if (reviews.length === 0) return 'Nothing waits for your review'
  if (reviews.length === 1) return '1 pull request waits for your review'
  return `${reviews.length} pull requests wait for your review`
}

/**
 * GitHub: the pull requests waiting for the user's review, their own pull requests with where each one's review and
 * checks stand, the others the AI reviewed, and their issues, read through gh with the login gh already has. Each pull
 * request shows its AI review (spec 032): Start AI review, how far along it is, or its level and Open review. Pull
 * requests open in Review; issues open on github.com. This file is the entry the frame mounts. Spec: 024-github.
 *
 * Keys: Up and Down walk controls, Enter opens one, `r` reads GitHub again. Left and Right switch tabs; Tab and
 * Escape are the frame's.
 */
export function GitHubScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  useLanding(root)
  const github = useGitHub()
  const inMenu = useSettings((settings) => settings.showGitHubInMenu)
  const hasHost = useHasHost()
  const still = useStill()
  const now = useNow(true, 30_000)
  const [tab, setTab] = useRemembered('githubTab')
  // Each pull request's AI review, from the host's list of reviews, or the sample's without a host.
  const reviews = useReviewList(hasHost)
  const sections = pullSections(github, rowsOf(reviews.list))

  // Where the keyboard is in the screen: whether the screen holds it, and the place of the last row it was on.
  const keyboard = useRef({ held: false, row: 0 })

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    keyboard.current.held = true
    const row = rowsIn(root.current).findIndex((element) => element === event.target)
    if (row >= 0) keyboard.current.row = row
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Focus that moves on names where it went. A control taken away from under it names nothing.
    const movedAway = event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
    if (movedAway) keyboard.current.held = false
  }

  /** When what had the keyboard leaves the screen, the keyboard stays: on the row now in its place, or on Refresh. */
  const keepKeyboard = () => {
    const active = document.activeElement
    const lost = !active || active === document.body
    if (!keyboard.current.held || !lost) return

    const rows = rowsIn(root.current)
    const next = rows[Math.min(keyboard.current.row, rows.length - 1)] ?? root.current?.querySelector<HTMLElement>(REFRESH)
    next?.focus({ preventScroll: true })
  }

  // The lists go away at once when gh signs out, so no row's exit says so.
  useEffect(keepKeyboard, [github.connection])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    if (event.defaultPrevented || event.nativeEvent.isComposing || modified || event.key !== 'r') return
    event.preventDefault()
    refresh()
  }

  const connected = github.connection === 'connected'
  const needsGh = github.connection === 'missing' || github.connection === 'signed-out'

  return (
    <div ref={root} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} className={`${inMenu ? SCREEN_SCROLLER : SCREEN_SCROLLER_UNDER_SECOND_ROW} pb-16`}>
      <div className={`flex flex-col gap-6 ${SCREEN_COLUMN}`}>
        <Hero>
          <header className="px-1">
            <h1 className="eyebrow">GitHub</h1>
            <p className="mt-1 font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{titleOf(github)}</p>
            <Status github={github} hasHost={hasHost} still={still} now={now} />
          </header>
        </Hero>
        <div className="flex flex-col gap-6">
          <PageTabs
            id="github"
            label="GitHub lists"
            value={tab}
            onChoose={setTab}
            tabs={[
              { value: 'pulls', label: 'Pull requests', extra: connected && github.reviews.length ? <TabCount tone="live">{github.reviews.length} to review</TabCount> : null },
              { value: 'issues', label: 'Issues', extra: connected && github.issues.length ? <TabCount>{github.issues.length}</TabCount> : null },
            ]}
          />
          {reviews.error && connected ? (
            <p role="alert" className="px-1 text-[13.5px] leading-snug text-bad-fg">
              The AI reviews could not be read, so no row shows one: {reviews.error}
            </p>
          ) : null}
          {(['pulls', 'issues'] as const).map((key) => (
            <section key={key} id={`github-panel-${key}`} role="tabpanel" aria-labelledby={`github-tab-${key}`} hidden={tab !== key}>
              {connected && tab === key ? <Lists tab={key} github={github} sections={sections} live={hasHost} still={still} now={now} onRowsLeft={keepKeyboard} /> : null}
            </section>
          ))}
        </div>
        {needsGh ? (
          <Rise>
            <Connect missing={github.connection === 'missing'} />
          </Rise>
        ) : null}
      </div>
    </div>
  )
}

/** Whom gh is signed in as, or why it is not. */
function Who({ connection, login, refreshing }: GitHubState): ReactNode {
  if (connection === 'connected') {
    return (
      <span>
        Connected through gh as <span className="font-medium text-foreground">@{login}</span>
      </span>
    )
  }
  if (connection === 'unknown') return refreshing ? 'Asking gh' : 'Not known yet'
  return 'Not connected'
}

/** When gh last answered, or that it is being asked now. */
function lastRead({ connection, refreshing, refreshedAt }: GitHubState, now: number): string | null {
  if (connection === 'unknown') return null
  if (refreshing) return 'Refreshing'
  if (!refreshedAt) return null
  return `Refreshed ${waited(Date.parse(refreshedAt), now)} ago`
}

/** Who gh is signed in as, when it last read, and the way to read again. */
function Status({ github, hasHost, still, now }: { github: GitHubState; hasHost: boolean; still: boolean; now: number }) {
  const when = lastRead(github, now)
  const sampleLine = hasHost ? 'Sample data from the scripted host, which never runs gh. Start the host with --github to read GitHub.' : 'Sample data. No host is running.'

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className={cn('size-2 rounded-full', DOT[github.connection])} aria-hidden="true" />
          <Who {...github} />
        </span>
        {when ? <span aria-live="polite">{when}</span> : null}
        <Button variant="ghost" size="sm" data-stop="" data-github-refresh="" aria-label="Refresh" aria-keyshortcuts="r" onClick={refresh} className="-ml-1">
          <RotateCw className={cn(github.refreshing && !still && 'animate-spin')} aria-hidden="true" />
          Refresh
          <Kbd>r</Kbd>
        </Button>
      </div>
      {github.sample ? <p className="text-[12px] text-muted-foreground">{sampleLine}</p> : null}
      {github.error ? (
        <p className="flex items-start gap-1.5 text-[13px] text-bad-fg">
          <CircleAlert className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
          <span>{github.error}</span>
        </p>
      ) : null}
    </div>
  )
}

/** One group of the list: its heading, a row for each item, and a line when it is empty or holds only the most recent. */
interface Group<Item> {
  key: string
  label: string
  /** What the group holds, under its heading. */
  about?: string
  items: readonly Item[]
  /** The row for one item, given its turn in the arrival. */
  row: (item: Item, order: number) => ReactNode
  /** What the group says when it has nothing in it. */
  empty: string
  /** GitHub found more than the group holds. */
  more: boolean
}

/**
 * The selected tab's groups as one list, so its pieces land one after another as the screen arrives, and a row a refresh
 * brings rises in on its own. `onRowsLeft` runs once the rows that left have gone.
 */
function Lists({ tab, github, sections, live, still, now, onRowsLeft }: { tab: 'pulls' | 'issues'; github: GitHubState; sections: PullSections; live: boolean; still: boolean; now: number; onRowsLeft: () => void }) {
  const variants = useMemo(() => (still ? STILL_ROWS : rowVariants(false)), [still])
  const arriving = useArriving()

  // Every piece takes its turn in reading order: a group's heading, its rows, then its line.
  let order = 0
  const turn = () => (arriving ? order++ : -1)
  const pieces: ReactNode[] = []

  const addGroup = <Item,>({ key, label, about, items, row, empty, more }: Group<Item>) => {
    pieces.push(<GroupHeading key={`${key}:heading`} label={label} count={items.length} about={about} variants={variants} order={turn()} />)
    for (const item of items) {
      pieces.push(row(item, turn()))
    }
    if (items.length === 0) {
      pieces.push(
        <NoteRow key={`${key}:empty`} variants={variants} order={turn()}>
          {empty}
        </NoteRow>,
      )
    }
    if (more) {
      pieces.push(
        <NoteRow key={`${key}:more`} variants={variants} order={turn()}>
          The {GITHUB_LIMIT} most recently updated. GitHub has more.
        </NoteRow>,
      )
    }
  }

  if (tab === 'pulls') {
    addGroup({
      key: 'reviews',
      label: 'Review requested',
      about: 'Open pull requests that ask for your review.',
      items: sections.requested,
      row: (entry, order) => <PullCard key={`reviews:${entry.pull?.url ?? entry.id}`} entry={entry} mine={false} live={live} now={now} variants={variants} order={order} />,
      empty: 'Nothing waits for your review.',
      more: github.more.reviews,
    })
    addGroup({
      key: 'pulls',
      label: 'Your pull requests',
      about: 'Your open pull requests, with where their review and checks stand.',
      items: sections.mine,
      row: (entry, order) => <PullCard key={`pulls:${entry.pull?.url ?? entry.id}`} entry={entry} mine live={live} now={now} variants={variants} order={order} />,
      empty: 'You have no open pull requests.',
      more: github.more.pulls,
    })
    addGroup({
      key: 'ai',
      label: 'Recently reviewed by AI',
      about: 'Other pull requests the AI reviewed: merged or closed since, or opened from a link. Work’s AI Reviews tab lists every review.',
      items: sections.reviewed,
      row: (entry, order) => <PullCard key={`ai:${entry.id}`} entry={entry} mine={false} live={live} now={now} variants={variants} order={order} />,
      empty: 'No other pull request has an AI review yet.',
      more: false,
    })
  } else {
    addGroup({
      key: 'issues',
      label: 'Your issues',
      items: github.issues,
      row: (issue, order) => <IssueRow key={`issues:${issue.url}`} issue={issue} live={live} now={now} variants={variants} order={order} />,
      empty: 'No open issue is assigned to you or was opened by you.',
      more: github.more.issues,
    })
  }

  return (
    <ul aria-label="GitHub" className="relative flex flex-col gap-2">
      <AnimatePresence mode="popLayout" onExitComplete={onRowsLeft}>
        {pieces}
      </AnimatePresence>
    </ul>
  )
}

function Command({ children }: { children: string }) {
  return <pre className="w-fit rounded-xl bg-code-bg px-3 py-2 font-mono text-[12px] text-code-text">{children}</pre>
}

/** How to connect: install gh, or sign it in. hobkin never asks for a token. */
function Connect({ missing }: { missing: boolean }) {
  return (
    <section aria-label="Connect GitHub" className="flex flex-col gap-3 rounded-3xl bg-background p-5">
      <p className="max-w-[62ch] text-[14px] leading-relaxed">
        {missing
          ? "hobkin reads GitHub through gh, GitHub's command line tool, with the sign-in gh keeps. It only reads, and it never asks for a token."
          : 'gh is installed and not signed in to github.com. hobkin uses the sign-in gh keeps, and never asks for a token.'}
      </p>
      <div className="flex flex-col gap-1.5">
        {missing ? <Command>brew install gh</Command> : null}
        <Command>gh auth login</Command>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Run {missing ? 'these' : 'it'} in Terminal, then press <Kbd>r</Kbd> to look again.
      </p>
    </section>
  )
}
