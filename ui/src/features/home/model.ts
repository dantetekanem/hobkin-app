import { isFinishedBranch } from '../actions/items.ts'
import { outcomeWeek, sinceLastLook } from '../reports/briefing.ts'
import { kindOf, sourceOf, toneOf, triageOf } from '../reports/report.ts'
import { clockTime, timeOf, waited } from '../reports/time.ts'
import type { HomeAction, HomeInput, HomeModel, HomeRow, HomeTarget, HomeTone, NeedRow, StackCard } from './types.ts'

const screen = (name: 'actions' | 'reports' | 'routines' | 'work' | 'github'): HomeTarget => ({ to: 'screen', screen: name })
const open = (target: HomeTarget, label = 'Open'): HomeAction => ({ label, target })
const row = (id: string, title: string, detail: string | null, tone: HomeTone, target: HomeTarget, aside: string | null = null): HomeRow =>
  ({ id, title, detail, tone, aside, action: open(target) })
const age = (at: number | null, now: number) => at === null ? null : `${waited(at, now)} ago`

function needsOf(input: HomeInput): NeedRow[] {
  const rows: NeedRow[] = []
  if (input.question) {
    const q = input.question
    rows.push({ ...row(`question:${q.id}`, q.question, q.tldr ?? null, 'accent', { to: 'question' }), kind: 'question' })
  }
  const waiting = input.waiting.filter(item => item.id !== input.question?.id)
    .toSorted((a, b) => (timeOf(a.at) ?? Infinity) - (timeOf(b.at) ?? Infinity))
  for (const item of waiting) {
    const target: HomeTarget = item.opens?.screen === 'reports' ? { to: 'report', id: item.opens.report }
      : item.opens?.screen === 'work' ? screen('work') : { to: 'action', id: item.id }
    rows.push({ ...row(`decision:${item.id}`, item.summary, item.from, 'accent', target, age(timeOf(item.at), input.now)), kind: 'decision' })
  }
  for (const change of input.work?.finished.flatMap(group => group.changes) ?? []) {
    const covered = input.waiting.some(({ item }) => item && isFinishedBranch(item)
      && item.answerTo?.slug === change.slug && item.answerTo.item === change.item && item.answerTo.head === change.head)
    if (covered) continue
    rows.push({ ...row(`review:${change.key}:${change.head ?? ''}`, change.title, change.project, 'info', { to: 'review', change }), kind: 'review' })
  }
  if (input.github.connection === 'connected') {
    for (const pr of input.github.reviews.filter(pr => pr.review === 'waiting')) {
      rows.push({ ...row(`github:${pr.repo}#${pr.number}`, pr.title, `${pr.repo} #${pr.number}`, 'info', { to: 'url', url: pr.url }), kind: 'github' })
    }
  }
  for (const project of input.work?.projects.filter(project => project.state === 'proposed') ?? []) {
    rows.push({ ...row(`proposal:${project.slug}`, project.name, 'Proposed project', 'info', screen('work')), kind: 'proposal' })
  }
  return rows
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
    if (existing) existing.count += 1
    else groups.set(key, {
      count: 1,
      row: row(
        `problem:${report.id}`, triage?.message ?? report.title,
        triage?.next ? `Next: ${triage.next}` : null,
        toneOf(report) === 'critical' ? 'bad' : 'warn',
        { to: 'report', id: report.id }, age(timeOf(report.at), input.now),
      ),
    })
  }
  return [
    ...[...groups.values()].map(({ row, count }) => ({ ...row, aside: [count > 1 ? `×${count}` : '', row.aside].filter(Boolean).join(' · ') })),
    ...input.routines.filter(facts => facts.state === 'held').map(facts => row(`held:${facts.routine.id}`, facts.routine.title, facts.hold?.reason ?? 'Held', 'warn', { to: 'routine', id: facts.routine.id })),
  ]
}

