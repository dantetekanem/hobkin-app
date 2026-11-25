/**
 * Change Review in the host: reviews prepared in the background, kept as artifacts in the home, and opened at once.
 *
 * A review is prepared once for each commit of its change. The host reads the change and owns every code range: it
 * draws the graph and checks it before anyone sees it. Then the change review (spec 032) runs on it, for a finished
 * change and a pull request alike, and once that is ready the review is told as its units. A change that moves to a
 * new commit gets a new review, and the old one stays where it was. Specs: 005-review-model, 009-review-notes, 032.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import type { ChangeScores, Grade } from '#shared/protocol/work.ts'
import { agentMessage } from '#shared/agent-message.ts'
import { CLIENT_PRODUCER_VERSION } from '../producer-version.ts'
import { completeReview, draftReview } from '#shared/review/prepare.ts'
import { reviewIdOf, targetOfReviewId, type NamedCodeHost, type ReviewTarget } from '#shared/review/ids.ts'
import { detached as detachedNotes, foldNotes, type Note, type NoteEntry, type NoteIntent, type NoteTarget } from '#shared/review/notes.ts'
import { deployOf, deployWhy, type AssessmentLogLine, type AssessmentRequest, type AssessmentStatus } from '#shared/review/assessment.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { ratingOf } from './ratings.ts'
import { count } from '#shared/review/prose.ts'
import { IDLE_STATUS, shownAsRow, type MergeAsked, type OpenedReview, type ReviewCursor, type ReviewLanding, type ReviewList, type ReviewListItem, type ReviewNotes, type ReviewPeople, type ReviewRepoLine, type ReviewStatus, type ReviewTurn, type VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { openReview } from '#shared/review/validate.ts'
import { githubApi, type HostApi } from './code-hosts.ts'
import { layerNames, pullLayers } from './pull-layers.ts'
import { checkGrammar, grammarLines, type GrammarAsk, type GrammarResult, type GrammarTexts } from '#shared/review/grammar.ts'
import { askForChanges, closingComment, pullReviewPost, saysNothing, type PullReviewPost, type Verdict } from '#shared/review/verdict.ts'
import { Unavailable } from '../commands.ts'
import { LOG_LINES, pendingSteps, type Assessments } from './assessment.ts'
import { ghText, type GhCall } from './gh.ts'
import type { MergePlan, Moved } from './landing.ts'
import { fixBrief } from '../../../packages/change-review/src/fix.ts'
import { riskShown, riskStep, type RiskWork } from './risk-fix.ts'
import type { ReviewSource } from './sources.ts'
import type { BuildFailed, Prepared, ReviewStore } from './store.ts'
import { FAILED_WAITS_MS, KEPT_CURRENT, lineOf, type Line, type LineChange } from './turns.ts'
import type { Carried } from './carry.ts'

/** How often reviewed pull requests are asked of GitHub, to see which are no longer open. */
const SWEEP_EVERY_MS = 2 * 60_000

/** Something to prepare in the background, with what says it changed: a change's commit, or when a pull request last changed on GitHub. */
export interface Watched {
  id: string
  head?: string | null
  updatedAt?: string | null
  /** For a finished change, what its repository's line weighs (spec 058): its project's name, grade, conflict and when it finished. */
  project?: string
  grade?: Grade | null
  conflict?: boolean | null
  at?: string
  /** For a pull request, when it was opened and when its head commit was committed, as GitHub's list says them. */
  openedAt?: string
  pushedAt?: string
}

/** How many reviews the background built by itself on a local day, and how many of them in the place for the longest wait. */
export interface DayCount {
  day: string
  built: number
  aged?: number
}

/** Why a change an agent works on again is not reviewed now. */
const AT_WORK = 'An agent is working on it again, so its review waits until it finishes.'
/** How often a read of a review is kept in the home, at most: cleaning up allows for that much. */
const READ_KEPT_EVERY_MS = 60 * 60_000
/** How many reviews the background builds by itself in a local day, across all repositories, unless the workload says otherwise. */
export const REVIEWS_A_DAY = 20
/** A file that is only prose to read: a change made of nothing else has nothing to rate. */
const MARKDOWN = /\.(md|mdx|markdown)$/i

/** What Review again with nothing changed says, before a second press builds it. */
const COSTS_AGAIN = 'Nothing changed since this review: building it again costs a whole review, with its tests and its model calls. Ask again to build it.'
/** How long a first Review again with nothing changed waits for the second press that builds it. */
const AGAIN_WITHIN_MS = 10 * 60_000
/** Why a pull request the background does not watch is not reviewed again by itself: it waits for the user's ask. */
const PULL_ASKED = 'A pull request is reviewed again when you start its review.'

/** What a finished change's card says a yes does, from the Work screen (`011-work`). */
export interface ChangeCard {
  /** How its yes lands it: hobkin's `merge`, `mergePr` or `refreshMerge`. */
  landing: 'merge' | 'mergePr' | 'refreshMerge'
  /** What a yes does, in hobkin's words. */
  yes: string
  /** Its branch, when it has one. */
  branch: string | null
  /** Its pull request's address, once one is open. */
  pr: string | null
  /** What hobkin's own scored review gave it. Missing or null when it has none, or the host is older. */
  scores?: ChangeScores | null
  /** The same scores as a review's ratings, by hobkin, with what is missing and the commit they were made at (spec 058). */
  hobkinNeeds?: ReviewNeeds | null
  /** Where its branch stands against the branch it merges into, as hobkin's survey has it. */
  code?: ReviewStatus['code']
}

/** Where a finished change's pull request goes: its GitHub repository as `owner/name`, the branch it merges into, and its own. */
export interface PublishPlan {
  slug: string
  repo: string
  base: string
  branch: string
}

/** Opens a finished change's pull request once the review says yes. */
export interface Publisher {
  /** Where the pull request would go. Throws, with the reason, when the change cannot have one. */
  plan(slug: string, branch: string): Promise<PublishPlan>
  /** Pushes the branch at the reviewed commit and opens the pull request. */
  open(plan: PublishPlan, pull: { head: string; title: string; body: string }): Promise<{ url: string }>
}

export interface ReviewsOptions {
  store: ReviewStore
  sources: { change: ReviewSource; pull: ReviewSource }
  /** hobkin's work actions, for a verdict on a finished change. Throws with the reason while hobkin is not open. */
  work: () => { workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown> }
  /** The card of a finished change, or null when hobkin no longer lists it. */
  card: (slug: string, item: string) => ChangeCard | null
  /** gh, for a verdict on a pull request. A host given none posts nothing. */
  gh?: GhCall
  /** The quick model, for fixing the grammar of the user's words before a pull request gets them. A host that asks no models has none. */
  grammar?: GrammarAsk
  /** The API of a pull request on a code host the home names, other than GitHub: null when it can be asked nothing. */
  apiOf?: (target: PullTarget) => HostApi | null
  /**
   * Whether a review may check the change's repository out. One that may not, as a pull request on a host that allows
   * no checkout, gets its map, code, notes and verdict, and no change review. Taken as yes when not given.
   */
  checksOut?: (target: ReviewTarget) => boolean
  /** The code hosts the home names besides GitHub, by name and web address, as the window learns them. */
  namedHosts?: () => NamedCodeHost[]
  /** How a named code host merges, and deletes a branch, as the code host file says. Null where hobkin has no way there. */
  hostWays?: (target: PullTarget) => HostWays | null
  /** Who a pull request is from, by its author and description, with links to their profiles. */
  peopleOf?: (target: PullTarget, facts: { author: string | null; description: string }) => Promise<ReviewPeople>
  /** Opens a finished change's pull request. A host given none opens none. */
  publish?: Publisher
  /** The commit a change is at now, as the app already knows it without asking anyone. Null when it does not know. */
  head?: (target: ReviewTarget) => string | null
  /**
   * Whether a pull request is one a change of hobkin's opened, wherever that change stands: its review is that change's,
   * so the background never prepares it by itself. Null when it cannot tell now. A host given none prepares any.
   */
  ownPull?: (target: PullTarget) => boolean | null
  onChange?: () => void
  log?: (line: string) => void
  now?: () => number
  /** How long to wait between asks of GitHub for the result of an asynchronous merge. */
  mergePollMs?: number
  /**
   * The change review (spec 032) of finished changes and pull requests: started once a review's graph is ready, one
   * commit once, and read back when the review opens. A host given none reviews nothing that way, and its reviews keep
   * the host's own steps.
   */
  assessments?: Assessments
  /**
   * A pull request's review the user asked for is ready, on a host with no change reviews. With them, the change review
   * tells it once it is ready instead, and a review the background prepared on its own is not told at all.
   */
  onReady?: (ready: { target: ReviewTarget; review: Review; at: string }) => void
  /** Hears that a verdict merged something, a pull request on GitHub or a finished change, so it leaves what the lists show at once. */
  onMerged?: (target: ReviewTarget) => void
  /** What a review is about before its file can say: a finished change's title and project, as the Work screen has them. */
  describe?: (target: ReviewTarget) => { title: string; project: string } | null
  /**
   * Where a finished change stands in hobkin's own records after a yes: merged, being brought up to date to merge, or
   * neither (null). A change hobkin no longer lists as finished may simply be merged, which is no error.
   */
  landing?: (target: ChangeTarget) => ReviewLanding | null
  /**
   * How a yes lands a finished change now, from git: straight away when it merges cleanly, brought up to date first only
   * when it conflicts, and at the commit its branch is at now. A host given none lands it the way its card says.
   */
  merging?: (target: ChangeTarget, change: { reviewed: string; current: string; pr: boolean }) => Promise<MergePlan>
  /** What moved on a pull request since the commit its review read, from a checkout of it. Without it, only that it moved is said. */
  pullMoved?: (target: PullTarget, from: string, to: string) => Promise<Moved>
  /**
   * Where hobkin's own work on a finished change stands, for what hobkin does when its AI review says risky to deploy
   * (A37 to A39): back at work, finished at a commit with what its run left for the user, or over, and why work mode
   * starts nothing on its project now. A host given none sends no agent back by itself.
   */
  ownWork?: (target: ChangeTarget) => RiskWork | null
  /** How many reviews each repository keeps current (spec 058, 063), as the YOLO rules say, or null for none. Three when it says nothing. */
  keepCurrent?: () => number | null | undefined
  /** The tries to get all five ratings, as the YOLO rules say (spec 063): what a row says it is "of" when a review rates again. Three when it says nothing. */
  ratingTries?: () => number | undefined
  /** Hears a finished change's ratings made at the commit the change is at, once each time they are read: the bridge to hobkin decides what goes (spec 063). */
  graded?: (target: ChangeTarget, head: string, needs: ReviewNeeds) => void
  /** Whether an agent works on a change again, as hobkin's items say: its waiting review is dropped, and its row says why. */
  backAtWork?: (target: ChangeTarget) => boolean
  /** When a change at a commit finished, as an ISO time, or null while that is not known: the line's clock for it. */
  finishedAt?: (target: ChangeTarget, head: string | null) => string | null
  /**
   * Carries a change's newest review to the commit it moved to when the review still holds there (spec 058, A5),
   * instead of building it again. A host given none builds it again, as before.
   */
  carry?: (target: ChangeTarget, head: string) => Promise<Carried>
  /** How many reviews the background builds by itself in a local day (spec 058, 063), as the YOLO rules say, or null for none. Twenty when it says nothing. */
  reviewsADay?: () => number | null | undefined
  /** Whether hobkin closed a change without a merge, or no longer has it (spec 058): its review leaves the list. */
  closed?: (target: ChangeTarget) => boolean
  /** Where the day's count of background builds is kept, so a host started again the same day keeps it. In memory without one. */
  dayLedger?: { read(): DayCount | null; write(kept: DayCount): void }
}

/** A pull request, as a review target. */
type PullTarget = Extract<ReviewTarget, { kind: 'pull' }>

/** A finished hobkin change, as a review target. */
type ChangeTarget = Extract<ReviewTarget, { kind: 'change' }>

interface Job {
  target: ReviewTarget
  head: string | null
  refresh: boolean
  /**
   * Whether its change review starts once its graph is drawn. False when only the graph and its files were asked for, as
   * the window's code look asks (spec 071); an ask for the change review while the job waits or runs sets it.
   */
  changeReview: boolean
}

/** A finished change's pull request: where it goes, and what it says. */
interface Publication {
  plan: PublishPlan
  pull: { head: string; title: string; body: string }
}

/** How a pull request is merged, as its repository allows: squashed, with a merge commit, or rebased. */
type MergeMethod = 'squash' | 'merge' | 'rebase'

/** What approve and merge does to a pull request: the review it posts first, if any, and how it merges. */
/** How a named code host lands and closes the user's pull requests, its own way (spec 048, entry 26). */
export interface HostWays {
  /** Whether hobkin may merge there. */
  merge: boolean
  /** The comment that asks the host to merge, and what it does once that is posted. Null when the file names none. */
  mergeBy: { comment: string; after?: string } | null
  /** The user's email addresses: on such a host the user opened a pull request when one is its author's name. */
  emails: readonly string[]
  /** Deletes a branch there with git, only while it is at `sha`. */
  deleteBranch: (branch: string, sha: string) => Promise<void>
}

interface Merge {
  /** On a named host, the comment that asks it to merge, which is posted in place of a merge. */
  asks?: { comment: string; after?: string }
  post: PullReviewPost | null
  method: MergeMethod
  base: string
  /** The user opened it: GitHub lets nobody approve their own pull request. */
  mine: boolean
  /** The commit it merges: where the pull request is now, as the preview showed it. */
  head: string
}

/** A verdict's preview, with the review, card and pull request it was built from. */
interface Planned {
  preview: VerdictPreview
  review: Review
  /** Null for a pull request from GitHub. */
  card: ChangeCard | null
  /** For `approve` on a finished change. */
  publication?: Publication
  /** For `approve-merge` on a pull request. */
  merge?: Merge
  /** For `approve-merge` on a finished change, with git's word on how it lands. */
  plan?: MergePlan
  /** Nothing is left to do, and this says why: it merged already, or it is being brought up to date to merge. */
  done?: string
  /** For `discard` and `discard-branch`. */
  discard?: Discard
}

/** A pull request on GitHub, by where it lives. */
interface PullPlace {
  owner: string
  repo: string
  number: number
  /** The named code host it lives on, or none for GitHub. */
  host?: string
}

/** What a discard closes on GitHub, and under what name it says so: the pull request under review, or a finished change's own. */
interface Discard {
  /** Null for a finished change with no pull request open: nothing goes to GitHub then. */
  pull: (PullPlace & { named: string }) | null
  /** The reviewer's words, posted on the pull request before it is closed. Null when there are none. */
  comment: string | null
  /** For `discard-branch` on a pull request: its head branch, deleted on GitHub once it is closed, only while it is still at `sha`. */
  branch?: PullBranch
  /** For `discard-branch` on a finished change: what hobkin said deleting its branch takes, which it deletes once it took the no. */
  deletes?: BranchPlan
  /** For a finished change: whether hobkin takes the no. False once hobkin is done with it, when it only leaves the list. */
  declines?: boolean
}

/** A pull request's head branch as GitHub had it when it was shown: its name, its commit, and its repository's node id. */
interface PullBranch {
  ref: string
  sha: string
  /** GitHub's id of the repository, which its delete needs. None on a named host, which deletes with git. */
  repo?: string
}

/**
 * GitHub's one delete of a branch that is pinned to a commit: `updateRefs` moves the ref from `beforeOid` to nothing,
 * atomically, and changes nothing when the ref is anywhere else (docs.github.com/en/graphql/reference/git). `force` only
 * lets it move other than forward; the commit it must be at still holds.
 */
const DELETE_REF =
  'mutation($repo: ID!, $name: GitRefname!, $before: GitObjectID!) { updateRefs(input: { repositoryId: $repo, refUpdates: [{ name: $name, beforeOid: $before, afterOid: "0000000000000000000000000000000000000000", force: true }] }) { clientMutationId } }'

/**
 * What deleting a finished change's own branch takes, as hobkin reads it (`deleteBranch` with `look`): the branch, where it
 * is on this Mac and on origin, the worktree that goes with it and what git ignores in that worktree, and how many commits
 * no other branch or tag on this Mac holds, or null when git cannot say. hobkin deletes it only when told exactly this again.
 */
interface BranchPlan {
  branch: string
  here: string | null
  remote: { name: string; url: string; sha: string } | null
  worktree: string | null
  /** The files and folders git ignores in the worktree, such as `.env` or `build/`. An older hobkin says nothing of them. */
  ignored?: string[]
  lost: number | null
}

/** A folder as the user knows it, with their home folder as `~`. */
function tilde(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** Where a remote is, in words: a repository on GitHub by its name, any other by its address. */
function remoteWords({ name, url }: { name: string; url: string }): string {
  const repo = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url)?.[1]
  return repo ? `on GitHub, in ${repo}` : `on ${name}, at ${url}`
}

/**
 * What deleting a finished change's branch takes, line by line: where the branch goes, its worktree and the files git
 * ignores in it (three by name, then how many more), and the commits no other branch or tag on this Mac holds.
 */
