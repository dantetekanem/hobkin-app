import type { FinishedChange, FinishedGroup, FinishedGroupName, GroupPlan, WorkProject, WorkState } from '#shared/protocol/work.ts'

/**
 * Work mode for a window with no host, in the shape the host sends (`shared/protocol/work.ts`), with the words
 * hobkin uses. The projects are the frame's sample projects, and two of the finished changes are the sample GitHub
 * pull requests, so a card can show where its PR stands. Nothing here came from hobkin.
 */

const HOUR_MS = 3_600_000

/** hobkin's words for a group of finished work (`groupWords` in its `src/cli/work/groups.mjs`), for the sample alone. */
const GROUP_WORDS = {
  merge: {
    name: 'Ready to merge',
    action: (count: number) => (count === 1 ? 'Merge this one' : `Merge all ${count}`),
    underWay: (count: number) => (count === 1 ? 'Merging it…' : `Merging all ${count}…`),
    why: (count: number) => `With proof, no conflict and no grade against ${count === 1 ? 'it' : 'them'}.`,
    question: (count: number) => (count === 1 ? 'Merge this one?' : `Merge these ${count}, in this order?`),
    about:
      'Each merges at the commit its card showed, or not at all. A branch merges on this machine and pushes nothing, and a PR merges on GitHub. One that cannot merge says why in Chat, and the rest still go.',
  },
  refresh: {
    name: 'Refresh then merge',
    action: (count: number) => (count === 1 ? 'Refresh and merge this one' : `Refresh and merge all ${count}`),
    underWay: (count: number) => (count === 1 ? 'Asking for its refresh…' : `Asking for all ${count} refreshes…`),
    why: (count: number) => (count === 1 ? 'Behind its base, so an agent brings it up to date first.' : 'Behind their base, so an agent brings each up to date first.'),
    question: (count: number) => (count === 1 ? 'Refresh and merge this one?' : `Refresh and merge these ${count}, in this order?`),
    about:
      'An agent brings each up to date with its base and runs its proof again, and hobkin merges it once that run ends well. With work mode off or paused, the main agent hands each to a session. One that cannot start says why in Chat, and the rest still go.',
  },
} as const

/** What a group's page lists, numbered in the order the rows go, under their projects (`groupPlan` in hobkin). */
function planOf(name: 'merge' | 'refresh', changes: readonly FinishedChange[]): GroupPlan {
  const projects: GroupPlan['projects'] = []
  changes.forEach((change, index) => {
    const grade = change.safety ? `${change.safety.grade} ${change.safety.rating}${change.safety.stale ? ' on an older commit' : ''}` : 'not graded'
    const note = [change.pr && 'PR', change.behind > 0 && `${change.behind} behind`, grade].filter(Boolean).join(' · ')
    const step = { number: index + 1, title: change.title, note }
    const last = projects.at(-1)
    if (last?.slug === change.slug) last.steps.push(step)
    else projects.push({ slug: change.slug, project: change.project, steps: [step] })
  })
  return { name: GROUP_WORDS[name].name, about: GROUP_WORDS[name].about, projects }
}

/** A group of the sample, with hobkin's words for however many changes it holds. */
export function groupOf(name: FinishedGroupName, changes: FinishedChange[]): FinishedGroup {
  if (name === 'needs') return { name, heading: 'Needs you', why: null, action: null, changes }
  const words = GROUP_WORDS[name]
  return {
    name,
    heading: words.name,
    why: words.why(changes.length),
    action: { label: words.action(changes.length), question: words.question(changes.length), plan: planOf(name, changes), underWay: words.underWay(changes.length) },
    changes,
  }
}

const sha = (seed: string) => seed.padEnd(40, '0')

const merging = (rest: Omit<FinishedChange, 'key' | 'review' | 'behind' | 'conflict' | 'landing'> & Partial<FinishedChange>): FinishedChange => ({
  key: `${rest.slug}:${rest.item}`,
  review: rest.safety ? `Reviewed: ${rest.safety.grade} ${rest.safety.rating} at this commit.` : 'Not reviewed. Get it reviewed runs one first, about $2 and 14 minutes.',
  behind: 0,
  conflict: false,
  landing: rest.pr ? 'mergePr' : 'merge',
  ...rest,
})

