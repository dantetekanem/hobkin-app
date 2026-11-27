import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProviderAccess } from '../../shared/protocol/models.ts'
import type { PendingQuestion } from '../../shared/protocol/question.ts'
import type { PiSetup, ProjectFolder, SetupProjectOutcome, SetupProjectWhy, SetupSaved, SetupWorkDone } from '../../shared/protocol/setup.ts'
import { codexProvider, connectedNames } from '../src/features/onboarding/accounts.ts'
import { balance, GLOW, GROW, shadesFor } from '../src/features/onboarding/balance.ts'
import { cloudWayOn, foldersPicked, matching, ownOption, pickedAnswer, picksOf, PICKS_SHOWN, shownOf, togglePick } from '../src/features/onboarding/picks.ts'
import { CODE_QUESTIONS, pickedSuggestions, startingReply, toggleSuggestion } from '../src/features/onboarding/questions.ts'
import { GOAL_BUBBLES, GOALS, goalsOf, setupAnswersOf } from '../src/features/onboarding/goals.ts'
import { cardPicksOf, dropCard, keepCard, NO_PICKS, picksFrom, type Card, type CardPicks, type GoalCards } from '../src/features/onboarding/cards.ts'
import {
  beatAfter,
  beatOf,
  checkAnswer,
  followUpOf,
  piByHand,
  piecesOf,
  piHandWords,
  piNeeds,
  piSteps,
  skipShows,
  spokenText,
  startTale,
  tellOn,
  holdsAt,
  troubleAt,
  workSaid,
  type Answers,
  type BeatId,
  type Facts,
  type Tale,
  type TaleEvent,
} from '../src/features/onboarding/story.ts'
import { resolveTaleKey, type TaleKeyContext, type TalePress } from '../src/features/onboarding/tale-keys.ts'

const pi = (over: Partial<PiSetup> = {}): PiSetup => ({
  installed: true,
  version: '1.5.0',
  pinned: '1.5.0',
  matches: true,
  canInstall: true,
  installCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0',
  packages: [{ name: 'pi-coder', adds: 'Opens a branch as a diff.', installed: true }],
  ...over,
})

/** A Mac hobkin knows nothing about yet: the host has not said what Pi is here, and no account is connected. */
const bare: Facts = { pi: null, connected: [], claude: false, smart: false, asked: null }
const none: Answers = { replies: {} }
/** Connected to a real model, so main hobkin can ask questions of its own, and has none open yet. */
const smart: Facts = { ...bare, connected: ['OpenAI'], smart: true }

/** A question main hobkin has open, as the host hands it to the window. */
const pending = (over: Partial<PendingQuestion> = {}): PendingQuestion => ({
  id: 'ask-1',
  from: 'hobkin',
  question: 'Which of these should I check first each morning?',
  choices: [
    { value: 'mail', label: 'Mail' },
    { value: 'prs', label: 'Pull requests' },
  ],
  other: true,
  askedAt: 0,
  expiresAt: null,
  ...over,
})

/** The beats from one to the end, answering as `answers` says. */
function walk(answers: Answers, facts: Facts, from: BeatId = 'hello'): BeatId[] {
  const beats: BeatId[] = [from]
  for (let next = beatAfter(from, answers, facts); next; next = beatAfter(next, answers, facts)) beats.push(next)
  return beats
}

const tell = (events: TaleEvent[], answers: Answers = none, facts: Facts = bare, from: Tale = startTale()) =>
  events.reduce((tale, event) => tellOn(tale, event, answers, facts), from)

test('the story opens on the hello and is told one bubble at a time', () => {
  const hello = beatOf('hello', none, bare)
  const second = tell(['on'])

  assert.deepEqual(startTale(), { at: 'hello', line: 0, trail: [], ended: null })
  assert.equal(hello.lines.length, 2)
  assert.deepEqual(second, { at: 'hello', line: 1, trail: [], ended: null })
  assert.equal(tell(['on', 'on']).at, 'sound', 'past its last bubble the next beat starts')
  assert.deepEqual(tell(['on', 'on']).trail, ['hello'])
})

test('a question holds the story until it is answered', () => {
  const asking: Tale = { at: 'goals', line: 1, trail: ['hello', 'sound'], ended: null }

  assert.equal(beatOf('goals', none, bare).lines.length, 2, 'the question is asked with the last bubble')
  assert.deepEqual(tellOn({ ...asking, line: 0 }, 'on', none, bare), asking)
  assert.deepEqual(tell(['on', 'on'], none, bare, asking), asking, 'going on does not pass a question')
  assert.equal(tellOn(asking, 'answered', { ...none, goals: ['job'] }, bare).at, 'goals-said')
})

test('a bubble that only asks to go on is passed by going on', () => {
  const ready: Tale = { at: 'subscription', line: beatOf('subscription', none, bare).lines.length - 1, trail: [], ended: null }

  assert.equal(beatOf('subscription', none, bare).ask?.kind, 'go')
  assert.notEqual(tellOn(ready, 'on', none, bare).at, 'subscription')
})

test('a new Mac with goals: Pi and a sign-in first, then who the person is, the goals, the cards, the writing, the first run, then the app', () => {
  const answers: Answers = {
    ...none,
    goals: ['job', 'project'],
    computer: 'personal',
    name: 'Ada',
    pi: 'installed',
    account: 'connected',
    more: true,
    cards: keepCard(NO_PICKS, 'job-openings').picks,
    firstRun: 'run',
  }
  const written = [{ card: card('job-openings'), routine: { id: 'roles', title: 'Roles that fit', template: 'job-openings@1', enabled: true } }]
  const facts: Facts = { ...smart, host: true, pi: pi({ installed: false, version: null, matches: false }), connected: [], cards: groups, written }

  assert.deepEqual(walk(answers, facts), [
    'hello',
    'sound',
    'subscription',
    'pi',
    'pi-ready',
    'connect',
    'connected',
    'name',
    'name-hi',
    'email',
    'goals',
    'goals-said',
    // Whose computer it is was said already, so it is not asked again. Where it is asked is tested below.
    'more',
    'q1',
    'q2',
    'cards-project',
    'cards-job',
    'routines-need',
    'writing',
    'written',
    'first-run',
    'first-run-started',
    'thanks',
    'usage',
    'needs',
    'settings',
    'tour',
  ])
})

test('Pi is only brought up when something of it is missing', () => {
  const after = (state: PiSetup | null) => beatAfter('subscription', none, { ...bare, pi: state })
  const missingPackage = pi({ packages: [{ name: 'pi-coder', adds: '', installed: false }] })

  assert.equal(after(pi()), 'connect', 'Pi and its packages are here')
  assert.equal(after(null), 'connect', 'no host has said, as in a browser tab')
  assert.equal(after(pi({ installed: false, version: null, matches: false })), 'pi')
  assert.equal(after(pi({ version: '1.4.2', matches: false })), 'pi')
  assert.equal(after(missingPackage), 'pi')

  assert.equal(piNeeds(pi()), null)
  assert.equal(piNeeds(pi({ installed: false, version: null, matches: false })), 'pi')
  assert.equal(piNeeds(pi({ version: '1.4.2', matches: false })), 'version')
  assert.equal(piNeeds(missingPackage), 'packages')
})

