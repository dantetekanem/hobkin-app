import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { approvalGroups, groupPlan, groupWords, landingWay, shownTitle, type GroupName } from 'hobkin/src/cli/work/groups.mjs'
import { heldByItsGrade } from 'hobkin/src/cli/work/reads.mjs'
import { byPriority, byRank, grades, MAX_AGENTS, readMode, setAgents } from 'hobkin/src/cli/work/store.mjs'
import {
  GRADES,
  PR_MODES,
  type ChangeChoice,
  type FinishedChange,
  type FinishedGroup,
  type Grade,
  type PrMode,
  type ProjectState,
  type QueueRow,
  type WorkProject,
  type WorkState,
} from '#shared/protocol/work.ts'
import type { HostHandlers } from './commands.ts'

/**
 * Work mode for the Work screen: read from hobkin's own snapshot with hobkin's own rules, and every action the
 * screen takes carried out by one of hobkin's own work actions. Nothing here decides anything hobkin does not.
 * Spec: 011-work.
 */

/** What the host needs of hobkin's application for work mode (`workAction` in its `src/cli/application.mjs`). */
export interface WorkApp {
  workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>
  /** Reads hobkin's state again, so the window sees a change made outside a work action at once. */
  refresh(): Promise<unknown>
}

interface Safety {
  grade: string
  rating: string
  stale?: boolean
}

/** A finished change as hobkin lists it: one of its `readyItems` or `pullRequestRows` (`src/cli/work/reads.mjs`). */
interface ReadyRow {
  slug: string
  project?: string
  item: string
  title: string
  grade?: string | null
  branch?: string | null
  head?: string | null
  pr?: string | null
  about?: string | null
  summary?: string | null
  proof?: string | null
  left?: string | null
  behind?: number | null
  conflict?: boolean | null
  size?: { additions: number; deletions: number; files: number } | null
  safety?: Safety | null
  gap?: string
  holds?: number
  proved?: boolean
  unread?: string | null
}

/** A row of hobkin's queue (`planRow` in its `src/cli/work/commands.mjs`). */
interface PlanRow {
  key: string
  kind: string
  slug?: string | null
  project?: string
  item?: string | null
  title: string
  grade?: string | null
  why?: string | null
  waiting?: string | null
  skipped?: boolean
  picked?: boolean
  estimate?: { fresh?: number } | null
}

interface ProjectStatus {
  slug: string
  name?: string
  state?: string
  /** A proposal's place among the others, as the look for projects ranked them. */
  rank?: number
  priority?: string
  prMode?: string
  level?: string
  paused?: boolean
  open?: number
  prs?: number
  branches?: number
  left?: number
  unmerged?: number
  nextLookAt?: string | null
  lookError?: string | null
}

/** hobkin's `workStatus`, as the snapshot's `work` holds it. */
interface WorkStatus {
  enabled?: boolean
  folder?: string | null
  autoPick?: boolean
  agents?: number
  agentsAllowed?: number
  pause?: { line?: string } | null
  waitingOn?: string | null
  forecast?: { line?: string } | null
  queued?: number
  plan?: PlanRow[]
  projects?: ProjectStatus[]
}

const gradeOf = (value: unknown): Grade | null => (GRADES.includes(value as Grade) ? (value as Grade) : null)
const count = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? '' : 's'}`
const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}${/[.!?]$/.test(words) ? '' : '.'}`

/*
 * What an approval card says and offers, in hobkin's terminal words: `reviewLine`, `mergeLine`, `mergeWords` and
 * `cardChoices` in its `src/cli/ui.mjs`, which does not export them. They are written out here as they are there,
 * until hobkin exports them (host/proposed-hobkin-changes/03-work-cards.patch).
 */

const LONGEST_CARD_LINE = 280
/** One line whatever an agent wrote, and short enough to read at a glance. */
const cardLine = (text: string | null | undefined): string | null => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > LONGEST_CARD_LINE ? `${flat.slice(0, LONGEST_CARD_LINE - 1)}…` : flat
}

const rated = ({ safety }: ReadyRow) => Boolean(safety) && !safety!.stale
const risky = ({ safety }: ReadyRow) => safety?.grade === 'risky' && !safety.stale

