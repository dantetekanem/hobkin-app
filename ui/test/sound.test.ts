import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { Bubble } from '../src/features/chat/bubble.ts'
import { bubbleCue, hopCue } from '../src/features/sound/cues.ts'
import { playTones, type SoundContext } from '../src/features/sound/player.ts'
import { FADE_OUT, mayPlay, pitchCurve, SOUND_NAMES, soundLength, talkPitch, TALK_RANGE, tonesOf, type SoundName, type Tone } from '../src/features/sound/sounds.ts'

/** What a press on the page would call: the sound module listens for the user's first pointer or key press. */
const presses = new Map<string, () => void>()
const page = globalThis as { AudioContext?: unknown; addEventListener?: unknown; removeEventListener?: unknown }
page.addEventListener = (type: string, listener: () => void) => presses.set(type, listener)
page.removeEventListener = (type: string) => presses.delete(type)
// The settings store keeps its choices in the page's storage, which a test does not have.
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
after(() => {
  for (const key of ['window', 'AudioContext', 'addEventListener', 'removeEventListener']) Reflect.deleteProperty(globalThis, key)
})
const { useSettings } = await import('../src/features/settings/store.ts')
const { play } = await import('../src/features/sound/index.ts')

/** The longest each sound may run, in seconds. Small sounds for a small creature, never an alert. */
const LONGEST: Record<SoundName, number> = { talk: 0.115, hop: 0.13, land: 0.11, pick: 0.1, tap: 0.06, chime: 1, cheer: 0.4 }
/** The loudest any tone may get, and the babble much softer than that. */
const LOUDEST = 0.2
const TALK_LOUDEST = 0.08

type Event = [kind: 'set' | 'linear' | 'exponential', value: number, at: number]

/** A context that records what the player makes of a sound, in place of the page's audio. */
function fakeContext(currentTime = 2) {
  const param = () => {
    const events: Event[] = []
    return {
      events,
      setValueAtTime: (value: number, at: number) => events.push(['set', value, at]),
      linearRampToValueAtTime: (value: number, at: number) => events.push(['linear', value, at]),
      exponentialRampToValueAtTime: (value: number, at: number) => events.push(['exponential', value, at]),
    }
  }
  const destination = { connected: [] as unknown[], connect() {} }
  const oscillators: { type: string; frequency: ReturnType<typeof param>; connected: unknown[]; started: number | null; stopped: number | null }[] = []
  const gains: { gain: ReturnType<typeof param>; connected: unknown[] }[] = []
  const context = {
    state: 'running' as string,
    currentTime,
    destination,
    resumes: 0,
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    oscillators,
    gains,
    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: param(),
        connected: [] as unknown[],
        started: null as number | null,
        stopped: null as number | null,
        connect: (to: unknown) => void oscillator.connected.push(to),
        start: (at: number) => void (oscillator.started = at),
        stop: (at: number) => void (oscillator.stopped = at),
      }
      oscillators.push(oscillator)
      return oscillator
    },
    createGain() {
      const gain = { gain: param(), connected: [] as unknown[], connect: (to: unknown) => void gain.connected.push(to) }
      gains.push(gain)
      return gain
    },
  }
  return context
}

/** A constructor the page would have as `AudioContext`, that hands out this one context. */
const contextClass = (context: object, made = { count: 0 }) =>
  function AudioContext() {
    made.count += 1
    return context
  }

test('every sound is short and quiet, and nothing in it runs before its start or below zero', () => {
  for (const name of SOUND_NAMES) {
    const tones = tonesOf(name, { word: 'hobkin' })
    assert.ok(tones.length > 0, name)
    assert.ok(soundLength(tones) <= LONGEST[name], `${name} lasts ${soundLength(tones)}s`)
    for (const tone of tones) {
      assert.ok(tone.peak > 0 && tone.peak <= (name === 'talk' ? TALK_LOUDEST : LOUDEST), `${name} peaks at ${tone.peak}`)
      assert.ok(tone.at >= 0 && tone.length > 0 && tone.from > 0 && tone.to > 0, name)
      // It rises from silence and has room to fade back to it, so it never clicks.
      assert.ok(tone.attack > 0 && tone.attack + FADE_OUT < tone.length, `${name} has room for its envelope`)
      const curve = pitchCurve(tone)
      assert.deepEqual([curve[0]![0], curve.at(-1)![0]], [0, tone.length], `${name}'s pitch runs from its start to its end`)
      assert.ok(curve.every(([at, hz], index) => hz > 0 && (index === 0 || at > curve[index - 1]![0])), `${name}'s pitch moves forward in time and stays above zero`)
    }
  }
})

/** The voiced part of a syllable: the tone that trills. */
const bodyOf = (word: string): Tone => tonesOf('talk', { word }).find((tone) => tone.trill)!