const READY: FinishedChange[] = [
  merging({
    slug: 'billing-api',
    project: 'billing-api',
    item: '5e7c21',
    title: 'Patch the webhook retry',
    grade: 'P0',
    branch: 'hobkin/5e7c21-patch-the-webhook-retry',
    head: sha('f3a9c1e7'),
    pr: null,
    about: 'A failed webhook is tried again three times with a growing wait, instead of being dropped after the first error.',
    proof: 'node --test test/webhooks.test.ts: 14 pass, including a delivery that fails twice and then lands.',
    yes: 'Merge it puts hobkin/5e7c21-patch-the-webhook-retry (18 lines) into the default branch on this machine. Nothing is pushed.',
    reason: 'With proof, no conflict and no grade against it.',
    safety: { grade: 'safe', rating: 'A', stale: false },
    size: { lines: 18, files: 2 },
    choices: [
      { value: 'merge', label: 'Merge it' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
  merging({
    slug: 'storefront',
    project: 'storefront',
    item: '4c9e21',
    title: 'Remember the shipping address',
    grade: 'P1',
    branch: 'hobkin/4c9e21-remember-the-shipping-address',
    head: sha('9b04d2aa'),
    pr: null,
    about: 'Checkout fills in the last shipping address a signed-in customer used, and leaves the form empty for a guest.',
    proof: 'pnpm test checkout: 52 pass. A new test covers a guest and a returning customer.',
    yes: 'Merge it puts hobkin/4c9e21-remember-the-shipping-address (64 lines) into the default branch on this machine. Nothing is pushed.',
    reason: 'With proof, no conflict and no grade against it.',
    safety: { grade: 'safe', rating: 'B', stale: false },
    size: { lines: 64, files: 4 },
    choices: [
      { value: 'merge', label: 'Merge it' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
  merging({
    slug: 'storefront',
    project: 'storefront',
    item: '8d2f60',
    title: 'Fix the login redirect after a password reset',
    grade: 'P1',
    branch: 'hobkin/8d2f60-fix-the-login-redirect',
    head: sha('2e6b0c41'),
    pr: 'https://github.com/hobkin-sample/storefront/pull/479',
    about: 'After a password reset the login page sent a signed-in user back to itself. It now goes on to the page they asked for.',
    proof: 'pnpm test auth: 31 pass, with the redirect after a reset covered.',
    yes: 'It is the PR https://github.com/hobkin-sample/storefront/pull/479, and merging it merges it on GitHub.',
    reason: 'With proof, no conflict and no grade against it.',
    safety: { grade: 'safe', rating: 'A', stale: false },
    size: { lines: 22, files: 2 },
    choices: [
      { value: 'mergePr', label: 'Merge the PR on GitHub' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'open', label: 'Open the PR in the browser' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
]

const REFRESH: FinishedChange[] = [
  merging({
    slug: 'docs-site',
    project: 'docs-site',
    item: 'a7f3b9',
    title: 'Document the export command',
    grade: 'P2',
    branch: 'hobkin/a7f3b9-document-the-export-command',
    head: sha('77c1e9f0'),
    pr: 'https://github.com/hobkin-sample/docs/pull/71',
    about: 'A page for `export`, with an example for each format and what to do when the file is too large.',
    proof: 'The docs build passes and every example on the page runs as written.',
    yes: 'It is the PR https://github.com/hobkin-sample/docs/pull/71, and merging it merges it on GitHub.',
    reason: '2 commits behind its base, so an agent brings it up to date first.',
    safety: { grade: 'safe', rating: 'A', stale: false },
    size: { lines: 140, files: 3 },
    behind: 2,
    landing: 'refreshMerge',
    choices: [
      { value: 'refreshMerge', label: 'Refresh and merge the PR' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'open', label: 'Open the PR in the browser' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
]

const NEEDS: FinishedChange[] = [
  merging({
    slug: 'storefront',
    project: 'storefront',
    item: 'd2c4e8',
    title: 'Move the cart into one module',
    grade: 'P1',
    branch: 'hobkin/d2c4e8-move-the-cart-into-one-module',
    head: sha('c0ffee12'),
    pr: null,
    about: 'The cart lived in three files that each kept part of its state. It is one module now, with one place that writes it.',
    // A long proof, which hobkin sends whole up to 2000 characters (`LONGEST_PROOF` in its `src/cli/work/reads.mjs`): two lines show, and all of it on Show all.
    proof:
      'pnpm test: 214 pass, with new tests for adding, removing and merging cart lines in the one module. pnpm typecheck passes. Checkout was run by hand with a guest and a signed-in customer: the totals, the shipping and the saved cart matched before and after the move. The three files that each kept part of the cart are gone, and nothing imports them any more. A cart saved by the old code loads in the new module, checked against a copy of 120 carts from last week, with 0 differences.',
    yes: 'It conflicts with the default branch, so it cannot merge until an agent rebases it.',
    reason: 'It conflicts with the default branch.',
    safety: { grade: 'safe', rating: 'B', stale: false },
    size: { lines: 410, files: 9 },
    conflict: true,
    choices: [
      { value: 'rebase', label: 'Have an agent rebase it' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
  merging({
    slug: 'billing-api',
    project: 'billing-api',
    item: '0f6a3b',
    title: 'Round invoices once',
    grade: 'P1',
    branch: 'hobkin/0f6a3b-round-invoices-once',
    head: sha('51d8a3be'),
    pr: null,
    about: 'Invoices rounded each line and then the total, so some came out a cent off. They round the total only.',
    proof: 'node --test test/invoices.test.ts: 40 pass.',
    yes: 'Merge it puts hobkin/0f6a3b-round-invoices-once (36 lines) into the default branch on this machine. Nothing is pushed.',
    reason: 'It is rated risky C at this commit.',
    safety: { grade: 'risky', rating: 'C', stale: false },
    size: { lines: 36, files: 3 },
    choices: [
      { value: 'review', label: 'Review it again' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'merge', label: 'Merge it anyway: it is rated risky' },
      { value: 'decline', label: 'Cancel it' },
    ],
  }),
]

function projects(now: number): WorkProject[] {
  const at = (hours: number) => new Date(now + hours * HOUR_MS).toISOString()
  const project = (rest: Partial<WorkProject> & Pick<WorkProject, 'slug' | 'priority' | 'prMode' | 'level'>): WorkProject => ({
    name: rest.slug,
    state: 'chosen',
    issues: 'off',
    paused: false,
    open: 0,
    prs: 0,
    branches: 0,
    left: 0,
    unmerged: 0,
    nextLookAt: null,
    lookError: null,
    ...rest,
  })
  return [
    project({ slug: 'storefront', priority: 'P0', prMode: 'draft', issues: 'labeled', level: 'critical', open: 4, prs: 1, branches: 2, unmerged: 3, nextLookAt: at(0.7) }),
    project({ slug: 'billing-api', priority: 'P1', prMode: 'off', level: 'important', open: 7, branches: 2, left: 1, unmerged: 2, nextLookAt: at(5) }),
    project({ slug: 'docs-site', priority: 'P2', prMode: 'published', level: 'casual', open: 2, prs: 1, nextLookAt: at(50) }),
    // What the look for projects found and the user has not answered, and one they left alone.
    project({ slug: 'design-kit', state: 'proposed', priority: 'P2', prMode: 'off', level: 'casual' }),
    project({ slug: 'old-landing', state: 'skipped', priority: 'P3', prMode: 'off', level: 'casual' }),
  ]
}

export function sampleWork(now = Date.now()): WorkState {
  return {
    enabled: true,
    folder: '~/code',
    autoPick: false,
    held: null,
    forecast: 'Next 8h: about 5 jobs · 1 P0 · 3 P1 · 1 P2 · 2 agents at a time. Auto-pick is off, so only picks and work on finished branches start.',
    agents: 2,
    agentsAllowed: 2,
    maxAgents: 8,
    queue: [
      { key: 'item:storefront:7a31c2', kind: 'item', slug: 'storefront', project: 'storefront', item: '7a31c2', title: 'Tighten the checkout tests', grade: 'P0', why: 'urgent, critical, high impact, small', waiting: null, skipped: false, picked: true, tokens: 180_000 },
      { key: 'look:billing-api', kind: 'look', slug: 'billing-api', project: 'billing-api', item: null, title: 'security look', grade: 'P1', why: 'important, due', waiting: 'a free worker', skipped: false, picked: false, tokens: 90_000 },
      { key: 'item:billing-api:e09b44', kind: 'item', slug: 'billing-api', project: 'billing-api', item: 'e09b44', title: 'Plan the rate limiter', grade: 'P1', why: 'important, high impact, large', waiting: null, skipped: false, picked: false, tokens: 420_000 },
      { key: 'item:docs-site:52d0f8', kind: 'item', slug: 'docs-site', project: 'docs-site', item: '52d0f8', title: 'Refresh the install guide', grade: 'P2', why: 'casual, medium impact, small', waiting: null, skipped: false, picked: false, tokens: 60_000 },
      { key: 'ideas:docs-site', kind: 'ideas', slug: 'docs-site', project: 'docs-site', item: null, title: 'new ideas', grade: 'P3', why: 'due', waiting: null, skipped: false, picked: false, tokens: 40_000 },
      { key: 'item:storefront:91f0aa', kind: 'item', slug: 'storefront', project: 'storefront', item: '91f0aa', title: 'Try a lighter product grid', grade: 'P3', why: 'casual, low impact, medium', waiting: null, skipped: true, picked: false, tokens: 150_000 },
    ],
    queued: 7,
    projects: projects(now),
    finished: [groupOf('merge', READY), groupOf('refresh', REFRESH), groupOf('needs', NEEDS)],
  }
}
