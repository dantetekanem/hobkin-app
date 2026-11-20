import { catalogMatch } from '#shared/integrations/servers.ts'
import { remindersOf, type ReminderOccurrence } from '#shared/protocol/reminders.ts'
import type { ConfiguredServer } from '#shared/integrations/types.ts'
import type { GitHubConnection, GitHubPull } from '#shared/protocol/github.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { FinishedChange, YoloState } from '#shared/protocol/work.ts'
import { isFinishedBranch, type WaitingRow } from '../actions/items.ts'
import { ownMark, serviceMark } from '../integrations/marks.ts'
import { outcomeWeek, sinceLastLook } from '../reports/briefing.ts'
import { kindOf, sourceOf, toneOf, triageOf } from '../reports/report.ts'
import { clockTime, timeOf, waited } from '../reports/time.ts'
import { readyCount, yoloSays } from '../settings/yolo.ts'
import { brokenModels, specFile } from '../proofs/proof-match.ts'
import type { CardFact, ConnectionTile, DayMark, HomeAction, HomeInput, HomeModel, HomeRow, HomeTarget, HomeTone, HomeYolo, NeedKind, NeedRow, StackCard } from './types.ts'
import { stripItems, thoughtsOf, TIPS } from './tips.ts'
import { customWidgetsOf, layoutOf, orderWidgets } from './widgets.ts'

type ScreenName = Extract<HomeTarget, { to: 'screen' }>['screen']

const screen = (name: ScreenName): HomeTarget => ({ to: 'screen', screen: name })
const open = (target: HomeTarget, label = 'Open'): HomeAction => ({ label, target })
const age = (at: number | null, now: number) => at === null ? null : `${waited(at, now)} ago`
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const finishedChanges = (input: HomeInput) => input.work?.finished.flatMap(group => group.changes) ?? []

interface RowFields {
  id: string
  title: string
  detail: string | null
  tone: HomeTone
  target: HomeTarget
  aside?: string | null
  /** The verb on the row: where it goes. */
  label?: string
}

function row({ id, title, detail, tone, target, aside = null, label = 'Open' }: RowFields): HomeRow {
  return {
    id,
    title,
    detail,
    tone,
    aside,
    action: open(target, label),
  }
}

/** What a need row stands for, so its stack card can say more than the row does. */
interface Need {
  row: NeedRow
  at: number | null
  question?: PendingQuestion
  waiting?: WaitingRow
  change?: FinishedChange
  pull?: GitHubPull
  reminder?: ReminderOccurrence & { home: string }
}

function need(kind: NeedKind, fields: RowFields, source: Omit<Need, 'row'>): Need {
  return { row: { ...row(fields), kind }, ...source }
}

/**
 * The finished change a waiting row asks about: the branch a merge decision names (at any head, since the change
 * moves on while the decision waits), or work left for the user under the change's own title and project.
 */
function changeOf(item: WaitingRow, changes: readonly FinishedChange[]): FinishedChange | undefined {
  const branch = item.item && isFinishedBranch(item.item) ? item.item.answerTo : null
  if (branch) {
    return changes.find(change => change.slug === branch.slug && change.item === branch.item)
  }

  if (item.opens?.screen === 'work') {
    return changes.find(change =>
      change.title === item.summary
      && (change.project === item.from || change.slug === item.from)
    )
  }

  return undefined
}

/** Only host-owned open reminders/actions get personal priority; report text never creates one. */
function waitingTier(item: WaitingRow): -1 | 0 | 1 {
  if (item.branch || item.opens?.screen === 'reports') return 1
  if (item.item?.answerTo?.kind === 'reminder') return -1
  if (item.kind === 'yours' || item.item?.answerTo?.kind === 'action') return 0
  return 1
}

/** Where a waiting row is handled: its change in Review, its report, Work, or the item itself in Action Items. */
function waitingAction(item: WaitingRow, change: FinishedChange | undefined): HomeAction {
  if (change) return open({ to: 'review', change }, 'Review')
  if (item.opens?.screen === 'reports') return open({ to: 'report', id: item.opens.report }, 'Read')
  if (item.opens?.screen === 'work') return open(screen('work'), 'Open')
  const tier = waitingTier(item)
  const target: HomeTarget = { to: 'action', id: item.id }
  if (tier === -1) return open(target, 'Open reminder')
  if (tier === 0) return open(target, 'View action')
  return open(target, 'Decide')
}