test('a babbled syllable rolls: a quick start, a trill of a few semitones, and a duller tail it settles into', () => {
  for (const word of ['a', 'hello', 'tomorrow', '']) {
    const tones = tonesOf('talk', { word })
    const body = bodyOf(word)
    const length = soundLength(tones)

    assert.ok(length >= 0.05 && length <= 0.11, `${JSON.stringify(word)} lasts ${length}s`)
    assert.ok(body.trill!.rate >= 18 && body.trill!.rate <= 26, `the "rr" trills ${body.trill!.rate} times a second`)
    assert.ok(body.trill!.depth >= 1 && body.trill!.depth <= 3, 'a few semitones wide')
    // The "t": the pitch falls into the word's own.
    assert.ok(body.onset!.ratio > 1 && body.onset!.length <= 0.02)
    const curve = pitchCurve(body)
    assert.ok(curve[0]![1] > curve[1]![1], 'it starts above and falls')
    // The trill goes up and down around the word's pitch, more than once.
    const turns = curve.slice(1, -1).filter(([, hz], index) => Math.sign(hz - curve[index]![1]) !== Math.sign(curve[index + 2]![1] - hz)).length
    assert.ok(turns >= 2, `${JSON.stringify(word)} turns ${turns} times`)
    // The "m": a duller wave that outlasts the voiced part, a little lower.
    const tail = tones.at(-1)!
    assert.equal(tail.wave, 'sine')
    assert.ok(tail.at + tail.length > body.at + body.length && tail.from < body.from)
  }
  assert.ok(soundLength(tonesOf('talk', { word: 'a' })) < soundLength(tonesOf('talk', { word: 'tomorrow' })), 'a longer word, a longer syllable')
  assert.deepEqual(bodyOf('hello').trill, bodyOf('Hello!').trill, 'the same word rolls the same way')
  // Called 45 ms apart, syllables run together into one mumble.
  assert.ok(soundLength(tonesOf('talk', { word: 'a' })) > 0.045)
})

test('a word babbles at its own pitch, the same every time, inside one pleasant range', () => {
  const words = ['hello', 'there', 'I', 'finished', 'the', 'review', 'and', 'it', 'looks', 'good', 'tomorrow', 'we', 'ship']
  const pitches = words.map(talkPitch)

  assert.deepEqual(words.map(talkPitch), pitches, 'the same word, the same pitch')
  assert.equal(new Set(pitches).size, words.length, 'different words, different pitches')
  assert.equal(talkPitch('Hello,'), talkPitch('hello'), 'capitals and punctuation do not change how a word sounds')
  for (const word of [...words, '', '   ', '…?!', '🦔', 'x'.repeat(500), 'naïve', '日本']) {
    const pitch = talkPitch(word)
    assert.ok(Number.isFinite(pitch) && pitch >= TALK_RANGE.low && pitch <= TALK_RANGE.high, `${JSON.stringify(word)} gives ${pitch}`)
  }
  // The syllable sits on the word's pitch and settles only a little from it.
  const body = bodyOf('hello')
  assert.equal(body.from, talkPitch('hello'))
  assert.ok(Math.abs(body.to / body.from - 1) <= 0.08)
  assert.ok(tonesOf('talk').length > 0, 'no word still babbles')
})

test('the player makes one oscillator and one gain for each tone, starts and stops each, and connects them to the speakers', () => {
  const context = fakeContext(2)
  const tones = tonesOf('chime')
  playTones(context as unknown as SoundContext, tones)

  assert.equal(context.oscillators.length, tones.length)
  assert.equal(context.gains.length, tones.length)
  tones.forEach((tone, index) => {
    const oscillator = context.oscillators[index]!
    const gain = context.gains[index]!
    assert.equal(oscillator.type, tone.wave)
    assert.deepEqual(oscillator.connected, [gain])
    assert.deepEqual(gain.connected, [context.destination])
    assert.ok(oscillator.started! >= context.currentTime + tone.at, 'never scheduled in the past')
    assert.ok(Math.abs(oscillator.stopped! - (oscillator.started! + tone.length)) < 1e-9)
    assert.deepEqual(oscillator.frequency.events[0], ['set', tone.from, oscillator.started])
    // The envelope starts and ends at silence, and its top is the tone's peak.
    const levels = gain.gain.events
    assert.deepEqual(levels[0], ['set', 0, oscillator.started])
    assert.equal(levels.at(-1)![1], 0)
    assert.ok(Math.abs(levels.at(-1)![2] - oscillator.stopped!) < 1e-9)
    assert.equal(Math.max(...levels.map(([, value]) => value)), tone.peak)
  })

  // A trilled syllable's pitch follows its curve, point by point, on the same clock.
  const babble = fakeContext(5)
  const syllable = tonesOf('talk', { word: 'hello' })
  playTones(babble as unknown as SoundContext, syllable)
  syllable.forEach((tone, index) => {
    const oscillator = babble.oscillators[index]!
    assert.deepEqual(
      oscillator.frequency.events.map(([, hz, at]) => [hz, Math.round((at - oscillator.started!) * 1e6) / 1e6]),
      pitchCurve(tone).map(([at, hz]) => [hz, Math.round(at * 1e6) / 1e6]),
    )
  })
})

