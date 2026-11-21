/**
 * Change Review's place in the host: where its changes are read from, what is prepared in the background, the change
 * review that tells each one, and the commands the window runs. Specs: 005-review-model (S6), 009-review-notes,
 * 024-github, 032-change-review.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths, readItems, readProject, readProjects } from 'hobkin/src/cli/work/store.mjs'
import { defaultBranch } from 'hobkin/src/cli/work/tree.mjs'
import type { GitHubState } from '#shared/protocol/github.ts'
import type { FinishedChange, WorkState } from '#shared/protocol/work.ts'
import type { GrammarAsk } from '#shared/review/grammar.ts'
import { pullUrl, reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { ReviewLanding } from '#shared/review/status.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import type { HostHandlers } from '../commands.ts'
import { findGh } from '../github-gh.ts'
import type { PiModelRuntime } from '../pi.ts'
import { reviewChange } from '../../../packages/change-review/src/pipeline.ts'
import { piModelRunner } from './agent.ts'
import { Assessments, gitIn } from './assessment.ts'
import { githubApi, namedApi, readCodeHosts, type CodeHosts, type HostApi } from './code-hosts.ts'
import { reviewCode, reviewMap } from './guide.ts'
import { mergePlan, movedSince } from './landing.ts'
import { reviewModelChecks } from './model-checks.ts'
import { chatTeller } from './notify.ts'
import type { WhoIsMe } from './owner.ts'
import { peopleFinder, pullPeople } from './people.ts'
import type { GhCall } from './gh.ts'
import { pullCheckout, pullRefs, type PullTarget, type Say } from './pull-checkout.ts'
import { Reviews, type Watched } from './reviews.ts'
import { sampleReviewSource } from './sample-source.ts'
import { gitPublisher } from './publish.ts'
import { changeSource, pullSource } from './sources.ts'
import { reviewStore } from './store.ts'
import { scanVicinity, type ScanRun } from './vicinity-scan.ts'

export interface ReviewSeat {
  root: string
  /** Change reviews run, with the real models. Otherwise the host prepares graphs alone, and nothing is spent. */
  live: boolean
  /** hobkin's data folder. Throws, with the reason, while hobkin is not open in this host. */
  data: () => string
  /** Work mode as the Work screen has it, with the finished changes. */
  work: () => WorkState | null
  /**
   * hobkin's work actions, and its way to show its chat again after a line was posted for it. Throws, with the reason,
   * while hobkin is not open in this host.
   */
  app: () => { workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>; requestRefresh?(): void }
  runtime: () => Promise<PiModelRuntime | undefined>
  /**
   * gh, to read pull requests, which are checked out on this Mac to be reviewed. Without it a pull request reads as the
   * sample change, as the GitHub page shows sample data.
   */
  gh?: GhCall
  /** Something merged on the user's word: its pull request leaves GitHub's lists at once, and they are read again, so the issue it fixed leaves too. */
  merged?: (pull: { repo?: string; number?: number; url?: string }) => void
  log?: (line: string) => void
}

const finishedIn = (work: WorkState | null): FinishedChange[] => (work?.finished ?? []).flatMap((group) => group.changes)

/** The folders hobkin keeps its projects in: the one each was chosen from, or hobkin's own copy of it. */
const projectFolders = (data: string) => readProjects(data).map((project) => project.path ?? paths(data, project.slug).clone)

/** gh as git's way to sign in to GitHub, the way `gh auth setup-git` would set it, for hobkin's own clones only. */
function ghCredentialHelper(): string | null {
  const gh = findGh()
  return gh ? `!${JSON.stringify(gh)} auth git-credential` : null
}

/**
 * The home's code hosts besides GitHub (spec 048, entry 13), read from its code host file each time, so an edit counts
 * at once. A file that cannot be read stops only what goes to a named host: GitHub's reviews never wait on it.
 */
