import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssessmentStatus } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewLanding, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'
import { failureOf, underWay } from '../src/features/review/preparing-model.ts'
import { ReviewLoad } from '../src/features/review/ReviewLoad.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { afterVerdict, createVerdictChoices, NO_LONGER_WAITING, type VerdictCommands } from '../src/features/review/verdict.ts'

const ID = 'change:hobkin:7d02c9'
/** The commit the review on screen was built for, the one an agent brings it up to date as, and the one it merged as. */
const REVIEWED = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
const REFRESHED = 'e44106a3b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5'
const TOKEN = 'b'.repeat(64)
const reviewAt = (head: string) => ({ id: ID, snapshot: head.repeat(2), change: { head }, nodes: [], edges: [], story: [] }) as unknown as Review
const rated = (head: string, at: string): AssessmentStatus => ({ state: 'ready', head, summary: { level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 3, storyBy: 'model', at } })
const ready: ReviewStatus = { ...IDLE_STATUS(ID), state: 'ready', head: REVIEWED, preparedAt: '2026-11-12T20:40:00.000Z', storyBy: 'host', assessment: rated(REVIEWED, '2026-11-12T20:45:00.000Z') }
const refreshing: ReviewLanding = { state: 'refreshing', at: '2026-11-12T20:51:00.000Z', into: 'main', message: 'An agent is bringing it up to date with main.' }
const merged: ReviewLanding = { state: 'merged', sha: REFRESHED, at: '2026-11-12T21:13:00.000Z', into: 'main', message: 'Merged into main at e44106a.' }

/**
 * A finished change's host, as a script: `say` sets the status it answers from then on, and `prepared` the review it
 * would open. It merges straight away, or brings the change up to date first (`conflicts`). Every call is kept.
 */
function hostOf({ conflicts = false } = {}) {
  const calls: string[] = []
  let status = ready
  let review = reviewAt(REVIEWED)
  const command = (async (name: string) => {
    calls.push(name)
    switch (name) {
      case 'review.status':
      case 'review.prepare':
        return status
      case 'review.get':
        return { review, notes: { entries: [], draft: null }, status, assessment: null } satisfies OpenedReview
      case 'review.notes':
        return { ok: true }
      case 'review.preview':
        return { verdict: 'approve-merge', lines: [conflicts ? 'It conflicts with main: an agent brings it up to date, then hobkin merges it.' : 'Merge it into main.'], confirm: TOKEN }
      case 'review.verdict':
        status = { ...status, landing: conflicts ? refreshing : merged }
        return { message: conflicts ? 'An agent is bringing it up to date.' : 'Merged it into main.' }
      default:
        throw new Error(name)
    }
  }) as ReviewCommands & VerdictCommands
  const loader = createReviewLoader({ id: ID, scope: 'host:/fixture', command, memory: createReviewMemory() })
  return {
    loader,
    command,
    say: (next: Partial<ReviewStatus>) => void (status = { ...status, ...next }),
    prepared: (next: Review) => void (review = next),
    asked: (name: string) => calls.filter((call) => call === name).length,
    calls,
  }
}

/** Polls the way the open review does, once a second. */
async function ticks(loader: { tick(): Promise<void> }, count = 1) {
  for (let index = 0; index < count; index++) await loader.tick()
}

