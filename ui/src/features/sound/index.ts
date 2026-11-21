import { useSettings } from '../settings/store.ts'
import { playTones } from './player.ts'
import { mayPlay, soundLength, tonesOf, type SoundName } from './sounds.ts'

export type { SoundName } from './sounds.ts'

/**
 * hobkin's sounds in the page: one Web Audio context, made on the first sound that may play, and only while the user
 * has sound on (Settings › Sound). What each sound is lives in `sounds.ts`; how a sound is played, in `player.ts`.
 *
 * A running context keeps an audio thread awake in the window's GPU process, so it is suspended once it has been quiet
 * for a while, and the next sound resumes it before it plays (spec 052).
 */

const page = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }

/** The page's one context, or null before it is needed. A closed one is replaced. */
let context: AudioContext | null = null
/** It has run, so a sound may resume it without a press. Reset with each new context. */
let ran = false
/** A sound asked it to resume and it has not yet: the next press starts it, as before it ever ran. */
let waiting = false
/** The page held a resume outside a press back, so it is never suspended again and plays as it did before. */
let keepRunning = false
/** The suspend waiting for the audio to be quiet long enough. */
let quiet: ReturnType<typeof setTimeout> | undefined
/** When each sound last played, on `performance.now()`'s clock. */
const playedAt = new Map<SoundName, number>()

/**
 * A sound held while the page starts its audio plays only if the start comes this soon after, in milliseconds. That
 * lets through the sound of the press that turns sound on; anything later would land after what it was for.
 */
const ON_TIME_MS = 150
/** How long the audio runs on after its last sound ends, in milliseconds, before it is suspended. */
const QUIET_MS = 3000
/** A resume of audio that has run that takes longer than this was held back by the page: its sound is dropped. */
const RESUMED_IN_MS = 1000

/** The context, made now if there is none. Null where the page has no audio: a server, a test, a Mac with no device. */
function contextNow(): AudioContext | null {
  if (context && context.state !== 'closed') return context
  const Context = page.AudioContext ?? page.webkitAudioContext
  if (typeof Context !== 'function') return null
  context = new Context()
  ran = false
  waiting = false
  keepRunning = false
  return context
}

/** The audio runs: from now on a sound may resume it without a press, and it is suspended once quiet for `ms` and QUIET_MS. */
function runUntilQuiet(audio: AudioContext, ms: number): void {
  ran = true
  waiting = false
  clearTimeout(quiet)
  if (keepRunning) return

  quiet = setTimeout(() => {
    const ours = audio === context && audio.state === 'running'
    if (ours && !keepRunning) audio.suspend().catch(() => {})
  }, ms + QUIET_MS)
}

function sound(audio: AudioContext, name: SoundName, detail: { word?: string } | undefined, at: number): void {
  if (!mayPlay(name, at, playedAt.get(name))) return
  playedAt.set(name, at)

  const tones = tonesOf(name, detail)
  playTones(audio, tones)
  runUntilQuiet(audio, soundLength(tones) * 1000)
}

/**
 * Plays a sound once audio that is not running has resumed. Audio that has run was suspended while quiet: it resumes
 * first and the sound plays then, so its start is not clipped. A resume the page holds back past RESUMED_IN_MS drops the
 * sound and keeps the audio running from then on. Audio that has never run is still waiting for the user to do
 * something. Before then nothing plays, and nothing waits to burst out later: only a sound asked for in the very press
 * that starts audio gets through.
 */
function resumeAndPlay(audio: AudioContext, name: SoundName, detail: { word?: string } | undefined, asked: number): void {
  const hasRun = ran
  let late = false
  const heldBack = hasRun
    ? setTimeout(() => {
        late = true
        if (audio.state !== 'running') keepRunning = true
      }, RESUMED_IN_MS)
    : undefined
  waiting = true
  clearTimeout(quiet)

  audio
    .resume()
    .then(() => {
      clearTimeout(heldBack)
      if (audio.state !== 'running') return

      const now = performance.now()
      const onTime = hasRun ? !late : now - asked <= ON_TIME_MS
      if (onTime) sound(audio, name, detail, now)
      else runUntilQuiet(audio, 0)
    })
    .catch(() => {})
}

/** Plays a sound if sound is on and the page may play audio. Never throws, and does nothing on a server or in a test. */
export function play(name: SoundName, detail?: { word?: string }): void {
  try {
    if (!useSettings.getState().sound) return
    const audio = contextNow()
    if (!audio) return

    const asked = performance.now()
    if (audio.state === 'running') sound(audio, name, detail, asked)
    else resumeAndPlay(audio, name, detail, asked)
  } catch {
    // A page that cannot make a sound stays quiet.
  }
}

/**
 * The Mac's web view lets audio start only inside a press. So with sound on, a pointer or key press makes the context
 * if there is none yet, and starts it if it has never run or a sound is waiting on it. Audio suspended while quiet is
 * left asleep: the next sound resumes it.
 */
function wake(): void {
  try {
    if (!useSettings.getState().sound) return
    const audio = contextNow()
    if (!audio || audio.state === 'running' || (ran && !waiting)) return
    audio
      .resume()
      .then(() => {
        if (audio.state === 'running') runUntilQuiet(audio, 0)
      })
      .catch(() => {})
  } catch {
    // A page that cannot make a sound stays quiet.
  }
}

const PRESSES = ['pointerdown', 'keydown'] as const
if (typeof page.addEventListener === 'function') for (const type of PRESSES) page.addEventListener(type, wake, { capture: true, passive: true })

// A hot update runs this file again with a context of its own, so the old one closes and stops listening.
import.meta.hot?.dispose(() => {
  for (const type of PRESSES) page.removeEventListener?.(type, wake, { capture: true })
  clearTimeout(quiet)
  void context?.close().catch(() => {})
  context = null
})