test('what hobkin says about Pi follows what is missing, and putting it off is said plainly', () => {
  const other = beatOf('pi', none, { ...bare, pi: pi({ version: '1.4.2', matches: false }) })
  const absent = beatOf('pi', none, { ...bare, pi: pi({ installed: false, version: null, matches: false }) })

  assert.match(other.lines.join(' '), /1\.4\.2/)
  assert.match(other.lines.join(' '), /1\.5\.0/)
  assert.doesNotMatch(absent.lines.join(' '), /1\.4\.2/)
  assert.equal(absent.ask?.kind, 'pi')
  assert.equal(beatAfter('pi', { ...none, pi: 'later' }, bare), 'pi-later')
  assert.equal(beatAfter('pi', { ...none, pi: 'installed' }, bare), 'pi-ready')
})

/** A Mac without npm, as a host that sends the Node facts says it: no Node at all, and hobkin can install its own. */
const noNode = (over: Partial<PiSetup> = {}) =>
  pi({ installed: false, version: null, matches: false, canInstall: false, node: { found: false, version: null, installs: '26.1.0' }, canInstallNode: true, ...over })
const ids = (state: PiSetup) => piSteps(state).map(({ id }) => id)
const missingCoder = [{ name: 'pi-coder', adds: 'Opens a branch as a diff.', installed: false }]

test('without npm the install starts with a Node of hobkin\'s own, then Pi, then the packages', () => {
  assert.deepEqual(ids(pi({ installed: false, version: null, matches: false, packages: missingCoder })), ['pi', 'pi-coder'], 'with npm there is no Node step')
  assert.deepEqual(ids(noNode({ packages: missingCoder })), ['node', 'pi', 'pi-coder'])
  assert.deepEqual(ids(noNode({ installed: true, version: '1.5.0', matches: true, packages: missingCoder })), ['node', 'pi-coder'], 'Pi adds its packages through npm too')

  const [node, piItself] = piSteps(noNode())
  assert.deepEqual([node!.kind, node!.name], ['node', 'Node 26.1.0'])
  assert.match(node!.adds, /\S/)
  assert.deepEqual([piItself!.kind, piItself!.name], ['pi', 'Pi 1.5.0'])
  assert.equal(piByHand(noNode()), false, 'the window installs it all')
})

test('without npm and no way to install Node, the steps are as before and the user installs by hand', () => {
  const cannot = noNode({ canInstallNode: false, packages: missingCoder })
  const { node: _node, canInstallNode: _can, ...before } = cannot

  assert.deepEqual(ids(cannot), ['pi', 'pi-coder'])
  assert.equal(piByHand(cannot), true)
  // A host from before sends no Node facts, and the panel does what it did.
  assert.deepEqual(ids(before), ['pi', 'pi-coder'])
  assert.equal(piByHand(before), true)
  assert.equal(piByHand(pi({ installed: false, version: null, matches: false })), false, 'with npm the window installs Pi')
  assert.equal(piByHand(pi({ canInstall: false, packages: missingCoder })), false, 'only packages missing: the window tries, as before')
})