function deletionLines({ branch, here, remote, worktree, ignored = [], lost }: BranchPlan): string[] {
  const there = remote ? remoteWords(remote) : null
  const where = here ? (there ? `on this Mac and ${there}` : 'on this Mac') : `${there ?? 'on origin'}. It is gone from this Mac already`
  const losing =
    lost == null
      ? 'Commits on no other branch or tag on this Mac are lost.'
      : lost === 0
        ? 'No commit is lost: every one on it is on another branch or tag on this Mac.'
        : `${count(lost, 'commit')} on no other branch or tag on this Mac ${lost === 1 ? 'is' : 'are'} lost.`
  return [
    `Then delete its branch ${branch} ${where}.`,
    ...(worktree ? [`Remove the worktree that holds it, at ${tilde(worktree)}.`] : []),
    ...(worktree && ignored.length > 0 ? [`Files git ignores in its worktree go with it: ${some(ignored)}.`] : []),
    losing,
  ]
}

/** The pull request a github.com address names, or null for any other address. */
function pullOfAddress(address: string): PullPlace | null {
  const found = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/.exec(address)
  return found ? { owner: found[1]!, repo: found[2]!, number: Number(found[3]) } : null
}

/** What a preparation did, for the log its change review takes over, and what it reviews once it is read. */
interface RunLog {
  head: string | null
  startedAt: string
  lines: AssessmentLogLine[]
  request?: AssessmentRequest
  /** Why it stopped, when it did. */
  error?: string
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Who wrote a pull request, as its host names them, and the description they gave it. */
interface PullAuthorship {
  author: string | null
  description: string
}

/** A pull request's author and description, as its host says now. */
async function pullAuthorship(target: PullTarget, api: HostApi): Promise<PullAuthorship> {
  const path = `repos/${target.owner}/${target.repo}/pulls/${target.number}`
  try {
    const pull = JSON.parse(await api({ path })) as { user?: { login?: string }; body?: string | null }
    return {
      author: pull.user?.login ?? null,
      description: (pull.body ?? '').replace(/\r\n?/g, '\n').trim(),
    }
  } catch (error) {
    throw new Unavailable(messageOf(error))
  }
}

/** What a review is about when neither a run nor hobkin nor the home can say: the target's own names. */
const aboutFromTarget = (target: ReviewTarget) =>
  target.kind === 'change' ? { title: target.item, project: target.slug } : { title: `#${target.number}`, project: `${target.owner}/${target.repo}` }

/** What a change review reviews, as its status says it: the project, the title, both commits and the size. */
function requestOf(target: ReviewTarget, review: Review): AssessmentRequest {
  const { change } = review
  return {
    kind: target.kind,
    project: change.project,
    ...(target.kind === 'pull' ? { number: target.number } : {}),
    title: change.title,
    base: change.base,
    head: change.head,
    files: change.files,
    added: change.additions,
    removed: change.deletions,
  }
}

/** A few names, quoted: `"a", "b" and 3 more`. */
function some(names: readonly string[], shown = 3): string {
  const quoted = names.slice(0, shown).map((name) => `"${name}"`)
  if (names.length > shown) return `${quoted.join(', ')} and ${names.length - shown} more`
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '')
}

/** What moved on a branch since its review, in a line. */
function movedWords({ rebased, same, subjects }: Moved, into: string, at: string): string {
  if (rebased && same) return `Since this review it was rebased onto ${into}: the same change, now at ${at}.`
  const which = subjects.length ? `: ${some(subjects)}` : ''
  if (rebased) return `Since this review it was written again, and is now at ${at}${which}.`
  return `Since this review it gained ${count(subjects.length, 'commit')}${which}.`
}

/** What a yes does to a finished change, line by line, as git says it lands now. */
/**
 * Which commit a verdict's review was built at: this one, or, for a review carried here, the one it was built from,
 * with this one where its tests ran (spec 058).
 */
export function reviewedAt(at: string, carried?: { from: string; why: string }): string {
  const here = at.slice(0, 7)
  if (!carried) return `At commit ${here}, the one this review was built from.`
  const from = carried.from.slice(0, 7)
  return `Carried from ${from} to ${here}, its tests run at ${here}: this review was built from ${from}.`
}

function landingLines(plan: MergePlan, pr: string | null, carried?: { from: string; why: string }): string[] {
  const at = plan.head.slice(0, 7)
  const how =
    plan.route === 'refreshMerge'
      ? `It conflicts with ${plan.into}: an agent brings it up to date, then hobkin merges it.`
      : plan.route === 'mergePr'
        ? `Merge its pull request on GitHub${pr ? `, ${pr}` : ''}, at ${at}.`
        : plan.merges === 'fast-forward'
          ? `Merge it into ${plan.into} on this machine: ${plan.into} moves up to ${at}. Nothing is pushed.`
          : `Merge it into ${plan.into} on this machine, with a merge commit. Nothing is pushed.`
  const moved = plan.moved ? movedWords(plan.moved, plan.into, at) : null
  return [how, ...(moved ? [moved] : []), moved ? `This merges ${at}, the commit shown here.` : reviewedAt(plan.head, carried)]
}

/** Why a review's change review stops, or never starts, once its change is done on its host. */
const closedWords = (target: ReviewTarget) =>
  target.kind === 'change' ? 'Its change merged, so its review is not needed.' : 'Its pull request is closed, so its review is not needed.'

/** A merged change, in the words a verdict on it answers with. */
const mergedWords = (landing: ReviewLanding) => `Already merged${landing.into ? ` into ${landing.into}` : ''}${landing.sha ? ` at ${landing.sha.slice(0, 7)}` : ''}.`

/** The words for how a pull request is merged, in a preview. */
const MERGE_WORDS: Record<MergeMethod, string> = {
  squash: 'by squashing its commits into one',
  merge: 'with a merge commit',
  rebase: 'by rebasing its commits onto it',
}

/** How often a review asks where its change is now: when it is opened, and for each finished change the background watches. */
export const LOOK_AGAIN_MS = 60_000

/** A version of something the background prepares, which it looks at once: its commit, and when it last changed on its host. */
const versionOf = (head: string | null, updatedAt: string | null = null) => `${head ?? ''}@${updatedAt ?? ''}`

/**
 * The rules the host draws a graph by. A review asked for whose graph was drawn by older rules is drawn again: 2 is the
 * graph whose nodes say what they are and whose tests, dependencies and pull request life cycles are wired; 3 draws
 * the request's life cycle out to its entry points and routes.
 */
export const GRAPH_RULES = 3

/** Every review the host has prepared or is preparing, and what to do with them. */
export class Reviews {
  private readonly statuses = new Map<string, ReviewStatus>()
  private readonly queue: Job[] = []
  private readonly running = new Map<string, Promise<void>>()
  /** The job each preparation under way runs, so an ask for its change review that comes meanwhile still has one start. */
  private readonly jobsUnderWay = new Map<string, Job>()
  private readonly opened = new Map<string, Prepared>()
  /** The version of each watched review last looked at, so the background looks at each version once. */
  private readonly watched = new Map<string, string>()
  /** The finished changes the background was last handed: those hobkin lists on Work. */
  private finished = new Set<string>()
  /** Each repository's line, worked out again each time the background is handed the finished changes (spec 058). */
  private line: Line = { current: new Set(), aged: new Set(), waits: new Map() }
  /** The reviews the user asked for since this host started: the line never drops what waits for one. */
  private readonly userAsked = new Set<string>()
  /** The pull requests the background was last handed to review by themselves, as the user's setting names them. */
  private watchedPulls = new Set<string>()
  /** The reviews being carried to their change's new commit now. */
  private readonly carrying = new Set<string>()
  /** When Review again was last asked with nothing changed, by review: a second press soon after builds it. */
  private readonly againAt = new Map<string, number>()
  /** How many reviews the background built by itself on the local day it names. */
  private dayCount: DayCount | null = null
  /** When each review was last opened or had a file read, by this host's clock, and when that was last kept in the home. */
  private readonly readAt = new Map<string, number>()
  private readonly readKept = new Map<string, number>()
  private readonly controller = new AbortController()
  private working = false
  /** When each review last asked where its change is now. */
  private readonly lookedAt = new Map<string, number>()
  /** What each change's card named when this host last looked its commit up. The look stands until the card names another. */
  private readonly cardAtLook = new Map<string, string | null>()
  /** The commit each review's change was last looked up at, for one this host has no status of: a look makes no status. */
  private readonly lookedHead = new Map<string, string>()
  /** The watched pull requests GitHub's list named no commit for, as an older list does: their rows say so. */
  private pullsWithoutHead = new Set<string>()
  /** The watched pull requests GitHub's list gave no time for but their last update: their wait counts from that. */
  private pullsWithoutTimes = new Set<string>()
  /** The last failed build of each target, as the home keeps it, read once. */
  private readonly failures = new Map<string, BuildFailed | null>()
  /** Where each change started when this host last looked, and the commit it was at then: a start holds for that commit alone. */
  private readonly lookedStart = new Map<string, { head: string; start: string; stale: boolean }>()
  /** Who wrote each pull request a finished change opened, by the pull request's review name, once its host has been asked. */
  private readonly openedPullAuthorship = new Map<string, Promise<PullAuthorship>>()
  /** How many notes hobkin has written, so two in the same millisecond still have their own ids. */
  private written = 0
  /** The reviews someone asked for, by the window or by hobkin, as against what the background prepares by itself. */
  private sweeping = false
  private sweptAt = Number.NEGATIVE_INFINITY
  private readonly asked = new Set<string>()
  /** Reviews the user stopped while their map was being prepared: the change review after it does not start. */
  private readonly halted = new Set<string>()
  /** When each review's status last changed, in milliseconds by the host's clock. */
  private readonly changedAt = new Map<string, number>()
  /** What each review is about, as its change read when it was prepared. */
  private readonly about = new Map<string, { title: string; project: string }>()
  /** What each review's latest preparation did. */
  private readonly runs = new Map<string, RunLog>()
  /** The verdict under way on each review, and the token it was confirmed with: one at a time. */
  private readonly deciding = new Map<string, { confirm: string; done: Promise<{ message: string }> }>()
  /** The confirmations whose words went on a pull request: one confirmation posts once, so the same words never go twice. */
  private readonly posted = new Set<string>()
  /** The grammar check of each set of words, so a confirmation and its yes post the same words, checked once. */
  private readonly grammared = new Map<string, Promise<GrammarResult>>()
  /** What hobkin is doing about a risky answer on each change, while it asks hobkin: one at a time for a change. */
  private readonly settling = new Map<string, Promise<'done' | 'later'>>()
  /** The commit each finished change was last looked at for a risky answer, and when: done looks are not repeated, others after a minute. */
  private readonly riskLooked = new Map<string, { head: string; at: number }>()
  private readonly options: ReviewsOptions