function reviewLine({ safety }: ReadyRow): string {
  if (!safety) return 'Not reviewed. Get it reviewed runs one first, about $2 and 14 minutes.'
  const grade = `${safety.grade} ${safety.rating}`
  return safety.stale ? `Reviewed on an older commit (${grade}), not this one.` : `Reviewed: ${grade} at this commit.`
}

function mergeLine({ branch, size, pr, conflict, behind }: ReadyRow): string {
  const named = branch ?? 'its branch'
  if (pr) return `It is the PR ${pr}, and merging it merges it on GitHub.`
  if (conflict) return 'It conflicts with the default branch, so it cannot merge until an agent rebases it.'
  if ((behind ?? 0) > 0) return `Refresh and merge brings ${named} up to date with the default branch first and runs its proof again, then merges it on this machine. Nothing is pushed.`
  const lines = size ? ` (${count(size.additions + size.deletions, 'line')})` : ''
  return `Merge it puts ${named}${lines} into the default branch on this machine. Nothing is pushed.`
}

function mergeWords(entry: ReadyRow): string {
  const merge = (entry.behind ?? 0) > 0 ? `Refresh and merge ${entry.pr ? 'the PR' : 'it'}` : entry.pr ? 'Merge the PR on GitHub' : 'Merge it'
  return risky(entry) ? `${merge} anyway: it is rated risky` : merge
}

/** Merge first, its review first when a review rated this commit risky, and an agent to rebase it instead of a merge when it conflicts. */
function choicesOf(entry: ReadyRow): FinishedChange['choices'] {
  const choice = (value: ChangeChoice, label: string) => ({ value, label })
  const diff = choice('diff', 'Show the diff')
  const merge = choice(landingWay(entry), mergeWords(entry))
  const opens = entry.pr ? [choice('open', 'Open the PR in the browser')] : []
  const review = choice('review', rated(entry) ? 'Review it again' : 'Get it reviewed')
  const cancel = choice('decline', 'Cancel it')
  if (entry.conflict) return [choice('rebase', 'Have an agent rebase it'), diff, ...opens, review, cancel]
  return risky(entry) ? [review, diff, ...opens, merge, cancel] : [merge, diff, ...opens, review, cancel]
}

/**
 * Why a change is in its group. For one that needs the user, the first thing that stands in the way of one yes,
 * in the order hobkin checks them (`oneYesCarries` in `src/cli/work/groups.mjs`), in its own words where it has them.
 */
function reasonOf(entry: ReadyRow, group: GroupName): string {
  if (group === 'merge') return groupWords.merge.why(1)
  if (group === 'refresh') return `${count(entry.behind ?? 0, 'commit')} behind its base, so an agent brings it up to date first.`
  if (entry.unread) return sentence(entry.unread)
  if (entry.conflict) return 'It conflicts with the default branch.'
  if (entry.conflict !== false) return 'It has not been checked for conflicts yet.'
  if (!entry.head) return 'The last survey did not read its branch, so there is no commit to pin a yes to.'
  if (entry.proved === false) return 'No proof: nothing recorded shows it works.'
  if (heldByItsGrade(entry)) return `It is rated ${entry.safety!.grade} ${entry.safety!.rating} at this commit.`
  if (entry.left) return `Left for you: ${cardLine(entry.left)}`
  if (entry.holds) return `It brings ${entry.holds} earlier ${entry.holds === 1 ? 'branch' : 'branches'} with it, so one yes would cover more than this card.`
  return 'It needs you to open it.'
}

function changeOf(entry: ReadyRow, group: GroupName): FinishedChange {
  const size = entry.size ? { lines: entry.size.additions + entry.size.deletions, files: entry.size.files } : null
  return {
    key: `${entry.slug}:${entry.item}`,
    slug: entry.slug,
    project: entry.project ?? entry.slug,
    item: entry.item,
    title: shownTitle(entry.title),
    grade: gradeOf(entry.grade),
    branch: entry.branch ?? null,
    head: entry.head ?? null,
    pr: entry.pr ?? null,
    about: cardLine(entry.about ?? entry.summary),
    proof: cardLine(entry.proof),
    review: reviewLine(entry),
    yes: mergeLine(entry),
    reason: reasonOf(entry, group),
    safety: entry.safety ? { grade: entry.safety.grade, rating: entry.safety.rating, stale: Boolean(entry.safety.stale) } : null,
    size,
    behind: entry.behind ?? 0,
    conflict: entry.conflict ?? null,
    landing: landingWay(entry),
    choices: choicesOf(entry),
  }
}