test('while an agent brings a finished change up to date, and once it merged, the open review holds still: never outdated, never built again', async () => {
  const host = hostOf()
  await host.loader.load()
  const open = host.loader.getState().review
  assert.equal(open?.change.head, REVIEWED)
  const still = () => {
    const { review, preparation, status } = host.loader.getState()
    assert.equal(review, open, 'the review on screen is the one opened')
    assert.equal(status, 'ready')
    assert.equal(preparation?.head, REVIEWED, 'no newer commit to be outdated by')
    assert.equal(preparation?.stale, false)
    assert.equal(preparation?.phase, null, 'nothing built again over it')
    assert.equal(underWay(preparation), false)
    assert.equal(failureOf(preparation), null)
    assert.equal(preparation?.preparedAt, ready.preparedAt, 'the same preparation, so the canvas is not drawn again')
    assert.deepEqual(preparation?.assessment, ready.assessment, 'its own change review, not the one of the newer commit')
  }

  // The yes: an agent brings the branch up to date.
  host.say({ landing: refreshing })
  await ticks(host.loader)
  assert.deepEqual(host.loader.getState().preparation?.landing, refreshing)
  still()

  // Its branch moves, and an older host would call the review outdated and build it again for the new commit.
  host.say({ head: REFRESHED, stale: true, phase: 'reading', startedAt: '2026-11-12T20:52:00.000Z' })
  await ticks(host.loader, 2)
  still()
  host.say({ phase: null, startedAt: undefined, preparedAt: '2026-11-12T20:53:00.000Z', assessment: { state: 'running', head: REFRESHED, percent: 30 } })
  host.prepared(reviewAt(REFRESHED))
  await ticks(host.loader, 2)
  still()
  host.say({ assessment: rated(REFRESHED, '2026-11-12T20:58:00.000Z') })
  await ticks(host.loader, 2)
  still()

  // It merged: a state, and the review still holds still, even when asked to be built again.
  host.say({ landing: merged })
  await ticks(host.loader, 2)
  assert.deepEqual(host.loader.getState().preparation?.landing, merged)
  still()
  await host.loader.refresh()
  await ticks(host.loader, 2)
  still()

  assert.equal(host.asked('review.get'), 1, 'the review was fetched once, to open it')
  assert.equal(host.asked('review.prepare'), 0, 'and never prepared again')
  host.loader.dispose()
})

test('a change that is already merged opens on its review, merged, and is never prepared again', async () => {
  const host = hostOf()
  host.say({ landing: merged })
  await host.loader.load()
  const { status, review, preparation } = host.loader.getState()
  assert.deepEqual([status, review?.change.head, preparation?.landing], ['ready', REVIEWED, merged])
  await ticks(host.loader, 3)
  await host.loader.refresh()
  assert.equal(host.asked('review.prepare'), 0)
  assert.equal(host.asked('review.get'), 1)
  host.loader.dispose()
})

test('a change that lands offers nothing to build again over its review: no run with its Try again, no Refresh review', async () => {
  for (const landing of [refreshing, merged]) {
    // Its own change review stopped before the yes: the run says so, with a way to run it again.
    const stopped = hostOf()
    stopped.say({ assessment: { state: 'failed', head: REVIEWED, error: 'The tests did not finish in time.' } })
    await stopped.loader.load()
    const run = () => renderToStaticMarkup(createElement(ReviewLoad, { loader: stopped.loader, renderReview: () => null, renderRun: () => createElement('p', null, 'The run') }))
    assert.ok(run().includes('The run'))
    stopped.say({ landing })
    await ticks(stopped.loader)
    assert.equal(run().includes('The run'), false, landing.state)
    assert.equal(run().includes('Refresh review'), false, landing.state)
    stopped.loader.dispose()

    // With nothing under way, the corner offers to refresh the review, until its change lands.
    const quiet = hostOf()
    await quiet.loader.load()
    const corner = () => renderToStaticMarkup(createElement(ReviewLoad, { loader: quiet.loader, renderReview: () => null }))
    assert.ok(corner().includes('Refresh review'))
    quiet.say({ landing })
    await ticks(quiet.loader)
    assert.equal(corner().includes('Refresh review'), false, landing.state)
    quiet.loader.dispose()
  }
})

test('a merged change with no review to open is never prepared, and does not wait for one', async () => {
  const host = hostOf()
  host.say({ ...IDLE_STATUS(ID), landing: merged })
  await host.loader.load()
  await ticks(host.loader, 3)
  assert.equal(host.asked('review.prepare'), 0)
  const { status, error } = host.loader.getState()
  assert.equal(status, 'error', 'it says why there is nothing to show, rather than "preparing"')
  assert.ok(error)
  host.loader.dispose()
})