test('installing by hand says first what is missing, then how to get Node, then the line to run', () => {
  const absent = piHandWords(noNode({ canInstallNode: false }))
  assert.match(absent, /^I can't find Node on this Mac, so I can't install Pi myself\./)
  assert.match(absent, /Node 22\.19 or newer from nodejs\.org/)
  assert.match(absent, /run this in Terminal/)

  assert.match(piHandWords(noNode({ canInstallNode: false, node: { found: true, version: '20.11.0', installs: '26.1.0' } })), /^I found Node 20\.11\.0 but no npm, so I can't install Pi myself\./)
  const { node: _node, canInstallNode: _can, ...before } = noNode()
  assert.match(piHandWords(before), /^I can't find npm on this Mac, so I can't install Pi myself\./)
  for (const words of [absent, piHandWords(before)]) assert.doesNotMatch(words, /[—–]/)
})

test('what hobkin says about Pi without npm names Node, and offers to install it only when it can', () => {
  const lines = (state: PiSetup) => beatOf('pi', none, { ...bare, pi: state }).lines.join(' ')

  assert.match(lines(noNode()), /Node isn't on this Mac/)
  assert.match(lines(noNode()), /Want me to install Node and Pi\?/)
  assert.match(lines(noNode({ installed: true, version: '1.4.2' })), /Want me to install Node, then Pi 1\.5\.0\?/)
  assert.match(lines(noNode({ installed: true, version: '1.5.0', matches: true, packages: missingCoder })), /Want me to install Node, then add them\?/)

  const cannot = lines(noNode({ canInstallNode: false }))
  assert.match(cannot, /Node isn't on this Mac/)
  assert.doesNotMatch(cannot, /Want me to/)
  assert.match(lines(noNode({ canInstallNode: false, node: { found: true, version: '20.11.0', installs: '26.1.0' } })), /Node on this Mac \(20\.11\.0\) has no npm/)

  // With npm, hobkin says what it always said.
  assert.equal(lines(pi({ installed: false, version: null, matches: false })), "I run on Pi, and I can't find it on this Mac. Want me to install it? I'll add the packages my agents use too.")
})

test('an account Pi already reaches is found, and none leads to the sign-in', () => {
  const found: Facts = { ...bare, connected: ['OpenAI', 'Anthropic'] }

  assert.equal(beatAfter('subscription', none, found), 'found')
  assert.match(beatOf('found', none, found).lines.join(' '), /OpenAI and Anthropic/)
  assert.equal(beatAfter('found', none, found), 'name', 'then who the person is')
  assert.equal(beatAfter('subscription', none, bare), 'connect')
  assert.equal(beatOf('connect', none, bare).ask?.kind, 'connect')
})

test('with Claude Code signed in, hobkin says it can use it too', () => {
  const claude: Facts = { ...bare, connected: ['OpenAI'], claude: true }

  assert.match(beatOf('found', none, claude).lines.join(' '), /Claude Code/)
  assert.doesNotMatch(beatOf('found', none, { ...claude, claude: false }).lines.join(' '), /Claude Code/)
})

test('with its first models set, hobkin says in one more bubble, after the others, what it picked and that Settings changes it', () => {
  const at = (model: string, name: string, effort: 'low' | 'medium' | 'high' | 'max') => ({ model: `openai-codex/${model}`, name, effort })
  const sol = (effort: 'medium' | 'high' | 'max') => at('gpt-6.1-sol', 'GPT-6.1 Sol', effort)
  const models: Facts['models'] = {
    set: true,
    provider: { id: 'openai-codex', name: 'OpenAI Codex' },
    lead: sol('medium'),
    checks: sol('medium'),
    tiers: { fast: at('gpt-6-luna', 'GPT-6 Luna', 'low'), mid: sol('medium'), high: sol('high'), max: sol('max') },
  }
  const before: Facts = { ...bare, connected: ['OpenAI Codex'], claude: true }

  for (const beat of ['found', 'connected'] as const) {
    const without = beatOf(beat, none, before).lines
    const said: readonly string[] = beatOf(beat, none, { ...before, models }).lines
    // Set while the beat is up, the bubble comes after the ones already said, so none of them moves.
    assert.deepEqual(said.slice(0, -1), without, beat)
    assert.match(said.at(-1)!, /GPT-6\.1 Sol.*GPT-6 Luna.*Settings/, beat)
    // Nothing set, as on a home where a model was chosen before: no bubble.
    assert.deepEqual(beatOf(beat, none, { ...before, models: { set: false, why: 'chosen' } }).lines, without, beat)
  }
  // One model for everything is said once.
  const one = { ...models, tiers: { ...models.tiers, fast: sol('medium') } }
  const line = beatOf('found', none, { ...before, models: one }).lines.at(-1)!
  assert.equal(line.split('GPT-6.1 Sol').length, 2, line)
})

test('the account holds the story like Pi: nothing puts it off, and a provider that connects moves it on', () => {
  const at: Tale = { at: 'connect', line: 0, trail: [], ended: null }

  assert.deepEqual(tellOn(at, 'on', none, bare), at, 'going on waits for an account')
  assert.deepEqual(tellOn(at, 'skip', none, { ...bare, pi: pi() }), at, 'and so does skipping')
  assert.equal(tellOn(at, 'answered', { ...none, account: 'connected' }, bare).at, 'connected')
  assert.equal(beatAfter('connected', { ...none, account: 'connected' }, bare), 'name')

  // An unfinished setup comes back to the step that holds it: Pi itself missing, or no account.
  assert.equal(holdsAt('connect', bare), true)
  assert.equal(holdsAt('pi', { ...bare, pi: pi({ installed: false, version: null, matches: false }) }), true)
  assert.equal(holdsAt('pi', { ...bare, pi: pi({ packages: [{ name: 'pi-coder', adds: '', installed: false }] }) }), false, 'missing packages can wait')
  assert.equal(holdsAt('found', { ...bare, connected: ['OpenAI'] }), false)
  assert.equal(holdsAt('name', bare), false)
})

test('with a host, the question about usage counts and the review of what hobkin needs come just before the settings, however the story got there', () => {
  const host: Facts = { ...bare, host: true }

  assert.equal(beatAfter('goals-said', { ...none, goals: ['code'] }, host), 'usage', 'no account: no routines')
  assert.equal(beatAfter('more', { ...none, more: false }, host), 'usage')
  assert.equal(beatAfter('thanks', none, host), 'usage')
  assert.equal(beatAfter('goals-said', { ...none, account: 'connected' }, host), 'usage', 'with no goal no routines are offered')
  assert.equal(beatAfter('usage', none, host), 'needs')
  assert.equal(beatAfter('needs', none, host), 'settings')
  assert.equal(beatOf('needs', none, host).ask?.kind, 'needs')
  // Without a host there is nothing to read, as in a browser tab on sample data.
  assert.equal(beatAfter('more', { ...none, more: false }, bare), 'settings')
})

test('while main hobkin writes the story waits, and the question it opens is asked in its own words', () => {
  const at: Tale = { at: 'writing', line: 0, trail: [], ended: null }
  const asked = followUpOf(pending())
  const thinking = beatOf('writing', none, smart)
  const asking = beatOf('writing', none, { ...smart, asked })

  assert.equal(thinking.lines.length, 1, 'one line while it thinks')
  assert.deepEqual(thinking.ask, { kind: 'wait' })
  assert.deepEqual(asking.lines, ['Which of these should I check first each morning?'])
  assert.deepEqual(asking.ask, { kind: 'follow-up', question: 'ask-1', options: pending().choices, typed: true })
  assert.deepEqual(tellOn(at, 'on', none, smart), at, 'waiting holds the story')
  assert.deepEqual(tellOn(at, 'on', none, { ...smart, asked }), at, 'and so does a question')
  assert.equal(tellOn(at, 'answered', none, { ...smart, asked }).at, 'written', 'once it is over, what was written')
})

test("only main hobkin's own question is asked in the story, and a choice without a label is said by its value", () => {
  const unlabeled = pending({ question: '  Which one?  ', choices: [{ value: 'a', label: '' }, { value: 'b', label: 'Bee' }], other: false })

  assert.deepEqual(followUpOf(unlabeled), { id: 'ask-1', words: 'Which one?', choices: [{ value: 'a', label: 'a' }, { value: 'b', label: 'Bee' }], typed: false })
  assert.equal(followUpOf(pending({ from: 'Routine inbox-sweep' })), null, "a routine's question is left to the question sheet")
  assert.equal(followUpOf(null), null)
})

test('hobkin asks about sound right after the hello, before anything else, and then needs something to think with', () => {
  const sound = beatOf('sound', none, bare)

  assert.equal(beatAfter('hello', none, bare), 'sound')
  assert.equal(beatAfter('sound', none, bare), 'subscription')
  assert.equal(sound.ask?.kind === 'choice' && sound.ask.field, 'sound')
})

test('the name is said back', () => {
  assert.deepEqual(beatOf('name-hi', { ...none, name: 'Ada' }, bare).lines, ['Hi, Ada!'])
})

test('back goes one bubble back, then to the beat before', () => {
  const second = tell(['on'])
  const asking: Tale = { at: 'goals', line: 1, trail: ['hello'], ended: null }

  assert.deepEqual(tellOn(second, 'back', none, bare), startTale())
  assert.deepEqual(tellOn(startTale(), 'back', none, bare), startTale(), 'nothing is behind the first bubble')
  assert.equal(tellOn(asking, 'back', none, bare).line, 0)
  assert.deepEqual(tell(['back', 'back'], none, bare, asking), { at: 'hello', line: 1, trail: [], ended: null }, 'it lands on the last bubble of the beat before')
})

test('back never undoes an install or a sign-in', () => {
  const installed: Answers = { ...none, pi: 'installed' }
  const facts: Facts = { ...bare, pi: pi({ installed: false, version: null, matches: false }) }
  const atPi: Tale = { at: 'pi', line: 1, trail: ['hello', 'subscription'], ended: null }
  const ready = tellOn(atPi, 'answered', installed, facts)

  assert.equal(ready.at, 'pi-ready')
  assert.deepEqual(ready.trail, [], 'what came before is out of reach')
  assert.deepEqual(tellOn(ready, 'back', installed, facts), ready)
})

test('skip shows only once Pi is in and a model account answers, and before that no way of skipping does anything', () => {
  const ready: Facts = { ...bare, pi: pi(), connected: ['OpenAI Codex'] }
  const missingPackage = pi({ packages: [{ name: 'pi-coder', adds: '', installed: false }] })

  assert.equal(skipShows(none, bare), false, 'no host has said what Pi is here')
  assert.equal(skipShows(none, { ...bare, pi: pi() }), false, 'Pi, and no account')
  assert.equal(skipShows(none, { ...ready, pi: pi({ installed: false, version: null, matches: false }) }), false, 'an account, and no Pi')
  assert.equal(skipShows(none, { ...ready, pi: pi({ version: '1.4.2', matches: false }) }), false, 'a Pi older than hobkin runs on')
  assert.deepEqual(tell(['on', 'skip']), tell(['on']), 'skip does nothing before both')

  assert.equal(skipShows(none, ready), true)
  assert.equal(skipShows({ ...none, account: 'connected' }, { ...bare, pi: pi() }), true, 'signed in during the setup')
  assert.equal(skipShows({ ...none, launcher: 'saved' }, { ...bare, pi: pi() }), true, 'a launcher that was kept')
  assert.equal(skipShows(none, { ...ready, pi: missingPackage }), true, 'missing packages can wait')
})

test('skip ends the story from anywhere once it shows, the last bubble ends it as done, and then nothing moves', () => {
  const ready: Facts = { ...bare, pi: pi(), connected: ['OpenAI Codex'] }
  const skipped = tell(['on', 'skip'], none, ready)
  const last: Tale = { at: 'tour', line: beatOf('tour', none, bare).lines.length - 1, trail: [], ended: null }
  const done = tellOn(last, 'on', none, bare)

  assert.equal(skipped.ended, 'skipped')
  assert.equal(skipped.at, 'hello', 'it ends where it was')
  assert.equal(done.ended, 'done')
  for (const event of ['on', 'back', 'skip', 'answered'] as const) {
    assert.deepEqual(tellOn(done, event, none, ready), done)
    assert.deepEqual(tellOn(skipped, event, none, ready), skipped)
  }
})

test('every beat has words, and only the last bubble of a beat asks', () => {
  const answers: Answers = { ...none, goals: ['job', 'business', 'project', 'life', 'code'], computer: 'work', name: 'Ada', more: true, cards: keepCard(NO_PICKS, 'job-openings').picks }
  const written = [{ card: card('job-openings'), routine: { id: 'roles', title: 'Roles that fit', template: 'job-openings@1', enabled: true } }]
  const facts: Facts = { pi: pi({ installed: false, version: null, matches: false }), connected: ['OpenAI'], claude: true, smart: true, asked: null, cards: groups, written }
  const long = followUpOf(pending({ question: `${'Which of your projects should I watch first, and how often, '.repeat(3)}and why?` }))
  const ids: BeatId[] = [
    'hello', 'sound', 'goals', 'goals-said', 'computer', 'computer-work', 'name', 'name-hi', 'email', 'subscription', 'computer-late', 'launcher', 'pi', 'pi-ready',
    'pi-later', 'found', 'connect', 'connected', 'more', 'q1', 'q2', 'q3', 'q4', 'projects-said', 'q5', 'q6', 'cards-job', 'cards-business',
    'cards-project', 'cards-life', 'cards-code', 'routines-need', 'writing', 'written', 'first-run', 'first-run-started', 'thanks', 'usage', 'needs', 'settings', 'tour',
  ]

  for (const asked of [null, long]) {
    for (const id of ids) {
      const beat = beatOf(id, answers, { ...facts, asked })
      assert.equal(beat.id, id)
      assert.ok(beat.lines.length > 0, `${id} says something`)
      // Main hobkin's own question is said whole, as long as it made it.
      if (id === 'writing' && asked) continue
      for (const line of beat.lines) assert.ok(line.trim().length > 0 && line.length <= 110, `${id}: a bubble is short enough to read at a glance`)
    }
  }
  assert.ok(long!.words.length > 110, 'the long question is longer than any of the story own bubbles')
})

test('a name is needed and an email can be left out, each held to what hobkin keeps', () => {
  assert.equal(checkAnswer('name', '  Ada  '), null)
  assert.match(checkAnswer('name', '   ') ?? '', /name/i)
  assert.ok(checkAnswer('name', 'a'.repeat(121)))
  assert.equal(checkAnswer('email', ''), null, 'no email is fine')
  assert.equal(checkAnswer('email', 'ada@example.invalid'), null)
  assert.ok(checkAnswer('email', 'ada at example'))
  assert.ok(checkAnswer('email', 'a@b c'))
})

test('the two choices balance: the one the pointer nears grows as the other shrinks', () => {
  const left = { x: 300, y: 400 }
  const right = { x: 900, y: 400 }
  const [farLeft, farRight] = balance({ x: 600, y: -2000 }, left, right)
  const [onLeft, offRight] = balance(left, left, right)
  const [nearLeft, nearRight] = balance({ x: 380, y: 400 }, left, right)
  const [midLeft, midRight] = balance({ x: 600, y: 400 }, left, right)

  assert.deepEqual([farLeft, farRight], [1, 1], 'far from both, both rest')
  assert.equal(onLeft, 1 + GROW)
  assert.equal(offRight, 1 - GROW)
  assert.ok(nearLeft > 1 && nearLeft < onLeft && nearRight < 1 && nearRight > offRight, 'it follows the distance')
  assert.ok(Math.abs(nearLeft + nearRight - 2) < 1e-9, 'what one gains the other gives')
  assert.deepEqual([midLeft, midRight], [1, 1], 'between them, neither wins')
  assert.ok(GROW <= 0.1, 'the change stays slight')
})

const provider = (id: string, name: string, more: Partial<ProviderAccess> = {}): ProviderAccess => ({ id, name, connected: false, ...more })

test('the sign-in the setup offers is the OpenAI subscription Pi lists', () => {
  const codex = provider('openai-codex', 'OpenAI Codex', { signIn: { label: 'ChatGPT Plus/Pro', subscription: true } })
  const key = provider('openai', 'OpenAI', { apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] } })
  const claude = provider('anthropic', 'Anthropic', { signIn: { label: 'Claude Pro/Max', subscription: true } })
  const sample = provider('openai', 'OpenAI', { signIn: { label: 'Sign in with ChatGPT', subscription: true } })

  assert.equal(codexProvider([claude, key, codex])?.id, 'openai-codex')
  assert.equal(codexProvider([claude, sample])?.id, 'openai', 'whatever Pi calls it, as long as it is OpenAI and signs in')
  assert.equal(codexProvider([claude, key]), null, 'a key is not a subscription')
  assert.deepEqual(connectedNames([{ ...codex, connected: true }, claude, { ...key, connected: true }]), ['OpenAI Codex', 'OpenAI'])
})

/** The keyboard on the story itself, with a bubble fully said and nothing being asked. */
const idle: TaleKeyContext = { typing: false, pressable: false, asking: null, signingIn: false, busy: false }
const key = (name: string, more: Partial<TalePress> = {}): TalePress => ({ key: name, ...more })

test('Enter, Space and Right go on, and a field or a button keeps its own Enter', () => {
  for (const name of ['Enter', ' ', 'ArrowRight']) assert.deepEqual(resolveTaleKey(key(name), idle), { do: 'on' })
  assert.equal(resolveTaleKey(key('Enter'), { ...idle, typing: true }), null)
  assert.equal(resolveTaleKey(key(' '), { ...idle, typing: true }), null, 'a space is typed')
  assert.equal(resolveTaleKey(key('ArrowRight'), { ...idle, typing: true }), null, 'the caret moves')
  assert.equal(resolveTaleKey(key('Enter'), { ...idle, pressable: true }), null)
  assert.equal(resolveTaleKey(key(' '), { ...idle, pressable: true }), null)
  assert.equal(resolveTaleKey(key('Enter', { shift: true }), idle), null)
})

test('Escape and Left go back, Escape stops a sign-in first, and nothing goes back during an install', () => {
  assert.deepEqual(resolveTaleKey(key('Escape'), idle), { do: 'back' })
  assert.deepEqual(resolveTaleKey(key('ArrowLeft'), idle), { do: 'back' })
  assert.deepEqual(resolveTaleKey(key('Escape'), { ...idle, typing: true }), { do: 'back' })
  assert.equal(resolveTaleKey(key('ArrowLeft'), { ...idle, typing: true }), null, 'the caret moves')
  assert.deepEqual(resolveTaleKey(key('Escape'), { ...idle, signingIn: true }), { do: 'cancel-signin' })
  assert.equal(resolveTaleKey(key('Escape'), { ...idle, busy: true }), null)
  assert.equal(resolveTaleKey(key('ArrowLeft'), { ...idle, busy: true }), null)
})

test('with two choices up, Left and Right reach for them instead', () => {
  const choosing: TaleKeyContext = { ...idle, asking: 'choice' }

  assert.deepEqual(resolveTaleKey(key('ArrowLeft'), choosing), { do: 'reach', side: 'left' })
  assert.deepEqual(resolveTaleKey(key('ArrowRight'), choosing), { do: 'reach', side: 'right' })
  assert.deepEqual(resolveTaleKey(key('ArrowLeft'), { ...choosing, pressable: true }), { do: 'reach', side: 'left' }, 'from one choice to the other')
  assert.deepEqual(resolveTaleKey(key('Escape'), choosing), { do: 'back' })
})

test('keys held with Command, Control or Option, and Tab, are not the story\'s', () => {
  for (const name of ['Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(resolveTaleKey(key(name, { meta: true }), idle), null)
    assert.equal(resolveTaleKey(key(name, { ctrl: true }), idle), null)
    assert.equal(resolveTaleKey(key(name, { alt: true }), idle), null)
  }
  assert.equal(resolveTaleKey(key('Tab'), idle), null)
})

test('picking a suggestion adds it to what is written, and picking it again takes it out', () => {
  assert.equal(toggleSuggestion('', 'Email'), 'Email')
  assert.equal(toggleSuggestion('Email', 'Bills'), 'Email, Bills')
  assert.equal(toggleSuggestion('Email, Bills', 'Email'), 'Bills')
  assert.equal(toggleSuggestion('my accountant ,  Bills', 'Calendar'), 'my accountant, Bills, Calendar')
  assert.equal(toggleSuggestion('email', 'Email'), '', 'however it was typed')
  assert.deepEqual(pickedSuggestions('Email, my bank', ['Email', 'Bills']), ['Email'])
})

test('a bubble is split into words, and a key between backticks stays one piece', () => {
  assert.deepEqual(piecesOf('just press `⌘,`'), [
    { text: 'just', key: false },
    { text: 'press', key: false },
    { text: '⌘,', key: true },
  ])
  assert.deepEqual(piecesOf('  Hi,  Ada! '), [
    { text: 'Hi,', key: false },
    { text: 'Ada!', key: false },
  ])
  assert.equal(spokenText('just press `⌘,`'), 'just press ⌘,', 'a screen reader hears it without the marks')
})

test('the bubble the pointer nears gets lighter as the other gets darker, by the same amount', () => {
  const [restLeft, restRight] = shadesFor(0)
  const [litLeft, dimRight] = shadesFor(1)
  const [dimLeft, litRight] = shadesFor(-0.5)

  assert.deepEqual([restLeft, restRight], [1, 1], 'at rest both have their own light')
  assert.equal(litLeft, 1 + GLOW)
  assert.equal(dimRight, 1 - GLOW)
  assert.ok(dimLeft < 1 && litRight > 1, 'it follows which way the pointer leans')
  assert.ok(Math.abs(dimLeft + litRight - 2) < 1e-9)
})

test('typing narrows the bubbles to what holds it, the ones that start with it first', () => {
  const options = ['api-gateway', 'my-blog', 'blog-theme', 'notes']

  assert.deepEqual(matching(options, ''), options, 'nothing typed, everything in its own order')
  assert.deepEqual(matching(options, ' BLOG '), ['blog-theme', 'my-blog'])
  assert.deepEqual(matching(options, 'zzz'), [])
})

test('at most fifty bubbles show at once, and the rest are counted', () => {
  const many = Array.from({ length: 64 }, (_, index) => `project-${index}`)

  assert.equal(PICKS_SHOWN, 50)
  assert.equal(shownOf(many).shown.length, 50)
  assert.equal(shownOf(many).more, 14)
  assert.deepEqual(shownOf(['a', 'b']), { shown: ['a', 'b'], more: 0 })
})

test('many bubbles can be picked, a picked one can be let go, and the answer keeps their order', () => {
  const picked = ['notes', 'my-blog'].reduce(togglePick, [] as string[])

  assert.deepEqual(picked, ['notes', 'my-blog'])
  assert.deepEqual(togglePick(picked, 'notes'), ['my-blog'])
  assert.equal(pickedAnswer(picked), 'notes, my-blog')
  assert.deepEqual(picksOf('notes, my-blog, gone', ['my-blog', 'notes'], false), ['notes', 'my-blog'], 'coming back, only what is still there')
  assert.deepEqual(picksOf('Email, My bank', ['Email'], true), ['Email', 'My bank'], 'an own one is kept where own ones are taken')
  assert.deepEqual(picksOf(undefined, ['a'], true), [])
})

test('a cloud goes on by Continue once something is picked, and by Skip while nothing is', () => {
  assert.equal(cloudWayOn([]), 'skip')
  assert.equal(cloudWayOn(['notes']), 'continue')
  assert.equal(cloudWayOn([...GOAL_BUBBLES]), 'continue', 'every bubble picked still goes on')
})

test('picking goals in the window moves the story on to what hobkin says back', async () => {
  // The store reads the address as it loads, as the window does.
  const page = globalThis as { location?: { search: string } }
  page.location ??= { search: '' }
  const { useSetup } = await import('../src/features/onboarding/store.ts')
  useSetup.setState({ tale: { at: 'goals', line: 1, trail: ['email'], ended: null }, answers: none })

  // What the cloud hands `pickedFor` in Storyteller.tsx, every bubble picked.
  useSetup.getState().answer(goalsOf(GOAL_BUBBLES), bare)

  assert.equal(useSetup.getState().tale.at, 'goals-said')
  assert.deepEqual(useSetup.getState().answers.goals, [...GOALS])
})

test('typed words become a bubble of their own only where there is none by that name', () => {
  assert.equal(ownOption(['Email', 'Bills'], ' My bank '), 'My bank')
  assert.equal(ownOption(['Email', 'Bills'], 'email'), null)
  assert.equal(ownOption(['Email'], '   '), null)
})

const folderOf = (name: string, git = true): ProjectFolder => ({ name, path: `/Users/someone/Code/${name}`, git })
const OFF = { enabled: false, autoPick: true }
const CHOOSING = { enabled: true, autoPick: false }
const PICKING = { enabled: true, autoPick: true }

/** What the host answers once the picked projects went to work mode, one entry for each, in the order given. */
const workDone = (outcomes: [SetupProjectOutcome, SetupProjectWhy | null][], workMode = OFF): SetupWorkDone => ({
  folder: { typed: '~/Code', saved: '/Users/someone/Code', changed: true, problem: null },
  workMode,
  projects: outcomes.map(([outcome, why], index) => ({ path: `/Users/someone/Code/p${index}`, name: `p${index}`, outcome, why, reason: why ? 'Why.' : null })),
})

const picked: Answers = { ...none, goals: ['code'], computer: 'personal', more: true, replies: { 'projects-folder': '~/Code', projects: 'storefront, notes' } }
const hosted: Facts = { ...smart, smart: false, host: true }

test('the folder, the projects and validation are asked only with code, and only then do projects go to Work', () => {
  assert.deepEqual(walk(picked, hosted, 'more'), ['more', 'q1', 'q2', 'projects-said', 'q3', 'cards-code', 'thanks', 'usage', 'needs', 'settings', 'tour'])
  const [folder, projects, validation] = (['q1', 'q2', 'q3'] as const).map((id) => beatOf(id, { ...picked, replies: { 'projects-folder': ' ~/Code ' } }, bare).ask)
  assert.equal(folder?.kind === 'input' && folder.optional, true, 'the folder is typed, and can be skipped')
  assert.deepEqual(projects, { kind: 'pick', question: 'projects', from: { projectsIn: '~/Code' } }, 'the projects are the folders found in the folder that was named')
  assert.equal(validation?.kind === 'choice' && typeof validation.field === 'object' && validation.field.reply, 'validation', 'a yes or a no is two bubbles')

  // Without code none of them is asked, and nothing goes to Work.
  const job: Answers = { ...picked, goals: ['job'], replies: { projects: 'storefront' } }
  assert.deepEqual(walk(job, hosted, 'more'), ['more', 'q1', 'cards-job', 'thanks', 'usage', 'needs', 'settings', 'tour'])
  assert.deepEqual(setupAnswersOf(job, [folderOf('storefront')], []).projects, [])
  assert.equal(beatAfter('q2', { ...picked, replies: { 'projects-folder': '~/Code', projects: '  ' } }, hosted), 'cards-code', 'nothing picked, nothing to say or validate')
  assert.equal(beatAfter('q2', picked, { ...hosted, host: false }), 'q3', 'with no host nothing was done, as in a browser tab on sample data')
})

test('a folder left empty passes the projects question, and one that is not on this Mac is said in the bubble with the field to type another', () => {
  const empty: Answers = { ...picked, replies: { 'projects-folder': '  ' } }
  assert.equal(beatAfter('q1', empty, hosted), 'cards-code', 'no folder is looked in, not even a usual one')
  assert.equal(tellOn({ at: 'q1', line: 0, trail: ['more'], ended: null }, 'answered', empty, hosted).at, 'cards-code')
  assert.equal(beatAfter('more', { ...picked, replies: {} }, hosted), 'q1', 'the folder itself is always asked')

  const asked = beatOf('q1', picked, hosted)
  const missing = beatOf('q1', picked, { ...hosted, folderMissing: '~/Projects' })
  assert.equal(missing.lines.length, 1, 'one bubble, so the field comes with it')
  assert.match(missing.lines[0]!, /~\/Projects/, 'it names the folder it could not find')
  assert.notDeepEqual(missing.lines, asked.lines)
  assert.deepEqual(missing.ask, asked.ask, 'the same field, to type another or skip')
  assert.deepEqual(beatOf('q4', { ...picked, goals: ['code', 'project'] }, { ...hosted, folderMissing: '~/Projects' }).lines, beatOf('q4', { ...picked, goals: ['code', 'project'] }, hosted).lines, 'only the folder question says it')
})

test('validation is asked only once projects were picked', () => {
  const none: Answers = { ...picked, replies: { 'projects-folder': '~/Code', projects: '' } }
  assert.equal(beatAfter('q2', none, hosted), 'cards-code', 'skipped, or none found')
  assert.equal(beatAfter('q2', none, { ...hosted, host: false }), 'cards-code')
  assert.equal(beatAfter('projects-said', picked, hosted), 'q3', 'picked: asked after what was done with them')
  assert.equal(beatAfter('q2', picked, { ...hosted, host: false }), 'q3')
  assert.deepEqual(walk({ ...picked, goals: ['code', 'project'], replies: {} }, hosted, 'more'), ['more', 'q1', 'q4', 'cards-code', 'cards-project', 'thanks', 'usage', 'needs', 'settings', 'tour'])
})

test('a line in the quiet line is up only while the story is at the beat it was said at', () => {
  const said = { words: 'I could not keep your answers.', at: 'q2' as const }
  assert.equal(troubleAt(said, 'q2'), said.words)
  assert.equal(troubleAt(said, 'q3'), null, 'gone once the story moves on')
  assert.equal(troubleAt(null, 'q2'), null)
})

test('while the projects go to Work the story waits, then hobkin says what was done, and none of it can be gone back to', () => {
  const at: Tale = { at: 'q2', line: 0, trail: ['more', 'q1'], ended: null }
  const saying = tellOn(at, 'answered', picked, hosted)
  const done: Facts = { ...hosted, worked: workDone([['taken', null], ['taken', null]]) }

  assert.equal(saying.at, 'projects-said')
  assert.deepEqual(beatOf('projects-said', picked, hosted).ask, { kind: 'wait' })
  assert.deepEqual(tellOn(saying, 'on', picked, hosted), saying, 'waiting holds the story')
  assert.deepEqual(tellOn(saying, 'back', picked, hosted), saying, 'the projects are in Work already')

  assert.deepEqual(beatOf('projects-said', picked, done).lines, [workSaid(workDone([['taken', null], ['taken', null]]))])
  assert.equal(beatOf('projects-said', picked, done).ask, undefined, 'said, it only goes on')
  const next = tellOn(saying, 'on', picked, done)
  assert.equal(next.at, 'q3')
  assert.deepEqual(tellOn(next, 'back', picked, done), next)

  const failed = beatOf('projects-said', picked, { ...hosted, worked: 'failed' })
  assert.equal(failed.ask, undefined, 'a failure never holds the story')
  assert.equal(failed.lines.length, 1)
})

test('what hobkin says it did is true to what work mode did with the projects', () => {
  assert.match(workSaid(workDone([['taken', null], ['taken', null]], OFF)), /work on two projects once work mode is on/)
  assert.match(workSaid(workDone([['taken', null]], CHOOSING)), /^One project is in Work now, and nothing runs until you say so\.$/)
  assert.match(workSaid(workDone([['proposed', null], ['proposed', null], ['proposed', null]], PICKING)), /running, so I put three projects in Work for you to take/)
  assert.match(workSaid(workDone([['left', 'known']])), /^I had one project in Work already, and left it as it was\.$/)
  assert.match(workSaid(workDone([['left', 'known'], ['left', 'known']])), /two projects in Work already, and left them as they were/)

  // One more sentence for what was not added, or else for what was there already.
  assert.match(workSaid(workDone([['taken', null], ['skipped', 'not-git']])), /once work mode is on\. One was not a git repository\.$/)
  assert.match(workSaid(workDone([['taken', null], ['skipped', 'refused'], ['skipped', 'not-git']])), /I could not add two of them\.$/)
  assert.match(workSaid(workDone([['taken', null], ['left', 'known']])), /I had one of them already\.$/)
  assert.match(workSaid(workDone([['skipped', 'not-git'], ['skipped', 'not-git']])), /^None of them is a git repository, so I left them out\.$/)
  assert.match(workSaid(workDone([['skipped', 'not-git']])), /^It is not a git repository, so I left it out\.$/)
  assert.match(workSaid(workDone([['skipped', 'namesake']])), /^I could not add it to Work\.$/)
  assert.doesNotMatch(workSaid(workDone([['taken', null]])), /git|already/, 'nothing is said that did not happen')

  // Always one short bubble, however many there were.
  const many = (outcome: SetupProjectOutcome, count: number, why: SetupProjectWhy | null = null) => Array.from({ length: count }, (): [SetupProjectOutcome, SetupProjectWhy | null] => [outcome, why])
  for (const workMode of [OFF, CHOOSING, PICKING]) {
    const main = workMode === PICKING ? 'proposed' : 'taken'
    for (const projects of [many(main, 99), [...many(main, 99), ...many('skipped', 9, 'not-git')], [...many(main, 99), ...many('left', 12)], [...many('left', 99), ...many('skipped', 12, 'refused')]]) {
      const said = workSaid(workDone(projects, workMode))
      assert.ok(said.length <= 110, said)
    }
  }
})

test('what the setup saves: whose computer, the goals, each answered question with its words, the picked projects by path, and the cards', () => {
  const folders = [folderOf('storefront'), folderOf('notes', false)]
  const [where, which] = CODE_QUESTIONS
  const cards = cardPicksOf(groups, dropCard(keepCard(NO_PICKS, 'job-openings').picks, 'interviews'))

  assert.deepEqual(setupAnswersOf({ ...picked, replies: { ...picked.replies, 'projects-folder': ' ~/Code ', validation: ' ' } }, folders, cards), {
    computer: 'personal',
    answers: [
      { id: 'projects-folder', ask: where!.ask, answer: '~/Code' },
      { id: 'projects', ask: which!.ask, answer: 'storefront, notes' },
    ],
    projects: folders,
    goals: ['code'],
    cards,
  })
  assert.deepEqual(setupAnswersOf({ ...none, replies: { projects: '' } }, folders, []), { answers: [], projects: [], goals: [], cards: [] }, 'no computer said, and projects only once they are picked')
})

test('the projects picked are sent by their paths, in the order they were picked', () => {
  const folders = [folderOf('storefront'), folderOf('notes', false)]

  assert.deepEqual(foldersPicked(['notes', 'storefront', 'gone'], folders), [folders[1], folders[0]])
  assert.deepEqual(foldersPicked([], folders), [])
})

test('run again, what was saved before is where a field starts, and what was answered this time comes first', () => {
  const earlier: SetupSaved = { computer: 'personal', answers: [{ id: 'projects-folder', ask: 'Where?', answer: '~/Code' }], projects: [], goals: [], cards: [], savedAt: '2026-11-13T10:00:00.000Z' }

  assert.equal(startingReply(none, earlier, 'projects-folder'), '~/Code')
  assert.equal(startingReply({ ...none, replies: { 'projects-folder': '~/src' } }, earlier, 'projects-folder'), '~/src')
  assert.equal(startingReply(none, earlier, 'check'), '')
  assert.equal(startingReply(none, null, 'projects-folder'), '')
  assert.equal(beatAfter('more', { ...none, goals: ['job'], more: true }, hosted), 'q1', 'the story still asks every question')
})

test('run again, the goals and the cards start as they were left', () => {
  const left = dropCard(keepCard(NO_PICKS, 'job-openings').picks, 'interviews')
  const changed: CardPicks = { ...left, changes: { 'job-openings': { recurrence: 'Every weekday' } } }

  const saved = cardPicksOf(groups, changed)

  assert.deepEqual(picksFrom(saved), changed)
  assert.deepEqual(picksFrom([]), NO_PICKS)
})

test('a work computer with no account and no launcher is asked for the command that starts Pi, and nowhere else', () => {
  const work: Answers = { ...none, computer: 'work' }
  const host: Facts = { ...bare, host: true, pi: pi() }

  assert.equal(beatAfter('subscription', work, host), 'launcher')
  assert.equal(beatOf('launcher', work, host).ask?.kind, 'input')
  // Not on a personal computer, with an account found, with a launcher already named, or without a host to keep it.
  assert.equal(beatAfter('subscription', { ...none, computer: 'personal' }, host), 'connect')
  assert.equal(beatAfter('subscription', work, { ...host, connected: ['OpenAI'] }), 'found')
  assert.equal(beatAfter('subscription', work, { ...host, pi: pi({ launcher: 'work-pi' }) }), 'connect')
  assert.equal(beatAfter('subscription', work, { ...bare, pi: pi() }), 'connect')
  assert.equal(beatAfter('subscription', none, host), 'computer-late', 'a computer not asked about yet is asked about now')
  assert.equal(beatAfter('computer-late', work, host), 'launcher')
  assert.equal(beatAfter('computer-late', { ...none, computer: 'personal' }, host), 'connect')
  assert.equal(beatAfter('subscription', none, { ...host, connected: ['OpenAI'] }), 'found', 'with an account it is not asked at all')
})

test('a launcher that was kept is an account, and one put off sends the story on as before', () => {
  const host: Facts = { ...bare, host: true, pi: pi() }
  assert.equal(beatAfter('launcher', { ...none, computer: 'work', launcher: 'saved' }, host), 'connected')
  assert.equal(beatAfter('launcher', { ...none, computer: 'work', launcher: 'later' }, host), 'connect')
  assert.equal(beatAfter('launcher', { ...none, computer: 'work', launcher: 'later' }, { ...host, pi: pi({ installed: false, version: null, matches: false }) }), 'pi')
  assert.equal(checkAnswer('launcher', ''), null, 'empty puts it off')
  assert.equal(checkAnswer('launcher', 'work-pi --flag'), null)
  assert.notEqual(checkAnswer('launcher', 'a\u0007b'), null)
})

/** A card as hobkin's goalCards gives it. */
function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id, version: 1, source: 'hobkin', title: `Title of ${id}`, summary: 'What it watches.', needs: ['mail'], recurrence: 'Weekly',
    tells: 'When it changes.', skips: null, gives: ['report'], closes: null, private: false, asks: null, effort: 'medium', ...over,
  }
}