  constructor(options: ReviewsOptions) {
    this.options = options
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  /** `at` is when it changed, for a caller that has read the clock already. */
  private set(id: string, change: Partial<ReviewStatus>, at = this.now()) {
    const next = { ...this.stored(id), ...change }
    // A start is only said while something is queued or under way.
    if (next.phase == null) delete next.startedAt
    this.statuses.set(id, next)
    this.changedAt.set(id, at)
    this.options.onChange?.()
  }

  /** Adds a line to what the review's preparation did, keeping the latest. */
  private say(id: string, text: string) {
    const run = this.runs.get(id)
    if (!run) return
    run.lines.push({ at: new Date(this.now()).toISOString(), text })
    if (run.lines.length > LOG_LINES) run.lines.splice(0, run.lines.length - LOG_LINES)
  }

  private target(id: string): ReviewTarget {
    const target = targetOfReviewId(id)
    if (!target) throw new Error(`There is no review named ${id}.`)
    return target
  }

  /** What this host knows of a review's preparation, before asking where its change is now. */
  private stored(id: string): ReviewStatus {
    const known = this.statuses.get(id)
    if (known) return known
    // A review prepared before the host started is ready from its file.
    const newest = this.options.store.newest(this.target(id))
    if (!newest) return IDLE_STATUS(id)
    return { ...IDLE_STATUS(id), state: 'ready', preparedAt: newest.meta?.preparedAt ?? new Date(newest.at).toISOString(), storyBy: newest.meta?.storyBy ?? null, ...(newest.meta?.owner ? { owner: newest.meta.owner } : {}), ...(newest.meta?.code ? { code: newest.meta.code } : {}) }
  }

  /** A preparation of this review is waiting or under way. */
  private preparing(id: string): boolean {
    return this.running.has(id) || this.queue.some((job) => reviewIdOf(job.target) === id)
  }

  /** A preparation of this review is waiting or under way that starts its change review once its graph is drawn. */
  private preparingReview(id: string): boolean {
    if (this.jobsUnderWay.get(id)?.changeReview) return true
    return this.queue.some((job) => reviewIdOf(job.target) === id && job.changeReview)
  }

  /**
   * How a review's change review stands at `head`: as it runs or ran; queued behind the graph it starts from while that
   * is prepared, with what the preparation did so far; or failed, with why, when the preparation could not finish. A
   * graph built alone has none behind it. Undefined on a host with no change reviews.
   */
  private assessmentOf(id: string, target: ReviewTarget, head: string | null): AssessmentStatus | undefined {
    const { assessments } = this.options
    if (!assessments) return undefined
    const known = this.withFix(target, assessments.status(target, head, this.startFor(id, head)?.start))
    const run = this.runs.get(id)
    if (!run || known.state === 'queued' || known.state === 'running' || (head && run.head && run.head !== head)) return known
    const preparing = this.preparingReview(id)
    if (!preparing && !(run.error && (known.state === 'idle' || known.state === 'failed'))) return known
    const shared = { head: run.head ?? head, startedAt: run.startedAt, ...(run.request ? { request: run.request } : {}), log: [...run.lines] }
    if (!preparing) return { state: 'failed', ...shared, error: run.error }
    return { state: 'queued', ...shared, percent: 0, eta: null, now: run.lines.at(-1)?.text ?? 'Waiting for its turn.', steps: pendingSteps() }
  }

  /** Where hobkin's own work on a finished change stands, or null for a pull request, a host that cannot say, or a read that failed. */
  private ownWorkOf(target: ReviewTarget): RiskWork | null {
    if (target.kind !== 'change' || !this.options.ownWork) return null
    try {
      return this.options.ownWork(target)
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)} could not read hobkin's work on it: ${messageOf(error)}`)
      return null
    }
  }

  /** A ready answer of risky to deploy on hobkin's own change, with what hobkin does about it (A39). Anything else as it is. */
  private withFix(target: ReviewTarget, known: AssessmentStatus): AssessmentStatus {
    if (known.state !== 'ready' || !known.summary || !known.head || deployOf(known.summary) !== 'risky') return known
    const work = this.ownWorkOf(target)
    const fix = work && riskShown(this.options.store.riskFix(target), known.head, work)
    return fix ? { ...known, fix } : known
  }

  /**
   * Sends hobkin's agent back to its own finished change whose AI review at the commit its card is at says risky to
   * deploy, with what the review found, or leaves the change to the user once hobkin has done what it may (A37, A38).
   * A pull request is never sent back. Called when a review finishes, and by the background as the host publishes its
   * state, so a restart, a hobkin that was not open and work mode running again each send what waited. One at a time
   * for a change. Never throws: what hobkin refuses is logged, and tried again later.
   */
  async settleRisk(id: string): Promise<void> {
    await this.riskTurn(id)
  }

  /** Waits for every look at a risky answer under way. For tests and for closing. */
  async settledRisk(): Promise<void> {
    while (this.settling.size) await Promise.all([...this.settling.values()])
  }

  /** One look at a change's risky answer: `done` when nothing is left to try at this commit, `later` when something should be tried again. */
  private riskTurn(id: string): Promise<'done' | 'later'> {
    const under = this.settling.get(id)
    if (under) return under
    const turn = this.riskLook(id).finally(() => this.settling.delete(id))
    this.settling.set(id, turn)
    return turn
  }

  private async riskLook(id: string): Promise<'done' | 'later'> {
    const target = targetOfReviewId(id)
    const { assessments, store } = this.options
    if (target?.kind !== 'change' || !assessments || !this.options.ownWork) return 'done'
    if (this.closedOn(target) || this.landingOf(target)) return 'done'

    const work = this.ownWorkOf(target)
    const head = work?.head
    if (!work || !head) return 'later'
    const known = assessments.status(target, head, this.startFor(id, head)?.start)
    if (known.state !== 'ready' || !known.summary || deployOf(known.summary) !== 'risky') return 'done'

    const record = store.riskFix(target)
    const step = riskStep(record, head, work)
    // Work mode starts nothing on its project now: what would go, goes once it runs.
    if (!step) return work.held ? 'later' : 'done'

    const findings = fixBrief(assessments.read(target, head)?.units ?? { units: [] }) ?? deployWhy(known.summary)
    const at = new Date(this.now()).toISOString()
    try {
      if (step.do === 'send') {
        await this.options.work().workAction('fixRisk', target.slug, target.item, { head, findings })
        store.saveRiskFix(target, { ...store.riskFix(target), rounds: [...record.rounds, { head, at }] })
      } else {
        const asked = { head, rounds: record.rounds.length, why: step.why, findings }
        const answer = (await this.options.work().workAction('riskStays', target.slug, target.item, asked)) as { action?: unknown } | null
        const action = typeof answer?.action === 'string' ? answer.action : null
        store.saveRiskFix(target, { ...store.riskFix(target), waiting: { head, at, why: step.why, action } })
      }
    } catch (error) {
      this.options.log?.(`Review ${id}: hobkin did not ${step.do === 'send' ? 'send an agent back to make it safe' : 'leave it to you'}: ${messageOf(error)}`)
      return 'later'
    }
    this.options.onChange?.()
    return 'done'
  }

  /**
   * The background's look at the risky answers of the finished changes on Work: each change once for each commit its
   * card is at, and again a minute later while something stopped it, as hobkin not being open or work mode starting
   * nothing. A change that leaves Work, as when an agent goes back to it, is looked at afresh when it comes back.
   */
  private watchRisk(wanted: readonly Watched[]) {
    if (!this.options.ownWork || !this.options.assessments) return
    const now = this.now()
    const shown = new Set(wanted.map(({ id }) => id))
    for (const id of this.riskLooked.keys()) if (!shown.has(id)) this.riskLooked.delete(id)
    for (const { id, head } of wanted) {
      if (!head || !id.startsWith('change:')) continue
      const looked = this.riskLooked.get(id)
      if (looked?.head === head && now - looked.at < LOOK_AGAIN_MS) continue
      this.riskLooked.set(id, { head, at: now })
      void this.riskTurn(id).then((done) => {
        if (done === 'done' && this.riskLooked.get(id)?.head === head) this.riskLooked.set(id, { head, at: Number.POSITIVE_INFINITY })
      })
    }
  }

  /** The user gave a verdict on this commit of hobkin's own change: hobkin sends no agent back to it by itself (A37). */
  private answered(target: ReviewTarget, head: string) {
    if (target.kind !== 'change') return
    const record = this.options.store.riskFix(target)
    if (!record.answered.includes(head)) this.options.store.saveRiskFix(target, { ...record, answered: [...record.answered, head] })
  }

  /**
   * How a review's preparation stands. A ready review is outdated when its change is at a commit no review was built
   * for: it still opens, and says so, until a newer one is ready.
   */
  status(id: string): ReviewStatus {
    const target = this.target(id)
    const known = this.stored(id)
    // A finished change's card names its commit, and can be a commit behind after an agent reworked the change. What
    // this host looked up, in git or on the code host, stands until the card names another commit than it did then.
    const head = this.headOf(id, this.options.head?.(target) ?? null)
    const at = head ?? this.opened.get(id)?.review.change.head ?? null
    const assessment = this.assessmentOf(id, target, at)
    const landing = this.landingOf(target)
    // A branch being brought up to date on the user's word moves as it should: that is no newer change to review.
    const start = this.startFor(id, head)
    const stale = known.state === 'ready' && head != null && (!this.options.store.has(target, head) || start?.stale === true) && landing?.state !== 'refreshing'
    const mergeAsked = this.mergeAskedOf(target, landing)
    const pr = target.kind === 'change' ? this.pullOfChange(target)?.pr : undefined
    const card = target.kind === 'change' ? this.options.card(target.slug, target.item) : null
    const scores = card?.scores
    const code = card?.code ?? known.code
    const startsAt = start?.start
    // A change not built at its commit says why it waits, and how many are ahead of it.
    const turn = !known.phase && (stale || head == null || !this.options.store.has(target, head)) ? this.turnOf(id, target, head) : undefined
    const carriedFrom = assessment?.state === 'ready' ? assessment.summary?.carried : undefined
    // The ratings of the review that opens: of the commit it was built for, which they name, when the change moved on.
    const needs = this.needsOf(target, stale ? (this.opened.get(id)?.review.change.head ?? at) : at, head, carriedFrom)
    const rating = this.ratingFor(target, head, assessment, turn, needs)
    return {
      ...known,
      head,
      stale,
      ...(turn ? { turn } : {}),
      rating,
      ...(needs.length ? { needs } : {}),
      ...(carriedFrom ? { carried: { from: carriedFrom.from, why: carriedFrom.why } } : {}),
      ...(assessment ? { assessment } : {}),
      ...(landing ? { landing } : {}),
      ...(mergeAsked ? { mergeAsked } : {}),
      ...(pr ? { pr } : {}),
      ...(scores ? { scores } : {}),
      ...(code ? { code } : {}),
      ...(startsAt ? { startsAt } : {}),
    }
  }

  private startFor(id: string, head: string | null) {
    const known = this.lookedStart.get(id)
    return known?.head === head ? known : undefined
  }

  /** The commit a review's change is at: what this host last looked up, until `card` names another commit than it did then. */
  private headOf(id: string, card: string | null): string | null {
    const looked = this.statuses.get(id)?.head ?? this.lookedHead.get(id) ?? null
    if (looked == null) return card
    const cardAsAtLook = card === (this.cardAtLook.get(id) ?? null)
    return cardAsAtLook ? looked : (card ?? looked)
  }

  /** Whether a change's AI review at this commit is due: it never started there, or a quit or a crash cut it short. */
  private assessmentDue(target: ReviewTarget, head: string): boolean {
    const { assessments } = this.options
    if (!assessments) return false
    return assessments.status(target, head, this.startFor(reviewIdOf(target), head)?.start).state === 'idle' || assessments.cutShort(target, head)
  }

  /**
   * Whether the background will start this finished change's review when its turn comes: hobkin lists it as finished,
   * nothing is under way for it, the background has not looked at it at this commit yet, and nothing ran there, or what
   * ran was cut short. A review the user stopped or removed at this commit is looked at already, so it does not wait.
   */
  private waitsItsTurn(id: string, target: ReviewTarget, status: ReviewStatus): boolean {
    // A finished change, or a pull request the workload names: what the background reviews when its turn comes.
    if (target.kind === 'change' ? !this.finished.has(id) : !this.watchedPulls.has(id)) return false
    if (this.preparing(id) || status.phase || status.landing) return false
    const { head } = status
    if (this.failedBuild(target, head)) return true
    if (this.watched.get(id) === versionOf(head)) return false
    if (!head || !this.options.store.has(target, head)) return true
    return this.reviewsChange(target) && this.assessmentDue(target, head)
  }

  /**
   * Whether there is nothing left to review: a finished change hobkin's records say merged, or a pull request the home
   * marks closed, because it merged or closed on its host or on the user's yes. No AI review is queued for one.
   */
  private closedOn(target: ReviewTarget): boolean {
    return target.kind === 'change' ? this.landingOf(target)?.state === 'merged' : this.options.store.landedAt(target) != null
  }

  /**
   * Ends what waits or runs for a review that `closedOn` says is done: its map leaves the queue, one being drawn
   * starts no change review, and its change review stops where it is, as a stop the user asks for does. What it wrote
   * stays in the home, marked closed, so it leaves the lists. Says whether anything was waiting or running.
   */
  private retire(id: string, target: ReviewTarget): boolean {
    const why = closedWords(target)
    const waiting = this.queue.findIndex((job) => reviewIdOf(job.target) === id)
    if (waiting >= 0) this.queue.splice(waiting, 1)
    const drawing = this.running.has(id)
    if (drawing) this.halted.add(id)
    this.asked.delete(id)
    const stopped = this.options.assessments?.stop(target, why) ?? false
    if (!this.options.store.landedAt(target)) this.options.store.saveLanded(target, new Date(this.now()).toISOString())
    if (!(waiting >= 0 || drawing || stopped)) return false
    this.say(id, `Stopped: ${why}`)
    if (waiting >= 0) this.set(id, { state: this.options.store.newest(target) ? 'ready' : 'idle', phase: null })
    return true
  }

  /** Retires every review waiting or running whose change merged, or whose pull request closed, since it was queued. */
  private retireClosed() {
    const ids = new Map<string, ReviewTarget>()
    for (const job of this.queue) ids.set(reviewIdOf(job.target), job.target)
    for (const id of this.running.keys()) ids.set(id, this.target(id))
    for (const target of this.options.assessments?.pending() ?? []) ids.set(reviewIdOf(target), target)
    let retired = false
    for (const [id, target] of ids) if (this.closedOn(target) && this.retire(id, target)) retired = true
    if (retired) this.options.onChange?.()
  }

  /** Where a finished change stands after a yes, as hobkin's records say. Null for a pull request, or when nothing was said yet. */
  private landingOf(target: ReviewTarget): ReviewLanding | null {
    if (target.kind !== 'change' || !this.options.landing) return null
    try {
      return this.options.landing(target)
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)} could not read how its change landed: ${messageOf(error)}`)
      return null
    }
  }

  /**
   * Every review the host knows, newest first: what it prepared or is preparing since it started, and every review in
   * the home. Each says what it is about, how its preparation stands, and how its change review does, without its steps
   * or its log. One thing is listed once: a pull request a listed finished change opened is that change's row.
   */
  list(): ReviewList {
    const stored = new Map(this.options.store.list().map((entry) => [reviewIdOf(entry.target), entry]))
    // A finished change with nothing prepared yet has no status and nothing in the home: it is listed while it waits its turn.
    const items = [...new Set([...this.statuses.keys(), ...stored.keys(), ...this.finished])].flatMap((id): { item: ReviewListItem; at: number }[] => {
      const target = targetOfReviewId(id)
      if (!target) return []
      const status = this.status(id)
      // What merged or was discarded on the user's yes is done: it is kept in the home, notes and all, and is no longer listed.
      if (status.landing?.state === 'merged' || this.options.store.landedAt(target)) return []
      // So is a change hobkin closed or no longer has, once it is no finished change any more.
      if (target.kind === 'change' && !this.finished.has(id) && this.isClosed(target)) return []
      const kept = stored.get(id)
      const head = status.head ?? kept?.change?.head ?? null
      const about = this.about.get(id) ?? this.options.describe?.(target) ?? kept?.change ?? aboutFromTarget(target)
      const known = this.assessmentOf(id, target, head)
      const times = [this.changedAt.get(id), Date.parse(status.preparedAt ?? ''), Date.parse(known?.summary?.at ?? ''), Date.parse(known?.startedAt ?? '')].filter(
        (time): time is number => time != null && Number.isFinite(time),
      )
      const at = times.length > 0 ? Math.max(...times) : (kept?.at ?? 0)
      const waiting = this.waitsItsTurn(id, target, status)
      // Nothing ran, nothing waits: a finished change the background will not prepare at this commit is not listed for it.
      if (!kept && !this.statuses.has(id) && !waiting) return []
      // Built for an older commit, and not in its repository's line: it waits its turn to be built again (spec 058).
      const builtFor = kept?.change?.head
      const outOfLine = target.kind === 'change' ? !this.line.current.has(id) : !this.watchedPulls.has(id)
      const outdated = !status.phase && outOfLine && head != null && builtFor != null && builtFor !== head && /^[0-9a-f]{40}$/.test(builtFor)
      const turn = waiting || outdated ? this.turnOf(id, target, head) : undefined
      const needs = this.needsOf(target, builtFor ?? head, head, known?.state === 'ready' ? known.summary?.carried : undefined)
      const rating = this.ratingFor(target, head, known, turn, needs)
      const item: ReviewListItem = {
        id,
        kind: target.kind,
        title: about.title,
        project: about.project,
        head,
        state: status.state,
        phase: status.phase,
        ...(status.startedAt ? { startedAt: status.startedAt } : {}),
        error: status.error,
        ...(known ? { assessment: forList(known) } : {}),
        ...(status.mergeAsked ? { mergeAsked: status.mergeAsked } : {}),
        ...(status.owner ? { owner: status.owner } : {}),
        ...(status.pr ? { pr: status.pr } : {}),
        ...(status.scores ? { rate: status.scores.rate } : {}),
        ...(waiting ? { waiting: true as const } : {}),
        ...(turn ? { turn } : {}),
        ...(outdated ? { outdated: { builtFor: builtFor! } } : {}),
        ...(needs.length ? { needs } : {}),
        rating,
        ...(known?.state === 'ready' && known.summary?.carried ? { carried: { from: known.summary.carried.from, why: known.summary.carried.why } } : {}),
        ...(kept?.change?.lines != null ? { lines: kept.change.lines } : {}),
        updatedAt: new Date(at).toISOString(),
      }
      return [{ item, at }]
    })
    // A pull request is hidden behind its change's row only where the window shows that row.
    const shownRows = items.filter(({ item }) => shownAsRow(item)).map(({ item }) => item.id)
    const behindRows = this.pullsOfChanges(shownRows)
    const once = items.filter(({ item }) => !behindRows.has(item.id))
    once.sort((a, b) => b.at - a.at || a.item.id.localeCompare(b.item.id))
    const reviews = once.map(({ item }) => item)
    return { reviews, repos: this.repoLines(reviews.filter(shownAsRow)) }
  }

  /**
   * A line for each repository with rows (spec 058): its finished changes in the line, those that wait, those whose
   * review is of an older commit, and the reviews finished in the last seven days.
   */
  private repoLines(rows: readonly ReviewListItem[]): ReviewRepoLine[] {
    const lines = new Map<string, ReviewRepoLine>()
    const weekAgo = this.now() - 7 * 24 * 60 * 60 * 1000
    for (const row of rows) {
      // A repository is its project's slug, or a pull request's repository, whatever name a row gives it.
      const target = targetOfReviewId(row.id)
      const repo = target?.kind === 'change' ? `change:${target.slug}` : target?.kind === 'pull' ? `pull:${target.host ?? ''}:${target.owner}/${target.repo}` : row.project
      const line = lines.get(repo) ?? { project: row.project, current: 0, waiting: 0, outdated: 0, builtThisWeek: 0 }
      if (row.outdated) line.outdated += 1
      else if (row.turn) line.waiting += 1
      else if (this.line.current.has(row.id)) line.current += 1
      if (target && row.assessment?.head && Date.parse(row.assessment.summary?.at ?? '') >= weekAgo) {
        line.builtThisWeek += 1
        // About what its model calls took, where they gave a count.
        const tokens = this.options.assessments?.tokensAt?.(target, row.assessment.head) ?? null
        if (tokens != null) line.tokensThisWeek = (line.tokensThisWeek ?? 0) + tokens
      }
      lines.set(repo, line)
    }
    return [...lines.values()]
  }

  /** The review names of the pull requests these finished changes opened, as their cards give the address. */
  private pullsOfChanges(ids: readonly string[]): Set<string> {
    const pulls = new Set<string>()
    for (const id of ids) {
      const target = targetOfReviewId(id)
      const opened = target?.kind === 'change' ? this.pullOfChange(target) : null
      if (opened) pulls.add(reviewIdOf(opened.pull))
    }
    return pulls
  }

  /**
   * The pull request a finished change opened: its page as the change's card gives the address, and the pull request
   * that address names. Null when it opened none, or the address is no pull request page this host knows.
   */
  private pullOfChange(target: ChangeTarget): { pr: string; pull: PullTarget } | null {
    const pr = this.options.card(target.slug, target.item)?.pr
    const pull = pr ? targetOfReviewId(pr) : null
    return pr && pull?.kind === 'pull' ? { pr, pull } : null
  }

  /**
   * Asks where the change is now, at most once a minute for each review, so an opened review can say it is outdated.
   * A pull request is asked of GitHub, a finished change's branch of git, with where the change starts at that commit.
   * Nothing is prepared here: the reviewer chooses when to rebuild.
   */
  async lookAgain(id: string, now: () => number = this.options.now ?? Date.now): Promise<void> {
    const target = this.target(id)
    const at = now()
    const last = this.lookedAt.get(id)
    if ((last != null && at - last < LOOK_AGAIN_MS) || this.landingOf(target)?.state === 'merged') return
    this.lookedAt.set(id, at)
    try {
      const source = target.kind === 'change' ? this.options.sources.change : this.options.sources.pull
      const head = await source.head(target)
      if (!head) return
      this.cardAtLook.set(id, this.options.head?.(target) ?? null)
      // A review this host knows of moves to the commit. Of any other only the commit is kept: a look makes no status,
      // so what the user removed or stopped is not listed again for it.
      const known = this.statuses.get(id)
      if (known?.head != null) {
        if (head !== known.head) this.set(id, { head }, at)
      } else if (this.lookedHead.get(id) !== head) {
        this.lookedHead.set(id, head)
        this.options.onChange?.()
      }
      const start = await source.start?.(target, head)
      if (start) this.keepStart(id, head, start)
    } catch (error) {
      this.options.log?.(`Review ${id} could not look up its commit: ${messageOf(error)}`)
    }
  }

  /** Keeps where a change starts at the commit it was looked up at, and says so when that is news. */
  private keepStart(id: string, head: string, start: string) {
    const kept = this.startFor(id, head)
    if (kept?.start === start) return
    const drawn = this.options.store.read(this.target(id), head)?.review.change.base
    const stale = drawn != null && drawn !== start
    this.lookedStart.set(id, { head, start, stale })
    if (stale) this.watched.delete(id)
    this.options.onChange?.()
  }

  /**
   * Prepares a review in the background, and answers at once with how it stands. A review already prepared for the
   * change's commit is used without a run, and one already under way is joined. A ready review stays ready, and opens,
   * while a newer one is prepared. `refresh` prepares it again even for the same commit. `asked` says someone asked
   * for it, the window or hobkin, so hobkin says in its chat when a pull request's review they asked for is ready.
   * `changeReview: false` asks for the graph and its files alone, which ask no model, as the window's code look does
   * (spec 071): the change review starts only on an ask for it, later or while that graph waits or is drawn.
   */
  prepare(id: string, { refresh = false, asked = false, byAgent = false, changeReview = true }: { refresh?: boolean; asked?: boolean; byAgent?: boolean; changeReview?: boolean } = {}): ReviewStatus {
    const target = this.target(id)
    const now = this.status(id)
    // Merged, or closed on its host: there is nothing left to review, and its status says so.
    if (this.closedOn(target)) return now
    // hobkin's agent asks as the background does (spec 058): in the line, within the day's number, or it hears why.
    if (byAgent) {
      const waits = this.agentWaits(id, target, now)
      if (waits) return { ...now, turn: waits }
      if (!this.running.has(id) && !this.queue.some((job) => reviewIdOf(job.target) === id)) this.countBuilt()
    }
    // Review again with nothing changed costs a whole review: the first ask says so, a second one soon after builds it.
    if (refresh && asked && this.nothingChangedSince(target, now)) {
      const last = this.againAt.get(id)
      if (last == null || this.now() - last > AGAIN_WITHIN_MS) {
        this.againAt.set(id, this.now())
        return { ...now, again: { why: COSTS_AGAIN } }
      }
    }
    this.againAt.delete(id)
    if (asked) {
      // A graph built alone is no news for the chat: the user watches it being built, and no change review runs to tell of.
      if (changeReview) this.asked.add(id)
      // Only the user's own ask keeps a review from being dropped by the line, a graph they wait for in the window too.
      if (!byAgent) this.userAsked.add(id)
    }
    // An ask for the change review joins a graph that waits or is drawn alone, and has its change review start after it.
    const waiting = this.queue.find((job) => reviewIdOf(job.target) === id)
    if (waiting) {
      waiting.refresh ||= refresh
      waiting.changeReview ||= changeReview
      return this.status(id)
    }
    if (this.running.has(id) && !refresh) {
      const underWay = this.jobsUnderWay.get(id)
      if (underWay) underWay.changeReview ||= changeReview
      return this.status(id)
    }
    const ahead = this.queue.length + this.running.size
    this.options.store.saveLanded(target, null)
    this.queue.push({ target, head: null, refresh, changeReview })
    const at = this.now()
    const startedAt = new Date(at).toISOString()
    this.runs.set(id, { head: null, startedAt, lines: [] })
    if (ahead > 0) this.say(id, `Waiting for ${count(ahead, 'review')} ahead of it.`)
    this.set(id, { state: now.state === 'ready' ? 'ready' : 'preparing', phase: 'queued', startedAt }, at)
    void this.work()
    return this.status(id)
  }

  private async work() {
    if (this.working) return
    this.working = true
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        const id = reviewIdOf(job.target)
        this.jobsUnderWay.set(id, job)
        const run = this.run(job).catch((error: unknown) => {
          const message = messageOf(error)
          this.asked.delete(id)
          this.options.log?.(`Review ${id} could not be prepared: ${message}`)
          const log = this.runs.get(id)
          if (log) log.error = message
          this.say(id, `Stopped: ${message}`)
          // Kept in the home: the background tries it again in its turn a day later, not on every look (spec 058).
          if (!this.controller.signal.aborted) this.keepFailure(job.target, { head: this.statuses.get(id)?.head ?? null, at: new Date(this.now()).toISOString(), error: message })
          // An older review still opens, and says the newer one could not be prepared.
          this.set(id, { state: this.options.store.newest(job.target) ? 'ready' : 'failed', phase: null, error: message })
        })
        this.running.set(id, run)
        await run
        this.running.delete(id)
        this.jobsUnderWay.delete(id)
        if (this.controller.signal.aborted) return
      }
    } finally {
      this.working = false
    }
  }

  private async run(job: Job) {
    const { target, refresh } = job
    const id = reviewIdOf(target)
    const { store } = this.options
    const source = target.kind === 'change' ? this.options.sources.change : this.options.sources.pull
    const say = (text: string) => this.say(id, text)
    this.set(id, { phase: 'reading', error: null })
    say(target.kind === 'pull' ? `Asking ${target.host ?? 'GitHub'} where #${target.number} is.` : 'Looking up the commit the change is at.')
    const head = await source.head(target)
    if (!head) throw new Error(target.kind === 'change' ? 'This change has no branch to read any more.' : 'This pull request is not open any more.')
    const log = this.runs.get(id)
    if (log) log.head = head
    this.cardAtLook.set(id, this.options.head?.(target) ?? null)
    // Ready, but for an older commit: it opens while the newer one is prepared.
    this.set(id, { head, stale: this.status(id).state === 'ready' && !store.has(target, head) })

    // One preparation for each commit: a review already made for it is used as it is, unless older rules drew its graph.
    const kept = refresh ? null : store.read(target, head)
    // A source that cannot say where the change starts now leaves the start the kept review was made from.
    const base = (kept && source.start ? await source.start(target, head) : null) ?? kept?.review.change.base
    const cached = kept?.review.change.head === head && kept.review.change.base === base && kept.meta?.graph === GRAPH_RULES ? kept : null
    if (cached) {
      this.lookedStart.set(id, { head, start: cached.review.change.base, stale: false })
      say(`The graph of ${head.slice(0, 7)} is drawn already.`)
      // Ready already, so there is no news to tell.
      this.asked.delete(id)
      this.opened.delete(id)
      if (log) log.request = requestOf(target, cached.review)
      this.set(id, { state: 'ready', phase: null, stale: false, preparedAt: cached.meta?.preparedAt ?? this.status(id).preparedAt, storyBy: cached.meta?.storyBy ?? null, ...(cached.meta?.owner ? { owner: cached.meta.owner } : {}), ...(cached.meta?.code ? { code: cached.meta.code } : {}) })
      this.assessAfter(job, cached.review)
      return
    }

    const input = await source.read(target, head, { say, titled: (title) => this.about.set(id, { title, project: aboutFromTarget(target).project }) })
    this.about.set(id, { title: input.change.title, project: input.change.project })
    const { capture } = input
    if (log) log.request = { kind: target.kind, project: input.change.project, ...(target.kind === 'pull' ? { number: target.number } : {}), title: input.change.title, base: capture.base, head, files: capture.files.length, added: capture.additions, removed: capture.deletions }
    say(`Read ${count(capture.files.length, 'changed file')}: ${count(capture.additions, 'line')} added and ${count(capture.deletions, 'line')} removed.`)
    // No model narrates the graph: the change review tells the change (spec 032), and the graph keeps the host's steps.
    const draft = await draftReview({ ...input, id })
    this.set(id, { phase: 'checking' })
    const { review: completed, corrections } = await completeReview(draft)
    for (const line of corrections) this.options.log?.(`Review ${id}: ${line}`)
    // A pull request's description is shown as its author wrote it. Nothing in the review rests on it.
    const review = input.description === undefined ? completed : { ...completed, change: { ...completed.change, description: input.description } }

    const files = filesOf(draft.input.capture.files, draft.headFiles, review)
    const meta = { preparedAt: new Date(this.now()).toISOString(), storyBy: 'host' as const, graph: GRAPH_RULES, producerVersion: CLIENT_PRODUCER_VERSION, ...(input.owner ? { owner: input.owner } : {}), ...(input.code ? { code: input.code } : {}) }
    store.write(target, review, files, meta)
    this.lookedStart.set(id, { head, start: capture.base, stale: false })
    this.keepFailure(target, null)
    say(`Drew the graph: ${count(review.nodes.length, 'node')} and ${count(review.edges.length, 'wire')}.`)
    this.opened.set(id, { review, files, meta })
    this.set(id, { state: 'ready', phase: null, stale: false, ...meta })
    const told = this.asked.delete(id)
    if (told && target.kind === 'pull' && !this.reviewsChange(target)) {
      try {
        this.options.onReady?.({ target, review, at: meta.preparedAt })
      } catch (error) {
        this.options.log?.(`Review ${id}: what was told of it failed: ${messageOf(error)}`)
      }
    }
    // Prepared again on the user's word: the change review runs again too.
    this.assessAfter(job, review)
  }

  /** Whether a change review runs for this target: a host with change reviews, and a repository a review may check out. */
  private reviewsChange(target: ReviewTarget): boolean {
    return this.options.assessments != null && (this.options.checksOut?.(target) ?? true)
  }

  /**
   * Starts the change review once a job's graph is drawn, when the job asks for one (spec 071). A graph built alone
   * starts none, and a stop asked for while it was drawn ends with it.
   */
  private assessAfter(job: Job, review: Review) {
    if (job.changeReview) this.assess(job.target, review, { again: job.refresh })
    else this.halted.delete(reviewIdOf(job.target))
  }

  /** Starts the change review at the commit the review's graph was built for. Never stops the graph. */
  private assess(target: ReviewTarget, review: Review, { again = false }: { again?: boolean } = {}) {
    const { assessments } = this.options
    if (!assessments || !this.reviewsChange(target) || this.closedOn(target)) return
    // The user stopped this review while its map was being prepared.
    if (this.halted.delete(reviewIdOf(target))) return
    const { change } = review
    const run = this.runs.get(reviewIdOf(target))
    try {
      assessments.start(
        {
          target,
          head: change.head,
          base: change.base,
          // A pull request's title and description are claims the review checks, never instructions.
          description: target.kind === 'pull' ? { source: 'pull-request', title: change.title, ...(change.description ? { body: change.description } : {}) } : { source: 'commits', title: change.title },
          request: requestOf(target, review),
          ...(run?.head === change.head ? { log: run.lines, startedAt: run.startedAt } : {}),
        },
        { again },
      )
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)}: the change review could not start: ${messageOf(error)}`)
    }
  }

  /** Waits for whatever preparation of this review is under way. For tests and for closing. */
  async settled(id?: string): Promise<void> {
    while (this.working || (id && this.running.has(id))) await Promise.all([...this.running.values()])
  }

  private loaded(id: string): Prepared {
    const known = this.opened.get(id)
    if (known) return known
    const target = this.target(id)
    const status = this.status(id)
    const cached = (status.head && this.options.store.read(target, status.head)) || this.options.store.latest(target)
    if (!cached) {
      if (status.state === 'failed') throw new Unavailable(`This review could not be prepared: ${status.error}`)
      if (!this.preparing(id) && this.options.store.cleanedUp(target)) {
        // Cleaned up after it closed: what is kept, and Rebuild while the change is still there to build.
        const there = target.kind === 'change' ? this.finished.has(id) : this.watchedPulls.has(id) && !this.closedOn(target)
        throw new Unavailable(`Its review was cleaned up after the change was merged or closed; its summary is kept.${there ? ' Rebuild it to see it again.' : ''}`)
      }
      throw new Unavailable('This review is still being prepared.')
    }
    // The same check the window would run: a review whose anchors no longer match its files is refused.
    const byId = new Map(cached.files.map((file) => [file.fileId, file]))
    openReview(cached.review, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null)
    this.opened.set(id, cached)
    return cached
  }

  /**
   * The review as the user reads it. Once its change review is ready it is told as its units, with their levels on
   * the graph. Until then it has no steps but its opening and closing: the host's own steps only count lines, and are no
   * review. On a host with no change reviews it stays as it was prepared.
   */
  private shown(target: ReviewTarget, { review, files }: Pick<Prepared, 'review' | 'files'>): Review {
    const { assessments } = this.options
    if (!assessments) return review
    return assessments.present(target, review, files) ?? { ...review, story: review.story.filter((step) => step.kind !== 'walk').map(({ travel: _travel, ...step }) => step) }
  }

  /**
   * Whether a review is in use: opened or read within `withinMs`, being prepared, or being carried now. Cleaning up
   * leaves such a review whole.
   */
  inUse(target: ReviewTarget, withinMs: number): boolean {
    const id = reviewIdOf(target)
    if (this.preparing(id) || this.carrying.has(id)) return true
    const read = this.readAt.get(id)
    if (read != null && this.now() - read < withinMs) return true
    // Read before this host started: the home keeps it, at most an hour behind the last read.
    let kept: number | null = null
    try {
      kept = Date.parse(this.options.store.readAt(target) ?? '')
    } catch (error) {
      this.options.log?.(`Review ${id}: when it was last read could not be read, so it is kept as in use: ${messageOf(error)}`)
      return true
    }
    return Number.isFinite(kept) && this.now() - kept! < withinMs + READ_KEPT_EVERY_MS
  }

  /** Notes a read of a review, and keeps it in the home at most once an hour, so a restart knows it too. */
  private noteRead(id: string) {
    const now = this.now()
    this.readAt.set(id, now)
    const kept = this.readKept.get(id)
    if (kept != null && now - kept < READ_KEPT_EVERY_MS) return
    this.readKept.set(id, now)
    try {
      this.options.store.saveReadAt(this.target(id), new Date(now).toISOString())
    } catch (error) {
      this.options.log?.(`Review ${id}: when it was read could not be kept, so a restart may not know it: ${messageOf(error)}`)
    }
  }

  /** The prepared review as the user reads it, with the reviewer's notes. */
  get(id: string): OpenedReview {
    this.noteRead(id)
    const prepared = this.loaded(id)
    const { review } = prepared
    // Opening a review is when its change is looked up: a pull request on its host, a finished change's branch in git.
    void this.lookAgain(id)
    const status = this.status(id)
    const target = this.target(id)
    const { assessments } = this.options
    const assessment = this.assessmentOf(id, target, review.change.head)
    return {
      review: this.shown(target, prepared),
      notes: this.options.store.notes(target),
      status: { ...status, stale: status.stale || (status.head != null && status.head !== review.change.head && status.landing?.state !== 'refreshing'), ...(assessment ? { assessment } : {}) },
      ...(assessments ? { assessment: assessments.read(target, review.change.head, review.change.base) } : {}),
    }
  }

  /** Both sides of one file of a prepared review. */
  file(id: string, fileId: string): ReviewFileContents {
    this.noteRead(id)
    const { files, review } = this.loaded(id)
    // A test file the change review found joins the review as it is shown, read at its commit.
    const file = files.find((entry) => entry.fileId === fileId) ?? this.options.assessments?.shownFile(this.target(id), review.change.head, fileId)
    if (!file) throw new Error(`${fileId} is not a file of this review.`)
    return file
  }

  /**
   * Keeps the reviewer's notes in the home, sent or not, so they come back after a restart. The window's log is laid
   * over what the home has, so a note hobkin left that the window has not seen yet stays, and one the window removed goes.
   */
  saveNotes(id: string, notes: ReviewNotes): void {
    const target = this.target(id)
    const saved = this.options.store.notes(target).entries as NoteEntry[]
    // Folded, so the file holds each note once however often it was changed.
    const receipts = new Map(foldNotes(saved).map((note) => [note.id, note.sent]))
    const entries = foldNotes([...saved, ...notes.entries]).map((note) => {
      // A window may have loaded this note before the host recorded its delivery.
      const sent = receipts.get(note.id)
      return { op: 'put' as const, note: sent == null ? note : { ...note, sent } }
    })
    this.options.store.saveNotes(target, { entries, draft: notes.draft })
  }

  /**
   * Reviewed pull requests that GitHub says are no longer open leave the list: merged or closed, here or on
   * github.com, by anyone. Each is asked of GitHub, at most every two minutes. One GitHub does not answer for stays,
   * and is asked again next time.
   */
  async sweepPulls({ force = false }: { force?: boolean } = {}): Promise<void> {
    const now = this.now()
    if (this.sweeping || (!force && now - this.sweptAt < SWEEP_EVERY_MS)) return
    this.sweeping = true
    this.sweptAt = now
    let gone = false
    try {
      for (const { target } of this.options.store.list()) {
        if (target.kind !== 'pull' || this.options.store.landedAt(target) || this.preparing(reviewIdOf(target))) continue
        const head = await this.options.sources.pull.head(target).catch(() => undefined)
        if (head !== null) continue
        this.options.store.saveLanded(target, new Date(this.now()).toISOString())
        this.retire(reviewIdOf(target), target)
        gone = true
      }
    } finally {
      this.sweeping = false
    }
    if (gone) this.options.onChange?.()
  }

  /** The pull requests with a review standing that nothing has marked closed yet, as the host asks GitHub about them. */
  openPulls(): Extract<ReviewTarget, { kind: 'pull' }>[] {
    return this.options.store.list().flatMap(({ target }) => (target.kind === 'pull' && !this.options.store.landedAt(target) ? [target] : []))
  }

  /** A pull request that GitHub says is no longer open, merged or closed anywhere: its review leaves the lists now, as the sweep would have found. */
  settlePull(target: Extract<ReviewTarget, { kind: 'pull' }>): void {
    if (this.options.store.landedAt(target)) return
    this.options.store.saveLanded(target, new Date(this.now()).toISOString())
    this.retire(reviewIdOf(target), target)
    this.options.onChange?.()
  }

  /**
   * Stops a review that is waiting or under way, on the user's word: a preparation still waiting leaves the queue,
   * one under way finishes its map and starts no change review, and a change review is stopped where it is, its tests
   * with it. Whatever was ready before stays as it was. Refused when nothing of it is running.
   */
  stop(id: string): ReviewStatus {
    const target = this.target(id)
    let stopped = false
    const waiting = this.queue.findIndex((job) => reviewIdOf(job.target) === id)
    if (waiting >= 0) {
      this.queue.splice(waiting, 1)
      this.asked.delete(id)
      this.say(id, 'Stopped before it started, as you asked.')
      this.set(id, { state: this.options.store.newest(target) ? 'ready' : 'idle', phase: null })
      stopped = true
    }
    if (this.running.has(id)) {
      // Its map is quick to finish. The change review after it is the long part, and that one does not start.
      this.halted.add(id)
      stopped = true
    }
    if (this.options.assessments?.stop(target)) stopped = true
    if (!stopped) throw new Unavailable('This review is not running, so there is nothing to stop.')
    this.options.onChange?.()
    return this.status(id)
  }

  /**
   * Removes a review from the app: every map built for it, its change reviews and its notes leave the home, and it
   * leaves the list. Refused while it is being prepared or reviewed. Preparing it again builds it from nothing.
   */
  remove(id: string): { id: string; removed: true } {
    const target = this.target(id)
    if (this.preparing(id) || this.options.assessments?.busy(target)) throw new Unavailable('This review is being prepared. Wait for it to finish, then remove it.')
    this.options.store.remove(target)
    this.options.assessments?.forget(target)
    // What it is watched at stays, so the background does not build it again until its change moves.
    for (const kept of [this.statuses, this.opened, this.lookedAt, this.cardAtLook, this.lookedHead, this.changedAt, this.about, this.runs]) kept.delete(id)
    this.asked.delete(id)
    this.options.onChange?.()
    return { id, removed: true }
  }

  /** Moves the reviewer's view to a step, by its number from 1 in the story they read, or to a node. The window follows. */
  show(id: string, place: { step?: number; node?: string }): ReviewCursor {
    const review = this.shown(this.target(id), this.loaded(id))
    const { step, node } = place
    if ((step == null) === (node == null)) throw new Unavailable('Name a step or a node to show, and only one.')
    if (step != null && !isStepNumber(step, review)) throw new Unavailable(`This review has ${review.story.length} steps.`)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    const cursor: ReviewCursor = { ...(step != null ? { step } : {}), ...(node != null ? { node } : {}), at: (this.options.now ?? Date.now)() }
    this.set(id, { cursor }, cursor.at)
    return cursor
  }

  /**
   * A note hobkin leaves on a review, signed as hobkin: on a node, on a wire, or on a step. It is taken on the step
   * that shows what it is about, so it reads in the story where the reviewer meets it.
   */
  note(id: string, { intent, text, step, node, wire }: { intent: NoteIntent; text: string; step?: number; node?: string; wire?: string }): Note {
    const target = this.target(id)
    const review = this.shown(target, this.loaded(id))
    const edge = wire == null ? undefined : review.edges.find((entry) => entry.id === wire)
    if (node != null && !review.nodes.some((entry) => entry.id === node)) throw new Unavailable(`This review has no node ${node}.`)
    if (wire != null && !edge) throw new Unavailable(`This review has no wire ${wire}.`)
    if (step != null && !isStepNumber(step, review)) throw new Unavailable(`This review has ${review.story.length} steps.`)
    const about: NoteTarget = node != null ? { kind: 'node', node } : edge ? { kind: 'wire', wire: edge.id } : { kind: 'step' }
    const shown = [node, edge?.from, edge?.to].filter((entry): entry is string => entry != null)
    const cursor = this.stored(id).cursor?.step
    const taken =
      (step != null ? review.story[step - 1] : undefined) ??
      review.story.find((entry) => entry.focus.some((focused) => shown.includes(focused))) ??
      (cursor != null ? review.story[cursor - 1] : undefined) ??
      review.story.find((entry) => entry.kind === 'walk') ??
      review.story[0]!
    const at = (this.options.now ?? Date.now)()
    const note: Note = { id: `hobkin-${at.toString(36)}-${(this.written += 1)}`, step: taken.id, target: about, intent, text: text.trim(), author: 'hobkin', at }
    const saved = this.options.store.notes(target)
    const notes = foldNotes([...(saved.entries as NoteEntry[]), { op: 'put', note }])
    this.options.store.saveNotes(target, { entries: notes.map((entry) => ({ op: 'put', note: entry })), draft: saved.draft })
    this.set(id, { notesAt: at }, at)
    return note
  }

  /**
   * Who a review's pull request is from. For a prepared pull request review: by the author and description its review
   * kept, or, for a review that kept no author, as the pull request's host says now. For a finished change: as the host
   * of the pull request it opened says, asked once for each pull request. A change that opened none names nobody.
   */
  async people(id: string): Promise<ReviewPeople | null> {
    const target = this.target(id)
    if (target.kind === 'change') return this.peopleOfOpenedPull(target)

    const { review, meta } = this.loaded(id)
    let author = meta?.owner?.author ?? null
    let description = review.change.description ?? ''
    const api = author ? null : this.apiFor(target)
    if (api) {
      const said = await pullAuthorship(target, api)
      author = said.author
      description = description || said.description
    }
    return this.peopleNamedBy(target, { author, description })
  }

  /** Who the pull request a finished change opened is from. Null when it opened none, or its host cannot be asked from here. */
  private async peopleOfOpenedPull(change: ChangeTarget): Promise<ReviewPeople | null> {
    const opened = this.pullOfChange(change)
    if (!opened) return null

    const api = this.apiFor(opened.pull)
    if (!api) return null

    const authorship = await this.authorshipOfOpenedPull(opened.pull, api)
    return this.peopleNamedBy(opened.pull, authorship)
  }

  /** The people a pull request's authorship names, with their profiles where this host looks people up. */
  private async peopleNamedBy(target: PullTarget, authorship: PullAuthorship): Promise<ReviewPeople> {
    if (this.options.peopleOf) return this.options.peopleOf(target, authorship)

    return { author: authorship.author ? { name: authorship.author } : null }
  }

  /** What the host of a finished change's pull request says of who wrote it. An answer is kept; a failed ask is made again. */
  private authorshipOfOpenedPull(pull: PullTarget, api: HostApi): Promise<PullAuthorship> {
    const id = reviewIdOf(pull)
    const kept = this.openedPullAuthorship.get(id)
    if (kept) return kept

    const asked = pullAuthorship(pull, api).catch((error: unknown) => {
      this.openedPullAuthorship.delete(id)
      throw error
    })
    this.openedPullAuthorship.set(id, asked)
    return asked
  }

  /** The code hosts the home names besides GitHub, so a pull request page on one opens as its review. None without a code host file. */
  codeHosts(): NamedCodeHost[] {
    return this.options.namedHosts?.() ?? []
  }

  /** Where a pull request's reads and verdicts go: gh for GitHub, else its code host's API. Null when this host sends nothing there. */
  private apiFor(target: PullTarget): HostApi | null {
    if (target.host) return this.options.apiOf?.(target) ?? null
    return this.options.gh ? githubApi(this.options.gh) : null
  }

  /** The user's words checked for grammar once, by their exact texts. Null on a host that asks no models. */
  private grammarOf(texts: GrammarTexts): Promise<GrammarResult> | null {
    const ask = this.options.grammar
    if (!ask) return null
    const key = JSON.stringify(texts)
    let found = this.grammared.get(key)
    if (!found) {
      found = checkGrammar(texts, ask)
      this.grammared.set(key, found)
      if (this.grammared.size > 50) this.grammared.delete(this.grammared.keys().next().value!)
    }
    return found
  }

  /**
   * A pull request review with its words' grammar fixed where only grammar changed, what the confirmation says of it,
   * and the corrections it did not make, which the window shows apart for the user to take in (as pi-coder asks for each).
   */
  private async fixedPost(post: PullReviewPost): Promise<{ post: PullReviewPost; said: string[]; suggested: { original: string; suggestion: string }[] }> {
    const result = await this.grammarOf({ ...(post.body ? { body: post.body } : {}), comments: post.comments.map((comment) => comment.body) })
    if (!result) return { post, said: [], suggested: [] }
    if (result.kind === 'unchecked') return { post, said: grammarLines(result), suggested: [] }
    const { body, comments } = result.texts
    const fixed = { ...post, ...(body !== undefined ? { body } : {}), comments: post.comments.map((comment, index) => ({ ...comment, body: comments[index]! })) }
    return { post: fixed, said: grammarLines(result, { suggestions: false }), suggested: result.suggested }
  }

  /** The words a pull request gets before it is closed, with their grammar fixed in the same way. */
  private async fixedComment(comment: string | null): Promise<{ comment: string | null; said: string[] }> {
    const result = comment ? await this.grammarOf({ body: comment, comments: [] }) : null
    if (!result) return { comment, said: [] }
    return { comment: result.kind === 'checked' ? (result.texts.body ?? comment) : comment, said: grammarLines(result) }
  }

  /**
   * What a verdict will do, built from the review and the notes in the home, with the token that lets it go.
   * Nothing is sent here. `head` is the commit of the review on the user's screen: when the host holds a review of
   * another commit, prepared again since, it is refused, so nobody answers one review with what another would do.
   */
  async preview(id: string, verdict: Verdict, summary: string, head?: string): Promise<VerdictPreview> {
    return (await this.planned(id, verdict, summary, head)).preview
  }

  /** The preview, and the review, card and pull request it was built from, so a verdict does exactly what was shown. */
  private async planned(id: string, verdict: Verdict, summary: string, head?: string): Promise<Planned> {
    const target = this.target(id)
    const loaded = this.loaded(id)
    const { files, review: prepared, meta } = loaded
    const review = this.shown(target, loaded)
    const at = review.change.head
    // Every token holds the commit it was shown for, so no verdict ever acts on another one.
    const token = (...shown: unknown[]) => sha256(JSON.stringify([target.kind, id, verdict, at, ...shown]))
    // A merged change is merged whatever the verdict, and one being brought up to date to merge has the user's word already.
    const landing = this.landingOf(target)
    if (landing?.state === 'merged') return { review, card: null, done: mergedWords(landing), preview: { verdict, lines: [mergedWords(landing)], confirm: token('merged', landing.sha ?? null) } }
    if (landing?.state === 'refreshing' && verdict === 'approve-merge') {
      const said = landing.message ?? 'It is being brought up to date already, and hobkin merges it once that run ends well.'
      return { review, card: null, done: said, preview: { verdict, lines: [said], confirm: token('refreshing') } }
    }
    // Approve and merge lands where the branch is now and says what moved, so a moved head is no refusal there.
    const lands = verdict === 'approve-merge' && (target.kind === 'pull' || this.options.merging != null)
    // A discard is a no to the change wherever it is now, so a moved head is no refusal there either. What it deletes is in its token.
    const no = verdict === 'discard' || verdict === 'discard-branch'
    if (head != null && !at.startsWith(head) && !lands && !no) throw new Unavailable(`This review is for commit ${head.slice(0, 7)}; the change has moved to ${at.slice(0, 7)}. Rebuild the review and look again.`)
    const notes = foldNotes(this.options.store.notes(target).entries as NoteEntry[])
    const byId = new Map(files.map((file) => [file.fileId, file]))
    const loose = new Set(detachedNotes(notes, (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null))

    if (target.kind === 'pull') {
      const name = `${target.owner}/${target.repo}#${target.number}`
      const where = target.host ?? 'GitHub'
      const how = target.host ? 'through its API command' : 'through gh'
      // Only the user's own pull request is merged or closed from here, as its review recorded it. A review from before that reads as someone else's.
      if ((verdict === 'approve-merge' || no) && !meta?.owner?.mine) throw new Unavailable(`${name} is not yours, so merging or closing it is left to its author. Approve it or comment on it.`)
      if (no) {
        const { comment, said: checked } = await this.fixedComment(closingComment(summary))
        const closing = [`Close ${name} on ${where} without merging it, as you${target.host ? `, ${how}` : ''}.`, ...(comment ? ['Your words go on it as a comment first.', ...checked] : [])]
        const pull = { owner: target.owner, repo: target.repo, number: target.number, ...(target.host ? { host: target.host } : {}), named: name }
        // Closed already, by this yes from another window or on GitHub: there is no second comment and no second delete.
        if (this.options.store.landedAt(target)) throw new Unavailable(`${name} is closed already, so there is nothing left to close.`)
        if (verdict === 'discard') {
          const discard: Discard = { pull, comment }
          return { review, card: null, discard, preview: { verdict, lines: [...closing, 'Its branch stays.'], confirm: token('discard', comment) } }
        }
        if (target.host && !this.options.hostWays?.(target)) throw new Unavailable(`${target.host} gives hobkin no way to delete a branch there, so Remove closes the pull request and keeps the branch.`)
        // The branch as its host has it now, commit and all: one that gains a commit after this is not the one shown.
        const branch = await this.pullHead(target)
        const lines = target.host
          ? [...closing, `Then delete its branch ${branch.ref} on ${target.host}, with git, as you, only if it is still at ${branch.sha.slice(0, 7)}: a commit pushed since keeps it.`, 'Its commits stay on the closed pull request.']
          : [
              ...closing,
              `Then delete its branch ${branch.ref} on GitHub, in ${target.owner}/${target.repo}, as you, only if it is still at ${branch.sha.slice(0, 7)}: a commit pushed since keeps it.`,
              'Its commits stay on the closed pull request, and GitHub can restore the branch from there.',
            ]
        const discard: Discard = { pull, comment, branch }
        return { review, card: null, discard, preview: { verdict, lines, confirm: token('discard-branch', comment, branch) } }
      }
      const lineComments = (post: PullReviewPost) => (post.comments.length ? `with ${post.comments.length === 1 ? 'one comment' : `${post.comments.length} comments`} on lines` : 'with no comments on lines')
      const pinned = `At commit ${at.slice(0, 7)}, the one this review was built from. GitHub refuses if the pull request has moved since.`
      if (verdict === 'approve-merge' && target.host) return this.hostMergePlan({ target, name, review, notes, summary, loose, at, token })
      if (verdict === 'approve-merge') {
        const { mine, method, base, head: now, ref, defaultBranch } = await this.pullFacts(target)
        await this.layersUnder(target, { base, head: ref, defaultBranch })
        // It merges where the pull request is now, which the preview says: a head that moved since the review is no refusal.
        const reviewed = head != null && !at.startsWith(head) ? head : at
        const current = now ?? reviewed
        const movedOn = !(current.startsWith(reviewed) || reviewed.startsWith(current))
        const said = movedOn ? await this.pullMovedWords(target, reviewed, current, base) : null
        // GitHub lets nobody approve their own pull request: what the user wrote still goes, as a comment, and then it merges.
        const { post: written, said: checked, suggested } = await this.fixedPost(pullReviewPost(review, notes, mine ? 'comment' : 'approve', summary, loose))
        // A review with no line to place goes on the commit it merges; lines stay on the commit they were written on.
        const post = movedOn && written.comments.length === 0 ? { ...written, commit_id: current } : written
        const says = !mine || !saysNothing(post)
        const at7 = current.slice(0, 7)
        const tail = said ? [said, `This merges ${at7}, the commit shown here. GitHub refuses if the pull request moves again before then.`] : [pinned]
        const lines = mine
          ? [
              'GitHub does not let you approve your own pull request, so this merges it without an approval.',
              ...(says ? [`Comment on ${name} on GitHub first, as you, through gh, ${lineComments(post)}.`, ...checked] : []),
              `Merge ${name} into ${base} ${MERGE_WORDS[method]}, as you, through gh.`,
              ...tail,
            ]
          : [`Approve ${name} on GitHub, as you, through gh, ${lineComments(post)}.`, ...checked, `Then merge it into ${base} ${MERGE_WORDS[method]}.`, ...tail]
        const merge: Merge = { post: says ? post : null, method, base, mine, head: current }
        return { review, card: null, merge, preview: { verdict, lines, ...(says ? { post, ...(suggested.length ? { suggested } : {}) } : {}), confirm: token(merge) } }
      }
      // GitHub would refuse it, so it is refused here, before anything is sent.
      if (verdict === 'approve' && this.apiFor(target) && (await this.pullFacts(target)).mine) {
        if (target.host) throw new Unavailable(`On ${target.host} your own approval counts for nothing. Approve and merge asks ${target.host} to merge it, or leave a comment.`)
        throw new Unavailable('GitHub does not let you approve your own pull request. Approve and merge merges it without an approval, or leave a comment.')
      }
      const written = pullReviewPost(review, notes, verdict, summary, loose)
      if (verdict === 'comment' && saysNothing(written)) throw new Unavailable('There is nothing to post: write a comment first.')
      // GitHub asks every request for changes for a body, and only the user's words may be it.
      if (verdict === 'request-changes' && !written.body) throw new Unavailable('A request for changes needs your words: write what should change first.')
      const { post, said: checked, suggested } = await this.fixedPost(written)
      const words = { comment: 'Comment on', approve: 'Approve', 'request-changes': 'Ask for changes on' }[verdict]
      const lines = [`${words} ${name} on ${where}, as you, ${how}.`, `At commit ${at.slice(0, 7)}, the one this review was built from.`, `${lineComments(post).replace(/^w/, 'W')}.`, ...checked]
      return { review, card: null, preview: { verdict, lines, post, ...(suggested.length ? { suggested } : {}), confirm: token(post) } }
    }

    const card = this.options.card(target.slug, target.item)
    if (no) {
      const pr = card?.pr ?? null
      const place = pr ? pullOfAddress(pr) : null
      if (pr && !place) throw new Unavailable(`Its pull request is not one this host can close: ${pr}. Close it on GitHub, then remove the change.`)
      // With no finished card, hobkin still has the change only while it means to merge it after its refresh or works on it
      // again: the no stops that. Once hobkin is done with it, the no has nothing to stop, and the review only leaves the list.
      const refreshing = landing?.state === 'refreshing'
      const declines = card != null || refreshing || this.ownWorkOf(target)?.at === 'working'
      // hobkin says what deleting the branch takes, and refuses there, before anything is done, when it is not one to delete.
      const deletes = verdict === 'discard-branch' ? await this.branchPlan(target) : null
      const lines = [
        declines ? 'Say no to this change. hobkin does not work on it again, and learns from the no.' : 'hobkin is done with this change already, so it only leaves this list.',
        ...(declines && refreshing ? ['The merge you asked for does not happen.'] : []),
        ...(pr ? [`Close its pull request on GitHub without merging it, as you: ${pr}`] : []),
        ...(deletes ? deletionLines(deletes) : ['Its branch stays.']),
      ]
      const discard: Discard = { pull: pr && place ? { ...place, named: pr } : null, comment: null, declines, ...(deletes ? { deletes } : {}) }
      return { review, card, discard, preview: { verdict, lines, confirm: deletes ? token('discard-branch', pr, declines, deletes) : token('discard', pr, declines) } }
    }
    if (!card) throw new Unavailable('hobkin no longer lists this change as finished.')
    if (verdict === 'comment') throw new Unavailable('A finished change has nobody to comment to. Approve it, approve and merge it, or ask for changes.')
    if (verdict === 'approve') {
      const publication = await this.publication(target.slug, card, prepared, meta?.producerVersion)
      const { plan, pull } = publication
      const lines = [
        `Push ${plan.branch} at ${pull.head.slice(0, 7)} to ${plan.repo} on GitHub, as you.`,
        `Open a pull request from it into ${plan.base}, titled "${pull.title}".`,
        `Its description: ${pull.body}`,
        'Nothing is merged.',
      ]
      return { review, card, publication, preview: { verdict, lines, confirm: token(plan, pull) } }
    }
    if (verdict === 'approve-merge' && this.options.merging) {
      // Pinned to where the branch is now, as the preview shows it: the yes merges exactly that commit.
      const reviewed = head != null && !at.startsWith(head) ? head : at
      let plan: MergePlan
      try {
        plan = await this.options.merging(target, { reviewed, current: this.options.head?.(target) ?? at, pr: card.pr != null })
      } catch (error) {
        throw new Unavailable(messageOf(error))
      }
      return { review, card, plan, preview: { verdict, lines: landingLines(plan, card.pr, this.status(id).carried), confirm: token(plan) } }
    }
    if (verdict === 'approve-merge') {
      return { review, card, preview: { verdict, lines: [card.yes, `${reviewedAt(at, this.status(id).carried)} A branch that moved since is refused.`], confirm: token(card.landing) } }
    }
    const note = askForChanges(review, notes, summary)
    if (!note) throw new Unavailable('There is nothing to talk over yet. Write a comment, or a question to discuss with D.')
    return { review, card, preview: { verdict, lines: ["hobkin's agent goes back to this change with your notes:"], note, confirm: token(note) } }
  }

  /**
   * Approve and merge on the user's own pull request on a named host, the way that host merges: the review goes first,
   * as a comment on a pull request the user opened (their own approval counts for nothing there) and as an approval on
   * one an agent opened because they asked, then the comment that asks the host to merge it, at the commit shown.
   * Refused, before anything is sent, for a draft, a conflict, one no longer open, or a host with no merge entry.
   */
  private async hostMergePlan({ target, name, review, notes, summary, loose, at, token }: {
    target: PullTarget
    name: string
    review: Review
    notes: readonly Note[]
    summary: string
    loose: ReadonlySet<string>
    at: string
    token: (...shown: unknown[]) => string
  }): Promise<Planned> {
    const host = target.host!
    const ways = this.options.hostWays?.(target)
    const api = this.apiFor(target)
    if (!ways?.merge || !api) throw new Unavailable(`hobkin may not merge on ${host}, as its code host file says.`)
    if (!ways.mergeBy) throw new Unavailable(`${host} has no merge entry in the code host file, so hobkin does not know how to ask it to merge. Name its merge comment there.`)
    let pull: { state?: string; draft?: boolean; mergeable?: boolean | null; mergeable_state?: string; head?: { sha?: string }; user?: { login?: string } }
    try {
      pull = JSON.parse(await api({ path: `repos/${target.owner}/${target.repo}/pulls/${target.number}` })) as typeof pull
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    if (pull.state !== 'open') throw new Unavailable(`${name} is not open on ${host}, so there is nothing to merge.`)
    if (pull.draft) throw new Unavailable(`${name} is a draft on ${host}: mark it ready for review first.`)
    if (pull.mergeable === false || pull.mergeable_state === 'dirty') throw new Unavailable(`${name} has conflicts on ${host}: resolve them first.`)
    const current = pull.head?.sha
    if (!current) throw new Unavailable(`${host} did not say which commit ${name} is at, so its merge is not asked.`)
    const opened = Boolean(pull.user?.login && ways.emails.includes(pull.user.login.toLowerCase()))
    const { post: written, said: checked, suggested } = await this.fixedPost(pullReviewPost(review, notes, opened ? 'comment' : 'approve', summary, loose))
    // A review with no line to place goes on the commit it asks to merge; lines stay on the commit they were written on.
    const post = current !== at && written.comments.length === 0 ? { ...written, commit_id: current } : written
    const says = !opened || !saysNothing(post)
    const lineComments = post.comments.length ? `with ${post.comments.length === 1 ? 'one comment' : `${post.comments.length} comments`} on lines` : 'with no comments on lines'
    const { comment, after } = ways.mergeBy
    const lines = [
      ...(opened
        ? [`On ${host} your own approval counts for nothing, so nothing is approved.`, ...(says ? [`Comment on ${name} on ${host} first, as you, through its API command, ${lineComments}.`, ...checked] : [])]
        : [`Approve ${name} on ${host}, as you, through its API command, ${lineComments}.`, ...checked]),
      `Then post "${comment}" on it, which asks ${host} to merge it.`,
      ...(after ? [after] : []),
      // Not the branch it merges into: a stacked pull request's base is the one below it.
      `It asks at commit ${current.slice(0, 7)}: if ${name} moves before then, nothing more is posted.`,
    ]
    const merge: Merge = { asks: ways.mergeBy, post: says ? post : null, method: 'merge', base: '', mine: opened, head: current }
    return { review, card: null, merge, preview: { verdict: 'approve-merge', lines, ...(says ? { post, ...(suggested.length ? { suggested } : {}) } : {}), confirm: token(merge) } }
  }

  /**
   * The branch a pull request comes from, as GitHub has it now, for deleting it once it is closed. Refused, before anything
   * is sent, when it is not one to delete from here: in a fork, in a repository that is gone, the repository's default
   * branch, a protected branch, the branch of another open pull request, or one that open pull requests merge into.
   */
  private async pullHead(target: PullTarget): Promise<PullBranch> {
    const host = this.apiFor(target)
    if (!host) throw new Unavailable(`This host posts nothing to ${target.host ?? 'GitHub'}.`)
    const api = async <Value>(path: string) => JSON.parse(await host({ path })) as Value
    const repo = `repos/${target.owner}/${target.repo}`
    type Pull = { head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null }; base?: { repo?: { full_name?: string } } }
    const read = async <Facts>(reads: Promise<unknown>[]) => {
      try {
        return (await Promise.all(reads)) as Facts
      } catch (error) {
        throw new Unavailable(messageOf(error))
      }
    }
    const [pull, settings] = await read<[Pull, { default_branch?: string; node_id?: string }]>([api(`${repo}/pulls/${target.number}`), api(repo)])
    const home = `${target.owner}/${target.repo}`
    const ref = pull.head?.ref
    const from = pull.head?.repo?.full_name
    const keeps = 'Remove closes the pull request and keeps the branch.'
    if (!ref || !from) throw new Unavailable('The repository its branch lived in is gone, so there is no branch to delete. Remove closes the pull request.')
    if (from.toLowerCase() !== (pull.base?.repo?.full_name ?? home).toLowerCase()) throw new Unavailable(`Its branch ${ref} lives in ${from}, a fork, and is not deleted from here. ${keeps}`)
    if (ref === settings.default_branch) throw new Unavailable(`Its branch is ${ref}, the default branch of ${home}, which is never deleted. ${keeps}`)
    const sha = pull.head?.sha
    // GitHub's delete names the repository by its id; a named host deletes with git, by the commit alone.
    if (!sha || (!target.host && !settings.node_id)) throw new Unavailable(`${target.host ?? 'GitHub'} did not say which commit its branch ${ref} is at, so it is not deleted. ${keeps}`)
    type Listed = { number?: number }[]
    const [branch, heads, bases] = await read<[{ protected?: boolean }, Listed, Listed]>([
      api(`${repo}/branches/${ref.split('/').map(encodeURIComponent).join('/')}`),
      api(`${repo}/pulls?state=open&head=${encodeURIComponent(`${target.owner}:${ref}`)}`),
      api(`${repo}/pulls?state=open&base=${encodeURIComponent(ref)}`),
    ])
    const others = 'Remove closes this pull request and keeps the branch.'
    if (branch.protected) throw new Unavailable(`Its branch ${ref} is protected in ${home}, so it is not deleted from here. ${keeps}`)
    const sharing = heads.find((open) => open.number !== target.number)
    if (sharing) throw new Unavailable(`Its branch ${ref} is also the branch of ${home}#${sharing.number}, which is open, so it is not deleted. ${others}`)
    if (bases.length > 0) {
      const into = bases.length === 1 ? `${home}#${bases[0]!.number}, an open pull request, merges` : `${home}#${bases[0]!.number} and ${bases.length - 1} more open pull requests merge`
      throw new Unavailable(`Its branch ${ref} is what ${into} into, so it is not deleted. ${others}`)
    }
    return { ref, sha, ...(target.host ? {} : { repo: settings.node_id }) }
  }

  /** What hobkin says deleting a finished change's own branch takes, read and never changed. Its refusal comes back as it is. */
  private async branchPlan(target: ChangeTarget): Promise<BranchPlan> {
    let answer: unknown
    try {
      answer = await this.options.work().workAction('deleteBranch', target.slug, target.item, { look: true })
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    const plan = (answer as { plan?: BranchPlan } | null)?.plan
    if (!plan || typeof plan.branch !== 'string') throw new Unavailable('hobkin did not say what deleting its branch takes, so nothing is deleted.')
    return plan
  }

  /**
   * What GitHub says of a pull request before it is approved or merged: whether the user opened it, the branch it merges
   * into, and how its repository lets it be merged, squashed first, then with a merge commit, then rebased.
   */
  private async pullFacts(target: PullTarget): Promise<{ mine: boolean; method: MergeMethod; base: string; head: string | null; ref: string | null; defaultBranch: string | null }> {
    const host = this.apiFor(target)
    if (!host) throw new Unavailable(`This host merges nothing on ${target.host ?? 'GitHub'}.`)
    const api = async <Value>(path: string) => JSON.parse(await host({ path })) as Value
    const repo = `repos/${target.owner}/${target.repo}`
    type Facts = [{ login?: string }, { user?: { login?: string }; base?: { ref?: string }; head?: { sha?: string; ref?: string } }, { default_branch?: string; allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean }]
    let facts: Facts
    try {
      // A named host places the author by the user's addresses, and merges its own way: neither its login nor its settings are read.
      facts = (await Promise.all([target.host ? {} : api('user'), api(`${repo}/pulls/${target.number}`), target.host ? {} : api(repo)])) as Facts
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    const [viewer, pull, settings] = facts
    const method: MergeMethod | null = settings.allow_squash_merge === true ? 'squash' : settings.allow_merge_commit !== false ? 'merge' : settings.allow_rebase_merge !== false ? 'rebase' : null
    // A named host merges its own way, so how GitHub would merge is no question there.
    if (!method && !target.host) throw new Unavailable(`${target.owner}/${target.repo} allows no way to merge a pull request.`)
    // On GitHub the user opened it when gh's login is its author's; elsewhere, when one of their addresses is its author's name.
    const author = pull.user?.login?.toLowerCase()
    const mine = target.host
      ? Boolean(author && (this.options.hostWays?.(target)?.emails ?? []).includes(author))
      : Boolean(viewer.login && author && viewer.login.toLowerCase() === author)
    return { mine, method: method ?? 'merge', base: pull.base?.ref ?? 'its base branch', head: pull.head?.sha ?? null, ref: pull.head?.ref ?? null, defaultBranch: settings.default_branch ?? null }
  }

  /**
   * A layer of a stack merges after the ones under it: GitHub merges them together or refuses, so a pull request whose
   * base is another open pull request's branch is refused here, naming the layers under it, before anything is sent.
   * A read that fails says nothing, and GitHub has its own say.
   */
  private async layersUnder(target: PullTarget, { base, head, defaultBranch }: { base: string; head: string | null; defaultBranch: string | null }): Promise<void> {
    const api = this.apiFor(target)
    if (!api || target.host || !head || !defaultBranch || base === defaultBranch) return
    let layers
    try {
      layers = await pullLayers(api, { owner: target.owner, repo: target.repo, base, head, defaultBranch })
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)} could not read the pull requests under it: ${messageOf(error)}`)
      return
    }
    if (layers.below.length) throw new Unavailable(`#${target.number} is layer ${layers.below.length + 1} of ${layers.of}: merge ${layerNames(layers.below)} first.`)
  }

  /** What moved on a pull request since its review, in a line: from a checkout of it when the host has one. */
  private async pullMovedWords(target: PullTarget, from: string, to: string, base: string): Promise<string> {
    const at = to.slice(0, 7)
    if (!this.options.pullMoved) return `Since this review it moved to ${at}.`
    try {
      return movedWords(await this.options.pullMoved(target, from, to), base, at)
    } catch (error) {
      this.options.log?.(`Review ${reviewIdOf(target)} could not say what moved: ${messageOf(error)}`)
      return `Since this review it moved to ${at}.`
    }
  }

  /**
   * Does a verdict the user confirmed: only when `confirm` is the token of exactly what they were shown, and `head`,
   * when given, the commit of the review they were shown. A pull request gets one GitHub review through gh, and
   * approve and merge merges it too; a finished change gets one of hobkin's own work actions.
   */
  async verdict(id: string, verdict: Verdict, summary: string, confirm: string, head?: string): Promise<{ message: string }> {
    // One verdict at a time on a review, from however many windows: the same yes again joins the one under way.
    const key = reviewIdOf(this.target(id))
    const under = this.deciding.get(key)
    if (under) {
      if (under.confirm === confirm) return under.done
      throw new Unavailable('Another verdict on this review is under way. Wait for it to end, then look again.')
    }
    const done = this.decide(id, verdict, summary, confirm, head)
    this.deciding.set(key, { confirm, done })
    try {
      const said = await done
      // The user's word on this commit of hobkin's own change: hobkin sends nothing of its own for it.
      const target = this.target(id)
      if (target.kind === 'change') this.answered(target, this.loaded(id).review.change.head)
      return said
    } finally {
      this.deciding.delete(key)
    }
  }

  private async decide(id: string, verdict: Verdict, summary: string, confirm: string, head?: string): Promise<{ message: string }> {
    if (verdict !== 'approve-merge') return this.give(id, verdict, summary, confirm, head)
    // A merge the user asked for is kept until it happens: one that is refused, or that waits for something first,
    // stays in the list with why, so a yes that did not land is never lost from sight.
    const target = this.target(id)
    const at = new Date(this.now()).toISOString()
    try {
      const { waiting, ...done } = await this.give(id, verdict, summary, confirm, head)
      // A named host merges in its own time: the merge waits, with what the host does, until the host has closed it.
      if (waiting != null) {
        this.options.store.saveMergeAsked(target, { at, state: 'waiting', message: waiting, confirm })
        this.options.onChange?.()
        return done
      }
      const waits = this.landingOf(target)?.state === 'refreshing'
      this.options.store.saveMergeAsked(target, waits ? { at, state: 'waiting' } : null)
      // Merged: it leaves the list of reviews, so nothing stays on screen that reads as if it had not gone through, and
      // an AI review still waiting or running for it stops.
      if (!waits) {
        this.options.store.saveLanded(target, at)
        if (this.closedOn(target)) this.retire(id, target)
      }
      this.options.onChange?.()
      return done
    } catch (error) {
      // What was never sent, because it was not what the user was shown, is no merge they asked for.
      if (!(error instanceof Unavailable && /has changed since it was shown/.test(error.message))) {
        this.options.store.saveMergeAsked(target, { at, state: 'failed', why: messageOf(error) })
        // It is not merged, whatever was recorded before, so it is listed, at the top, with why.
        this.options.store.saveLanded(target, null)
        this.options.onChange?.()
      }
      throw error
    }
  }

  /** The merge the user asked for that has not happened, or undefined: one that waited is done once the change has merged. */
  private mergeAskedOf(target: ReviewTarget, landing: ReviewLanding | null): MergeAsked | undefined {
    const stored = this.options.store.mergeAsked(target)
    if (!stored) return undefined
    // The confirmation it was asked with stays in the host: the window is shown what waits, and why.
    const { confirm: _confirm, ...asked } = stored
    if (landing?.state !== 'merged') return asked
    this.options.store.saveMergeAsked(target, null)
    return undefined
  }

  private async give(id: string, verdict: Verdict, summary: string, confirm: string, head?: string): Promise<{ message: string; waiting?: string }> {
    // Done with what the token was checked against: a review prepared again meanwhile is never the one acted on.
    const { preview, review, card, publication, merge, plan, done, discard } = await this.planned(id, verdict, summary, head)
    if (preview.confirm !== confirm) throw new Unavailable('What would be sent has changed since it was shown. Look at it again before sending.')
    const target = this.target(id)
    if (done) return { message: done }
    if (discard) return this.discarded(id, target, discard)

    if (target.kind === 'pull') {
      const where = target.host ?? 'GitHub'
      const api = this.apiFor(target)
      if (!api) throw new Unavailable(`This host posts nothing to ${where}.`)
      const name = `${target.owner}/${target.repo}#${target.number}`
      const post = async (body: PullReviewPost) => {
        const answer = await api({ method: 'POST', path: `repos/${target.owner}/${target.repo}/pulls/${target.number}/reviews`, body })
        // The comments went with it, so they are never sent twice, and neither is anything this yes posts.
        this.posted.add(confirm)
        this.markSent(target, verdict)
        return (JSON.parse(answer || '{}') as { html_url?: string }).html_url
      }
      if (merge?.asks) {
        // The review first, then the pull request read again: the merge is asked only at the commit shown.
        const posted = merge.post && !this.posted.has(confirm) ? await post(merge.post) : null
        const went = merge.post ? (merge.mine ? 'Your comment went' : 'It was approved') : null
        const now = (JSON.parse(await api({ path: `repos/${target.owner}/${target.repo}/pulls/${target.number}` })) as { head?: { sha?: string } }).head?.sha
        if (!now || now !== merge.head) throw new Error(`${went ? `${went} on ${where}, but ` : ''}${name} moved to ${(now ?? 'another commit').slice(0, 7)} before its merge was asked, so the merge comment was not posted.`)
        // The same yes again asks nothing more: one merge comment for one confirmation.
        if (this.options.store.mergeAsked(target)?.confirm !== confirm) await api({ method: 'POST', path: `repos/${target.owner}/${target.repo}/issues/${target.number}/comments`, body: { body: merge.asks.comment } })
        const after = merge.asks.after ?? `${where} merges it in its own time.`
        return { message: `Asked ${where} to merge ${name}${went ? (merge.mine ? ', after your comment' : ', after approving it') : ''}. ${after}${posted ? ` ${posted}` : ''}`.trim(), waiting: after }
      }
      if (merge) {
        // A merge that failed after its review went is tried again with that same yes: the review does not go twice.
        const posted = merge.post && !this.posted.has(confirm) ? await post(merge.post) : null
        try {
          // `sha` is the commit the preview showed: GitHub refuses the merge if the pull request has moved since.
          const body = { sha: merge.head, merge_method: merge.method }
          try {
            await api({ method: 'PUT', path: `repos/${target.owner}/${target.repo}/pulls/${target.number}/merge`, body })
          } catch (error) {
            // The bottom of a stack GitHub keeps for its own endpoint, which merges it and says when it is done.
            if (!/asynchronous merge endpoint/i.test(messageOf(error))) throw error
            const queued = await this.mergedAsync(api, target, body)
            if (queued) return { message: `${queued} ${name} waits there.`, waiting: queued }
          }
        } catch (error) {
          if (merge.post) throw new Error(`${merge.mine ? 'Your comments went' : 'It was approved'} on GitHub, but it was not merged: ${messageOf(error)}`)
          throw error
        }
        const before = merge.post ? (merge.mine ? ', after your comments' : ', after approving it') : ''
        this.merged(id)
        return { message: `Merged ${name} into ${merge.base}${before}.${posted ? ` ${posted}` : ''}` }
      }
      if (this.posted.has(confirm)) throw new Unavailable('This was posted already, so it is not posted again.')
      const posted = await post(preview.post!)
      return { message: `Posted to ${where}${posted ? `: ${posted}` : '.'}` }
    }

    if (publication) {
      const { url } = await this.options.publish!.open(publication.plan, publication.pull)
      return { message: `Opened ${url}` }
    }
    const said =
      verdict === 'approve-merge'
        ? await this.options.work().workAction(plan?.route ?? card!.landing, target.slug, target.item, { head: plan?.head ?? review.change.head })
        : await this.options.work().workAction('ask', target.slug, target.item, preview.note ?? '')
    this.markSent(target, verdict)
    if (verdict === 'approve-merge') this.merged(id)
    return { message: String((said as { message?: unknown } | null)?.message ?? 'Done.') }
  }

  /**
   * Merges a pull request through GitHub's asynchronous merge, pinned to `sha`, and follows its result until GitHub says
   * merged or refused, asking again after a wait that leaves the host free. Null once merged; the words of a merge that
   * was put in a queue, which is as far as GitHub says.
   */
  private async mergedAsync(api: HostApi, target: PullTarget, body: { sha: string; merge_method: MergeMethod }): Promise<string | null> {
    const path = `repos/${target.owner}/${target.repo}/pulls/${target.number}/merge-async`
    type Result = { status?: string; details?: { uuid?: string; message?: string } }
    let result = JSON.parse((await api({ method: 'PUT', path, body })) || '{}') as Result
    const uuid = result.details?.uuid
    while (result.status === 'pending') {
      if (!uuid) throw new Error('GitHub took the merge but gave no way to follow it. Look at the pull request on GitHub.')
      await new Promise((resolve) => setTimeout(resolve, this.options.mergePollMs ?? 2000))
      result = JSON.parse(await api({ path: `${path}/${uuid}` })) as Result
    }
    if (result.status === 'merged') return null
    if (result.status === 'enqueued') return result.details?.message ?? 'GitHub put it in its merge queue.'
    throw new Error(result.details?.message ?? `GitHub did not merge it (${result.status ?? 'no answer'}).`)
  }

  /**
   * The no the user confirmed. A pull request is closed on GitHub without merging, first, so a no never leaves one open
   * behind it. A finished change then gets hobkin's own no, the one its card gives. With `discard-branch` the branch goes
   * last: a pull request's head branch on GitHub, or the change's own branch, which hobkin deletes exactly as it was shown.
   * A step that fails says what was already done and stops there. Once the no went, the review leaves the list and is
   * kept in the home, as a merged one is, with the notes written on it. A change hobkin is done with gets no no: it only
   * leaves the list. `remove` is what deletes a review.
   */
  private async discarded(id: string, target: ReviewTarget, { pull, comment, branch, deletes, declines = true }: Discard): Promise<{ message: string }> {
    const closed = pull ? await this.closePull(pull, comment) : null

    const leave = () => {
      // What closed on GitHub leaves the lists at once, as what merged does, and no AI review runs for it any more.
      if (pull) this.merged(id)
      this.options.store.saveLanded(target, new Date(this.now()).toISOString())
      if (target.kind === 'pull') this.retire(id, target)
      this.options.onChange?.()
    }
    let said = closed ?? 'Removed.'
    if (target.kind === 'pull' && pull && branch) {
      const done = said.replace(/\.$/, '')
      try {
        await this.deleteHeadBranch(target, branch)
      } catch (error) {
        leave()
        throw new Error(`${done}, but its branch ${branch.ref} was not deleted: ${messageOf(error)}`)
      }
      said = `${done}, and deleted its branch ${branch.ref}.`
    }
    if (target.kind === 'change') {
      if (declines) {
        let answer: unknown
        try {
          answer = await this.options.work().workAction('decline', target.slug, target.item)
        } catch (error) {
          if (closed) throw new Error(`Its pull request was closed on GitHub, but hobkin did not take the no: ${messageOf(error)}`)
          throw error
        }
        const no = String((answer as { message?: unknown } | null)?.message ?? 'Said no to it.')
        said = closed ? `${no} ${closed}` : no
      } else said = 'hobkin was done with this change already, so it only left the list.'
      if (deletes) {
        const done = !declines ? 'It left the list' : closed ? `${closed} hobkin took the no` : 'hobkin took the no'
        try {
          const gone = await this.options.work().workAction('deleteBranch', target.slug, target.item, { expect: deletes })
          said = `${done}. ${String((gone as { message?: unknown } | null)?.message ?? `Deleted ${deletes.branch}.`)}`
        } catch (error) {
          leave()
          throw new Error(`${done}, but its branch was not deleted: ${messageOf(error)}`)
        }
      }
    }
    leave()
    return { message: said }
  }

  /**
   * Deletes a closed pull request's head branch, as the user, only while it is at the commit shown: on GitHub through gh,
   * on a named host with git, the way its code host file allows.
   */
  private async deleteHeadBranch(target: ReviewTarget, { ref, sha, repo }: PullBranch): Promise<void> {
    if (target.kind === 'pull' && target.host) {
      const ways = this.options.hostWays?.(target)
      if (!ways) throw new Unavailable(`${target.host} gives hobkin no way to delete a branch there.`)
      return ways.deleteBranch(ref, sha)
    }
    const { gh } = this.options
    if (!gh) throw new Unavailable('This host posts nothing to GitHub.')
    const body = JSON.stringify({ query: DELETE_REF, variables: { repo, name: `refs/heads/${ref}`, before: sha } })
    const answer = await ghText(gh, ['api', '--hostname', 'github.com', '--method', 'POST', 'graphql', '--input', '-'], body)
    // GitHub answers a refused update with its reasons beside the data.
    const errors = (JSON.parse(answer || '{}') as { errors?: { message?: string }[] }).errors ?? []
    if (errors.length > 0) throw new Error(errors.map((error) => error.message ?? 'GitHub refused it.').join(' '))
  }

  /** Closes a pull request without merging it, as the user, through its own host, with their words as a comment first. */
  private async closePull(pull: PullPlace & { named: string }, comment: string | null): Promise<string> {
    const where = pull.host ?? 'GitHub'
    const api = this.apiFor({ kind: 'pull', owner: pull.owner, repo: pull.repo, number: pull.number, ...(pull.host ? { host: pull.host } : {}) })
    if (!api) throw new Unavailable(`This host posts nothing to ${where}.`)
    const send = (method: 'POST' | 'PATCH', path: string, body: unknown) => api({ method, path: `repos/${pull.owner}/${pull.repo}/${path}`, body })
    if (comment) await send('POST', `issues/${pull.number}/comments`, { body: comment })
    try {
      await send('PATCH', `pulls/${pull.number}`, { state: 'closed' })
    } catch (error) {
      if (comment) throw new Error(`Your comment went on ${where}, but it was not closed: ${messageOf(error)}`)
      throw error
    }
    return `Closed ${pull.named}${pull.host ? ` on ${pull.host}` : ''} without merging it.`
  }

  /** Tells the host something merged. What it does next never undoes the merge. */
  private merged(id: string) {
    try {
      this.options.onMerged?.(this.target(id))
    } catch (error) {
      this.options.log?.(`Review ${id}: what follows its merge failed: ${messageOf(error)}`)
    }
  }

  /** Where a finished change's pull request would go, and what it would say. Refused, with the reason, when it cannot have one. */
  private async publication(slug: string, card: ChangeCard, review: Review, producerVersion?: string | null): Promise<Publication> {
    if (card.pr) throw new Unavailable(`The pull request for this change is already open: ${card.pr}. Approve and merge it, or ask for changes.`)
    if (!this.options.publish) throw new Unavailable('This host cannot open pull requests.')
    if (!card.branch) throw new Unavailable('This change has no branch to push.')
    let plan: PublishPlan
    try {
      plan = await this.options.publish.plan(slug, card.branch)
    } catch (error) {
      throw new Unavailable(messageOf(error))
    }
    const { head, base, branch } = review.change
    const body = agentMessage({ summary: review.summary, version: producerVersion, details: `Branch: ${branch}\nBase: ${base}\nReviewed commit: ${head}` })
    return { plan, pull: { head, title: review.change.title, body } }
  }

  /**
   * A verdict that went takes its comments with it: they are marked sent, so they are never sent twice. A pull request
   * takes only the user's own, so hobkin's notes stay unsent. Talk to agent on a finished change takes the user's
   * questions to discuss too.
   */
  private markSent(target: ReviewTarget, verdict: Verdict) {
    if ((verdict === 'approve' || verdict === 'approve-merge') && target.kind === 'change') return
    const saved = this.options.store.notes(target)
    const at = (this.options.now ?? Date.now)()
    const discussed = target.kind === 'change' && verdict === 'request-changes'
    const comment = (note: Note) => note.intent === 'comment' && (target.kind === 'change' || note.author !== 'hobkin')
    const question = (note: Note) => discussed && note.intent === 'question' && note.author !== 'hobkin'
    const took = (note: Note) => note.sent == null && (comment(note) || question(note))
    const entries = foldNotes(saved.entries as NoteEntry[]).map((note) => ({ op: 'put' as const, note: took(note) ? { ...note, sent: at } : note }))
    this.options.store.saveNotes(target, { entries, draft: saved.draft })
  }

  /**
   * Prepares in the background what will be reviewed: finished changes, and the pull requests the user's setting names.
   * Each version of one is looked at once: a change at a commit with no review yet is prepared, a change whose AI review
   * was cut short is started again, and a pull request that changed on GitHub since its review is looked at again. A
   * finished change is at the commit its branch is at, asked of git at most once a minute, even while its card names an
   * older one. No more than `limit` wait or run at a time, so the rest are looked at as those finish. A failure is not
   * tried again until the change moves.
   */
  watch(wanted: readonly Watched[], limit = 3): void {
    // The host calls this as it publishes its state: the moment to see which reviewed pull requests have closed, and
    // to stop what waits or runs for a change that merged since it was queued.
    void this.sweepPulls().catch((error: unknown) => this.options.log?.(`Reviews: asking GitHub which pull requests closed failed: ${messageOf(error)}`))
    try {
      this.retireClosed()
    } catch (error) {
      this.options.log?.(`Reviews: stopping the reviews of merged changes failed: ${messageOf(error)}`)
    }
    this.watchRisk(wanted)
    this.finished = new Set(wanted.flatMap(({ id }) => (id.startsWith('change:') ? [id] : [])))
    this.watchedPulls = new Set(wanted.flatMap(({ id }) => (targetOfReviewId(id)?.kind === 'pull' ? [id] : [])))
    this.pullsWithoutHead = new Set(wanted.flatMap(({ id, head }) => (!head && this.watchedPulls.has(id) ? [id] : [])))
    this.pullsWithoutTimes = new Set(wanted.flatMap(({ id, openedAt, pushedAt }) => (!openedAt && !pushedAt && this.watchedPulls.has(id) ? [id] : [])))
    this.line = this.lineFor(wanted)
    this.grade(wanted)
    this.dropAtWork()
    this.followBranches(wanted, limit)
    for (const entry of wanted) {
      if (this.queue.length + this.running.size >= limit) return
      this.watchOne(entry)
    }
  }

  /**
   * Asks git where each finished change's branch is, at most once a minute for each, and looks at the change again as
   * soon as git answers, so a branch an agent moved is reviewed at its new commit while its card names the older one.
   */
  private followBranches(wanted: readonly Watched[], limit: number) {
    const now = this.now()
    for (const entry of wanted) {
      if (!entry.id.startsWith('change:')) continue
      const last = this.lookedAt.get(entry.id)
      if (last != null && now - last < LOOK_AGAIN_MS) continue
      void this.lookAgain(entry.id, () => now)
        .then(() => {
          if (this.queue.length + this.running.size < limit) this.watchOne(entry)
        })
        .catch((error: unknown) => this.options.log?.(`Review ${entry.id}: looking up its branch failed: ${messageOf(error)}`))
    }
  }

  /**
   * Each repository's line of the finished changes handed in Work's order. One that cannot be worked out is no line:
   * every finished change is then reviewed by itself, as before there was one, and the host's log says why.
   */
  private lineFor(wanted: readonly Watched[]): Line {
    try {
      const weighed = wanted.flatMap((entry): LineChange[] => {
        const target = targetOfReviewId(entry.id)
        if (!target) return []
        // A pull request the workload names waits in its repository's line, as a change does.
        if (target.kind === 'pull') {
          // One of hobkin's own, or one hobkin cannot tell yet, is never built by itself, so it takes no place.
          if (this.options.ownPull && this.options.ownPull(target) !== false) return []
          const name = `${target.owner}/${target.repo}`
          // GitHub's list names its commit; an older list does not, and then it is the one this host last read of it.
          const head = entry.head ?? this.statuses.get(entry.id)?.head ?? this.lookedHead.get(entry.id) ?? this.options.store.latest(target)?.review.change.head ?? null
          const reviewed = this.reviewFinished(target, head)
          const failedAt = this.failedBuild(target, head)?.at
          // Its clock: when it was opened or its head committed, the later one not after now. A comment moves neither.
          const times = [entry.openedAt, entry.pushedAt].map((time) => Date.parse(time ?? '')).filter((time) => Number.isFinite(time) && time <= this.now())
          const at = times.length ? new Date(Math.max(...times)).toISOString() : entry.updatedAt
          return [{ id: entry.id, repo: `pull:${target.host ?? ''}:${name}`, name, reviewed, ...(at ? { at } : {}), ...(failedAt ? { failedAt } : {}) }]
        }
        const refreshing = this.landingOf(target)?.state === 'refreshing'
        // Its clock is when it finished; hobkin's own time, which any write resets, only while that cannot be read.
        const at = this.options.finishedAt?.(target, entry.head ?? null) ?? entry.at
        const reviewed = this.reviewFinished(target, entry.head ?? null)
        const failedAt = this.failedBuild(target, entry.head ?? null)?.at
        return [{ id: entry.id, repo: target.slug, name: entry.project ?? target.slug, grade: entry.grade ?? null, conflict: entry.conflict ?? null, refreshing, reviewed, ...(at ? { at } : {}), ...(failedAt ? { failedAt } : {}) }]
      })
      // The place for the longest wait spends at most half the day's number, so what finishes today is reviewed today.
      const longest = this.builtToday().aged < Math.floor(this.dayLimit() / 2)
      const kept = this.options.keepCurrent?.()
      return lineOf(weighed, { keep: kept === undefined ? KEPT_CURRENT : kept, now: this.now(), longest })
    } catch (error) {
      this.options.log?.(`Reviews: the line of each repository could not be worked out, so everything handed in is reviewed as before: ${messageOf(error)}`)
      return { current: new Set(wanted.map((entry) => entry.id)), aged: new Set(), waits: new Map() }
    }
  }

  /** Whether hobkin closed a change or no longer has it, as its items say. One that cannot be read is not. */
  private isClosed(target: ChangeTarget): boolean {
    try {
      return this.options.closed?.(target) ?? false
    } catch {
      return false
    }
  }

  /** Whether an agent works on a change again, as hobkin's items say. One that cannot be read is not. */
  private isBackAtWork(target: ChangeTarget): boolean {
    try {
      return this.options.backAtWork?.(target) ?? false
    } catch {
      return false
    }
  }

  /**
   * Drops the review that only waits its turn for a change an agent works on again: its graph's place in the queue, and
   * its change review's. What is under way goes on, and one the user asked for is never dropped.
   */
  private dropAtWork() {
    if (!this.options.backAtWork) return
    const dropped = (target: ReviewTarget): target is ChangeTarget => {
      const id = reviewIdOf(target)
      return target.kind === 'change' && !this.finished.has(id) && !this.userAsked.has(id) && this.isBackAtWork(target)
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const { target } = this.queue[index]!
      if (!dropped(target)) continue
      const id = reviewIdOf(target)
      this.queue.splice(index, 1)
      this.say(id, `Dropped: ${AT_WORK}`)
      this.set(id, { state: this.options.store.newest(target) ? 'ready' : 'idle', phase: null })
    }
    for (const target of this.options.assessments?.pending() ?? []) if (dropped(target)) this.options.assessments!.unqueue(target, AT_WORK)
  }

  /**
   * The user's five questions answered for a review (spec 058): the change review's own at the commit, and hobkin's
   * scored run's from the change's card, each saying who made it. Empty when neither rated it.
   */
  private needsOf(target: ReviewTarget, head: string | null, shownAt: string | null, carried?: { from: string }): ReviewNeeds[] {
    // A change review of an older host, or a stand-in, may not answer it: then the review is not rated by it.
    const own = head ? (this.options.assessments?.needsOf?.(target, head, this.startFor(reviewIdOf(target), head)?.start) ?? null) : null
    const hobkins = target.kind === 'change' ? (this.options.card(target.slug, target.item)?.hobkinNeeds ?? null) : null
    return [own, hobkins].filter((needs): needs is ReviewNeeds => needs != null).map((needs) => {
      // A rating always names the commit it was made at; one made at another than its row's says which (spec 058).
      if (!shownAt || needs.head === shownAt) return needs
      const [rated, now] = [needs.head.slice(0, 7), shownAt.slice(0, 7)]
      const atOtherCommit =
        needs.by === 'change-review' && carried?.from === needs.head ? `Rated at ${rated}, where this review was built, before it was carried to ${now}.` : `Rated at ${rated}; the change is at ${now} now.`
      return { ...needs, atOtherCommit }
    })
  }

  /**
   * Where a review's five ratings stand at the commit the change is at (spec 063): always one of rated, rating now, waiting its
   * turn, rating again, not rated after the tries, or nothing to rate. The change review's own ratings only; hobkin's scored
   * run's are no rating of this review and are left out.
   */
  private ratingFor(target: ReviewTarget, head: string | null, assessment: AssessmentStatus | undefined, turn: ReviewTurn | undefined, needs: readonly ReviewNeeds[]) {
    const notRated = head ? (this.options.assessments?.notRatedOf?.(target, head, this.startFor(reviewIdOf(target), head)?.start) ?? undefined) : undefined
    const running = assessment?.state === 'queued' || assessment?.state === 'running'
    const files = head ? this.options.store.read(target, head)?.review.files : undefined
    const nothingToRate = files != null && files.length > 0 && files.every((file) => MARKDOWN.test(file.path))
    return ratingOf({ head, needs, running, ...(turn ? { turn } : {}), ...(notRated ? { notRated } : {}), tries: this.options.ratingTries?.() ?? 3, nothingToRate })
  }

  /** Tells the bridge each finished change's ratings that were made at the commit it is at, so YOLO mode reads the numbers the user sees. */
  private grade(wanted: readonly Watched[]) {
    const { graded, assessments } = this.options
    if (!graded || !assessments?.needsOf) return
    for (const entry of wanted) {
      const target = targetOfReviewId(entry.id)
      if (target?.kind !== 'change') continue
      const head = this.headOf(entry.id, entry.head ?? null)
      const range = this.startFor(entry.id, head)
      // A stored score may predate a retarget at this same commit. Never publish it before checking its range.
      if (this.options.sources.change.start && (!range || range.stale)) continue
      const needs = head ? assessments.needsOf(target, head, range?.start) : null
      if (head && needs && needs.head === head) graded(target, head, needs)
    }
  }

  /**
   * A change that moved keeps its review when it still holds at the new commit: carried there, its tests run once and
   * no model asked. When it does not hold, or the carry fails, it is built again, and the log says why.
   */
  private carryOrBuild(id: string, target: ChangeTarget, head: string) {
    if (this.carrying.has(id)) return
    this.carrying.add(id)
    this.say(id, `Checking whether its review still holds at ${head.slice(0, 7)}.`)
    const build = (why: string) => {
      if (!this.dayHasRoom()) {
        // Looked at again tomorrow, when the day has room.
        this.watched.delete(id)
        return
      }
      this.options.log?.(`Review ${id} at ${head.slice(0, 7)} is built again: ${why}`)
      this.countBuilt()
      this.prepare(id)
    }
    void this.options.carry!(target, head)
      .then(
        (carried) => {
          if (!carried.carried) return build(carried.why)
          this.options.log?.(`Review ${id} carried from ${carried.from.slice(0, 7)} to ${head.slice(0, 7)}: ${carried.why}`)
          this.say(id, `Carried from ${carried.from.slice(0, 7)}: ${carried.why}`)
          this.set(id, { state: 'ready', phase: null, stale: false, head, preparedAt: new Date(this.now()).toISOString() })
        },
        (error: unknown) => build(`its carry failed: ${messageOf(error)}`),
      )
      .finally(() => this.carrying.delete(id))
  }

  /**
   * Whether a review is as it would be built again now: ready at the commit its change is at, from the same start, and
   * its change review finished there. A host with no change reviews draws only graphs, which cost nothing to draw again.
   */
  private nothingChangedSince(target: ReviewTarget, status: ReviewStatus): boolean {
    const { assessments, store } = this.options
    const { head } = status
    if (!assessments || !head || status.stale || status.phase || !store.has(target, head)) return false
    if (status.startsAt && store.read(target, head)?.review.change.base !== status.startsAt) return false
    return assessments.status(target, head, status.startsAt).state === 'ready'
  }

  /**
   * Why an ask from hobkin's agent is not built now, or undefined when it is: a change or a watched pull request out of
   * its line waits its turn there, and past the day's number anything waits for midnight. One in no line takes a place
   * of the day's number.
   */
  private agentWaits(id: string, target: ReviewTarget, now: ReviewStatus): ReviewTurn | undefined {
    const inSomeLine = this.line.current.has(id) || this.line.waits.has(id)
    if (inSomeLine && !this.line.current.has(id)) return this.turnOf(id, target, now.head) ?? this.line.waits.get(id)
    if (!this.dayHasRoom()) return { ahead: 0, why: `Today's ${this.dayLimit()} background reviews are spent, so the next is built after midnight.` }
    return undefined
  }

  /** The local day a time is on, as `YYYY-MM-DD`. */
  private dayOf(time: number): string {
    return new Date(time).toLocaleDateString('en-CA')
  }

  /** How many reviews the background may build by itself today: the rule's whole number, Infinity for none, else twenty. */
  private dayLimit(): number {
    const set = this.options.reviewsADay?.()
    if (set === null) return Number.POSITIVE_INFINITY
    return Number.isInteger(set) && (set as number) >= 1 ? (set as number) : REVIEWS_A_DAY
  }

  /** How many the background built by itself today, as the ledger kept it when the day began here. */
  private builtToday(): DayCount & { aged: number } {
    const day = this.dayOf(this.now())
    if (this.dayCount?.day === day) return this.dayCount as DayCount & { aged: number }
    let kept: DayCount | null = null
    try {
      kept = this.options.dayLedger?.read() ?? null
    } catch (error) {
      this.options.log?.(`Reviews: the day's count of background reviews could not be read, so it starts at none: ${messageOf(error)}`)
    }
    const today = kept?.day === day
    const whole = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0)
    const counted = { day, built: today ? whole(kept!.built) : 0, aged: today ? whole(kept!.aged) : 0 }
    this.dayCount = counted
    return counted
  }

  /** Whether the background may build one more review by itself today. */
  private dayHasRoom(): boolean {
    return this.builtToday().built < this.dayLimit()
  }

  /** Counts one review the background builds by itself today, and whether it is in the place for the longest wait, and keeps the count. */
  private countBuilt(aged = false) {
    const today = this.builtToday()
    today.built += 1
    if (aged) today.aged += 1
    try {
      this.options.dayLedger?.write({ ...today })
    } catch (error) {
      this.options.log?.(`Reviews: the day's count of background reviews could not be kept: ${messageOf(error)}`)
    }
  }

  /**
   * Whether a target's review at this commit has finished: its graph is drawn and its change review, where one runs,
   * is ready or failed. Until then a change keeps the place for the longest wait.
   */
  private reviewFinished(target: ReviewTarget, head: string | null): boolean {
    if (head == null || !this.options.store.has(target, head) || this.preparing(reviewIdOf(target))) return false
    const start = this.startFor(reviewIdOf(target), head)
    if (start?.stale) return false
    if (!this.reviewsChange(target)) return true
    const state = this.options.assessments!.status(target, head, start?.start).state
    return state === 'ready' || state === 'failed'
  }

  /** The last failed build of a target that still holds at this commit: none once a review was built there. */
  private failedBuild(target: ReviewTarget, head: string | null): BuildFailed | null {
    const id = reviewIdOf(target)
    if (!this.failures.has(id)) {
      try {
        this.failures.set(id, this.options.store.buildFailed(target))
      } catch (error) {
        this.options.log?.(`Review ${id}: its last failed build could not be read, so it is tried as before: ${messageOf(error)}`)
        this.failures.set(id, null)
      }
    }
    const failed = this.failures.get(id) ?? null
    if (!failed || (failed.head != null && failed.head !== head)) return null
    return head != null && this.options.store.has(target, head) ? null : failed
  }

  /** Keeps a failed build, or forgets one once a review is built. A record that cannot be kept is said in the log. */
  private keepFailure(target: ReviewTarget, failed: BuildFailed | null) {
    const id = reviewIdOf(target)
    if (!failed && !this.failures.get(id)) return
    this.failures.set(id, failed)
    try {
      this.options.store.saveBuildFailed(target, failed)
    } catch (error) {
      this.options.log?.(`Review ${id}: its failed build could not be kept, so a restart tries it again: ${messageOf(error)}`)
    }
  }

  /** Why a change waits instead of being built by itself, and how many are ahead of it in its repository's line. */
  private turnOf(id: string, target: ReviewTarget, head: string | null): ReviewTurn | undefined {
    if (this.preparing(id)) return undefined
    // A pull request the workload does not name waits for the user's Start AI review.
    if (target.kind === 'pull' && !this.watchedPulls.has(id)) return { ahead: 0, why: PULL_ASKED }
    if (target.kind === 'change' && !this.finished.has(id)) return this.isBackAtWork(target) ? { ahead: 0, why: AT_WORK } : undefined
    const waits = this.line.waits.get(id) ?? (this.line.current.has(id) && !this.dayHasRoom() ? { ahead: 0, why: `Today's ${this.dayLimit()} background reviews are spent, so the next is built after midnight.` } : undefined)
    if (!waits) return undefined
    // What waits gets no review, and so no agent goes back to it by itself: the row says so (spec 058).
    const unchecked = head != null && this.options.store.newest(target) ? ' Its review is of an older commit, so nothing checks this one by itself.' : ' Not reviewed yet, so nothing checks it by itself.'
    const read = this.statuses.get(id)?.head ?? this.lookedHead.get(id)
    const list = `${(target.kind === 'pull' && target.host) || 'GitHub'}'s list`
    const unnamed = !this.pullsWithoutHead.has(id)
      ? ''
      : read
        ? ` ${list} did not say its commit, so the line goes by ${read.slice(0, 7)}, the one hobkin last read.`
        : ` ${list} did not say its commit, and hobkin has read none of it yet.`
    const untimed = !this.pullsWithoutTimes.has(id)
      ? ''
      : `${unnamed ? ' Nor did it say' : ` ${list} did not say`} when it was opened or pushed, so its wait counts from its last update there.`
    return { ahead: waits.ahead, why: `${waits.why}${unchecked}${unnamed}${untimed}` }
  }

  /** The background's look at one thing to prepare, at the version it is at now. Never throws: the host publishes around it. */
  private watchOne({ id, head: card = null, updatedAt = null }: Watched) {
    const { store } = this.options
    try {
      const target = targetOfReviewId(id)
      if (!target) return
      // A finished change, or a pull request the workload names, is built by itself only in its repository's line (spec 058).
      if (!this.line.current.has(id)) return
      // At the day's number of background builds, nothing more is built by itself until midnight.
      if (!this.dayHasRoom()) return
      const head = target.kind === 'change' ? this.headOf(id, card) : card
      const version = versionOf(head, updatedAt)
      // A build that failed here is tried again once a day has passed, in its turn, and not before.
      const failed = this.failedBuild(target, head)
      if (failed && this.now() - Date.parse(failed.at) < FAILED_WAITS_MS) return
      if ((this.watched.get(id) === version && !failed) || this.statuses.get(id)?.phase) return
      // A change being brought up to date or merged on the user's word is not reviewed again for its new commit, and a
      // pull request closed on its host is not reviewed at all.
      if (this.landingOf(target) || this.closedOn(target)) return
      // A pull request of hobkin's own change is reviewed as that change, never again by itself; one that cannot be told yet waits.
      const own = target.kind === 'pull' && this.options.ownPull ? this.options.ownPull(target) : false
      if (own === null) return
      this.watched.set(id, version)
      if (own) return
      const newest = store.newest(target)
      const newBase = this.startFor(id, head)?.stale === true
      const moved = head ? !store.has(target, head) || newBase : updatedAt ? Date.parse(updatedAt) > (newest?.at ?? 0) : false
      if (newest && moved && !newBase && head && target.kind === 'change' && this.options.carry) this.carryOrBuild(id, target, head)
      else if (!newest || moved) {
        this.countBuilt(this.line.aged.has(id))
        this.prepare(id)
      } else if (target.kind === 'change' && head && this.assessmentDue(target, head)) {
        // Never started at this commit, or cut short by a quit or a crash: it starts, once.
        const stored = store.read(target, head)
        if (stored) {
          this.countBuilt(this.line.aged.has(id))
          this.assess(target, stored.review)
        }
      }
    } catch (error) {
      this.options.log?.(`Review ${id} was not prepared in the background: ${messageOf(error)}`)
    }
  }

  close(): void {
    this.controller.abort()
    this.queue.length = 0
    this.options.assessments?.close()
  }
}

/** Whether `step` is a step of the review, numbered from 1. */
function isStepNumber(step: number, review: Review): boolean {
  return Number.isInteger(step) && step >= 1 && step <= review.story.length
}

/** A change review's status as a list shows it: the steps and the log are for the review that is open. */
function forList({ steps: _steps, log: _log, ...status }: AssessmentStatus): AssessmentStatus {
  return status
}

/** Both sides of every file the review points into: the change's own, and the unchanged files context reads. */
function filesOf(captured: readonly { id: string; path: string; oldPath?: string; base: string | null; head: string | null; binary: boolean }[], headFiles: ReadonlyMap<string, string>, review: Review): ReviewFileContents[] {
  return review.files.map((file) => {
    const found = captured.find((entry) => entry.id === file.id)
    if (found) return { fileId: file.id, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), base: found.base, head: found.head, binary: found.binary }
    const text = headFiles.get(file.path) ?? null
    return { fileId: file.id, path: file.path, base: text, head: text, binary: false }
  })
}
