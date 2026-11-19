import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProviderAccess } from '../../shared/protocol/models.ts'
import type { PendingQuestion } from '../../shared/protocol/question.ts'
import type { PiSetup, ProjectFolder, SetupProjectOutcome, SetupProjectWhy, SetupSaved, SetupWorkDone } from '../../shared/protocol/setup.ts'
import { codexProvider, connectedNames } from '../src/features/onboarding/accounts.ts'
import { balance, GLOW, GROW, shadesFor } from '../src/features/onboarding/balance.ts'
import { foldersPicked, matching, ownOption, pickedAnswer, picksOf, PICKS_SHOWN, shownOf, togglePick } from '../src/features/onboarding/picks.ts'
import {
  FOLLOW_UPS_MAX,
  FOLLOW_UPS_WAIT,
  followUpRequest,
  followUpsOver,
  pickedSuggestions,
  QUESTIONS,
  routinesRequest,
  setupAnswersOf,
  startingReply,
  toggleSuggestion,
  type FollowUps,
} from '../src/features/onboarding/questions.ts'
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
  spokenText,
  startTale,
  tellOn,
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
  const asking: Tale = { at: 'computer', line: 1, trail: ['hello', 'sound'], ended: null }

  assert.equal(beatOf('computer', none, bare).lines.length, 2, 'the question is asked with the last bubble')
  assert.deepEqual(tellOn({ ...asking, line: 0 }, 'on', none, bare), asking)
  assert.deepEqual(tell(['on', 'on'], none, bare, asking), asking, 'going on does not pass a question')
  assert.equal(tellOn(asking, 'answered', { ...none, computer: 'work' }, bare).at, 'computer-thanks')
})

test('a bubble that only asks to go on is passed by going on', () => {
  const ready: Tale = { at: 'subscription', line: beatOf('subscription', none, bare).lines.length - 1, trail: [], ended: null }

  assert.equal(beatOf('subscription', none, bare).ask?.kind, 'go')
  assert.notEqual(tellOn(ready, 'on', none, bare).at, 'subscription')
})

