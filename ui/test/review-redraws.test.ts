import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import type { ChangeAssessment } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { createReviewLoader, type ReviewCommands, type ReviewLoader } from '../src/features/review/loader.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { mountCounting } from './render-count.ts'

const id = 'change:project:item'
const T0 = Date.parse('2026-11-21T16:00:00Z')
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const review = { id, snapshot: 'a'.repeat(64), change: { head: 'h' }, nodes: [], edges: [], story: [] } as unknown as Review
const summary = { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: iso(50) } as const
const finished: ChangeAssessment = { head: 'h', summary, story: '# Story\n', units: null, triage: null, blind: null, progress: null, nodes: [] }

/**
 * A host that answers every question with a new copy of what it says now, as the connection does: each reply is parsed
 * anew, so nothing it returns is the object the window already holds.
 */
function host(status: ReviewStatus) {
  let now = status
  const copy = <Value>(value: Value): Value => structuredClone(value)
  const command = (async (name: string) => {
    if (name === 'review.status' || name === 'review.prepare') return copy(now)
    if (name === 'review.get') return copy({ review, notes: { entries: [], draft: null }, status: now, assessment: finished } satisfies OpenedReview)
    if (name === 'review.notes') return { ok: true }
    throw new Error(name)
  }) as ReviewCommands
  const loader = createReviewLoader({ id, scope: 'host:/fixture', command, memory: createReviewMemory(), now: () => T0 })
  return { loader, say: (next: ReviewStatus) => void (now = next) }
}

/** What the review window reads of the loader: all of it (the loading boundary), and the parts its views select. */
async function readers(loader: ReviewLoader) {
  const draws = { boundary: 0, preparation: 0, review: 0, assessment: 0 }
  const Boundary = () => {
    draws.boundary += 1
    useSyncExternalStore(loader.subscribe, loader.getState, loader.getState)
    return null
  }
  const Part = ({ part }: { part: 'preparation' | 'review' | 'assessment' }) => {
    draws[part] += 1
    useStore(loader, (state) => state[part])
    return null
  }
  const mounted = await mountCounting(() => [
    createElement(Boundary, { key: 'boundary' }),
    ...(['preparation', 'review', 'assessment'] as const).map((part) => createElement(Part, { key: part, part })),
  ])
  const since = () => ({ ...draws })
  return { mounted, draws, since }
}

test('a review being prepared, asked about each second while nothing new is said, draws nothing again', async () => {
  const preparing: ReviewStatus = { ...IDLE_STATUS(id), state: 'preparing', phase: 'reading', startedAt: iso(0) }
  const { loader, say } = host(preparing)
  await loader.load()
  const { mounted, draws } = await readers(loader)
  const kept = loader.getState().preparation

  for (let second = 0; second < 5; second++) await mounted.change(() => loader.tick())
  assert.equal(loader.getState().preparation, kept, 'the same status is kept')
  assert.deepEqual(draws, { boundary: 1, preparation: 1, review: 1, assessment: 1 })

  // A new phase is something new: it is drawn, once.
  say({ ...preparing, phase: 'arranging' })
  await mounted.change(() => loader.tick())
  assert.equal(loader.getState().preparation?.phase, 'arranging')
  assert.deepEqual([draws.preparation, draws.review], [2, 1])
  await mounted.unmount()
  loader.dispose()
})

test('an open review built again, fetched each second while the host has nothing new, keeps the review on screen as it is', async () => {
  const ready: ReviewStatus = { ...IDLE_STATUS(id), state: 'ready', head: 'h', preparedAt: iso(4), assessment: { state: 'ready', head: 'h', summary } }
  const { loader, say } = host(ready)
  await loader.load()
  // Rebuild: the review stays open while the host prepares it again.
  say({ ...ready, phase: 'reading', startedAt: iso(60) })
  await loader.tick()
  const { mounted, draws } = await readers(loader)
  const { review: shown, assessment } = loader.getState()

  for (let second = 0; second < 5; second++) await mounted.change(() => loader.tick())
  assert.equal(loader.getState().review, shown, 'the same review is kept')
  assert.equal(loader.getState().assessment, assessment, 'the same change review is kept')
  assert.deepEqual(draws, { boundary: 1, preparation: 1, review: 1, assessment: 1 })
  await mounted.unmount()
  loader.dispose()
})