function projectsOf(input: HomeInput): HomeRow[] {
  const reports = problemReports(input)
  return (input.work?.projects ?? []).filter(project => project.state === 'chosen').map(project => {
    const problems = reports.filter(report => /^work\.(.+)\.[^.]+$/.exec(report.scheduleId ?? '')?.[1] === project.slug)
    const changes = input.work!.finished.flatMap(group => group.changes).filter(change => change.slug === project.slug).length
    const detail = [
      problems.length ? `${problems.length} problems` : '',
      changes ? `${changes} changes to review` : '',
      project.prs ? `${project.prs} PRs` : '',
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

    return row(`project:${project.slug}`, project.name, detail, tone, screen('work'))
  })
}

function githubOf(input: HomeInput): HomeModel['github'] {
  if (input.github.connection !== 'connected') return { known: false, reviews: 0, failing: 0, rows: [] }
  const reviews = input.github.reviews.filter(pr => pr.review === 'waiting')
  const failing = input.github.pulls.filter(pr => pr.checks === 'failing')
  const rows = new Map<string, HomeRow>()
  for (const pr of [...reviews, ...failing]) {
    const id = `github:${pr.repo}#${pr.number}`
    const failed = failing.some(other => other.repo === pr.repo && other.number === pr.number)
    rows.set(id, row(id, pr.title, `${pr.repo} #${pr.number} · ${failed ? 'Checks failing' : 'Review requested'}`, failed ? 'bad' : 'info', { to: 'url', url: pr.url }))
  }
  return { known: true, reviews: reviews.length, failing: failing.length, rows: [...rows.values()] }
}

function stackOf(input: HomeInput, needs: NeedRow[]): StackCard[] {
  const candidates: { tier: number; at: number | null; card: StackCard }[] = []
  const add = (source: HomeRow, kind: StackCard['kind'], tier: number, at: number | null, reason: string, next: string | null = null) => {
    candidates.push({
      tier,
      at,
      card: {
        id: source.id,
        kind,
        label: kind === 'upnext' ? 'Coming up' : kind[0]!.toUpperCase() + kind.slice(1),
        reason,
        tone: source.tone,
        mood: tier === 2 ? 'error' : tier === 1 ? 'listening' : 'working',
        title: source.title,
        detail: source.detail,
        next,
        primary: source.action,
        secondary: null,
      },
    })
  }
  for (const need of needs) {
    if (need.kind === 'proposal' || need.kind === 'github') continue
    const at = need.kind === 'question' ? timeOf(input.question?.askedAt)
      : need.kind === 'decision' ? timeOf(input.waiting.find(item => `decision:${item.id}` === need.id)?.at) : null
    add(need, need.kind, 1, at, at === null ? 'Waiting for you' : `Waiting ${waited(at, input.now)}`)
  }
  for (const agent of input.agents.filter(agent => agent.asks)) {
    add(
      row(
        `agent:${agent.id}`,
        agent.asks!,
        agent.title,
        'accent',
        { to: 'agent', id: agent.id },
      ),
      'agent',
      1,
      null,
      'Waiting for you',
    )
  }
  for (const need of needs.filter(need => need.kind === 'github')) {
    add(
      need,
      'github',
      1,
      null,
      'Waiting for your review',
    )
  }
  for (const report of problemReports(input)) {
    const triage = triageOf(report)
    add(
      row(
        `problem:${report.id}`,
        triage?.message ?? report.title,
        sourceOf(report),
        toneOf(report) === 'critical' ? 'bad' : 'warn',
        { to: 'report', id: report.id },
      ),
      'problem',
      2,
      timeOf(report.at),
      `New ${age(timeOf(report.at), input.now)}`,
      triage?.next ?? null,
    )
  }
  if (input.github.connection === 'connected') {
    for (const pr of input.github.pulls.filter(pr => pr.checks === 'failing')) {
      add(
        row(
          `github:${pr.repo}#${pr.number}`,
          pr.title,
          'Checks failing',
          'bad',
          { to: 'url', url: pr.url },
        ),
        'github',
        2,
        null,
        'Checks failing',
      )
    }
  }
  const fresh = sinceLastLook(input.reports, input.read, input.attention)
  if (fresh && fresh.count >= 3 && input.now - fresh.since >= 2 * HOUR) {
    add(
      row(
        `away:${fresh.since}`,
        `${fresh.count} reports since you looked`,
        null,
        'info',
        fresh.openId ? { to: 'report', id: fresh.openId } : screen('reports'),
      ),
      'away',
      3,
      null,
      `Away ${waited(fresh.since, input.now)}`,
    )
  }
  const held = input.routines.filter(facts => facts.state === 'held')
  const soon = forecasts(input).filter(facts => facts.next!.at - input.now <= 900_000)
  for (const facts of [...held, ...soon.filter(facts => facts.state !== 'held')]) {
    add(
      row(
        `upnext:${facts.routine.id}`,
        facts.routine.title,
        facts.hold?.reason ?? null,
        facts.state === 'held' ? 'warn' : 'info',
        { to: 'routine', id: facts.routine.id },
      ),
      'upnext',
      4,
      null,
      facts.state === 'held' ? 'Held' : `Starts at ${clockTime(facts.next!.at)}`,
    )
  }
  for (const agent of input.agents.filter(agent => !agent.asks)) {
    add(
      row(
        `agent:${agent.id}`,
        agent.title,
        agent.doing,
        'info',
        { to: 'agent', id: agent.id },
      ),
      'agent',
      4,
      null,
      'Working now',
    )
  }
  const wins = winsOf(input.wins)
  if (new Date(input.now).getHours() >= 17 && wins && wins.merged + wins.decided > 0) {
    add(
      row(
        'today:wins',
        `${wins.merged} merged · ${wins.decided} decided`,
        null,
        'ok',
        screen('work'),
      ),
      'today',
      5,
      null,
      'Today',
    )
  }
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.tier === 1) return (a.at ?? Infinity) - (b.at ?? Infinity)
    if (a.tier === 2) return (b.at ?? -Infinity) - (a.at ?? -Infinity)
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
  const marks: HomeModel['upcoming']['day']['marks'] = []
  const observations = new Set<string>()
  const record = (source: string, at: number | null, outcome: string) => {
    if (at === null || at < start || at >= end || at > input.now) return
    const key = JSON.stringify([source, at])
    if (observations.has(key)) return
    observations.add(key)
    marks.push({ at, state: outcome === 'failed' ? 'failed' : 'done' })
  }
  for (const report of input.reports) {
    if (kindOf(report) === 'scheduled' && report.scheduleId) record(report.scheduleId, timeOf(report.at), report.outcome)
  }
  for (const facts of input.routines) {
    if (facts.lastRun) record(facts.routine.id, timeOf(facts.lastRun.finishedAt), facts.lastRun.status)
  }
  const runs = marks.length
  const failed = marks.filter(mark => mark.state === 'failed').length
  const next = forecasts(input)
  for (const facts of next) {
    if (facts.next!.at < end) marks.push({ at: facts.next!.at, state: 'next' })
  }
  marks.sort((a, b) => a.at - b.at)
  return {
    rows: next.slice(0, 3).map(facts => row(`routine:${facts.routine.id}`, facts.routine.title, facts.hold?.reason ?? null, facts.state === 'held' ? 'warn' : 'quiet', { to: 'routine', id: facts.routine.id }, clockTime(facts.next!.at))),
    day: { start, end, now: input.now, marks },
    summary: `${runs} ${runs === 1 ? 'run' : 'runs'}${failed ? ` · ${failed} failed` : ''}`,
  }
}

