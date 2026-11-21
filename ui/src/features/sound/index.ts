import { useSettings } from '../settings/store.ts'
import { playTones } from './player.ts'
import { mayPlay, tonesOf, type SoundName } from './sounds.ts'

export type { SoundName } from './sounds.ts'

/**
 * hobkin's sounds in the page: one Web Audio context, made on the first sound that may play, and only while the user
 * has sound on (Settings › Sound). What each sound is lives in `sounds.ts`; how a sound is played, in `player.ts`.
 */

const page = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }

/** The page's one context, or null before it is needed. A closed one is replaced. */
let context: AudioContext | null = null
/** When each sound last played, on `performance.now()`'s clock. */
const playedAt = new Map<SoundName, number>()

/**
 * A sound held while the page starts its audio plays only if the start comes this soon after, in milliseconds. That
 * lets through the sound of the press that turns sound on; anything later would land after what it was for.
 */
const ON_TIME_MS = 150

/** The context, made now if there is none. Null where the page has no audio: a server, a test, a Mac with no device. */
function contextNow(): AudioContext | null {
  if (context && context.state !== 'closed') return context
  const Context = page.AudioContext ?? page.webkitAudioContext
  if (typeof Context !== 'function') return null
  context = new Context()
  return context
}

function sound(audio: AudioContext, name: SoundName, detail: { word?: string } | undefined, at: number): void {
  if (!mayPlay(name, at, playedAt.get(name))) return
  playedAt.set(name, at)
  playTones(audio, tonesOf(name, detail))
}

/** Plays a sound if sound is on and the page may play audio. Never throws, and does nothing on a server or in a test. */
export function play(name: SoundName, detail?: { word?: string }): void {
  try {
    if (!useSettings.getState().sound) return
    const audio = contextNow()
    if (!audio) return
    const asked = performance.now()
    if (audio.state === 'running') return sound(audio, name, detail, asked)
    // The page starts audio suspended until the user does something. Before then nothing plays, and nothing waits to
    // burst out later: only a sound asked for in the very press that starts audio gets through.
    audio
      .resume()
      .then(() => {
        const now = performance.now()
        if (audio.state === 'running' && now - asked <= ON_TIME_MS) sound(audio, name, detail, now)
      })
      .catch(() => {})
  } catch {
    // A page that cannot make a sound stays quiet.
  }
}

/**
 * The Mac's web view lets audio start only inside a press. So with sound on, each pointer or key press makes the context
 * if there is none yet and starts it if it is not running, and the next sound plays.
 */
function wake(): void {
  try {
    if (!useSettings.getState().sound) return
    const audio = contextNow()
    if (audio && audio.state !== 'running') audio.resume().catch(() => {})
  } catch {
    // A page that cannot make a sound stays quiet.
  }
}

const PRESSES = ['pointerdown', 'keydown'] as const
if (typeof page.addEventListener === 'function') for (const type of PRESSES) page.addEventListener(type, wake, { capture: true, passive: true })

// A hot update runs this file again with a context of its own, so the old one closes and stops listening.
import.meta.hot?.dispose(() => {
  for (const type of PRESSES) page.removeEventListener?.(type, wake, { capture: true })
  void context?.close().catch(() => {})
  context = null
})