/** One name for a server: the catalog's, for a service it knows, or the name in Pi's file. */
function serverName(server: ConfiguredServer): string {
  return catalogMatch(server)?.name ?? server.name
}

function needsOf(input: HomeInput): Need[] {
  const needs: Need[] = []
  const { question } = input
  if (question) {
    needs.push(need('question', {
      id: `question:${question.id}`,
      title: question.question,
      detail: question.tldr ?? null,
      tone: 'accent',
      target: { to: 'question' },
      label: 'Answer',
    }, { at: timeOf(question.askedAt), question }))
  }

  const changes = finishedChanges(input)
  const covered = new Set<FinishedChange>()
  const waiting = input.waiting
    .filter(item => item.id !== question?.id)
    .toSorted((a, b) => (timeOf(a.at) ?? Infinity) - (timeOf(b.at) ?? Infinity))
  for (const item of waiting) {
    const change = changeOf(item, changes)
    if (change) covered.add(change)

    const at = timeOf(item.at)
    const { target, label } = waitingAction(item, change)
    needs.push(need('decision', {
      id: `decision:${item.id}`,
      title: item.summary,
      detail: change?.project ?? item.from,
      tone: 'accent',
      target,
      aside: age(at, input.now),
      label,
    }, { at, waiting: item, change }))
  }

  for (const change of changes.filter(change => !covered.has(change))) {
    needs.push(need('review', {
      id: `review:${change.key}:${change.head ?? ''}`,
      title: change.title,
      detail: change.project,
      tone: 'info',
      target: { to: 'review', change },
      label: 'Review',
    }, { at: null, change }))
  }

  if (input.github.connection === 'connected') {
    for (const pull of input.github.reviews.filter(pr => pr.review === 'waiting')) {
      needs.push(need('github', {
        id: `github:${pull.repo}#${pull.number}`,
        title: pull.title,
        detail: `${pull.repo} #${pull.number}`,
        tone: 'info',
        target: { to: 'pull', url: pull.url },
        label: 'Review',
      }, { at: null, pull }))
    }
  }

  for (const server of input.integrations?.servers.filter(server => server.state === 'sign-in') ?? []) {
    needs.push(need('connection', {
      id: `connection:${server.name}`,
      title: `Sign in to ${serverName(server)}`,
      detail: 'hobkin cannot use it until you sign in.',
      tone: 'warn',
      target: screen('integrations'),
      label: 'Sign in',
    }, { at: null }))
  }

  for (const project of input.work?.projects.filter(project => project.state === 'proposed') ?? []) {
    needs.push(need('proposal', {
      id: `proposal:${project.slug}`,
      title: project.name,
      detail: 'Proposed project',
      tone: 'info',
      target: screen('work'),
      label: 'See',
    }, { at: null }))
  }

  const reminders = remindersOf(input.reminders)
  for (const entry of reminders?.entries ?? []) {
    if (entry.status !== 'pending-confirmation' || Date.parse(entry.deliveredAt) > input.now
      || input.dismissed.has(`problem:${entry.id}`)
      || input.waiting.some(item => item.item?.answerTo?.kind === 'reminder' && item.item.answerTo.id === entry.id)) continue
    needs.push(need('decision', {
      id: `reminder:${entry.id}`, title: entry.title, detail: entry.next,
      tone: 'accent', target: { to: 'report', id: entry.id }, label: 'Supporting report',
    }, { at: Date.parse(entry.dueAt), reminder: { ...entry, home: reminders!.home } }))
  }
  return needs
}

const HOUR = 3_600_000
const WEEK = 7 * 24 * HOUR
const problemReports = (input: HomeInput) =>
  input.reports
    .filter(report => {
      const at = timeOf(report.at)

      return !input.read.has(report.id)
        && at !== null
        && at <= input.now
        && at >= input.now - WEEK
        && ['critical', 'blocked'].includes(toneOf(report))
    })
    .toSorted((a, b) => timeOf(b.at)! - timeOf(a.at)!)

const forecasts = (input: HomeInput) =>
  input.routines
    .filter(facts =>
      facts.state !== 'off'
      && facts.routine.enabled
      && facts.next !== null
      && Number.isFinite(facts.next.at)
      && facts.next.at >= input.now
    )
    .toSorted((a, b) => a.next!.at - b.next!.at)