export function homeModel(input: HomeInput): HomeModel {
  const day = new Date(input.now)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  if (!input.live) return {
    header: { title: 'Home is not available yet', line: null, chips: [], mood: 'idle' },
    stack: [],
    needs: { rows: [], more: 0 },
    running: { rows: [], held: null, slots: null },
    upcoming: { rows: [], day: { start, end, now: input.now, marks: [] }, summary: '' },
    problems: { rows: [], more: 0 },
    projects: { rows: [] },
    github: { known: false, reviews: 0, failing: 0, rows: [] },
    week: { days: [], completed: 0, unfinished: 0, wins: null },
  }
  const needs = needsOf(input)
  const atLeast = input.github.connection === 'connected' && input.github.more.reviews
  const problems = problemsOf(input)
  const fresh = sinceLastLook(input.reports, input.read, input.attention)
  const days = outcomeWeek(input.reports, input.now)
  const upcoming = upcomingOf(input, start, end)
  const chips: HomeModel['header']['chips'] = []
  if (input.agents.length) chips.push({ tone: 'info', label: `${input.agents.length} working` })
  if (upcoming.rows[0]) chips.push({ tone: 'quiet', label: `Next: ${upcoming.rows[0].title} · ${upcoming.rows[0].aside}` })
  if (input.work?.held) chips.push({ tone: 'warn', label: 'Work held' })
  return {
    header: {
      title: needs.length || atLeast
        ? `${atLeast ? 'At least ' : ''}${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you',
      line: fresh?.count ? `${fresh.count} ${fresh.count === 1 ? 'report' : 'reports'} since you looked` : null,
      chips,
      mood: needs.length ? 'listening' : problems.length ? 'focused' : 'idle',
    },
    stack: stackOf(input, needs),
    needs: { rows: needs.slice(0, 5), more: Math.max(0, needs.length - 5) },
    running: {
      rows: input.agents.map(agent => row(`agent:${agent.id}`, agent.title, agent.asks ?? agent.doing, agent.asks ? 'accent' : 'info', { to: 'agent', id: agent.id })),
      held: input.work?.held ?? null,
      slots: input.work ? `${input.agents.filter(agent => agent.kind === 'work').length} of ${input.work.agents} slots · ${input.work.queued} queued` : null,
    },
    upcoming,
    problems: { rows: problems.slice(0, 4), more: Math.max(0, problems.length - 4) },
    projects: { rows: projectsOf(input) },
    github: githubOf(input),
    week: {
      days,
      completed: days.reduce((sum, day) => sum + day.completed, 0),
      unfinished: days.reduce((sum, day) => sum + day.failed + day.stopped, 0),
      wins: winsOf(input.wins),
    },
  }
}
