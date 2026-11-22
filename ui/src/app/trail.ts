import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Place } from '../features/main-agent/mind.ts'
import { depth } from './overlays.ts'
import { SCREENS, type ScreenId } from './screens.ts'

/**
 * The trail (053): the places the user came through to the page they are on, oldest first, as the frame shows them
 * under the menu on every page. Each earlier place goes back to it, and Escape goes back one. The stack of earlier
 * places is `trail` in `useView`. What a place is, how it is named and how it is shown are here, with no window, so
 * they are tested alone.
 */

/** What a page keeps of itself while the user is away from it: Work's tab, the row in focus, how far it was scrolled. */
export interface Keep {
  tab?: string
  /** The row that had the keyboard or was pressed last, as a selector (`rowKeyOf` in kept-place.ts). */
  focus?: string
  scroll?: number
}

/** One place of the trail. */
export interface Stop {
  screen: ScreenId
  /** What the page is about: a project's slug, an agent's id, a review's id or a proof run's id. */
  about?: string
  /** For Settings and the pages under it: the screen under them. */
  settingsReturn?: ScreenId
  /** For a GitHub open for now: the screen it was opened over. */
  githubReturn?: ScreenId
  keep?: Keep
}

/** The most places a trail holds, the page itself among them. The oldest leave first. */
export const MOST_PLACES = 6

/** The view a place is read from. */
export interface Where {
  screen: ScreenId
  openAgent: string | null
  openReview: string | null
  openProof: string | null
  /** The project its page shows, by slug. */
  project: string | null
  settingsReturn: ScreenId | null
  githubReturn: ScreenId | null
}

/** The view a trail is shown for: where it is, the places before it, and the ways back the mind and the canvas keep. */
export interface TrailView extends Where {
  trail: readonly Stop[]
  mindReturn: Place | null
  canvasReturn: Place | null
}

/** The field that says what each page is about. */
const ABOUT: Partial<Record<ScreenId, 'openAgent' | 'openReview' | 'openProof' | 'project'>> = {
  agent: 'openAgent',
  review: 'openReview',
  proof: 'openProof',
  project: 'project',
}

/** The screen a place stands on: the one under Settings for Settings and the pages under it, or its own. */
function groundOf(stop: Pick<Stop, 'screen' | 'settingsReturn'>): ScreenId | undefined {
  const underSettings = depth({ screen: stop.screen, settingsReturn: stop.settingsReturn ?? null }) > 0
  return underSettings ? stop.settingsReturn : stop.screen
}

/** The place the view is on. What the page keeps of itself is read apart, as the user leaves it. */
export function stopOf(where: Where): Stop {
  const field = ABOUT[where.screen]
  const about = field ? where[field] : null
  return {
    screen: where.screen,
    ...(about ? { about } : {}),
    ...(depth(where) > 0 && where.settingsReturn ? { settingsReturn: where.settingsReturn } : {}),
    ...(where.screen === 'github' && where.githubReturn ? { githubReturn: where.githubReturn } : {}),
  }
}

/** Whether a place can be gone back to: a page about something (an agent, a review, a run, a project) names it. */
export function namesItsPage(stop: Stop): boolean {
  return ABOUT[stop.screen] === undefined || Boolean(stop.about)
}

/** Two places are the same when they are the same page about the same thing. */
export function samePlace(a: Stop, b: Stop): boolean {
  return a.screen === b.screen && (a.about ?? null) === (b.about ?? null)
}

/**
 * The view on a place. What a page under Settings sits over stays open under it, and the proof run shown stays the one
 * last opened; everything else that was open closes with its page.
 */
export function whereOf(stop: Stop, now: Where): Where {
  const ground = groundOf(stop)
  const about = stop.about ?? null
  const open = (screen: ScreenId, held: string | null) => {
    if (stop.screen === screen) return about
    if (ground === screen) return held
    return null
  }
  return {
    screen: stop.screen,
    openAgent: open('agent', now.openAgent),
    openReview: open('review', now.openReview),
    openProof: stop.screen === 'proof' ? about : now.openProof,
    project: open('project', now.project),
    settingsReturn: stop.settingsReturn ?? null,
    githubReturn: stop.githubReturn ?? null,
  }
}

/**
 * The trail as the frame shows it: the places before, then the page itself, at most six. The mind and the canvas keep
 * a way back of their own, so the place they were opened over shows before them.
 */
export function shownTrail(view: TrailView): Stop[] {
  const under = view.screen === 'mind' ? view.mindReturn : view.screen === 'canvas' ? view.canvasReturn : null
  const below = under ? [stopOf({ ...view, ...under })] : []
  return [...view.trail, ...below, stopOf(view)].slice(-MOST_PLACES)
}

const LABEL: ReadonlyMap<ScreenId, string> = new Map(SCREENS.map(({ id, label }) => [id, label]))

/**
 * A place's short name: the page's, or what it is about once that is known. `found` is the project's or the agent's
 * name, the review's title or the proof's model.
 */
export function placeName(stop: Stop, found?: string): string {
  switch (stop.screen) {
    case 'project':
      return found ?? stop.about ?? 'Project'
    case 'review':
      return found ? `Review: ${found}` : 'Review'
    case 'proof':
      return found ? `Proof: ${found}` : 'Proof run'
    case 'agent':
      return found ?? 'Agent'
    default:
      return LABEL.get(stop.screen) ?? stop.screen
  }
}

/** A TLA+ model's name: its spec's file, without the folder or `.tla`. */
export function modelName(spec: string): string {
  return (spec.split('/').at(-1) ?? spec).replace(/\.tla$/, '')
}

/** The title a review is known by: its finished change's, or its pull request's. Undefined when neither is known here. */
export function reviewTitleOf(
  id: string,
  changes: readonly { slug: string; item: string; title: string }[],
  pulls: readonly { repo: string; number: number; title: string }[],
): string | undefined {
  const target = targetOfReviewId(id)
  if (!target) return undefined
  if (target.kind === 'change') return changes.find(({ slug, item }) => slug === target.slug && item === target.item)?.title
  const repo = `${target.owner}/${target.repo}`
  return pulls.find((pull) => pull.repo.toLowerCase() === repo && pull.number === target.number)?.title
}