function winsOf(value: unknown): HomeModel['week']['wins'] {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !('today' in value)
    || !('streak' in value)
  ) {
    return null
  }

  const today = value.today
  if (
    !today
    || typeof today !== 'object'
    || Array.isArray(today)
    || !('merged' in today)
    || !('decided' in today)
  ) {
    return null
  }

  const { merged, decided } = today
  const streak = value.streak
  if (
    typeof merged !== 'number'
    || typeof decided !== 'number'
    || typeof streak !== 'number'
    || ![merged, decided, streak].every(count => Number.isInteger(count) && count >= 0)
  ) {
    return null
  }

  return { merged, decided, streak }
}

function problemsOf(input: HomeInput): HomeRow[] {
  const groups = new Map<string, { row: HomeRow; count: number }>()
  for (const report of problemReports(input)) {
    const triage = triageOf(report)
    const issue = (triage?.message ?? report.title).trim().replace(/\s+/g, ' ').toLowerCase()
    const key = JSON.stringify([report.scheduleId ?? '', issue, report.outcome])
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      continue
    }

    groups.set(key, {
      count: 1,
      row: row({
        id: `problem:${report.id}`,
        title: triage?.message ?? report.title,
        detail: triage?.next ? `Next: ${triage.next}` : null,
        tone: toneOf(report) === 'critical' ? 'bad' : 'warn',
        target: { to: 'report', id: report.id },
        aside: age(timeOf(report.at), input.now),
        label: 'Read',
      }),
    })
  }

  const reports = [...groups.values()].map(({ row, count }) => ({
    ...row,
    aside: [count > 1 ? `×${count}` : '', row.aside].filter(Boolean).join(' · '),
  }))
  const heldRoutines = input.routines
    .filter(facts => facts.state === 'held')
    .map(facts => row({
      id: `held:${facts.routine.id}`,
      title: facts.routine.title,
      detail: facts.hold?.reason ?? 'Held',
      tone: 'warn',
      target: { to: 'routine', id: facts.routine.id },
      label: 'See',
    }))
  const failedServers = (input.integrations?.servers ?? [])
    .filter(server => server.state === 'failed')
    .map(server => row({
      id: `connection:${server.name}`,
      title: `${serverName(server)} could not connect`,
      detail: server.error,
      tone: 'bad',
      target: screen('integrations'),
      label: 'See',
    }))
  // A TLA+ model hobkin's latest run found broken on a project's default branch (050-tla-proofs).
  const models = brokenModels(input.work).map(({ project, fact }) => row({
    id: `model:${fact.run}`,
    title: 'A model broke on main',
    detail: `${project} · ${specFile(fact.spec)}${fact.why ? `: ${fact.why} breaks` : ''}`,
    tone: 'bad',
    target: { to: 'proof', id: fact.run },
    label: 'See',
  }))
  return [...models, ...reports, ...heldRoutines, ...failedServers]
}

function projectsOf(input: HomeInput): HomeRow[] {
  const reports = problemReports(input)
  return (input.work?.projects ?? []).filter(project => project.state === 'chosen').map(project => {
    const problems = reports.filter(report => /^work\.(.+)\.[^.]+$/.exec(report.scheduleId ?? '')?.[1] === project.slug)
    const changes = finishedChanges(input).filter(change => change.slug === project.slug).length
    const detail = [
      problems.length ? plural(problems.length, 'problem') : '',
      changes ? `${plural(changes, 'change')} to review` : '',
      project.prs ? plural(project.prs, 'PR') : '',
      project.paused ? 'Paused' : '',
      project.lookError ?? '',
    ].filter(Boolean).join(' · ') || null
    let tone: HomeTone
    if (project.lookError || problems.some(report => toneOf(report) === 'critical')) {
      tone = 'bad'
    } else if (problems.length || project.paused) {
      tone = 'warn'
    } else if (changes) {
      tone = 'info'
    } else {
      tone = 'quiet'
    }

    return row({
      id: `project:${project.slug}`,
      title: project.name,
      detail,
      tone,
      target: screen('work'),
      aside: project.priority,
    })
  })
}