const groups: GoalCards[] = [
  { goal: 'job', starters: [card('job-openings'), card('job-applications', { private: true }), card('interviews')], more: [] },
  { goal: 'business', starters: [card('business-leads')], more: [] },
  { goal: 'project', starters: [card('project-milestones'), card('deadlines-ahead')], more: [] },
  { goal: 'life', starters: [card('email', { private: true })], more: [] },
  { goal: 'code', starters: [card('review-queue')], more: [] },
]

test('the goals question comes right after the email, takes any goals, their own words or none, and the computer fork is not asked there', () => {
  const goals = beatOf('goals', none, bare)

  assert.equal(beatAfter('email', none, bare), 'goals')
  assert.deepEqual(goals.ask?.kind === 'pick' && goals.ask.from, { options: ['Writing code', 'A project of my own', 'Starting a business', 'Keeping life in order', 'Finding a job'] })
  assert.match(goals.ask?.kind === 'pick' ? goals.ask.note ?? '' : '', /model provider/, 'the note about the answers is under this question')
  assert.equal(beatAfter('goals', none, bare), 'goals-said')
  for (const said of [[], ['code'], ['project', 'code']] as const) {
    assert.equal(beatAfter('goals-said', { ...none, goals: [...said] }, smart), said.length ? 'more' : 'settings', 'no computer fork for these goals')
  }
  assert.doesNotMatch(beatOf('hello', none, bare).lines.join(' ') + goals.lines.join(' '), /develop/i, 'nothing before it pitches development')
})