function codeHostsSeat(seat: ReviewSeat) {
  const strict = (): CodeHosts => readCodeHosts(seat.data())
  const known = (): CodeHosts => {
    try {
      return strict()
    } catch (error) {
      seat.log?.(`Reviews: ${error instanceof Error ? error.message : String(error)}`)
      return { hosts: [], emails: [], agents: [] }
    }
  }
  const hostOf = (name: string) => strict().hosts.find((host) => host.name === name)
  /** A named host's API for a pull request's repository; null for GitHub, which gh answers. */
  const apiOf = (target: PullTarget): HostApi | null => {
    if (!target.host) return null
    const host = hostOf(target.host)
    if (!host) throw new Error(`${target.host} is not a code host the code host file names.`)
    return namedApi(host, target)
  }
  /** A review checks out a named host's repository only where the code host file allows it, or names a tree of the host's own. */
  const checksOut = (target: ReviewTarget) => {
    if (target.kind !== 'pull' || !target.host) return true
    try {
      const host = hostOf(target.host)
      return host?.checkout === true || host?.tree != null
    } catch {
      return false
    }
  }
  /** Who the user is on a pull request's host: their login there, their addresses and the agents that work there for them. */
  const whoIsMe = async (target: PullTarget): Promise<WhoIsMe> => {
    const { emails, agents } = known()
    let viewer: string | null = null
    try {
      const api = apiOf(target) ?? (seat.gh ? githubApi(seat.gh) : null)
      viewer = api ? ((JSON.parse(await api({ path: 'user' })) as { login?: string }).login ?? null) : null
    } catch {
      // Not said: their login then counts for nothing, and their addresses still do.
    }
    return { viewer, emails, agents: agents.filter((agent) => agent.host === (target.host ?? 'github')).map((agent) => agent.login) }
  }
  const named = () => known().hosts.map(({ name, web }) => ({ name, web }))
  const quietHostOf = (name: string) => {
    try {
      return hostOf(name)
    } catch {
      return undefined
    }
  }
  /** The review tree a named host keeps of its own, used in place of hobkin's worktree. */
  const treeOf = (target: ReviewTarget) => (target.kind === 'pull' && target.host ? (quietHostOf(target.host)?.tree ?? null) : null)
  // People found by the home's lookup, kept in its client folder (entry 27).
  const find = peopleFinder({ file: () => join(seat.data(), 'client', 'people.json'), lookup: () => known().people })
  const peopleOf = (target: PullTarget, facts: { author: string | null; description: string }) => pullPeople({ target, ...facts, agents: known().agents, find })
  return { hostOf: quietHostOf, apiOf, checksOut, whoIsMe, named, treeOf, emails: () => known().emails, peopleOf }
}