/** The kinds of finished work that ask for a yes, as the terminal's Decisions sorts them (`branchType` in its `src/cli/ui.mjs`). */
const asksForAYes = ({ gap = 'land' }: ReadyRow) => !['unlanded', 'elsewhere', 'yours'].includes(gap)
/** The most urgent first. The sort is stable, so rows of one grade keep the order that puts the easiest yes first. */
const urgency = ({ grade }: ReadyRow) => (grades.includes(grade ?? '') ? grades.indexOf(grade!) : grades.length)

/** Finished work in hobkin's groups: what merges as it is, what refreshes first, and what needs the user. */
function finishedFrom(rows: readonly ReadyRow[]): FinishedGroup[] {
  const approval = rows.filter(asksForAYes).toSorted((first, second) => urgency(first) - urgency(second))
  return approvalGroups(approval).map(({ name, rows: entries }) => {
    const changes = entries.map((entry) => changeOf(entry, name))
    if (name === 'needs') return { name, heading: 'Needs you', why: null, action: null, changes }
    const words = groupWords[name]
    return {
      name,
      heading: words.name,
      why: words.why(entries.length),
      action: { label: words.action(entries.length), question: words.question(entries.length), plan: groupPlan(name, entries), underWay: words.underWay(entries.length) },
      changes,
    }
  })
}

const queueRowOf = (row: PlanRow): QueueRow => ({
  key: row.key,
  kind: row.kind,
  slug: row.slug ?? null,
  project: row.project ?? row.slug ?? '',
  item: row.item ?? null,
  title: row.title,
  grade: gradeOf(row.grade),
  why: row.why || null,
  waiting: row.waiting || null,
  skipped: Boolean(row.skipped),
  picked: Boolean(row.picked),
  tokens: row.estimate?.fresh ?? null,
})

const PROJECT_STATES: readonly ProjectState[] = ['chosen', 'proposed', 'skipped', 'dropped']

const projectOf = (project: ProjectStatus): WorkProject => ({
  slug: project.slug,
  name: project.name ?? project.slug,
  state: PROJECT_STATES.includes(project.state as ProjectState) ? (project.state as ProjectState) : 'proposed',
  priority: gradeOf(project.priority) ?? 'P2',
  prMode: PR_MODES.includes(project.prMode as PrMode) ? (project.prMode as PrMode) : 'off',
  level: project.level ?? 'important',
  paused: Boolean(project.paused),
  open: project.open ?? 0,
  prs: project.prs ?? 0,
  branches: project.branches ?? 0,
  left: project.left ?? 0,
  unmerged: project.unmerged ?? 0,
  nextLookAt: project.nextLookAt ?? null,
  lookError: project.lookError ?? null,
})

/**
 * Every project work mode knows: the ones taken, by priority as the terminal's Work tab lists them, then the
 * proposals in the order the look ranked them, then the ones left alone. Each sort keeps the order of equals.
 */
function projectsFrom(projects: readonly ProjectStatus[]): WorkProject[] {
  const inState = (state: ProjectState) => projects.filter((project) => project.state === state)
  return [
    ...inState('chosen').toSorted(byPriority),
    ...inState('proposed').toSorted(byRank),
    ...inState('skipped'),
    ...inState('dropped'),
  ].map(projectOf)
}

/**
 * Work mode as the Work screen draws it, from hobkin's snapshot: its switch, its queue in its order, the projects it
 * knows, and the finished changes in the groups one yes can finish, as the terminal's Decisions lists them.
 * Null for a snapshot with no work mode in it, such as the view the terminal saved.
 */
