import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { AssessmentStatus } from '../../shared/review/assessment.ts'
import { IDLE_STATUS } from '../../shared/review/status.ts'
import { reviewBadge, saysHigh } from '../src/features/work/review-badge.ts'

// Keep the hook's state across renders and commit effects separately, without a browser.
const hookRuntime = `data:text/javascript,${encodeURIComponent(`
  let state, ref, deps, effect, cleanup
  export function useState() { return [state, value => { state = value }] }
  export function useRef(initial) { return ref ??= { current: initial } }
  export function useCallback(callback) { return callback }
  export function useEffect(run, next) {
    if (deps && next.every((value, i) => Object.is(value, deps[i]))) return
    deps = next
    effect = run
  }
  export function commit() { cleanup?.(); cleanup = effect() }
  export function unmount() { cleanup?.() }
`)}`
const host = `data:text/javascript,${encodeURIComponent(`
  let respond
  export function setResponder(run) { respond = run }
  export function runCommand(...args) { return respond(...args) }
  export function useHost(select) { return select({ home: '/test' }) }
`)}`

const ID = 'change:storefront:d2c4e8'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const risky: AssessmentStatus = {
  state: 'ready', head: A,
  summary: { level: 'high', critical: false, needsYou: 1, worthALook: 0, safe: 0, storyBy: 'host', at: '2026-11-20T10:00:00Z' },
}
const answered = () => new Promise((resolve) => setImmediate(resolve))

/** The hook with React and the host replaced, so its renders and effects run one by one in the test. */
async function loadHook(t: { after(run: () => void): void }) {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/use-change-review.ts')) {
      if (specifier === 'react') return next(hookRuntime, context)
      if (specifier === '@/lib/host/index.ts') return next(host, context)
    }
    return next(specifier, context)
  } })
  t.after(() => hooks.deregister())
  const { useChangeReview } = await import('../src/features/work/use-change-review.ts')
  const { commit, unmount } = await import(hookRuntime)
  const { setResponder } = await import(host)
  t.after(unmount)
  return { useChangeReview, commit, setResponder }
}

test('a failed first status request for the new head does not keep the old review badge or merge styling', async (t) => {
  const { useChangeReview, commit, setResponder } = await loadHook(t)

  const status = { ...IDLE_STATUS(ID), state: 'ready', head: A, assessment: risky }
  const respond = t.mock.fn(async () => status)
  setResponder(respond)
  useChangeReview(ID, A)
  commit()
  await answered()
  const { assessment } = useChangeReview(ID, A)
  assert.equal(reviewBadge(assessment).tone, 'bad')
  assert.equal(saysHigh(assessment), true)

  const reject = t.mock.fn(async () => { throw new Error('Host temporarily unavailable') })
  setResponder(reject)
  const beforeRequest = useChangeReview(ID, B).assessment
  commit()
  await answered()
  assert.equal(reject.mock.callCount(), 1)
  const afterFailure = useChangeReview(ID, B).assessment
  assert.equal(reviewBadge(afterFailure).tone, 'quiet')
  assert.equal(saysHigh(afterFailure), false)
  assert.equal(beforeRequest, undefined, 'the old assessment is hidden even before the effect runs')

  setResponder(async () => ({ ...status, head: B, assessment: { ...risky, head: B } }))
  await useChangeReview(ID, B).again()
  assert.equal(useChangeReview(ID, B).assessment?.head, B)
})

test('a card a commit behind its branch, as before hobkin looks at the branch again, shows the review the host runs at the newer commit', async (t) => {
  const { useChangeReview, commit, setResponder } = await loadHook(t)
  const other = 'change:storefront:5be1a0'
  const C = 'c'.repeat(40)
  // hobkin's card still names A. The host looked the branch up in git, found B, and reviews B.
  const running: AssessmentStatus = { state: 'running', head: B, percent: 20, now: 'Running the checkout tests' }
  setResponder(async () => ({ ...IDLE_STATUS(other), state: 'preparing', head: B, assessment: running }))
  useChangeReview(other, A)
  commit()
  await answered()
  assert.equal(reviewBadge(useChangeReview(other, A).assessment).label, 'Reviewing · 20%')

  assert.equal(useChangeReview(other, C).assessment, undefined, 'once the card names another commit, the answer given for the old card is hidden until the host answers again')
})