export function hostReviews(seat: ReviewSeat): Reviews {
  const hosts = codeHostsSeat(seat)
  // This side learns the named hosts' pages at once, when hobkin is open, so their pull requests read as reviews.
  try {
    hosts.named()
  } catch {
    // hobkin is not open yet: they are learned the first time the file is read.
  }
  const find = (slug: string, item: string) => finishedIn(seat.work()).find((change) => change.slug === slug && change.item === item) ?? null
  // hobkin's own rule: the folder the project was chosen from, or hobkin's own copy of it.
  const repoOf = (slug: string) => {
    const data = seat.data()
    const repo = readProject(data, slug)?.path ?? paths(data, slug).clone
    return existsSync(repo) ? repo : null
  }
  // hobkin says in its chat when a review is ready, with no model turn. Only a live host tells it, as only a live host
  // runs change reviews; the scripted one keeps hobkin's chat as it is.
  const tell = seat.live ? chatTeller({ data: seat.data, refresh: () => seat.app().requestRefresh?.(), log: seat.log }) : undefined
  const describe = (target: ReviewTarget) => {
    const change = target.kind === 'change' ? find(target.slug, target.item) : null
    return change && { title: change.title, project: change.project }
  }
  // The branch each project merges into, as hobkin finds it with git and no network, kept once found.
  const into = new Map<string, string>()
  const intoOf = async (repo: string) => {
    if (!into.has(repo)) into.set(repo, await defaultBranch(repo))
    return into.get(repo)!
  }
  /** Where a finished change stands in hobkin's own records after a yes: merged, or being brought up to date to merge. */
  const landing = (target: Extract<ReviewTarget, { kind: 'change' }>): ReviewLanding | null => {
    const item = readItems(seat.data(), target.slug).find((entry) => entry.id === target.item)
    if (!item || (item.state !== 'merged' && !item.mergeWhenFresh)) return null
    const repo = repoOf(target.slug)
    const branch = repo ? into.get(repo) : undefined
    // Found once, so a status asked for a moment later names it.
    if (repo && !branch) void intoOf(repo).catch(() => {})
    if (item.state === 'merged') {
      const sha = item.landed?.sha ?? undefined
      const at = item.mergedAt ?? item.landed?.at ?? undefined
      return { state: 'merged', ...(sha ? { sha } : {}), ...(at ? { at } : {}), ...(branch ? { into: branch } : {}), message: `Merged${branch ? ` into ${branch}` : ''}${sha ? ` at ${sha.slice(0, 7)}` : ''}.` }
    }
    const at = item.mergeWhenFresh?.at
    return { state: 'refreshing', ...(at ? { at } : {}), ...(branch ? { into: branch } : {}), message: `An agent is bringing it up to date with ${branch ?? 'its default branch'}, and hobkin merges it once that run ends well.` }
  }
  // A pull request is reviewed on this Mac: in the user's clone of its repository, else in a clone of hobkin's own.
  const checkout = seat.gh ? pullCheckout({ root: seat.root, folders: () => projectFolders(seat.data()), gh: seat.gh, credentialHelper: ghCredentialHelper(), hostOf: hosts.hostOf }) : undefined
  // The change review of each finished change and each pull request asked for (spec 032): their own tests run in a
  // review worktree, and the Reviewer and the blind check go to the tiers. Only a live host runs it: the scripted one
  // runs no tests and asks no model.
  const assessments = seat.live
    ? new Assessments({
        root: seat.root,
        repoOf,
        ...(checkout ? { pullRepo: (target, head, say) => checkout.repoFor(target, head, say) } : {}),
        // A code host's own tree, for a repository too large to check out whole (entry 15).
        hostTree: hosts.treeOf,
        run: async (request) => {
          const model = piModelRunner({ root: seat.root, data: seat.data, runtime: seat.runtime })
          // hobkin's TLC runs at the head of the change's models, which the Reviewer weighs like tests that ran (050-tla-proofs).
          const modelChecks = await reviewModelChecks(request, { data: seat.data, log: seat.log })
          const result = await reviewChange({ ...request, model, modelChecks })
          for (const problem of result.problems) seat.log?.(`Change review at ${request.head.slice(0, 7)}: ${problem}`)
          return { units: result.units, storyBy: result.storyBy, answer: result.answer }
        },
        // Told once for each run that finishes, with the review to open.
        onReady: ({ target, head, summary, request }) => {
          const about = describe(target)
          const named = target.kind === 'change' ? { title: target.item, project: target.slug } : { title: `#${target.number}`, project: `${target.owner}/${target.repo}` }
          void tell?.({ id: reviewIdOf(target), kind: target.kind, title: request?.title ?? about?.title ?? named.title, project: request?.project ?? about?.project ?? named.project, head, at: summary.at, summary })
        },
        log: seat.log,
      })
    : undefined
  const store = reviewStore(seat.root)
  return new Reviews({
    ...(assessments ? { assessments } : {}),
    describe,
    landing,
    // What moved on a pull request since its review: read from its checkout, fetching its new head first when needed.
    ...(checkout ? { pullMoved: async (target: PullTarget, from: string, to: string) => movedSince({ repo: await checkout.repoFor(target, to), from, to, tip: pullRefs(target).base }) } : {}),
    // A yes merges a change that merges cleanly straight away, whatever its card would do, at the commit its branch is at.
    merging: async (target, { reviewed, current, pr }) => {
      const repo = repoOf(target.slug)
      if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
      // Where the branch is now is asked of git, as hobkin's own merge asks it. What hobkin last published of the
      // change can be a commit behind, as right after an agent reworked it, and a yes pinned to that is refused.
      const branch = find(target.slug, target.item)?.branch
      const tip = branch ? await gitIn(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).then((sha) => sha.trim() || null, () => null) : null
      return mergePlan({ repo, into: await intoOf(repo), reviewed, current: tip ?? current, pr })
    },
    onReady: ({ target, review, at }) => void tell?.({ id: reviewIdOf(target), kind: target.kind, title: review.change.title, project: review.change.project, head: review.change.head, at }),
    ...(seat.merged
      ? {
          // What closed or merged on a named host is told by its page, never by a repository and number GitHub could also have.
          onMerged: (target: ReviewTarget) =>
            seat.merged!(target.kind === 'pull' ? (target.host ? { url: pullUrl(target) ?? undefined } : { repo: `${target.owner}/${target.repo}`, number: target.number }) : { url: find(target.slug, target.item)?.pr ?? undefined }),
        }
      : {}),
    store,
    sources: {
      change: changeSource({
        find: (slug, item) => {
          const change = find(slug, item)
          return change && { project: change.project, title: change.title, branch: change.branch, head: change.head }
        },
        repoOf,
        baseOf: defaultBranch,
        // A change merged already is reviewed over its own range, as its last review read it.
        recorded: (target) => store.latest(target)?.review.change.base ?? null,
        // The call-graph scan runs only where reviews are real, never for the scripted host.
        ...(seat.live ? { vicinity: (repo: string, base: string, head: string) => scanVicinity({ repo, base, head }) } : {}),
      }),
      pull: seat.gh
        ? pullSource({
            gh: seat.gh,
            // A pull request on a code host the home names is read through that host, and checked out only where it allows.
            apiOf: hosts.apiOf,
            canCheckOut: hosts.checksOut,
            whoIsMe: hosts.whoIsMe,
            ...(checkout ? { checkout } : {}),
            // The call-graph scan runs only where reviews are real, never for the scripted host.
            ...(assessments ? { vicinity: pullVicinity(assessments) } : {}),
          })
        : sampleReviewSource(),
    },
    work: seat.app,
    // A finished change's commit is on its card already. A pull request's is asked of GitHub when its review is open.
    head: (target) => (target.kind === 'change' ? (find(target.slug, target.item)?.head ?? null) : null),
    card: (slug, item) => {
      const change = find(slug, item)
      return change && { landing: change.landing, yes: change.yes, branch: change.branch, pr: change.pr }
    },
    // Only a live host posts to GitHub or opens a pull request, and only for a verdict the user confirmed.
    ...(seat.live && seat.gh ? { gh: seat.gh, publish: gitPublisher({ repoOf, baseOf: defaultBranch, gh: seat.gh }) } : {}),
    // The user's words have their grammar fixed on the quick tier before a pull request gets them. The scripted host asks no model.
    ...(seat.live ? { grammar: quickGrammar(seat) } : {}),
    // Verdicts on a named code host's pull request go through that host, from a live host only, as GitHub's do.
    ...(seat.live && seat.gh ? { apiOf: hosts.apiOf } : {}),
    checksOut: hosts.checksOut,
    namedHosts: hosts.named,
    peopleOf: hosts.peopleOf,
    // How a named host merges and deletes a branch, its own way, as its code host file says (entry 26).
    hostWays: (target: PullTarget) => {
      const host = target.host ? hosts.hostOf(target.host) : undefined
      if (!host || !checkout) return null
      return { merge: host.merge, mergeBy: host.mergeBy ?? null, emails: hosts.emails(), deleteBranch: (branch: string, sha: string) => checkout.deleteBranch(target, branch, sha) }
    },
    log: seat.log,
  })
}

