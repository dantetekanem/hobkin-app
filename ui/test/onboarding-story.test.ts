import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProviderAccess } from '../../shared/protocol/models.ts'
import type { PiSetup } from '../../shared/protocol/setup.ts'
import { codexProvider, connectedNames } from '../src/features/onboarding/accounts.ts'
import { balance, GROW } from '../src/features/onboarding/balance.ts'
import { pickedSuggestions, QUESTIONS, routinesRequest, toggleSuggestion } from '../src/features/onboarding/questions.ts'
import { beatAfter, beatOf, checkAnswer, piecesOf, piNeeds, spokenText, startTale, tellOn, type Answers, type BeatId, type Facts, type Tale, type TaleEvent } from '../src/features/onboarding/story.ts'
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
const bare: Facts = { pi: null, connected: [], claude: false }
const none: Answers = { replies: {} }

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
  assert.equal(tell(['on', 'on']).at, 'computer', 'past its last bubble the next beat starts')
  assert.deepEqual(tell(['on', 'on']).trail, ['hello'])
})

test('a question holds the story until it is answered', () => {
  const asking = tell(['on', 'on', 'on'])

  assert.equal(asking.at, 'computer')
  assert.equal(asking.line, 1, 'the question is asked with the last bubble')
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
  const facts: Facts = { pi: pi({ installed: false, version: null, matches: false }), connected: [], claude: false }

  assert.deepEqual(walk(answers, facts), [
    'hello',
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

  assert.deepEqual(walk(yes, bare, 'more'), ['more', 'q1', 'q2', 'q3', 'q4', 'q5', 'questions-thanks', 'settings', 'tour'])
  assert.deepEqual(walk({ ...none, more: false }, bare, 'more'), ['more', 'settings', 'tour'])
})

test('the questions are five for each kind of computer, and they differ', () => {
  for (const kind of ['personal', 'work'] as const) {
    assert.equal(QUESTIONS[kind].length, 5)
    assert.equal(new Set(QUESTIONS[kind].map(({ id }) => id)).size, 5, 'each has its own id')
  }
  assert.notDeepEqual(QUESTIONS.personal.map(({ ask }) => ask), QUESTIONS.work.map(({ ask }) => ask))

  const personal = beatOf('q1', { ...none, computer: 'personal' }, bare)
  const work = beatOf('q1', { ...none, computer: 'work' }, bare)
  assert.equal(personal.lines.at(-1), QUESTIONS.personal[0]!.ask)
  assert.equal(work.lines.at(-1), QUESTIONS.work[0]!.ask)
  assert.equal(personal.ask?.kind === 'input' && personal.ask.optional, true, 'any of them can be skipped')
  assert.equal(beatOf('q1', none, bare).lines.at(-1), QUESTIONS.personal[0]!.ask, 'personal when the kind was never said')
})

test('the name is said back', () => {
  assert.deepEqual(beatOf('name-hi', { ...none, name: 'Ada' }, bare).lines, ['Hi, Ada!'])
})

test('back goes one bubble back, then to the beat before', () => {
  const second = tell(['on'])
  const asking = tell(['on', 'on', 'on'])

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
  const facts: Facts = { pi: pi({ installed: false, version: null, matches: false }), connected: ['OpenAI'], claude: true }
  const ids: BeatId[] = ['hello', 'computer', 'computer-thanks', 'name', 'name-hi', 'email', 'subscription', 'pi', 'pi-ready', 'pi-later', 'found', 'connect', 'connected', 'no-account', 'more', 'q1', 'q2', 'q3', 'q4', 'q5', 'questions-thanks', 'settings', 'tour']

  for (const id of ids) {
    const beat = beatOf(id, answers, facts)
    assert.equal(beat.id, id)
    assert.ok(beat.lines.length > 0, `${id} says something`)
    for (const line of beat.lines) assert.ok(line.trim().length > 0 && line.length <= 110, `${id}: a bubble is short enough to read at a glance`)
  }
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