function githubOf(input: HomeInput): HomeModel['github'] {
  if (input.github.connection !== 'connected') return { known: false, reviews: 0, failing: 0, rows: [] }

  const reviews = input.github.reviews.filter(pr => pr.review === 'waiting')
  const failing = input.github.pulls.filter(pr => pr.checks === 'failing')
  const rows = new Map<string, HomeRow>()
  for (const pr of [...reviews, ...failing]) {
    const id = `github:${pr.repo}#${pr.number}`
    if (rows.has(id)) continue

    const failed = failing.some(other => other.repo === pr.repo && other.number === pr.number)
    rows.set(id, row(failed
      ? {
          id,
          title: pr.title,
          detail: `${pr.repo} #${pr.number} · Checks failing`,
          tone: 'bad',
          target: { to: 'url', url: pr.url },
          label: 'GitHub',
        }
      : {
          id,
          title: pr.title,
          detail: `${pr.repo} #${pr.number} · Review requested`,
          tone: 'info',
          target: { to: 'pull', url: pr.url },
          label: 'Review',
        }))
  }
  return { known: true, reviews: reviews.length, failing: failing.length, rows: [...rows.values()] }
}

type Standing = Pick<ConnectionTile, 'status' | 'tone'>

/** `unknown` has no tile: the host has not said anything about gh yet. */
const GH: Partial<Record<GitHubConnection, Standing>> = {
  connected: { status: 'Connected', tone: 'ok' },
  'signed-out': { status: 'Sign in', tone: 'warn' },
  missing: { status: 'Not installed', tone: 'quiet' },
}

const SERVER: Record<ConfiguredServer['state'], Standing> = {
  connected: { status: 'Connected', tone: 'ok' },
  'sign-in': { status: 'Sign in', tone: 'warn' },
  failed: { status: 'Failed', tone: 'bad' },
  off: { status: 'Off', tone: 'quiet' },
  connecting: { status: 'Connecting', tone: 'info' },
}

function serverNote(server: ConfiguredServer): string | null {
  if (server.state === 'failed') return server.error
  if (server.state === 'connected' && server.tools.length) return plural(server.tools.length, 'tool')
  return null
}

/** gh first, as GitHub connects through it, then Pi's servers in the order of its file. */
function connectionsOf(input: HomeInput): HomeModel['connections'] {
  const tiles: ConnectionTile[] = []
  const gh = GH[input.github.connection]
  if (gh) {
    tiles.push({
      key: 'gh',
      name: 'GitHub',
      ...gh,
      note: input.github.login ? `@${input.github.login}` : null,
      mark: serviceMark('github'),
      target: screen('github'),
    })
  }
  for (const server of input.integrations?.servers ?? []) {
    const entry = catalogMatch(server)
    tiles.push({
      key: server.name,
      name: entry?.name ?? server.name,
      ...SERVER[server.state],
      note: serverNote(server),
      mark: entry ? serviceMark(entry.id) : ownMark(server.name),
      target: screen('integrations'),
    })
  }

  const count = (tone: HomeTone) => tiles.filter(tile => tile.tone === tone).length
  const connected = count('ok')
  const signIn = count('warn')
  const failing = count('bad')
  const summary = [
    connected ? `${connected} connected` : '',
    signIn ? `${signIn} ${signIn === 1 ? 'needs' : 'need'} sign-in` : '',
    failing ? `${failing} failing` : '',
  ].filter(Boolean).join(' · ') || null
  return {
    known: input.github.connection !== 'unknown' || input.integrations !== null,
    tiles,
    summary,
  }
}

/** What a finished change is, in a few facts the user weighs before reviewing it. */
function changeFacts(change: FinishedChange): CardFact[] {
  const facts: CardFact[] = []
  if (change.size) {
    facts.push({ label: 'Size', value: `${plural(change.size.lines, 'line')} · ${plural(change.size.files, 'file')}`, tone: 'quiet' })
  }
  if (change.grade) {
    facts.push({ label: 'Grade', value: change.grade, tone: 'quiet' })
  }
  if (change.safety) {
    const value = [change.safety.grade, change.safety.rating].filter(Boolean).join(' · ')
    facts.push({ label: 'Safety', value, tone: change.safety.stale ? 'warn' : 'quiet' })
  }
  if (change.behind > 0) {
    facts.push({ label: 'Behind', value: plural(change.behind, 'commit'), tone: 'warn' })
  }
  if (change.conflict) {
    facts.push({ label: 'Conflicts', value: 'Yes', tone: 'bad' })
  }
  return facts
}

type Choices = readonly { value: string; label: string }[] | undefined

const labelsOf = (choices: Choices) => (choices ?? []).map(choice => choice.label)
const pickOf = (choices: Choices, value: string | undefined) => choices?.find(choice => choice.value === value)?.label ?? null

/** Critical findings, due host reminders, real actions, then decisions, problems, catch-up, activity and the day. */
type Tier = -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5

