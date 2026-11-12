import { GRADES, type FinishedChange, type ProjectState, type QueueRow, type WorkProject, type WorkState } from '#shared/protocol/work.ts'
import type { HobkinChoice, WorkAction } from './actions.ts'
import { groupOf } from './sample.ts'

/**
 * What an action does to the sample, so a window with no host answers the way hobkin would, in hobkin's words:
 * a merge that cannot go says why and its card stays, a group says how each row went. Nothing here reaches hobkin.
 */

export type SampleOutcome = { state: WorkState; message: string; lines?: string[] } | { refused: string }

/** The sample change that moved since its card was drawn, so a refused merge can be seen. */
export const MOVED = 'storefront:4c9e21'

const MOVED_WHY = 'moved since it was offered, so nothing merged. It needs reading again.'

/** Start now with no host: no agent runs on sample data. */
const NOTHING_STARTS = 'This is sample data, so nothing starts here. With a host, hobkin starts it at once, as one extra worker when none is free.'

/** Add to queue with no host: the sample's issues belong to no project hobkin works on. */
const NOTHING_ADDED = 'This is sample data, so nothing was added. With a host, hobkin files the issue on the project whose repository it is in, first in the queue.'

/** What hobkin says once a card's choice is carried out (`src/cli/work/controls.mjs`). */
function saidOf({ title, project }: FinishedChange, choice: HobkinChoice): string {
  const named = `"${title}" on ${project}`
  switch (choice) {
    case 'merge':
      return `Merged "${title}" into main on ${project}. Nothing was pushed.`
    case 'mergePr':
      return `Merged the PR for ${named}.`
    case 'refreshMerge':
      return `${named} goes to an agent to be brought up to date, and hobkin merges it once that run ends well.`
    case 'review':
      return `${named} goes to the front of the queue for a review. It leaves the list while it is reviewed, and comes back to approve with its grade.`
    case 'decline':
      return `Said no to ${named}. Its branch stays, and hobkin learns from this.`
    case 'rebase':
    case 'changes':
      return `An agent goes back to ${named} next.`
  }
}

/** The finished changes without these, each group with hobkin's words for what is left in it. */
function without(state: WorkState, keys: readonly string[]): WorkState {
  const finished = state.finished
    .map(({ name, changes }) => groupOf(name, changes.filter(({ key }) => !keys.includes(key))))
    .filter(({ changes }) => changes.length > 0)
  return { ...state, finished }
}

/** A row run next goes first after the other picks, one skipped goes to the end, and one put back goes before the skipped rows. */
function moved(queue: readonly QueueRow[], row: QueueRow, action: 'run' | 'skip' | 'back'): QueueRow[] {
  const rest = queue.filter((entry) => entry.key !== row.key)
  if (action === 'skip') return [...rest, { ...row, skipped: true, picked: false }]

  const pastThePicks = (entry: QueueRow) => !entry.picked || entry.skipped
  const found = rest.findIndex(action === 'run' ? pastThePicks : (entry) => entry.skipped)
  const at = found < 0 ? rest.length : found
  const placed = { ...row, skipped: false, picked: action === 'run' || row.picked }
  return [...rest.slice(0, at), placed, ...rest.slice(at)]
}

/** The projects taken, by priority, then the proposals, then the ones left alone, as the host lists them. Sorts keep the order of equals. */
function inHobkinsOrder(projects: readonly WorkProject[]): WorkProject[] {
  const inState = (state: ProjectState) => projects.filter((project) => project.state === state)
  const taken = inState('chosen').toSorted((first, second) => GRADES.indexOf(first.priority) - GRADES.indexOf(second.priority))
  return [...taken, ...inState('proposed'), ...inState('skipped'), ...inState('dropped')]
}

const plural = (amount: number, one: string, many: string) => (amount === 1 ? one : many)