test('a new Mac: who the user is, Pi, a sign-in, then the app', () => {
  const answers: Answers = { ...none, computer: 'personal', name: 'Ada', pi: 'installed', account: 'connected', more: false }
  const facts: Facts = { ...bare, pi: pi({ installed: false, version: null, matches: false }) }

  assert.deepEqual(walk(answers, facts), [
    'hello',
    'sound',
    'computer',
    'computer-thanks',
    'name',
    'name-hi',
    'email',
    'subscription',
    'pi',
    'pi-ready',
    'connect',
    'connected',
    'more',
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
  assert.equal(beatAfter('found', none, found), 'more')
  assert.equal(beatAfter('subscription', none, bare), 'connect')
  assert.equal(beatOf('connect', none, bare).ask?.kind, 'connect')
})

test('with Claude Code signed in, hobkin says it can use it too', () => {
  const claude: Facts = { ...bare, connected: ['OpenAI'], claude: true }

  assert.match(beatOf('found', none, claude).lines.join(' '), /Claude Code/)
  assert.doesNotMatch(beatOf('found', none, { ...claude, claude: false }).lines.join(' '), /Claude Code/)
})

test('putting the sign-in off skips the questions, which need a model to hand them to', () => {
  const later: Answers = { ...none, account: 'later' }

  assert.equal(beatAfter('connect', later, bare), 'no-account')
  assert.equal(beatAfter('no-account', later, bare), 'settings')
  assert.equal(beatAfter('connect', { ...none, account: 'connected' }, bare), 'connected')
})

test('five more questions when asked for, and none when not', () => {
  const yes: Answers = { ...none, computer: 'work', more: true }

  assert.deepEqual(walk(yes, bare, 'more'), ['more', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'questions-thanks', 'settings', 'tour'], 'a work computer: its projects, then how the team works')
  assert.deepEqual(walk({ ...yes, computer: 'personal' }, bare, 'more'), ['more', 'q1', 'q2', 'q3', 'q4', 'q5', 'questions-thanks', 'settings', 'tour'])
  assert.deepEqual(walk({ ...none, more: false }, bare, 'more'), ['more', 'settings', 'tour'])
})

test('with a real model, main hobkin asks its own questions after the fixed ones, and without one the thanks come next', () => {
  const yes: Answers = { ...none, computer: 'personal', more: true }

  assert.deepEqual(walk(yes, smart, 'more'), ['more', 'q1', 'q2', 'q3', 'q4', 'q5', 'follow-ups', 'questions-thanks', 'settings', 'tour'])
  assert.deepEqual(walk({ ...yes, computer: 'work' }, smart, 'q6'), ['q6', 'follow-ups', 'questions-thanks', 'settings', 'tour'])
  assert.deepEqual(walk(yes, { ...smart, smart: false }, 'q5'), ['q5', 'questions-thanks', 'settings', 'tour'], 'the scripted host, or a browser tab, has no hobkin that asks')
})

test('while main hobkin thinks the story waits, and the question it opens is asked in its own words', () => {
  const at: Tale = { at: 'follow-ups', line: 0, trail: [], ended: null }
  const asked = followUpOf(pending())
  const thinking = beatOf('follow-ups', none, smart)
  const asking = beatOf('follow-ups', none, { ...smart, asked })

  assert.equal(thinking.lines.length, 1, 'one line while it thinks')
  assert.deepEqual(thinking.ask, { kind: 'wait' })
  assert.deepEqual(asking.lines, ['Which of these should I check first each morning?'])
  assert.deepEqual(asking.ask, { kind: 'follow-up', question: 'ask-1', options: pending().choices, typed: true })
  assert.deepEqual(tellOn(at, 'on', none, smart), at, 'waiting holds the story')
  assert.deepEqual(tellOn(at, 'on', none, { ...smart, asked }), at, 'and so does a question')
  assert.equal(tellOn(at, 'answered', none, { ...smart, asked }).at, 'questions-thanks', 'once they are over, the thanks')
})

test("only main hobkin's own question is asked in the story, and a choice without a label is said by its value", () => {
  const unlabeled = pending({ question: '  Which one?  ', choices: [{ value: 'a', label: '' }, { value: 'b', label: 'Bee' }], other: false })

  assert.deepEqual(followUpOf(unlabeled), { id: 'ask-1', words: 'Which one?', choices: [{ value: 'a', label: 'a' }, { value: 'b', label: 'Bee' }], typed: false })
  assert.equal(followUpOf(pending({ from: 'Routine inbox-sweep' })), null, "a routine's question is left to the question sheet")
  assert.equal(followUpOf(null), null)
})

test('the follow-ups happen once, so neither they nor what came before them can be gone back to', () => {
  const answers: Answers = { ...none, computer: 'personal', more: true }
  const last: Tale = { at: 'q5', line: 0, trail: ['more', 'q1', 'q2', 'q3', 'q4'], ended: null }
  const following = tellOn(last, 'answered', answers, smart)
  const thanks = tellOn(following, 'answered', answers, smart)

  assert.equal(following.at, 'follow-ups')
  assert.deepEqual(tellOn(following, 'back', answers, smart), following, 'the answers already went to hobkin')
  assert.equal(thanks.at, 'questions-thanks')
  assert.deepEqual(tellOn(thanks, 'back', answers, smart), thanks)
})

test('the questions differ by whose computer this is, and each has its own way of being answered', () => {
  assert.equal(QUESTIONS.personal.length, 5)
  assert.equal(QUESTIONS.work.length, 6, 'the folder and its projects, then four about the team')
  for (const kind of ['personal', 'work'] as const) {
    assert.equal(new Set(QUESTIONS[kind].map(({ id }) => id)).size, QUESTIONS[kind].length, 'each has its own id')
  }
  assert.notDeepEqual(QUESTIONS.personal.map(({ ask }) => ask), QUESTIONS.work.map(({ ask }) => ask))

  const personal: Answers = { ...none, computer: 'personal', replies: { 'projects-folder': ' ~/Code ' } }
  const [folder, projects, validation, check] = (['q1', 'q2', 'q3', 'q4'] as const).map((id) => beatOf(id, personal, bare).ask)

  assert.equal(folder?.kind === 'input' && folder.optional, true, 'the folder is typed, and can be skipped')
  assert.deepEqual(projects, { kind: 'pick', question: 'projects', from: { projectsIn: '~/Code' } }, 'the projects are the folders found in the folder that was named')
  assert.equal(validation?.kind === 'choice' && typeof validation.field === 'object' && validation.field.reply, 'validation', 'a yes or a no is two bubbles')
  assert.equal(check?.kind === 'pick' && 'options' in check.from && check.from.options.includes('Email'), true, 'a list is a cloud of bubbles to pick from')

  const unnamed = beatOf('q2', { ...none, computer: 'personal' }, bare).ask
  assert.deepEqual(unnamed?.kind === 'pick' && unnamed.from, { projectsIn: '~/Projects' }, 'with no folder named, the usual one is looked in')
  assert.equal(beatOf('q1', none, bare).lines.at(-1), QUESTIONS.personal[0]!.ask, 'personal when the kind was never said')
})

test('hobkin asks about sound right after the hello, before anything else', () => {
  const sound = beatOf('sound', none, bare)

  assert.equal(beatAfter('hello', none, bare), 'sound')
  assert.equal(beatAfter('sound', none, bare), 'computer')
  assert.equal(sound.ask?.kind === 'choice' && sound.ask.field, 'sound')
})

test('the name is said back', () => {
  assert.deepEqual(beatOf('name-hi', { ...none, name: 'Ada' }, bare).lines, ['Hi, Ada!'])
})

test('back goes one bubble back, then to the beat before', () => {
  const second = tell(['on'])
  const asking: Tale = { at: 'computer', line: 1, trail: ['hello'], ended: null }

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

test('skip ends the story from anywhere, the last bubble ends it as done, and then nothing moves', () => {
  const skipped = tell(['on', 'skip'])
  const last: Tale = { at: 'tour', line: beatOf('tour', none, bare).lines.length - 1, trail: [], ended: null }
  const done = tellOn(last, 'on', none, bare)

  assert.equal(skipped.ended, 'skipped')
  assert.equal(skipped.at, 'hello', 'it ends where it was')
  assert.equal(done.ended, 'done')
  for (const event of ['on', 'back', 'skip', 'answered'] as const) {
    assert.deepEqual(tellOn(done, event, none, bare), done)
    assert.deepEqual(tellOn(skipped, event, none, bare), skipped)
  }
})

test('every beat has words, and only the last bubble of a beat asks', () => {
  const answers: Answers = { ...none, computer: 'work', name: 'Ada', more: true }
  const facts: Facts = { pi: pi({ installed: false, version: null, matches: false }), connected: ['OpenAI'], claude: true, smart: true, asked: null }
  const long = followUpOf(pending({ question: `${'Which of your projects should I watch first, and how often, '.repeat(3)}and why?` }))
  const ids: BeatId[] = ['hello', 'sound', 'computer', 'computer-thanks', 'name', 'name-hi', 'email', 'subscription', 'launcher', 'pi', 'pi-ready', 'pi-later', 'found', 'connect', 'connected', 'no-account', 'more', 'q1', 'q2', 'projects-said', 'q3', 'q4', 'q5', 'q6', 'follow-ups', 'questions-thanks', 'settings', 'tour']

  for (const asked of [null, long]) {
    for (const id of ids) {
      const beat = beatOf(id, answers, { ...facts, asked })
      assert.equal(beat.id, id)
      assert.ok(beat.lines.length > 0, `${id} says something`)
      // Main hobkin's own question is said whole, as long as it made it.
      if (id === 'follow-ups' && asked) continue
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

test('the answers are handed to hobkin as one message, with only what was answered', () => {
  const [first, second] = QUESTIONS.work
  const request = routinesRequest({ ...none, computer: 'work', more: true, replies: { [first!.id]: 'Payments API', [second!.id]: '   ' } })

  assert.ok(request)
  assert.match(request, /work computer/)
  assert.match(request, /Payments API/)
  assert.ok(request.includes(first!.ask), 'each answer goes with its question')
  assert.ok(!request.includes(second!.ask), 'a question left empty is left out')
  assert.match(request, /ask before/i, 'nothing is made without a yes')
  assert.equal(routinesRequest({ ...none, computer: 'work', more: true, replies: {} }), null, 'nothing answered, nothing sent')
  assert.equal(routinesRequest({ ...none, more: false, replies: { [first!.id]: 'x' } }), null)
})

test('the follow-ups start with one message that hands hobkin the answers and asks for the rest one question at a time', () => {
  const [folder, projects] = QUESTIONS.personal
  const seed = followUpRequest({ ...none, computer: 'personal', more: true, replies: { [folder!.id]: ' ~/Code ', [projects!.id]: '  ' } })

  assert.equal(FOLLOW_UPS_MAX, 5)
  assert.match(seed, /personal computer/)
  assert.ok(seed.includes(`- ${folder!.ask}\n  ~/Code`), 'each answer goes with its question, as the routines message writes them')
  assert.ok(!seed.includes(projects!.ask), 'a question left empty is left out')
  assert.match(seed, /one question at a time/i)
  assert.match(seed, /ask_question/)
  assert.match(seed, /choices/)
  assert.ok(seed.includes(`at most ${FOLLOW_UPS_MAX} questions`))
  assert.match(seed, /two or three first routines/)
  assert.match(seed, /ask before you create or connect anything/i, 'nothing is made without a yes')

  const skipped = followUpRequest({ ...none, computer: 'work', more: true, replies: {} })
  assert.match(skipped, /work computer/)
  assert.match(skipped, /skipped/i, 'with nothing answered hobkin still asks, and knows why it has nothing')
})

test('the follow-ups are over when hobkin is done asking, five were answered, the user says enough, the message did not go, or nothing was asked for two minutes', () => {
  const at = 1_000_000
  const { startMs, quietMs } = FOLLOW_UPS_WAIT
  const working: FollowUps = { takenAt: at, failed: false, busy: true, open: false, answered: 0, enough: false, stirredAt: at }
  const over = (change: Partial<FollowUps>, after: number) => followUpsOver({ ...working, ...change }, at + after)

  assert.equal(over({}, 1000), false, 'hobkin is working on it')
  assert.equal(over({ busy: false }, startMs - 1), false, 'it gets a few seconds to start')
  assert.equal(over({ busy: false }, startMs), true, 'then idle with nothing open, it is done asking')
  assert.equal(over({ busy: false, open: true }, quietMs * 3), false, 'an open question waits for the user, however long they take')
  assert.equal(over({ answered: FOLLOW_UPS_MAX - 1 }, 1000), false)
  assert.equal(over({ answered: FOLLOW_UPS_MAX, open: true }, 1000), true, 'five answered is enough, even with a sixth open')
  assert.equal(over({ enough: true, open: true }, 0), true, 'the user can say it is enough at any time')
  assert.equal(over({ takenAt: null, failed: true }, 0), true, 'the message could not be sent')
  assert.equal(over({ takenAt: null }, quietMs - 1), false, 'the message is on its way')
  assert.equal(over({ takenAt: null }, quietMs), true)
  assert.equal(over({}, quietMs), true, 'working for two minutes with nothing asked')
  assert.equal(over({ stirredAt: at + quietMs - 1000 }, quietMs), false, 'a question that came or went starts the two minutes over')
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

const picked: Answers = { ...none, computer: 'personal', more: true, replies: { 'projects-folder': '~/Code', projects: 'storefront, notes' } }
const hosted: Facts = { ...smart, smart: false, host: true }

test('after the projects are picked, hobkin says what it did with them, only with a host and a pick', () => {
  assert.deepEqual(walk(picked, hosted, 'more'), ['more', 'q1', 'q2', 'projects-said', 'q3', 'q4', 'q5', 'questions-thanks', 'settings', 'tour'])
  assert.deepEqual(walk({ ...picked, computer: 'work' }, { ...hosted, smart: true }, 'q2'), ['q2', 'projects-said', 'q3', 'q4', 'q5', 'q6', 'follow-ups', 'questions-thanks', 'settings', 'tour'])
  assert.equal(beatAfter('q2', { ...picked, replies: { projects: '  ' } }, hosted), 'q3', 'nothing picked, nothing to say')
  assert.equal(beatAfter('q2', picked, { ...hosted, host: false }), 'q3', 'with no host nothing was done, as in a browser tab on sample data')
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

test('when validation is wanted, hobkin is asked to propose each project its checks and write them only on a yes, and the logs are a fact with a question before the first scan', () => {
  const replies = { ...picked.replies, validation: 'Set it up', logs: 'Yes' }
  const asked = { ...picked, replies }

  for (const message of [routinesRequest(asked)!, followUpRequest(asked)]) {
    assert.match(message, /each project I picked/)
    assert.match(message, /tests, lint and build/)
    assert.match(message, /work\/<slug>\/directions\.md/)
    assert.match(message, /only after I say yes/)
    assert.match(message, /You may read my logs and past sessions/)
    assert.match(message, /Ask me before your first scan/)
    assert.match(message, /ask before you create or connect anything/i, 'the rest of the message is as it was')
  }

  const later = { ...picked, replies: { ...picked.replies, validation: 'Later', logs: 'No' } }
  for (const message of [routinesRequest(later)!, followUpRequest(later)]) {
    assert.doesNotMatch(message, /directions\.md/)
    assert.doesNotMatch(message, /You may read my logs/)
    assert.ok(message.includes(QUESTIONS.personal[4]!.ask), 'the answer itself is still handed over with its question')
  }
  const nothingPicked = { ...asked, replies: { ...replies, projects: '' } }
  assert.doesNotMatch(routinesRequest(nothingPicked)!, /directions\.md/, 'with no project picked there are no checks to propose')
})

test('what the setup saves: whose computer, each answered question with its words, and the picked projects by path', () => {
  const folders = [folderOf('storefront'), folderOf('notes', false)]
  const [where, which] = QUESTIONS.personal

  assert.deepEqual(setupAnswersOf({ ...picked, replies: { ...picked.replies, 'projects-folder': ' ~/Code ', check: ' ' } }, folders), {
    computer: 'personal',
    answers: [
      { id: 'projects-folder', ask: where!.ask, answer: '~/Code' },
      { id: 'projects', ask: which!.ask, answer: 'storefront, notes' },
    ],
    projects: folders,
  })
  assert.deepEqual(setupAnswersOf({ ...none, replies: { projects: '' } }, folders), { answers: [], projects: [] }, 'no computer said, and projects only once they are picked')
})

test('the projects picked are sent by their paths, in the order they were picked', () => {
  const folders = [folderOf('storefront'), folderOf('notes', false)]

  assert.deepEqual(foldersPicked(['notes', 'storefront', 'gone'], folders), [folders[1], folders[0]])
  assert.deepEqual(foldersPicked([], folders), [])
})

test('run again, what was saved before is where a field starts, and what was answered this time comes first', () => {
  const earlier: SetupSaved = { computer: 'personal', answers: [{ id: 'projects-folder', ask: 'Where?', answer: '~/Code' }], projects: [], savedAt: '2026-11-13T10:00:00.000Z' }

  assert.equal(startingReply(none, earlier, 'projects-folder'), '~/Code')
  assert.equal(startingReply({ ...none, replies: { 'projects-folder': '~/src' } }, earlier, 'projects-folder'), '~/src')
  assert.equal(startingReply(none, earlier, 'check'), '')
  assert.equal(startingReply(none, null, 'projects-folder'), '')
  assert.equal(beatAfter('more', { ...none, more: true }, hosted), 'q1', 'the story still asks every question')
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
  assert.equal(beatAfter('subscription', none, host), 'connect', 'a computer that was not said is not a work one')
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