interface Candidate {
  tier: Tier
  at: number | null
  card: StackCard
}

type CardFields = Omit<StackCard, 'mood' | 'next' | 'facts' | 'choices' | 'pick' | 'why' | 'secondary'> & Partial<StackCard>

function candidate(tier: Tier, at: number | null, fields: CardFields): Candidate {
  return {
    tier,
    at,
    card: {
      mood: tier === -2 || tier === 2 ? 'error' : tier <= 1 ? 'listening' : 'working',
      next: null,
      facts: [],
      choices: [],
      pick: null,
      why: null,
      secondary: null,
      ...fields,
    },
  }
}

const SEE_WORK = open(screen('work'), 'See in Work')

/** The card's verb for a waiting row that is not about a change, from the row's own verb. */
const WAITING_VERB: Record<string, string> = { Read: 'Read report', Open: 'See in Work', Decide: 'Decide' }

/** The cards for what waits on the user: the question, the Action Items and the finished changes. */
function needCard({ row, at, question, waiting, change, reminder }: Need, now: number): Candidate | null {
  const base = { id: row.id, tone: row.tone, title: row.title, detail: row.detail }
  const reason = at === null ? 'Waiting for you' : `Waiting ${waited(at, now)}`

  if (reminder) {
    const due = new Intl.DateTimeFormat(undefined, { timeZone: reminder.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reminder.dueAt))
    return candidate(-1, at, {
      ...base, kind: 'reminder', label: 'Reminder', reason: `Due ${due} · ${reminder.timezone}`,
      detail: 'Completion not confirmed. Reading the report does not mark this done.',
      next: reminder.next, reminder: { home: reminder.home, id: reminder.id },
      primary: open(row.action.target, 'Supporting report'),
    })
  }

  if (question) {
    return candidate(1, at, {
      ...base,
      kind: 'question',
      label: `Question · ${question.from}`,
      reason,
      choices: labelsOf(question.choices),
      pick: pickOf(question.choices, question.recommended),
      why: question.why ?? null,
      primary: open(row.action.target, 'Answer'),
    })
  }

  if (waiting) {
    const asked = waiting.question.question.trim()
    const words = waiting.changed ?? (asked && asked !== row.title ? asked : null)
    const tier = change ? 1 : waitingTier(waiting)
    let label = `Decision · ${waiting.from}`
    if (change) label = `Finished change · ${change.project}`
    else if (tier === -1) label = 'Reminder'
    else if (tier === 0) label = 'For you'

    return candidate(tier, at, {
      ...base,
      kind: 'decision',
      label,
      reason,
      detail: change ? change.about ?? change.reason ?? null : words,
      facts: change ? changeFacts(change) : [],
      choices: labelsOf(waiting.question.choices.length ? waiting.question.choices : change?.choices),
      pick: waiting.pick,
      why: waiting.item?.why ?? null,
      primary: open(row.action.target, change ? 'Review change' : WAITING_VERB[row.action.label] ?? row.action.label),
      secondary: change ? SEE_WORK : null,
    })
  }

  if (row.kind === 'review' && change) {
    return candidate(1, null, {
      ...base,
      kind: 'review',
      label: `Finished change · ${change.project}`,
      reason: 'Ready for your review',
      detail: change.about ?? change.reason ?? null,
      facts: changeFacts(change),
      choices: labelsOf(change.choices),
      primary: open(row.action.target, 'Review change'),
      secondary: SEE_WORK,
    })
  }

  return null
}

function reviewRequestCard(row: NeedRow, pull: GitHubPull): Candidate {
  const labels = pull.labels.slice(0, 2).map(label => ({ label: 'Label', value: label, tone: 'quiet' as const }))
  return candidate(1, null, {
    id: row.id,
    kind: 'github',
    label: `Review request · ${pull.repo}`,
    reason: 'Waiting for your review',
    tone: row.tone,
    title: row.title,
    detail: pull.author ? `Opened by @${pull.author}` : null,
    facts: [{ label: 'Pull request', value: `#${pull.number}`, tone: 'quiet' }, ...labels],
    primary: open(row.action.target, 'Review'),
    secondary: open({ to: 'url', url: pull.url }, 'Open on GitHub'),
  })
}