/** The line that sums up a group's yes, after a line for each row (`sumOf` in hobkin's `src/cli/work/merge-group.mjs`). */
function sumOf(tried: readonly FinishedChange[], went: readonly FinishedChange[]): string {
  const here = went.filter(({ landing }) => landing === 'merge').length
  const onGitHub = went.filter(({ landing }) => landing === 'mergePr').length
  const refreshed = went.filter(({ landing }) => landing === 'refreshMerge').length
  const failed = tried.length - went.length
  const merged = here + onGitHub
  const howMany = merged < tried.length ? `${merged} of ${tried.length}` : plural(tried.length, 'it', `all ${tried.length}`)
  const mergedLine = !merged
    ? ''
    : here && onGitHub
      ? `Merged ${howMany}: ${here} here, with nothing pushed, and ${onGitHub} ${plural(onGitHub, 'PR', 'PRs')} on GitHub.`
      : here
        ? `Merged ${howMany} here, with nothing pushed.`
        : `Merged ${howMany} on GitHub.`
  return [
    mergedLine,
    refreshed ? `${refreshed} ${plural(refreshed, 'goes', 'go')} to an agent to be brought up to date, and hobkin merges ${plural(refreshed, 'it', 'each')} once that run ends well.` : '',
    failed ? `${failed} did not go, and ${plural(failed, 'its line says', 'their lines say')} why.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function applySample(state: WorkState, action: WorkAction): SampleOutcome {
  switch (action.do) {
    case 'mode': {
      if (!action.on) return { state: { ...state, enabled: false }, message: '' }
      const folder = action.folder ?? state.folder
      if (!folder) return { refused: 'Say which folder to start from.' }
      return { state: { ...state, enabled: true, folder }, message: '' }
    }
    case 'queue': {
      const row = state.queue.find(({ key }) => key === action.key)
      if (!row) return { refused: 'That row has already left the queue.' }
      if (action.action === 'now') return { refused: NOTHING_STARTS }

      // `queued` counts the rows that are not skipped.
      let queued = state.queued
      if (action.action === 'skip' && !row.skipped) queued -= 1
      if (action.action === 'back' && row.skipped) queued += 1

      return { state: { ...state, queue: moved(state.queue, row, action.action), queued }, message: '' }
    }
    case 'priority': {
      const projects = state.projects.map((project) => (project.slug === action.slug ? { ...project, priority: action.priority } : project))
      return { state: { ...state, projects: inHobkinsOrder(projects) }, message: '' }
    }
    case 'proposal': {
      const answered: ProjectState = action.answer === 'take' ? 'chosen' : 'skipped'
      const projects = state.projects.map((project) => (project.slug === action.slug ? { ...project, state: answered } : project))
      return { state: { ...state, projects: inHobkinsOrder(projects) }, message: '' }
    }
    case 'agents':
      return { state: { ...state, agents: action.agents, agentsAllowed: action.agents }, message: '' }
    case 'prs':
      return { state: { ...state, projects: state.projects.map((project) => (project.slug === action.slug ? { ...project, prMode: action.prs } : project)) }, message: '' }
    case 'issues':
      return { state: { ...state, projects: state.projects.map((project) => (project.slug === action.slug ? { ...project, issues: action.issues } : project)) }, message: '' }
    case 'issue':
      return { refused: NOTHING_ADDED }
    case 'change': {
      const { change, choice } = action
      if (choice === 'merge' && change.key === MOVED) return { refused: `"${change.title}" ${MOVED_WHY}` }
      return { state: without(state, [change.key]), message: saidOf(change, choice) }
    }
    case 'group': {
      const tried = action.group.changes
      const went = tried.filter(({ key, landing }) => !(key === MOVED && landing === 'merge'))
      // Each row is told the way its own card would be, and one that could not go names its work and project, then says why.
      const lines = tried.map((change) => (went.includes(change) ? saidOf(change, change.landing) : `"${change.title}" on ${change.project} ${MOVED_WHY}`))
      return { state: without(state, went.map(({ key }) => key)), message: sumOf(tried, went), lines }
    }
    case 'stop':
      return { refused: 'This is sample data: no agent is running here, so nothing was stopped. With a host, hobkin stops it the way k does in the terminal.' }
  }
}