/** The quick tier, as the grammar check asks it: the model the blind check runs on. */
function quickGrammar(seat: { root: string; data: () => string; runtime: Parameters<typeof piModelRunner>[0]['runtime'] }): GrammarAsk {
  const quick = piModelRunner({ root: seat.root, data: seat.data, runtime: seat.runtime })
  return ({ system, prompt, signal }) => quick({ pass: 'checker', system, prompt, signal })
}

/**
 * A pull request's life cycle: scanned in its review checkout, at its head, while no change review uses that checkout,
 * so callers are read as the pull request has them.
 */
export function pullVicinity(assessments: Assessments, run?: ScanRun): (target: PullTarget, repo: string, base: string, head: string, say?: Say) => Promise<Vicinity> {
  return (target, repo, base, head, say) =>
    assessments.inTree(
      target,
      repo,
      head,
      (tree) => {
        say?.('Mapping the callers and callees.')
        return scanVicinity({ repo: tree, base, head, ...(run ? { run } : {}) })
      },
      say,
      base,
    )
}

/** What the background prepares: every finished change at its commit. */
export function toPrepare(work: WorkState | null, _github?: GitHubState): Watched[] {
  // A pull request from GitHub is reviewed only once the user asks ("Start AI review", spec 032), so only finished
  // changes are prepared by themselves.
  return finishedIn(work).map((change) => ({ id: reviewIdOf({ kind: 'change', slug: change.slug, item: change.item }), head: change.head }))
}

type ReviewCommand = 'review.prepare' | 'review.status' | 'review.list' | 'review.codeHosts' | 'review.people' | 'review.remove' | 'review.stop' | 'review.get' | 'review.file' | 'review.notes' | 'review.map' | 'review.code' | 'review.show' | 'review.note' | 'review.preview' | 'review.verdict'

export function reviewHandlers(reviews: Reviews): Pick<HostHandlers, ReviewCommand> {
  return {
    // Asked for by the window or by hobkin, as against what the background prepares by itself.
    'review.prepare': ({ id, refresh }) => reviews.prepare(id, { refresh, asked: true }),
    'review.list': () => reviews.list(),
    'review.codeHosts': () => ({ hosts: reviews.codeHosts() }),
    'review.people': ({ id }) => reviews.people(id),
    'review.remove': ({ id }) => reviews.remove(id),
    'review.stop': ({ id }) => reviews.stop(id),
    'review.status': ({ id }) => {
      // An open review asks now and then, so it can say when its change has moved on.
      void reviews.lookAgain(id)
      return reviews.status(id)
    },
    'review.get': ({ id }) => reviews.get(id),
    'review.file': ({ id, fileId }) => reviews.file(id, fileId),
    'review.notes': ({ id, entries, draft }) => {
      reviews.saveNotes(id, { entries, draft })
      return { ok: true }
    },
    'review.map': ({ id }) => reviewMap(reviews, id),
    'review.code': ({ id, node }) => reviewCode(reviews, id, node),
    'review.show': ({ id, step, node }) => reviews.show(id, { step, node }),
    'review.note': ({ id, ...note }) => ({ id: reviews.note(id, note).id }),
    // `head` is the commit of the review on the user's screen: a verdict never acts on another one.
    'review.preview': ({ id, verdict, summary, head }) => reviews.preview(id, verdict, summary, head),
    'review.verdict': ({ id, verdict, summary, confirm, head }) => reviews.verdict(id, verdict, summary, confirm, head),
  }
}
