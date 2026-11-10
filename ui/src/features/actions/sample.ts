import type { ActionItem } from './items.ts'

/**
 * Sample action items, shaped as hobkin files its decisions, until the host supplies hobkin's own
 * (012-reports-actions). Each kind hobkin files is here: a routine's question, a to-do a routine found,
 * hobkin asking about a routine, a work item's question, a step only the user can take, finished branches
 * waiting for a merge decision, and the pick of what work mode starts.
 */

const NOW = Date.now()
const HOUR_MS = 3_600_000

const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR_MS).toISOString()

const OFFER_CHOICES = (merge: string, read: string, no: string) => [
  { value: 'later', label: 'Later' },
  { value: 'merge', label: merge },
  { value: 'read', label: read },
  { value: 'no', label: no },
]

export const sampleItems: ActionItem[] = [
  {
    id: 'decision-renew-domain',
    key: 'action:routine:renewals:renew-domain',
    from: 'Routine renewals',
    question: 'The registrar sent three reminders, and the card on file expired in October, so the renewal will not go through by itself. The domain lapses in 12 days.',
    tldr: 'Renew the hobkin.dev domain before it lapses',
    choices: [
      { value: 'done', label: 'Done' },
      { value: 'hobkin', label: 'Do it with hobkin' },
      { value: 'drop', label: 'Not doing it' },
    ],
    answerTo: { kind: 'action', id: 'renewals' },
    recommended: null,
    why: 'The site and the docs go offline if it lapses.',
    changed: null,
    links: [{ label: 'Registrar account', url: 'https://registrar.example.com/domains/hobkin.dev' }],
    at: hoursAgo(70),
  },
  {
    id: 'decision-reading-list',
    key: 'routines:routine:reading-list',
    from: 'hobkin',
    question: 'Reading list ran 14 times, and 2 of its reports were opened. Keep it running every day?',
    tldr: 'Reading list: 2 of its last 14 reports opened',
    choices: [
      { value: 'keep', label: 'Keep it daily' },
      { value: 'weekly', label: 'Run it weekly' },
      { value: 'pause', label: 'Pause it' },
    ],
    answerTo: { kind: 'routines', subject: 'routine', id: 'reading-list' },
    recommended: 'weekly',
    why: 'Most days it finds nothing new, and a weekly run would catch the same posts.',
    changed: null,
    at: hoursAgo(52),
  },
  {
    id: 'decision-newsletter',
    key: 'routine:inbox-sweep:5d1e0c7a9b2f4e18',
    from: 'Routine inbox-sweep',
    question: "Unsubscribe from the cloud provider's weekly newsletter?",
    tldr: "Unsubscribe from the cloud provider's weekly newsletter?",
    choices: [
      { value: 'yes', label: 'Unsubscribe' },
      { value: 'no', label: 'Keep it' },
    ],
    answerTo: { kind: 'routine', id: 'inbox-sweep' },
    recommended: 'yes',
    why: 'It has not been opened in 9 weeks, and the same news arrives in the release notes.',
    changed: 'It now arrives twice a week.',
    at: hoursAgo(46),
  },
  {
    id: 'decision-orchard-offer',
    key: 'offer:orchard:5e77a1',
    from: 'Work mode',
    question: [
      "orchard: Keep the orchard's books by season · reviewed, two notes · 5,271 lines",
      'Risk: Every ledger entry is saved a new way.',
      'Undo: Revert the merge commit, then run the season migration backwards.',
    ].join('\n'),
    tldr: "orchard: Keep the orchard's books by season",
    choices: OFFER_CHOICES('Merge it', 'Read it', 'Not this one'),
    answerTo: { kind: 'merge', slug: 'orchard', item: '5e77a1', head: '9b41f02' },
    recommended: 'read',
    why: 'It is a large change, and its review left two notes.',
    changed: null,
    at: hoursAgo(40),
  },
  {
    id: 'decision-webhook-secret',
    key: 'yours:billing-api:b72e10',
    from: 'Work mode, billing-api',
    question: "Rotating the webhook signing secret needs the payment provider's dashboard, which only you can sign in to. The new secret goes in the WEBHOOK_SECRET variable.",
    tldr: 'billing-api: Rotate the webhook signing secret',
    choices: [
      { value: 'done', label: 'Mark it done' },
      { value: 'talk', label: 'Talk it over in Chat' },
      { value: 'decline', label: 'Not needed' },
    ],
    answerTo: { kind: 'yours', slug: 'billing-api', item: 'b72e10' },
    recommended: null,
    why: null,
    changed: null,
    at: hoursAgo(30),
  },
  {
    id: 'decision-stripe-key',
    key: 'work:storefront:3fa9c1:stripe-key',
    from: 'Work mode, storefront',
    question: 'The checkout test needs a Stripe test key. Which one should it use?',
    tldr: 'The checkout test needs a Stripe test key',
    choices: [
      { value: 'shared', label: "Use the team's shared test key" },
      { value: 'new', label: 'Create a restricted key for this repo' },
      { value: 'skip', label: 'Skip the checkout test for now' },
    ],
    answerTo: { kind: 'work', slug: 'storefront', item: '3fa9c1' },
    recommended: 'new',
    why: 'A restricted key can only make test charges, and it can be revoked without touching other projects.',
    changed: null,
    at: hoursAgo(16),
  },
  {
    id: 'decision-hobkin-offer',
    key: 'offer:hobkin:7d02c9',
    from: 'Work mode',
    question: [
      'hobkin: Say what the main agent is doing, above the input · reviewed, no concerns · 113 lines',
      'Like "Show the model under the input", merged 6 days ago.',
      'Risk: On a short window the status line could cover the last message.',
      'Undo: Revert the merge commit. Nothing else depends on it.',
    ].join('\n'),
    tldr: 'hobkin: Say what the main agent is doing, above the input',
    choices: OFFER_CHOICES('Merge it', 'Read it', 'Not this one'),
    answerTo: { kind: 'merge', slug: 'hobkin', item: '7d02c9', head: '7d02c99' },
    recommended: null,
    why: null,
    changed: null,
    at: hoursAgo(5),
  },
  {
    id: 'decision-pickup',
    key: 'pickup',
    from: 'Work mode',
    question: [
      'Work mode is on, and nothing new starts by itself. Next in the queue:',
      '1. P1 billing-api: Retry failed webhooks with backoff',
      '2. P1 billing-api: Upgrade jsonwebtoken to 9.0.3',
      '3. P2 storefront: Load product images as they scroll into view',
      '4. P2 docs-site: Write the billing guide',
      '2 more wait behind these.',
    ].join('\n'),
    tldr: 'Pick what work mode starts: 6 waiting in the queue',
    choices: [
      { value: 'later', label: 'Not now' },
      { value: 'these', label: 'Start these 4' },
      { value: 'first', label: 'Start the first one' },
      { value: 'auto', label: 'Let it run the whole queue' },
    ],
    answerTo: { kind: 'pickup', keys: ['billing-api:retry-webhooks', 'billing-api:jsonwebtoken', 'storefront:lazy-images', 'docs-site:billing-guide'] },
    recommended: null,
    why: null,
    changed: null,
    at: hoursAgo(2),
  },
]

/**
 * The review Change Review opens for a finished branch. The review screen has two sample reviews so far,
 * built from these two changes. With the host, the branch itself names its review.
 */
const SAMPLE_REVIEWS: Record<string, string> = { '7d02c9': 'sample', '5e77a1': 'stress' }

export function sampleReviewFor(item: ActionItem): string {
  const branch = String(item.answerTo?.item ?? '')
  return Object.hasOwn(SAMPLE_REVIEWS, branch) ? SAMPLE_REVIEWS[branch]! : 'sample'
}