export function workFrom(snapshot: HobkinSnapshot): WorkState | null {
  const work = snapshot.work as WorkStatus | undefined
  if (!work || typeof work !== 'object') return null
  const waiting = snapshot.waiting as { branches?: ReadyRow[] } | null | undefined
  return {
    enabled: work.enabled === true,
    folder: work.folder ?? null,
    autoPick: work.autoPick === true,
    held: work.pause?.line ?? work.waitingOn ?? null,
    forecast: work.forecast?.line ?? null,
    agents: work.agents ?? 0,
    agentsAllowed: work.agentsAllowed ?? work.agents ?? 0,
    maxAgents: MAX_AGENTS,
    queue: (work.plan ?? []).map(queueRowOf),
    queued: work.queued ?? 0,
    projects: projectsFrom(work.projects ?? []),
    finished: finishedFrom(waiting?.branches ?? []),
  }
}

export interface WorkSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => WorkApp
  /** The folder the home's data is in. */
  root: () => string
}

type WorkCommand = 'work.mode' | 'work.queue' | 'work.project' | 'work.proposal' | 'work.agents' | 'work.change' | 'work.group'

/** y and n on a proposal in the terminal: take it, or leave it alone. */
const PROPOSAL_ANSWERS = { take: 'choose', skip: 'skip' } as const

/** The terminal's keys on a queue row: Enter runs it next, s skips it, and s on a skipped row puts it back. */
const QUEUE_ACTIONS = { run: 'run', skip: 'later', back: 'back' } as const
const CHANGE_ACTIONS = { merge: 'merge', 'merge-pr': 'mergePr', 'refresh-merge': 'refreshMerge', review: 'review', ask: 'ask', decline: 'decline' } as const

interface Reply {
  message?: unknown
  told?: { line?: unknown; heard?: boolean }[] | { line?: unknown }
}

const messageOf = (result: unknown) => String((result as Reply | null)?.message ?? '')

/** The Work screen's commands. Each is one of hobkin's own work actions, and a refusal comes back in hobkin's words. */
export function workHandlers({ app, root }: WorkSeat): Pick<HostHandlers, WorkCommand> {
  const done = { ok: true } as const
  return {
    'work.mode': async ({ on, folder }) => {
      if (on) {
        // hobkin's own switch, from the folder given or the one it keeps. It files what to start first for the user and starts nothing.
        await app().workAction('start', folder)
        return { enabled: true }
      }
      // `toggle` would turn work mode back on if it were already off, so it is asked only while it is on.
      if (readMode(root()).enabled) await app().workAction('toggle')
      return { enabled: false }
    },
    'work.queue': async ({ row, action }) => {
      await app().workAction(QUEUE_ACTIONS[action], row)
      return done
    },
    'work.project': async ({ slug, priority, prs }) => {
      await (priority ? app().workAction('priority', slug, priority) : app().workAction('prs', slug, prs))
      return done
    },
    'work.proposal': async ({ slug, answer }) => {
      await app().workAction(PROPOSAL_ANSWERS[answer], slug)
      return done
    },
    'work.agents': async ({ agents }) => {
      // hobkin's work actions have no key for this. It is `hobkin work agents`, which writes work mode's own file.
      const mode = setAgents(root(), agents)
      await app().refresh()
      return { agents: mode.agents }
    },
    'work.change': async ({ slug, item, action, head, note }) => {
      const named = CHANGE_ACTIONS[action]
      const lands = named === 'merge' || named === 'mergePr' || named === 'refreshMerge'

      let said: unknown
      if (named === 'ask') said = await app().workAction(named, slug, item, note ?? '')
      // A landing is pinned to the commit the card showed, so a change that moved since is refused.
      else if (lands) said = await app().workAction(named, slug, item, head ? { head } : {})
      else said = await app().workAction(named, slug, item)

      return { message: messageOf(said) }
    },
    'work.group': async ({ rows }) => {
      const result = (await app().workAction('group', rows)) as Reply | null
      // Each row is told the way its own card would be, and the line that sums them up is the message.
      const told = Array.isArray(result?.told) ? result.told : []
      return { message: messageOf(result), lines: told.filter(({ heard }) => !heard).map(({ line }) => String(line ?? '')) }
    },
  }
}