function stackOf(input: HomeInput, needs: Need[]): StackCard[] {
  const candidates: Candidate[] = []

  for (const item of needs) {
    const card = needCard(item, input.now)
    if (card) candidates.push(card)
  }

  for (const agent of input.agents.filter(agent => agent.asks)) {
    candidates.push(candidate(1, null, {
      id: `agent:${agent.id}`,
      kind: 'agent',
      label: `Agent asks · ${agent.project}`,
      reason: 'Waiting for you',
      tone: 'accent',
      title: agent.asks!,
      detail: agent.title,
      choices: labelsOf(agent.choices),
      pick: pickOf(agent.choices, agent.recommended),
      why: agent.why ?? null,
      primary: open({ to: 'agent', id: agent.id }, 'Answer agent'),
    }))
  }

  for (const { row, pull } of needs) {
    if (row.kind === 'github' && pull) candidates.push(reviewRequestCard(row, pull))
  }

  for (const report of problemReports(input)) {
    const triage = triageOf(report)
    const at = timeOf(report.at)
    candidates.push(candidate(toneOf(report) === 'critical' ? -2 : 2, at, {
      id: `problem:${report.id}`,
      kind: 'problem',
      label: `Problem · ${sourceOf(report)}`,
      reason: `New ${age(at, input.now)}`,
      tone: toneOf(report) === 'critical' ? 'bad' : 'warn',
      title: triage?.message ?? report.title,
      detail: triage?.message && triage.message !== report.title ? report.title : null,
      next: triage?.next ?? null,
      primary: open({ to: 'report', id: report.id }, 'Read report'),
    }))
  }

  if (input.github.connection === 'connected') {
    for (const pr of input.github.pulls.filter(pr => pr.checks === 'failing')) {
      candidates.push(candidate(2, null, {
        id: `github:${pr.repo}#${pr.number}`,
        kind: 'github',
        label: `Checks failing · ${pr.repo}`,
        reason: 'Checks failing',
        tone: 'bad',
        title: pr.title,
        detail: `Your pull request #${pr.number}`,
        primary: open({ to: 'url', url: pr.url }, 'Open on GitHub'),
      }))
    }
  }

  const fresh = sinceLastLook(input.reports, input.read, input.attention)
  if (fresh && fresh.count >= 3 && input.now - fresh.since >= 2 * HOUR) {
    candidates.push(candidate(3, null, {
      id: `away:${fresh.since}`,
      kind: 'away',
      label: 'Catch-up',
      reason: `Away ${waited(fresh.since, input.now)}`,
      tone: 'info',
      title: `${fresh.count} reports since you looked`,
      detail: null,
      primary: open(fresh.openId ? { to: 'report', id: fresh.openId } : screen('reports'), 'Catch up'),
    }))
  }

  const held = input.routines.filter(facts => facts.state === 'held')
  const soon = forecasts(input).filter(facts => facts.next!.at - input.now <= 900_000 && facts.state !== 'held')
  for (const facts of [...held, ...soon]) {
    const isHeld = facts.state === 'held'
    candidates.push(candidate(4, null, {
      id: `upnext:${facts.routine.id}`,
      kind: 'upnext',
      label: isHeld ? 'Routine held' : 'Coming up',
      reason: isHeld ? 'Held' : `Starts at ${clockTime(facts.next!.at)}`,
      tone: isHeld ? 'warn' : 'info',
      title: facts.routine.title,
      detail: facts.hold?.reason ?? null,
      primary: open({ to: 'routine', id: facts.routine.id }, 'See routine'),
    }))
  }

  for (const agent of input.agents.filter(agent => !agent.asks)) {
    candidates.push(candidate(4, null, {
      id: `agent:${agent.id}`,
      kind: 'agent',
      label: `Agent at work · ${agent.project}`,
      reason: 'Working now',
      tone: 'info',
      title: agent.title,
      detail: agent.doing,
      primary: open({ to: 'agent', id: agent.id }, 'Watch'),
    }))
  }

  const wins = winsOf(input.wins)
  if (new Date(input.now).getHours() >= 17 && wins && wins.merged + wins.decided > 0) {
    candidates.push(candidate(5, null, {
      id: 'today:wins',
      kind: 'today',
      label: 'Today',
      reason: 'Today',
      tone: 'ok',
      title: `${wins.merged} merged · ${wins.decided} decided`,
      detail: wins.streak > 1 ? `${wins.streak}-day streak` : null,
      primary: open(screen('work'), 'See Work'),
    }))
  }

  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.tier === -2 || a.tier === 2) return (b.at ?? -Infinity) - (a.at ?? -Infinity)
    if (a.tier <= 1) return (a.at ?? Infinity) - (b.at ?? Infinity)
    return 0
  })
  const seen = new Set<StackCard['kind']>()
  return candidates.filter(({ card }) => {
    if (seen.has(card.kind)) return false
    seen.add(card.kind)
    return true
  }).slice(0, 7).map(({ card }) => card)
}