/** The review screen, as a verdict that has landed sees it, and everything that happens to it. */
function screenOf(now: ReviewLanding | null, kind: 'change' | 'pull' = 'change') {
  const seen: string[] = []
  let landing = now
  let here = true
  let heard: ((landing: ReviewLanding | null) => void) | null = null
  return {
    seen,
    screen: {
      kind,
      here: () => here,
      close: () => void seen.push('close'),
      celebrate: (kind: 'tada' | 'done', message: string) => void seen.push(`${kind}: ${message}`),
      landing: async () => landing,
      follow: (listener: (landing: ReviewLanding | null) => void) => {
        heard = listener
        listener(landing)
        return () => void (heard = null)
      },
    },
    land: (next: ReviewLanding | null) => {
      landing = next
      heard?.(next)
    },
    leave: () => void (here = false),
    following: () => heard != null,
  }
}

test('approve and merge closes the review with Merged! once the change has merged: at once, or after an agent brings it up to date', async () => {
  // Merged at once: Merged!, and the review closes. So does a pull request, which GitHub merged, without asking more.
  const atOnce = screenOf(merged)
  await afterVerdict('approve-merge', 'Merged it into main.', atOnce.screen)
  assert.deepEqual(atOnce.seen, ['tada: Merged it into main.', 'close'])
  const pull = screenOf(null, 'pull')
  let asked = false
  pull.screen.landing = async () => {
    asked = true
    return null
  }
  await afterVerdict('approve-merge', 'Merged acme/shop#9 into main.', pull.screen)
  assert.deepEqual([pull.seen, asked], [['tada: Merged acme/shop#9 into main.', 'close'], false])

  // A host that says nothing of how the change lands, as when hobkin hands the merge to a session while work mode
  // waits, or an older host: never Merged! on its word alone. The review closes with what the host said it did.
  const unsaid = screenOf(null)
  await afterVerdict('approve-merge', 'A session brings it up to date and merges it.', unsaid.screen)
  assert.deepEqual(unsaid.seen, ['done: A session brings it up to date and merges it.', 'close'])

  // Brought up to date first: the review stays open while it is, and closes with Merged! once it has merged.
  const later = screenOf(refreshing)
  await afterVerdict('approve-merge', 'An agent is bringing it up to date.', later.screen)
  assert.deepEqual(later.seen, [])
  later.land({ ...refreshing, message: 'Still at it.' })
  assert.deepEqual(later.seen, [])
  later.land(merged)
  assert.deepEqual(later.seen, [`tada: ${merged.message}`, 'close'])
  assert.equal(later.following(), false)

  // Every other verdict closes the review with a short confirmation of what the host did.
  for (const verdict of ['approve', 'request-changes', 'comment'] as const) {
    const { screen, seen } = screenOf(null)
    await afterVerdict(verdict, 'Done.', screen)
    assert.deepEqual(seen, ['done: Done.', 'close'], verdict)
  }
})

test('nothing pops up later for a review the reviewer left, or for a change that stopped landing', async () => {
  const left = screenOf(refreshing)
  await afterVerdict('approve-merge', 'An agent is bringing it up to date.', left.screen)
  left.leave()
  left.land(merged)
  assert.deepEqual(left.seen, [])

  // The refresh ended without a merge: the review is the reviewer's again, and a merge after that is not this yes's.
  const stopped = screenOf(refreshing)
  await afterVerdict('approve-merge', 'An agent is bringing it up to date.', stopped.screen)
  stopped.land(null)
  stopped.land(merged)
  assert.deepEqual(stopped.seen, [])
  assert.equal(stopped.following(), false)

  // Left before the host answered: a change it merged still says Merged!, and nothing closes; one it refreshes says nothing.
  const gone = screenOf(merged)
  gone.leave()
  await afterVerdict('approve-merge', 'Merged it into main.', gone.screen)
  assert.deepEqual(gone.seen, ['tada: Merged it into main.'])
  const goneRefreshing = screenOf(refreshing)
  goneRefreshing.leave()
  await afterVerdict('approve-merge', 'An agent is bringing it up to date.', goneRefreshing.screen)
  assert.deepEqual(goneRefreshing.seen, [])
  assert.equal(goneRefreshing.following(), false)
})