test('the computer is asked only for a job, a business or life, and a work computer marks the private cards', () => {
  for (const goal of ['job', 'business', 'life'] as const) assert.equal(beatAfter('goals-said', { ...none, goals: [goal] }, bare), 'computer')
  assert.equal(beatAfter('computer', { ...none, goals: ['job'], computer: 'work' }, smart), 'computer-work', 'hobkin says once that it will say so')
  assert.equal(beatAfter('computer', { ...none, goals: ['job'], computer: 'personal' }, smart), 'more')
  assert.equal(beatAfter('computer-work', { ...none, goals: ['job'] }, smart), 'more')
  // Asked already, at the subscription for the launcher, it is not asked again. A work computer still hears the line once.
  assert.equal(beatAfter('goals-said', { ...none, goals: ['job'], computer: 'personal' }, smart), 'more')
  assert.equal(beatAfter('goals-said', { ...none, goals: ['job'], computer: 'work' }, smart), 'computer-work')
})

test('each picked goal asks its own question in the goals\' order, and none or no account offers no routines', () => {
  const all: Answers = { ...none, goals: ['code', 'project', 'job', 'business', 'life'], more: true }
  const asked = (['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const).map((id) => beatOf(id, all, bare).lines.at(-1))

  assert.match(asked[0]!, /projects live/)
  assert.match(asked[3]!, /the project/)
  assert.match(asked[4]!, /business in a line/)
  assert.match(asked[5]!, /kind of job/)
  assert.equal(beatOf('q6', all, bare).ask?.kind === 'input' && beatOf('q6', all, bare).ask?.kind, 'input', 'typed, and it can be skipped')
  assert.deepEqual(walk({ ...none, goals: ['life'], more: true }, bare, 'more'), ['more', 'cards-life', 'thanks', 'settings', 'tour'], 'life asks none')

  // No goal, or no account: no routines, and on to the settings.
  assert.equal(beatAfter('goals-said', { ...none, account: 'connected', goals: [] }, bare), 'settings')
  assert.equal(beatAfter('goals-said', { ...none, goals: [] }, smart), 'settings')
  assert.equal(beatAfter('goals-said', { ...none, launcher: 'saved', goals: ['code'] }, bare), 'more', 'a launcher kept is an account')
})

test('after the cards hobkin says it will check what they need, and with none kept the story goes to the thanks', () => {
  const kept: Answers = { ...none, goals: ['job', 'life'], cards: keepCard(NO_PICKS, 'email').picks }
  const facts: Facts = { ...smart, host: true, cards: groups }

  assert.equal(beatAfter('cards-life', kept, facts), 'cards-job', 'one goal at a time')
  assert.equal(beatAfter('cards-job', kept, facts), 'routines-need')
  assert.equal(beatOf('routines-need', kept, facts).lines.length, 1)
  assert.equal(beatAfter('routines-need', kept, facts), 'writing')
  assert.equal(beatAfter('cards-job', { ...kept, cards: dropCard(NO_PICKS, 'email') }, facts), 'thanks', 'none kept: nothing is written')
  // The first goal's cards say how they work, the next ones only introduce themselves.
  assert.equal(beatOf('cards-life', kept, facts).lines.length, 2)
  assert.equal(beatOf('cards-job', kept, facts).lines.length, 1)
  assert.deepEqual(beatOf('cards-job', kept, facts).ask, { kind: 'cards', goal: 'job' })
})

test('the writing message goes once, after the cards or else at the hand-off, and never on the scripted host or with no host', () => {
  const kept: Answers = { ...none, goals: ['job'], cards: keepCard(NO_PICKS, 'job-openings').picks }

  assert.equal(beatAfter('routines-need', kept, { ...smart, host: true, cards: groups }), 'writing')
  assert.equal(beatAfter('routines-need', kept, { ...hosted, cards: groups }), 'thanks', 'the scripted host writes nothing')
  assert.equal(beatAfter('routines-need', kept, { ...smart, cards: groups }), 'thanks', 'and neither does a browser tab')

  // Reaching the writing sends the message, so neither it nor what came before can be gone back to.
  const at: Tale = { at: 'routines-need', line: 0, trail: ['cards-job'], ended: null }
  const writing = tellOn(at, 'on', kept, { ...smart, host: true, cards: groups })
  assert.equal(writing.at, 'writing')
  assert.deepEqual(tellOn(writing, 'back', kept, { ...smart, host: true, cards: groups }), writing)
  // Before the message went, the cards can be gone back to, and from them the goal's question.
  assert.deepEqual(tellOn({ at: 'cards-job', line: 1, trail: ['q1'], ended: null }, 'back', kept, smart).line, 0)
})

test('what was written decides the first run and the thanks', () => {
  const kept: Answers = { ...none, goals: ['job'], cards: keepCard(NO_PICKS, 'job-openings').picks }
  const written = [{ card: card('job-openings'), routine: { id: 'roles', title: 'Roles that fit', template: 'job-openings@1', enabled: true } }]
  const facts: Facts = { ...smart, host: true, cards: groups, written }

  assert.equal(beatAfter('written', kept, facts), 'first-run')
  assert.match(beatOf('first-run', kept, facts).lines[0]!, /Roles that fit/)
  assert.equal(beatAfter('first-run', { ...kept, firstRun: 'later' }, facts), 'thanks', 'Later starts nothing')
  assert.equal(beatAfter('written', kept, { ...facts, written: [] }), 'thanks', 'nothing written, nothing to run')
  assert.notDeepEqual(beatOf('thanks', kept, facts).lines, beatOf('thanks', kept, { ...facts, written: [] }).lines)
})

test('while the cards are up, Escape, Left and Right are the cards screen\'s', () => {
  const cards: TaleKeyContext = { ...idle, asking: 'cards' }

  for (const name of ['Escape', 'ArrowLeft', 'ArrowRight']) assert.equal(resolveTaleKey(key(name), cards), null)
  assert.equal(resolveTaleKey(key('Enter'), { ...cards, pressable: true }), null, 'Enter presses the button that has the keyboard')
})