function upcomingOf(input: HomeInput, start: number, end: number): HomeModel['upcoming'] {
  const marks: DayMark[] = []
  const observations = new Set<string>()
  const titles = new Map(input.routines.map(facts => [facts.routine.id, facts.routine.title]))
  const record = (source: string, at: number | null, outcome: string, title: string, target: HomeTarget) => {
    if (at === null || at < start || at >= end || at > input.now) return
    const key = JSON.stringify([source, at])
    if (observations.has(key)) return
    observations.add(key)
    marks.push({ at, state: outcome === 'failed' ? 'failed' : 'done', title: titles.get(source) ?? title, target })
  }
  for (const report of input.reports) {
    if (kindOf(report) === 'scheduled' && report.scheduleId) {
      record(report.scheduleId, timeOf(report.at), report.outcome, report.title, { to: 'report', id: report.id })
    }
  }
  for (const facts of input.routines) {
    const { id, title } = facts.routine
    if (facts.lastRun) record(id, timeOf(facts.lastRun.finishedAt), facts.lastRun.status, title, { to: 'routine', id })
  }
  const runs = marks.length
  const failed = marks.filter(mark => mark.state === 'failed').length
  const next = forecasts(input)
  for (const facts of next) {
    const { id, title } = facts.routine
    if (facts.next!.at < end) marks.push({ at: facts.next!.at, state: 'next', title, target: { to: 'routine', id } })
  }
  marks.sort((a, b) => a.at - b.at)
  return {
    rows: next.slice(0, 3).map(facts => row({
      id: `routine:${facts.routine.id}`,
      title: facts.routine.title,
      detail: facts.hold?.reason ?? null,
      tone: facts.state === 'held' ? 'warn' : 'quiet',
      target: { to: 'routine', id: facts.routine.id },
      aside: clockTime(facts.next!.at),
      label: 'See',
    })),
    day: { start, end, now: input.now, marks },
    summary: `${runs} ${runs === 1 ? 'run' : 'runs'}${failed ? ` · ${failed} failed` : ''}`,
  }
}

function runningOf(input: HomeInput): HomeModel['running'] {
  const rows = input.agents.map(agent => ({
    ...row({
      id: `agent:${agent.id}`,
      title: agent.title,
      detail: agent.asks ?? agent.doing,
      tone: agent.asks ? 'accent' : 'info',
      target: { to: 'agent', id: agent.id },
      aside: agent.project,
      label: agent.asks ? 'Answer' : 'Watch',
    }),
    face: { hue: agent.hue, mood: agent.mood, asking: Boolean(agent.asks) },
  }))
  const queue = (input.work?.queue ?? [])
    .filter(item => !item.skipped)
    .slice(0, 3)
    .map(item => row({
      id: `queue:${item.key}`,
      title: item.title,
      detail: [item.project, item.waiting ? `waits for ${item.waiting}` : ''].filter(Boolean).join(' · '),
      tone: item.picked ? 'accent' : 'quiet',
      target: screen('work'),
      aside: item.grade,
      label: 'See',
    }))
  const working = input.agents.filter(agent => agent.kind === 'work').length
  return {
    rows,
    held: input.work?.held ?? null,
    slots: input.work ? `${working} of ${input.work.agents} slots · ${input.work.queued} queued` : null,
    queue,
  }
}

/** YOLO mode in Home's words, or null when hobkin has not said how it stands. */
function yoloOf(yolo: YoloState | null | undefined): HomeYolo | null {
  if (!yolo) return null
  return {
    on: yolo.on,
    rate: yolo.rate,
    summary: readyCount(yolo),
    says: yoloSays(yolo),
    projects: yolo.projects.map(({ slug, name, ready, needs }) => ({
      slug,
      name,
      ready,
      note: ready ? 'Ready' : needs[0] ?? 'Not ready yet',
    })),
  }
}