test('a sound asked for again too soon is skipped, so notices that arrive together chime once, and babble keeps up', () => {
  assert.equal(mayPlay('chime', 1000, undefined), true)
  assert.equal(mayPlay('chime', 1400, 1000), false)
  assert.equal(mayPlay('chime', 3000, 1000), true)
  assert.equal(mayPlay('talk', 1045, 1000), true, 'one word every 45 ms')
})

test('a new line hobkin says in its bubble babbles once, and what it is doing stays quiet', () => {
  const tip: Bubble = { kind: 'tip', text: 'Cmd+K finds anything and takes you there.' }
  const doing: Bubble = { kind: 'doing', text: "I'm thinking…" }

  assert.deepEqual(bubbleCue(null, tip), { name: 'talk', detail: { word: 'Cmd+K' } })
  assert.deepEqual(bubbleCue(doing, { kind: 'greeting', text: 'Hello again!' }), { name: 'talk', detail: { word: 'Hello' } })
  assert.deepEqual(bubbleCue(tip, { kind: 'reminder', text: 'Daily check: 1 of 9 reports opened. Revisit it?' }), { name: 'talk', detail: { word: 'Daily' } })
  assert.equal(bubbleCue(tip, { ...tip }), null, 'the same line kept on screen, as while it is read, says nothing new')
  assert.equal(bubbleCue(null, doing), null)
  assert.equal(bubbleCue(doing, { kind: 'doing', text: "I'm writing…" }), null)
  assert.equal(bubbleCue(tip, null), null)
})

test('hobkin chirps once as its mood turns to one it hops in, and not while it holds still', () => {
  assert.deepEqual(hopCue('idle', 'happy', false), { name: 'hop' })
  assert.deepEqual(hopCue('thinking', 'celebrating', false), { name: 'hop' })
  assert.equal(hopCue('happy', 'happy', false), null)
  assert.equal(hopCue('happy', 'celebrating', false), null, 'already hopping')
  assert.equal(hopCue('happy', 'idle', false), null)
  assert.equal(hopCue('idle', 'happy', true), null, 'a face held still does not hop')
})

test('with sound off, or with no audio in the page, play makes nothing and never throws', () => {
  const made = { count: 0 }
  page.AudioContext = contextClass(fakeContext(), made)
  useSettings.getState().setSound(false)
  for (const name of SOUND_NAMES) assert.doesNotThrow(() => play(name, { word: 'hi' }))
  assert.doesNotThrow(() => presses.get('pointerdown')?.())
  assert.equal(made.count, 0, 'no context while sound is off')

  useSettings.getState().setSound(true)
  Reflect.deleteProperty(page, 'AudioContext')
  for (const name of SOUND_NAMES) assert.doesNotThrow(() => play(name))
  assert.doesNotThrow(() => presses.get('keydown')?.())
  page.AudioContext = function AudioContext() {
    throw Error('No audio device.')
  }
  assert.doesNotThrow(() => play('tap'))
  Reflect.deleteProperty(page, 'AudioContext')
})

/** The context the sound module holds from the test before. */
let held = fakeContext()

test('until the user presses something the page plays nothing, and a press lets sound start', async () => {
  // The Mac's web view starts audio suspended until the user does something.
  const context = (held = fakeContext())
  context.state = 'suspended'
  context.resume = () => {
    context.resumes += 1
    return new Promise(() => {})
  }
  page.AudioContext = contextClass(context)
  useSettings.getState().setSound(true)

  play('pick')
  await new Promise((done) => setTimeout(done, 5))
  assert.equal(context.oscillators.length, 0, 'nothing waits to burst out later')
  presses.get('pointerdown')!()
  assert.ok(context.resumes >= 2, 'the press asks the page to start audio')

  context.state = 'running'
  play('tap')
  assert.equal(context.oscillators.length, tonesOf('tap').length)
})

test('a sound asked for in the press that starts audio still plays, as when the user turns sound on', async () => {
  const context = fakeContext()
  context.state = 'suspended'
  context.resume = async () => void (context.state = 'running')
  // The context before is gone, so the page makes a new one.
  held.state = 'closed'
  page.AudioContext = contextClass(context)

  play('cheer')
  await new Promise((done) => setTimeout(done, 5))
  assert.equal(context.oscillators.length, tonesOf('cheer').length)
  useSettings.getState().setSound(false)
})