/**
 * An open review of the finished change, wired as the window wires it: its verdict choices over the host, and what the
 * review does once a verdict has landed, with everything that happened to the review.
 */
async function openReview({ conflicts = false } = {}) {
  const host = hostOf({ conflicts })
  await host.loader.load()
  const seen: string[] = []
  let here = true
  const choices = createVerdictChoices({
    id: ID,
    head: REVIEWED,
    command: host.command,
    saveNotes: async () => {},
    current: () => true,
    landed: (verdict, message) =>
      afterVerdict(verdict, message, {
        kind: 'change',
        here: () => here,
        close: () => void seen.push('close'),
        celebrate: (kind) => void seen.push(kind),
        landing: host.loader.look,
        follow: host.loader.follow,
      }),
  })
  return {
    host,
    choices,
    seen,
    /** Both clicks of Approve and merge. */
    approveAndMerge: async () => {
      await choices.press('approve-merge')
      await choices.press('approve-merge')
    },
    /** The reviewer leaves the review, which closes it. */
    leave: () => {
      here = false
      host.loader.dispose()
    },
  }
}

test("the reviewer's own approve and merge of a change that merges at once closes the review with Merged!", async () => {
  const review = await openReview()

  await review.approveAndMerge()

  assert.equal(review.host.asked('review.verdict'), 1)
  assert.deepEqual(review.seen, ['tada', 'close'])
  review.host.loader.dispose()
})

test("the reviewer's own approve and merge of a change an agent brings up to date first: the review stays open, and closes with Merged! once it merged", async () => {
  const review = await openReview({ conflicts: true })

  await review.approveAndMerge()

  // The yes is done, and the review stays open while its branch is brought up to date and moves.
  assert.deepEqual(review.seen, [])
  assert.equal(review.choices.getState().busy, false)
  assert.equal(review.host.loader.getState().preparation?.landing?.state, 'refreshing')
  review.host.say({ head: REFRESHED })
  await ticks(review.host.loader, 2)
  assert.deepEqual(review.seen, [])

  review.host.say({ landing: merged })
  await ticks(review.host.loader)
  assert.deepEqual(review.seen, ['tada', 'close'])
  review.host.loader.dispose()
})

test('a reviewer who left while an agent brings the change up to date sees nothing when it merges later', async () => {
  const review = await openReview({ conflicts: true })
  await review.approveAndMerge()

  review.leave()
  review.host.say({ landing: merged })
  await ticks(review.host.loader, 2)

  assert.deepEqual(review.seen, [])
})

test('a host that no longer lists a finished change says so plainly: it was merged or closed, which is no failure', async () => {
  const gone = createVerdictChoices({
    id: ID,
    head: REVIEWED,
    command: (async () => {
      throw new Error('hobkin no longer lists this change as finished.')
    }) as VerdictCommands,
    saveNotes: async () => {},
    current: () => true,
  })
  await gone.press('approve-merge')
  assert.deepEqual([gone.getState().error, gone.getState().message, gone.getState().preview], [null, NO_LONGER_WAITING, null])

  // Any other refusal stays the host's own words, as an error.
  const refused = createVerdictChoices({
    id: ID,
    head: REVIEWED,
    command: (async () => {
      throw new Error('This change has no branch to push.')
    }) as VerdictCommands,
    saveNotes: async () => {},
    current: () => true,
  })
  await refused.press('approve')
  assert.deepEqual([refused.getState().error, refused.getState().message], ['This change has no branch to push.', null])
})