function chipsOf(input: HomeInput): HomeModel['header']['chips'] {
  const chips: HomeModel['header']['chips'] = []
  const next = forecasts(input)[0]
  const yolo = input.work?.yolo
  if (yolo?.on) {
    const readiness = yolo.projects.length ? ` · ${yolo.ready} of ${yolo.projects.length} ready` : ''
    chips.push({ tone: 'accent', label: `YOLO on${readiness}`, target: screen('yolo') })
  } else if (yolo) {
    chips.push({ tone: 'quiet', label: 'YOLO off', target: screen('yolo') })
  }
  if (input.agents.length) {
    chips.push({ tone: 'info', label: `${input.agents.length} working`, target: screen('work') })
  }
  if (next) {
    chips.push({ tone: 'quiet', label: `Next: ${next.routine.title} · ${clockTime(next.next!.at)}`, target: { to: 'routine', id: next.routine.id } })
  }
  if (input.work?.held) {
    chips.push({ tone: 'warn', label: 'Work held', target: screen('work') })
  }
  const held = input.routines.filter(facts => facts.state === 'held').length
  if (held) {
    chips.push({ tone: 'warn', label: `${plural(held, 'routine')} held`, target: screen('routines') })
  }
  return chips
}

export function homeModel(input: HomeInput): HomeModel {
  const day = new Date(input.now)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  if (!input.live) return {
    widgets: [],
    strip: [],
    header: { title: 'Home is not available yet', line: null, chips: [], mood: 'idle' },
    stack: [],
    needs: { rows: [], more: 0 },
    running: { rows: [], held: null, slots: null, queue: [] },
    upcoming: { rows: [], day: { start, end, now: input.now, marks: [] }, summary: '' },
    problems: { rows: [], more: 0 },
    projects: { rows: [] },
    github: { known: false, reviews: 0, failing: 0, rows: [] },
    connections: { known: false, tiles: [], summary: null },
    week: { days: [], completed: 0, unfinished: 0, wins: null },
    yolo: null,
  }

  // A dismissed id ("seen it / not now") is dropped wherever it would show: its need row, its problem row and its stack
  // card all carry the same id, so one dismissal quiets the thing across the whole dashboard. The item itself still
  // lives on its own screen, so nothing is lost.
  const kept = (id: string) => !input.dismissed.has(id)
  const priority = (need: Need) => need.reminder ? -1 : need.waiting && !need.change ? waitingTier(need.waiting) : 1
  const needs = needsOf(input).filter(need => kept(need.row.id)).toSorted((a, b) => {
    const band = priority(a) - priority(b)
    if (band !== 0) return band
    return priority(a) === -1 ? (a.at ?? Infinity) - (b.at ?? Infinity) : 0
  })
  const atLeast = input.github.connection === 'connected' && input.github.more.reviews
  const problems = problemsOf(input).filter(row => kept(row.id))
  const fresh = sinceLastLook(input.reports, input.read, input.attention)
  const days = outcomeWeek(input.reports, input.now)
  const base: Omit<HomeModel, 'widgets'> = {
    // Tips and hobkin's thoughts for the top strip: dismissed ones drop out here; the strip rotates a window over the rest.
    strip: stripItems(TIPS, thoughtsOf(input.thoughts), input.dismissed),
    header: {
      title: needs.length || atLeast
        ? `${atLeast ? 'At least ' : ''}${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you',
      line: fresh?.count ? `${fresh.count} ${fresh.count === 1 ? 'report' : 'reports'} since you looked` : null,
      chips: chipsOf(input),
      mood: needs.length ? 'listening' : problems.length ? 'focused' : 'idle',
    },
    stack: stackOf(input, needs).filter(card => kept(card.id)),
    needs: { rows: needs.slice(0, 5).map(need => need.row), more: Math.max(0, needs.length - 5) },
    running: runningOf(input),
    upcoming: upcomingOf(input, start, end),
    problems: { rows: problems.slice(0, 4), more: Math.max(0, problems.length - 4) },
    projects: { rows: projectsOf(input) },
    github: githubOf(input),
    connections: connectionsOf(input),
    week: {
      days,
      completed: days.reduce((sum, day) => sum + day.completed, 0),
      unfinished: days.reduce((sum, day) => sum + day.failed + day.stopped, 0),
      wins: winsOf(input.wins),
    },
    yolo: yoloOf(input.work?.yolo),
  }
  // Custom widgets ride the same manifest, ordering, animation and dismissal as the built-ins; a dismissed one leaves
  // by its `custom:<id>`, which never collides with a built-in's bare-kind id.
  const widgets = orderWidgets(base, layoutOf(input.layout), customWidgetsOf(input.custom))
  return { ...base, widgets: widgets.filter(widget => kept(widget.id)) }
}
